import type { WeightEntry, WeightSource } from '@prisma/client';

import { NotFoundError } from '../../shared/errors/index.js';
import { buildPage, decodeCursor, type Cursor } from '../../shared/http/pagination.js';
import {
  addLocalDays,
  daysBetween,
  localDateRange,
  todayIn,
  type LocalDate,
} from '../../shared/utils/local-date.js';
import { poundsToKg } from '../nutrition/nutrition.calculator.js';
import { toApiEnum, toPrismaEnum } from '../onboarding/onboarding.mappers.js';
import { trendPerMonth } from '../workouts/workouts.calculator.js';
import type { ProgressRepository } from './progress.repository.js';
import type { ListWeightQuery, RecordWeightInput, SummaryQuery } from './progress.schema.js';

/**
 * Progress business rules (screen 12).
 *
 * A day counts towards the streak if the user weighed in *or* completed a
 * workout. Meal logging will join that list once it exists — the definition
 * lives in one place (the repository's activity query) so adding a source does
 * not change this logic.
 */

export interface UserContext {
  userId: string;
  timezone: string;
}

/** How far back the streak will look. A year is far beyond any real streak. */
const STREAK_LOOKBACK_DAYS = 400;

export class ProgressService {
  constructor(private readonly repository: ProgressRepository) {}

  async recordWeight(context: UserContext, input: RecordWeightInput) {
    const weightKg = input.unit === 'lb' ? poundsToKg(input.weight) : input.weight;
    const localDate = input.date ?? todayIn(context.timezone);

    const entry = await this.repository.upsertWeight({
      userId: context.userId,
      weightKg,
      localDate,
      recordedAt: new Date(),
      source: toPrismaEnum<WeightSource>(input.source),
      note: input.note,
    });

    return toWeightEntry(entry);
  }

  async listWeights(context: UserContext, query: ListWeightQuery) {
    const cursor: Cursor | undefined = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

    const rows = await this.repository.findWeightPage(context.userId, query.limit, cursor);
    const page = buildPage(rows, query.limit, (row) => ({
      at: row.recordedAt.toISOString(),
      id: row.id,
    }));

    return { items: page.items.map(toWeightEntry), pagination: page.pagination };
  }

  async deleteWeight(context: UserContext, entryId: string): Promise<void> {
    const removed = await this.repository.deleteWeight(context.userId, entryId);
    // Scoped by userId in the query, so a miss means "not yours or not there".
    if (removed.count === 0) throw new NotFoundError('Weight entry not found.');
  }

  async getStreak(context: UserContext) {
    const today = todayIn(context.timezone);
    const activeDates = await this.repository.findActiveDates(
      context.userId,
      addLocalDays(today, -STREAK_LOOKBACK_DAYS),
      today,
    );

    return computeStreak(activeDates, today);
  }

  async getAdherence(context: UserContext, from: LocalDate, to: LocalDate) {
    const today = todayIn(context.timezone);
    const weekStart = startOfWeek(today);

    const [preference, activeInWeek, periodTotals] = await Promise.all([
      this.repository.findTrainingTargetPerWeek(context.userId),
      this.repository.findCompletedWorkoutDates(context.userId, weekStart, today),
      this.repository.findTrainingTotals(context.userId, from, to),
    ]);

    const trainedDays = new Set(activeInWeek);

    return {
      targetPerWeek: preference?.daysPerWeek ?? 0,
      completedThisWeek: trainedDays.size,
      week: localDateRange(weekStart, addLocalDays(weekStart, 6)).map((date) => ({
        date,
        trained: trainedDays.has(date),
      })),
      completedInPeriod: periodTotals.sessions,
    };
  }

  async getSummary(context: UserContext, query: SummaryQuery) {
    const today = todayIn(context.timezone);
    const from = periodStart(query.period, today);

    const [weights, firstEver, goal, totals, streak, adherence] = await Promise.all([
      this.repository.findWeightsBetween(context.userId, from, today),
      this.repository.findFirstWeight(context.userId),
      this.repository.findWeightGoal(context.userId),
      this.repository.findTrainingTotals(context.userId, from, today),
      this.getStreak(context),
      this.getAdherence(context, from, today),
    ]);

    return {
      period: query.period,
      from,
      to: today,
      weight: buildWeightSummary(weights, firstEver, goal?.targetWeightKg ?? null),
      streak,
      adherence,
      training: totals,
    };
  }
}

