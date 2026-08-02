import type { Equipment, Exercise, ExerciseCategory, MuscleGroup, SessionStatus } from '@prisma/client';

import { BusinessRuleError, NotFoundError } from '../../shared/errors/index.js';
import { buildPage, decodeCursor, type Cursor } from '../../shared/http/pagination.js';
import { toApiEnum, toApiEnums, toPrismaEnum } from '../onboarding/onboarding.mappers.js';
import { todayIn, toLocalDate, type LocalDate } from '../../shared/utils/local-date.js';
import {
  bestOneRepMax,
  estimateOneRepMax,
  totalReps,
  totalVolumeKg,
  trendPerMonth,
  workingSetCount,
  type CompletedSet,
} from './workouts.calculator.js';
import type { SessionWithSets, SetLogWithExercise, WorkoutsRepository } from './workouts.repository.js';
import type {
  CompleteSessionInput,
  ListExercisesQuery,
  ListSessionsQuery,
  LogSetInput,
  StartSessionInput,
} from './workouts.schema.js';

/**
 * Training log business rules.
 *
 * The important one: a session is the user's, always. Every read and write goes
 * through an ownership check, because a session id is exposed to the client and
 * guessing one must not reveal or corrupt somebody else's training.
 */

export interface UserContext {
  userId: string;
  timezone: string;
}

export class WorkoutsService {
  constructor(private readonly repository: WorkoutsRepository) {}

  // --- Catalog --------------------------------------------------------------

  async listExercises(query: ListExercisesQuery) {
    const exercises = await this.repository.findExercises({
      category: query.category === undefined ? undefined : toPrismaEnum<ExerciseCategory>(query.category),
      muscle: query.muscle === undefined ? undefined : toPrismaEnum<MuscleGroup>(query.muscle),
      equipment: query.equipment === undefined ? undefined : toPrismaEnum<Equipment>(query.equipment),
      search: query.q,
    });

    return exercises.map(toExerciseSummary);
  }

  async getExercise(context: UserContext, exerciseId: string) {
    const exercise = await this.repository.findExerciseById(exerciseId);
    if (!exercise) throw new NotFoundError('Exercise not found.');

    const lastSet = await this.repository.findLastWorkingSet(context.userId, exerciseId);

    return {
      ...toExerciseSummary(exercise),
      howToSteps: exercise.howToSteps,
      demoVideoKey: exercise.demoVideoKey,
      lastPerformed:
        lastSet === null
          ? null
          : {
              performedAt: lastSet.createdAt.toISOString(),
              weightKg: lastSet.weightKg,
              reps: lastSet.reps,
              estimatedOneRepMaxKg:
                lastSet.weightKg === null ? null : estimateOneRepMax(lastSet.weightKg, lastSet.reps),
            },
    };
  }

  // --- Sessions -------------------------------------------------------------

  /**
   * Starts a session, or returns the one already open.
   *
   * Idempotent on purpose: the app can double-fire "Start workout" on a flaky
   * connection, and two open sessions would split one workout's sets in half.
   */
  async startSession(context: UserContext, input: StartSessionInput) {
    const existing = await this.repository.findOpenSession(context.userId);
    // `created` is reported rather than inferred: a resumed session with no sets
    // yet is indistinguishable from a new one by looking at its contents.
    if (existing) return { session: toSessionDetail(existing), created: false };

    const now = new Date();
    const session = await this.repository.createSession({
      userId: context.userId,
      title: input.title ?? null,
      startedAt: now,
      localDate: toLocalDate(now, context.timezone),
    });

    return { session: toSessionDetail({ ...session, sets: [] }), created: true };
  }

  async getSession(context: UserContext, sessionId: string) {
    return toSessionDetail(await this.loadOwnedSession(context.userId, sessionId));
  }

  async getActiveSession(context: UserContext) {
    const session = await this.repository.findOpenSession(context.userId);
    return session === null ? null : toSessionDetail(session);
  }

  async listSessions(context: UserContext, query: ListSessionsQuery) {
    const cursor: Cursor | undefined = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

    const rows = await this.repository.findSessionPage(
      context.userId,
      query.limit,
      cursor,
      query.status === undefined ? undefined : toPrismaEnum<SessionStatus>(query.status),
    );

    const page = buildPage(rows, query.limit, (row) => ({
      at: row.startedAt.toISOString(),
      id: row.id,
    }));

    return { items: page.items.map(toSessionSummary), pagination: page.pagination };
  }

