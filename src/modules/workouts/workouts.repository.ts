import type {
  Equipment,
  Exercise,
  ExerciseCategory,
  MuscleGroup,
  Prisma,
  PrismaClient,
  SessionStatus,
  SetLog,
  WorkoutSession,
} from '@prisma/client';
import { uuidv7 } from 'uuidv7';

import type { Cursor } from '../../shared/http/pagination.js';

/**
 * All database access for the exercise catalog and training log.
 */

export interface ExerciseFilters {
  category?: ExerciseCategory | undefined;
  muscle?: MuscleGroup | undefined;
  equipment?: Equipment | undefined;
  search?: string | undefined;
}

export type SetLogWithExercise = SetLog & { exercise: Exercise };
export type SessionWithSets = WorkoutSession & { sets: SetLogWithExercise[] };

export interface CreateSessionInput {
  userId: string;
  title: string | null;
  startedAt: Date;
  localDate: string;
}

export interface UpsertSetInput {
  sessionId: string;
  userId: string;
  exerciseId: string;
  setNumber: number;
  reps: number;
  weightKg: number | null;
  durationSeconds: number | null;
  isWarmup: boolean;
}

export class WorkoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // --- Catalog --------------------------------------------------------------

  findExercises(filters: ExerciseFilters): Promise<Exercise[]> {
    const where: Prisma.ExerciseWhereInput = { isActive: true };

    if (filters.category !== undefined) where.category = filters.category;
    if (filters.muscle !== undefined) {
      // A muscle matches whether it is trained directly or as a secondary.
      where.OR = [{ primaryMuscles: { has: filters.muscle } }, { secondaryMuscles: { has: filters.muscle } }];
    }
    if (filters.equipment !== undefined) where.equipment = { has: filters.equipment };
    if (filters.search !== undefined) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    return this.prisma.exercise.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findExerciseById(id: string): Promise<Exercise | null> {
    return this.prisma.exercise.findFirst({ where: { id, isActive: true } });
  }

  findExercisesByIds(ids: string[]): Promise<Exercise[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.exercise.findMany({ where: { id: { in: ids }, isActive: true } });
  }

  // --- Sessions -------------------------------------------------------------

  createSession(input: CreateSessionInput): Promise<WorkoutSession> {
    return this.prisma.workoutSession.create({
      data: {
        id: uuidv7(),
        userId: input.userId,
        title: input.title,
        startedAt: input.startedAt,
        localDate: input.localDate,
      },
    });
  }

  findSessionById(id: string): Promise<SessionWithSets | null> {
    return this.prisma.workoutSession.findFirst({
      where: { id, deletedAt: null },
      include: {
        sets: { include: { exercise: true }, orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }] },
      },
    });
  }

  /** At most one session may be open at a time; the app resumes it on reopen. */
  findOpenSession(userId: string): Promise<SessionWithSets | null> {
    return this.prisma.workoutSession.findFirst({
      where: { userId, status: 'IN_PROGRESS', deletedAt: null },
      include: {
        sets: { include: { exercise: true }, orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }] },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Fetches `limit + 1` rows so the caller can tell whether another page exists
   * without a second COUNT query.
   */
  findSessionPage(
    userId: string,
    limit: number,
    cursor: Cursor | undefined,
    status: SessionStatus | undefined,
  ): Promise<SessionWithSets[]> {
    const where: Prisma.WorkoutSessionWhereInput = { userId, deletedAt: null };
    if (status !== undefined) where.status = status;

    if (cursor !== undefined) {
      // Keyset pagination: strictly older than the cursor, with the id breaking
      // ties so two sessions sharing a timestamp cannot be skipped or repeated.
      where.OR = [
        { startedAt: { lt: new Date(cursor.at) } },
        { startedAt: new Date(cursor.at), id: { lt: cursor.id } },
      ];
    }

    return this.prisma.workoutSession.findMany({
      where,
      include: { sets: { include: { exercise: true } } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  completeSession(
    id: string,
    completedAt: Date,
    perceivedExertion: number | null,
    notes: string | null,
  ): Promise<WorkoutSession> {
    return this.prisma.workoutSession.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt, perceivedExertion, notes },
    });
  }

  abandonSession(id: string): Promise<WorkoutSession> {
    return this.prisma.workoutSession.update({
      where: { id },
      data: { status: 'ABANDONED' },
    });
  }

  softDeleteSession(id: string, deletedAt: Date): Promise<WorkoutSession> {
    return this.prisma.workoutSession.update({ where: { id }, data: { deletedAt } });
  }

  // --- Sets -----------------------------------------------------------------

  /**
   * Re-logging the same set number replaces it, so correcting a mistyped weight
   * is idempotent rather than appending a duplicate.
   */
  upsertSet(input: UpsertSetInput): Promise<SetLog> {
    const payload = {
      reps: input.reps,
      weightKg: input.weightKg,
      durationSeconds: input.durationSeconds,
      isWarmup: input.isWarmup,
    };

    return this.prisma.setLog.upsert({
      where: {
        sessionId_exerciseId_setNumber: {
          sessionId: input.sessionId,
          exerciseId: input.exerciseId,
          setNumber: input.setNumber,
        },
      },
      update: payload,
      create: {
        id: uuidv7(),
        sessionId: input.sessionId,
        userId: input.userId,
        exerciseId: input.exerciseId,
        setNumber: input.setNumber,
        ...payload,
      },
    });
  }

  deleteSet(sessionId: string, setId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.setLog.deleteMany({ where: { id: setId, sessionId } });
  }

  // --- History and progress -------------------------------------------------

  /** Every logged set for one exercise, newest first. Drives history and trend. */
  findSetsForExercise(userId: string, exerciseId: string, take?: number): Promise<SetLogWithExercise[]> {
    return this.prisma.setLog.findMany({
      where: { userId, exerciseId, session: { deletedAt: null, status: 'COMPLETED' } },
      include: { exercise: true },
      orderBy: [{ createdAt: 'desc' }, { setNumber: 'asc' }],
      ...(take === undefined ? {} : { take }),
    });
  }

  /** The caller's most recent working set, used to pre-fill the log. */
  findLastWorkingSet(userId: string, exerciseId: string): Promise<SetLog | null> {
    return this.prisma.setLog.findFirst({
      where: {
        userId,
        exerciseId,
        isWarmup: false,
        session: { deletedAt: null, status: 'COMPLETED' },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Sessions in which an exercise appears, for the history list. */
  async findSessionsForExercise(
    userId: string,
    exerciseId: string,
    limit: number,
    cursor: Cursor | undefined,
  ): Promise<SessionWithSets[]> {
    const where: Prisma.WorkoutSessionWhereInput = {
      userId,
      deletedAt: null,
      status: 'COMPLETED',
      sets: { some: { exerciseId } },
    };

    if (cursor !== undefined) {
      where.OR = [
        { startedAt: { lt: new Date(cursor.at) } },
        { startedAt: new Date(cursor.at), id: { lt: cursor.id } },
      ];
    }

    return this.prisma.workoutSession.findMany({
      where,
      // Only this exercise's sets — the history card shows one exercise at a time.
      include: {
        sets: { where: { exerciseId }, include: { exercise: true }, orderBy: { setNumber: 'asc' } },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  countCompletedSessionsForExercise(userId: string, exerciseId: string): Promise<number> {
    return this.prisma.workoutSession.count({
      where: { userId, deletedAt: null, status: 'COMPLETED', sets: { some: { exerciseId } } },
    });
  }

  /** Completed sessions in a local-date window, for adherence and streaks. */
  findCompletedSessionsBetween(
    userId: string,
    fromLocalDate: string,
    toLocalDate: string,
  ): Promise<WorkoutSession[]> {
    return this.prisma.workoutSession.findMany({
      where: {
        userId,
        deletedAt: null,
        status: 'COMPLETED',
        localDate: { gte: fromLocalDate, lte: toLocalDate },
      },
      orderBy: { localDate: 'asc' },
    });
  }
}