// --- Pure helpers, kept out of the service so they are directly testable -----

/**
 * Counts consecutive active days ending today or yesterday.
 *
 * Yesterday still counts as "current": a user who has not yet logged today has
 * not broken anything, and resetting their streak at midnight would punish them
 * for the clock rather than for missing a day.
 */
export function computeStreak(activeDates: LocalDate[], today: LocalDate) {
  const active = new Set(activeDates);
  const sorted = [...active].sort((a, b) => b.localeCompare(a));

  const mostRecent = sorted[0] ?? null;
  const activeToday = active.has(today);

  let currentDays = 0;
  if (mostRecent !== null) {
    const gap = daysBetween(mostRecent, today);

    if (gap <= 1) {
      let cursor = mostRecent;
      while (active.has(cursor)) {
        currentDays += 1;
        cursor = addLocalDays(cursor, -1);
      }
    }
  }

  return {
    currentDays,
    longestDays: longestRun(sorted),
    lastActiveDate: mostRecent,
    activeToday,
  };
}

/** Longest consecutive run anywhere in the history. */
function longestRun(descendingDates: LocalDate[]): number {
  if (descendingDates.length === 0) return 0;

  let longest = 1;
  let run = 1;

  for (let index = 1; index < descendingDates.length; index += 1) {
    const previous = descendingDates[index - 1];
    const current = descendingDates[index];
    if (previous === undefined || current === undefined) continue;

    run = daysBetween(current, previous) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  return longest;
}

export function buildWeightSummary(
  windowEntries: WeightEntry[],
  firstEver: WeightEntry | null,
  targetKg: number | null,
) {
  const trend = windowEntries.map((entry) => ({
    date: entry.localDate,
    weightKg: entry.weightKg,
  }));

  const currentKg = windowEntries.at(-1)?.weightKg ?? null;
  const startingKg = firstEver?.weightKg ?? null;
  const changeKg = currentKg === null || startingKg === null ? null : round1(currentKg - startingKg);

  // Reuse the same least-squares fit as strength progress, then convert the
  // per-30-day slope to per-week.
  const perMonth = trendPerMonth(trend.map((point) => ({ date: point.date, value: point.weightKg })));
  const changePerWeekKg = perMonth === null ? null : round2((perMonth * 7) / 30);

  return {
    currentKg,
    startingKg,
    targetKg,
    changeKg,
    changePerWeekKg,
    estimatedWeeksToTarget: estimateWeeksToTarget(currentKg, targetKg, changePerWeekKg),
    trend,
  };
}

/**
 * Weeks to target at the observed rate.
 *
 * Null when the trend points away from the target — projecting an arrival date
 * from a trend heading the wrong way would be actively misleading.
 */
function estimateWeeksToTarget(
  currentKg: number | null,
  targetKg: number | null,
  changePerWeekKg: number | null,
): number | null {
  if (currentKg === null || targetKg === null || changePerWeekKg === null) return null;

  const remaining = targetKg - currentKg;
  if (Math.abs(remaining) < 0.1) return 0;
  if (Math.sign(remaining) !== Math.sign(changePerWeekKg)) return null;
  if (changePerWeekKg === 0) return null;

  return Math.max(1, Math.ceil(remaining / changePerWeekKg));
}

function periodStart(period: 'week' | 'month' | 'all', today: LocalDate): LocalDate {
  if (period === 'week') return addLocalDays(today, -6);
  if (period === 'month') return addLocalDays(today, -29);
  // "All time" is bounded rather than unbounded: a query with no floor would
  // scan the whole table as history grows.
  return addLocalDays(today, -365 * 3);
}

/** Monday-anchored, matching the weekly strip on screen 12. */
export function startOfWeek(date: LocalDate): LocalDate {
  const parsed = new Date(`${date}T00:00:00Z`);
  const dayOfWeek = parsed.getUTCDay();
  return addLocalDays(date, dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
}

function toWeightEntry(entry: WeightEntry) {
  return {
    id: entry.id,
    weightKg: entry.weightKg,
    date: entry.localDate,
    recordedAt: entry.recordedAt.toISOString(),
    source: toApiEnum<'manual' | 'scale' | 'import'>(entry.source),
    note: entry.note,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