  async logSet(context: UserContext, sessionId: string, input: LogSetInput) {
    const session = await this.loadOwnedSession(context.userId, sessionId);

    if (session.status !== 'IN_PROGRESS') {
      throw new BusinessRuleError('This session is already finished, so sets cannot be changed.');
    }

    const exercise = await this.repository.findExerciseById(input.exerciseId);
    if (!exercise) throw new NotFoundError('Exercise not found.');

    // Reject load on an exercise where it is meaningless, rather than storing a
    // number that would later produce a nonsensical 1RM.
    if (!exercise.isWeighted && input.weightKg !== null && input.weightKg > 0) {
      throw new BusinessRuleError(`${exercise.name} is not a weighted exercise.`, [
        { path: 'weightKg', message: 'This exercise does not take a load.' },
      ]);
    }

    await this.repository.upsertSet({
      sessionId,
      userId: context.userId,
      exerciseId: input.exerciseId,
      setNumber: input.setNumber,
      reps: input.reps,
      weightKg: input.weightKg,
      durationSeconds: input.durationSeconds,
      isWarmup: input.isWarmup,
    });

    return this.getSession(context, sessionId);
  }

  async deleteSet(context: UserContext, sessionId: string, setId: string) {
    const session = await this.loadOwnedSession(context.userId, sessionId);

    if (session.status !== 'IN_PROGRESS') {
      throw new BusinessRuleError('This session is already finished, so sets cannot be changed.');
    }

    const removed = await this.repository.deleteSet(sessionId, setId);
    if (removed.count === 0) throw new NotFoundError('Set not found.');

    return this.getSession(context, sessionId);
  }

  async completeSession(context: UserContext, sessionId: string, input: CompleteSessionInput) {
    const session = await this.loadOwnedSession(context.userId, sessionId);

    // Idempotent: a retried request returns the finished session unchanged
    // rather than moving completedAt.
    if (session.status === 'COMPLETED') return toSessionDetail(session);

    if (session.sets.length === 0) {
      throw new BusinessRuleError('Log at least one set before finishing the workout.');
    }

    await this.repository.completeSession(sessionId, new Date(), input.perceivedExertion, input.notes);

    return this.getSession(context, sessionId);
  }

  async abandonSession(context: UserContext, sessionId: string) {
    const session = await this.loadOwnedSession(context.userId, sessionId);

    if (session.status === 'COMPLETED') {
      throw new BusinessRuleError('This session is already complete.');
    }

    await this.repository.abandonSession(sessionId);
    return this.getSession(context, sessionId);
  }

  async deleteSession(context: UserContext, sessionId: string): Promise<void> {
    await this.loadOwnedSession(context.userId, sessionId);
    // Soft delete: training history is exactly the kind of thing users ask to
    // have restored after a mistaken tap.
    await this.repository.softDeleteSession(sessionId, new Date());
  }

  // --- History and progress -------------------------------------------------

  async getExerciseHistory(
    context: UserContext,
    exerciseId: string,
    limit: number,
    rawCursor: string | undefined,
  ) {
    const exercise = await this.repository.findExerciseById(exerciseId);
    if (!exercise) throw new NotFoundError('Exercise not found.');

    const cursor = rawCursor === undefined ? undefined : decodeCursor(rawCursor);
    const rows = await this.repository.findSessionsForExercise(context.userId, exerciseId, limit, cursor);

    const page = buildPage(rows, limit, (row) => ({
      at: row.startedAt.toISOString(),
      id: row.id,
    }));

    return {
      items: page.items.map((session) => {
        const sets = session.sets.map(toCompletedSet);
        const working = session.sets.filter((set) => !set.isWarmup);

        return {
          sessionId: session.id,
          performedAt: session.startedAt.toISOString(),
          localDate: session.localDate,
          sets: session.sets.map((set) => ({
            setNumber: set.setNumber,
            reps: set.reps,
            weightKg: set.weightKg,
            isWarmup: set.isWarmup,
          })),
          topSetWeightKg: topWeight(working),
          estimatedOneRepMaxKg: bestOneRepMax(sets),
          totalVolumeKg: totalVolumeKg(sets),
        };
      }),
      pagination: page.pagination,
    };
  }

