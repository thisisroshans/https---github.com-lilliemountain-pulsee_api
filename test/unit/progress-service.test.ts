import type { WeightEntry } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  buildWeightSummary,
  computeStreak,
  startOfWeek,
} from '../../src/modules/progress/progress.service.js';

/**
 * The streak is the retention mechanic, so its edges are pinned explicitly:
 * an unlogged today must not read as broken, and a real gap must.
 */

const TODAY = '2026-08-02'; // a Sunday

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    const streak = computeStreak(['2026-08-02', '2026-08-01', '2026-07-31'], TODAY);

    expect(streak.currentDays).toBe(3);
    expect(streak.activeToday).toBe(true);
    expect(streak.lastActiveDate).toBe('2026-08-02');
  });

  it('keeps the streak alive when today is not logged yet', () => {
    // Resetting at midnight would punish the user for the clock, not a miss.
    const streak = computeStreak(['2026-08-01', '2026-07-31'], TODAY);

    expect(streak.currentDays).toBe(2);
    expect(streak.activeToday).toBe(false);
  });

  it('breaks the streak after a missed day', () => {
    const streak = computeStreak(['2026-07-31', '2026-07-30'], TODAY);

    expect(streak.currentDays).toBe(0);
    expect(streak.lastActiveDate).toBe('2026-07-31');
  });

  it('stops counting at the first gap', () => {
    const streak = computeStreak(['2026-08-02', '2026-08-01', '2026-07-30', '2026-07-29'], TODAY);

    expect(streak.currentDays).toBe(2);
  });

  it('reports the longest run even when the current one is shorter', () => {
    const streak = computeStreak(
      ['2026-08-02', '2026-07-20', '2026-07-19', '2026-07-18', '2026-07-17'],
      TODAY,
    );

    expect(streak.currentDays).toBe(1);
    expect(streak.longestDays).toBe(4);
  });

  it('handles a single day', () => {
    const streak = computeStreak([TODAY], TODAY);

    expect(streak).toMatchObject({ currentDays: 1, longestDays: 1, activeToday: true });
  });

  it('handles no history at all', () => {
    expect(computeStreak([], TODAY)).toEqual({
      currentDays: 0,
      longestDays: 0,
      lastActiveDate: null,
      activeToday: false,
    });
  });

  it('counts a run that crosses a month boundary', () => {
    const streak = computeStreak(['2026-08-02', '2026-08-01', '2026-07-31', '2026-07-30'], TODAY);

    expect(streak.currentDays).toBe(4);
  });

  it('is not confused by unsorted or duplicated input', () => {
    const streak = computeStreak(['2026-07-31', '2026-08-02', '2026-08-01', '2026-08-02'], TODAY);

    expect(streak.currentDays).toBe(3);
  });
});

describe('startOfWeek', () => {
  it.each([
    ['2026-08-02', '2026-07-27'], // Sunday belongs to the week that began Monday
    ['2026-07-27', '2026-07-27'], // Monday is its own start
    ['2026-07-29', '2026-07-27'], // midweek
  ])('anchors %s to %s', (date, expected) => {
    expect(startOfWeek(date)).toBe(expected);
  });
});

describe('buildWeightSummary', () => {
  const entry = (localDate: string, weightKg: number): WeightEntry => ({
    id: `id-${localDate}`,
    userId: 'user-1',
    weightKg,
    localDate,
    recordedAt: new Date(`${localDate}T08:00:00Z`),
    source: 'MANUAL',
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('reports current, starting and change', () => {
    const entries = [entry('2026-07-01', 80), entry('2026-07-15', 78), entry('2026-08-01', 76)];

    const summary = buildWeightSummary(entries, entries[0] ?? null, 72);

    expect(summary.currentKg).toBe(76);
    expect(summary.startingKg).toBe(80);
    expect(summary.changeKg).toBe(-4);
    expect(summary.targetKg).toBe(72);
  });

  it('reports a weekly rate of loss as negative', () => {
    const entries = [entry('2026-07-05', 80), entry('2026-08-02', 76)];

    const summary = buildWeightSummary(entries, entries[0] ?? null, 72);

    // 4 kg over 4 weeks is about -1 kg/week.
    expect(summary.changePerWeekKg).toBeLessThan(0);
    expect(summary.changePerWeekKg).toBeGreaterThan(-1.5);
  });

  it('projects weeks to a target the trend is heading towards', () => {
    const entries = [entry('2026-07-05', 80), entry('2026-08-02', 76)];

    const summary = buildWeightSummary(entries, entries[0] ?? null, 72);

    expect(summary.estimatedWeeksToTarget).toBeGreaterThan(0);
  });

  it('refuses to project when the trend heads away from the target', () => {
    // Gaining while aiming to lose: an arrival date here would be a lie.
    const entries = [entry('2026-07-05', 76), entry('2026-08-02', 80)];

    const summary = buildWeightSummary(entries, entries[0] ?? null, 72);

    expect(summary.estimatedWeeksToTarget).toBeNull();
  });

  it('reports zero weeks once the target is reached', () => {
    const entries = [entry('2026-07-05', 76), entry('2026-08-02', 72)];

    expect(buildWeightSummary(entries, entries[0] ?? null, 72).estimatedWeeksToTarget).toBe(0);
  });

  it('has no trend or projection from a single weigh-in', () => {
    const entries = [entry('2026-08-02', 78)];

    const summary = buildWeightSummary(entries, entries[0] ?? null, 72);

    expect(summary.currentKg).toBe(78);
    expect(summary.changePerWeekKg).toBeNull();
    expect(summary.estimatedWeeksToTarget).toBeNull();
  });

  it('handles no weigh-ins at all', () => {
    const summary = buildWeightSummary([], null, 72);

    expect(summary).toMatchObject({ currentKg: null, startingKg: null, changeKg: null, trend: [] });
  });

  it('measures change from the first weigh-in ever, not the window', () => {
    // The window shows the last month; "you have lost 4 kg" must mean overall.
    const windowEntries = [entry('2026-08-01', 76)];
    const firstEver = entry('2026-01-01', 80);

    expect(buildWeightSummary(windowEntries, firstEver, 72).changeKg).toBe(-4);
  });
});