  /**
   * Strength trend and weekly volume for one exercise.
   *
   * Grouped in memory rather than SQL: a single user's history for a single
   * exercise is small (hundreds of rows at most), and the grouping needs the
   * user's local weeks, which the database does not know about.
   */
  async getExerciseProgress(context: UserContext, exerciseId: string) {
    const exercise = await this.repository.findExerciseById(exerciseId);
    if (!exercise) throw new NotFoundError('Exercise not found.');

    const sets = await this.repository.findSetsForExercise(context.userId, exerciseId, 1000);
    const totalSessions = await this.repository.countCompletedSessionsForExercise(context.userId, exerciseId);

    const byDate = groupBy(sets, (set) => toLocalDate(set.createdAt, context.timezone));

    const oneRepMaxTrend = [...byDate.entries()]
      .map(([date, daySets]) => ({ date, value: bestOneRepMax(daySets.map(toCompletedSet)) }))
      .filter((point): point is { date: LocalDate; value: number } => point.value !== null)
      .sort((a, b) => a.date.localeCompare(b.date));

    const byWeek = groupBy(sets, (set) => weekStartOf(toLocalDate(set.createdAt, context.timezone)));
    const weeklyVolume = [...byWeek.entries()]
      .map(([weekStart, weekSets]) => ({
        weekStart,
        volumeKg: totalVolumeKg(weekSets.map(toCompletedSet)),
        sets: workingSetCount(weekSets.map(toCompletedSet)),
      }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .slice(-12);

    return {
      exerciseId,
      isWeighted: exercise.isWeighted,
      currentOneRepMaxKg: oneRepMaxTrend.at(-1)?.value ?? null,
      oneRepMaxChangePerMonthKg: trendPerMonth(oneRepMaxTrend),
      oneRepMaxTrend,
      weeklyVolume,
      totalSessions,
    };
  }

  /**
   * Loads a session and proves it belongs to the caller.
   *
   * Reports 404 rather than 403 for someone else's session: confirming that an
   * id exists is itself a leak.
   */
  private async loadOwnedSession(userId: string, sessionId: string): Promise<SessionWithSets> {
    const session = await this.repository.findSessionById(sessionId);

    if (session?.userId !== userId) {
      throw new NotFoundError('Workout session not found.');
    }

    return session;
  }
}

// --- Projections ------------------------------------------------------------

function toExerciseSummary(exercise: Exercise) {
  return {
    id: exercise.id,
    slug: exercise.slug,
    name: exercise.name,
    category: toApiEnum(exercise.category),
    primaryMuscles: toApiEnums(exercise.primaryMuscles),
    secondaryMuscles: toApiEnums(exercise.secondaryMuscles),
    equipment: toApiEnums(exercise.equipment),
    isWeighted: exercise.isWeighted,
  };
}

function toCompletedSet(set: { reps: number; weightKg: number | null; isWarmup: boolean }): CompletedSet {
  return { reps: set.reps, weightKg: set.weightKg, isWarmup: set.isWarmup };
}

function toSessionSummary(session: SessionWithSets) {
  const sets = session.sets.map(toCompletedSet);
  const exerciseIds = new Set(session.sets.map((set) => set.exerciseId));

  return {
    id: session.id,
    status: toApiEnum(session.status),
    title: session.title,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    localDate: session.localDate,
    perceivedExertion: session.perceivedExertion,
    notes: session.notes,
    exerciseCount: exerciseIds.size,
    setCount: workingSetCount(sets),
    totalVolumeKg: totalVolumeKg(sets),
    totalReps: totalReps(sets),
    durationSeconds:
      session.completedAt === null
        ? null
        : Math.round((session.completedAt.getTime() - session.startedAt.getTime()) / 1000),
  };
}

function toSessionDetail(session: SessionWithSets) {
  return {
    ...toSessionSummary(session),
    sets: session.sets.map((set) => ({
      id: set.id,
      exerciseId: set.exerciseId,
      exerciseName: set.exercise.name,
      setNumber: set.setNumber,
      reps: set.reps,
      weightKg: set.weightKg,
      durationSeconds: set.durationSeconds,
      isWarmup: set.isWarmup,
    })),
  };
}

function topWeight(sets: { weightKg: number | null }[]): number | null {
  const weights = sets.map((set) => set.weightKg).filter((weight): weight is number => weight !== null);

  return weights.length === 0 ? null : Math.max(...weights);
}

/** ISO weeks start Monday; the progress chart groups by that. */
function weekStartOf(date: LocalDate): LocalDate {
  const parsed = new Date(`${date}T00:00:00Z`);
  const dayOfWeek = parsed.getUTCDay();
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  parsed.setUTCDate(parsed.getUTCDate() + offsetToMonday);
  return parsed.toISOString().slice(0, 10);
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [item]);
    else bucket.push(item);
  }

  return groups;
}

/** Re-exported so callers need not reach into the util directly. */
export { todayIn };

export type { SetLogWithExercise };
