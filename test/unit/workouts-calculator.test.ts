import { describe, expect, it } from 'vitest';

import {
  bestOneRepMax,
  estimateOneRepMax,
  totalReps,
  totalVolumeKg,
  trendPerMonth,
  workingSetCount,
  type CompletedSet,
} from '../../src/modules/workouts/workouts.calculator.js';

const working = (reps: number, weightKg: number | null): CompletedSet => ({
  reps,
  weightKg,
  isWarmup: false,
});
const warmup = (reps: number, weightKg: number | null): CompletedSet => ({
  reps,
  weightKg,
  isWarmup: true,
});

describe('estimateOneRepMax', () => {
  it('returns the load itself for a single rep', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
  });

  it('applies Epley for multiple reps', () => {
    // 100 * (1 + 10/30) = 133.33
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(133.3, 1);
    expect(estimateOneRepMax(22.5, 10)).toBeCloseTo(30, 1);
  });

  it('rises with both load and reps', () => {
    expect(estimateOneRepMax(60, 5)).toBeGreaterThan(estimateOneRepMax(50, 5) ?? 0);
    expect(estimateOneRepMax(60, 8)).toBeGreaterThan(estimateOneRepMax(60, 5) ?? 0);
  });

  it('refuses to guess beyond the range where Epley holds', () => {
    // Past ~12 reps the estimate drifts badly high; no number beats a wrong one.
    expect(estimateOneRepMax(60, 13)).toBeNull();
    expect(estimateOneRepMax(60, 30)).toBeNull();
  });

  it.each([
    ['zero load', 0, 5],
    ['negative load', -10, 5],
    ['zero reps', 60, 0],
  ])('returns null for %s', (_label, weight, reps) => {
    expect(estimateOneRepMax(weight, reps)).toBeNull();
  });
});

describe('bestOneRepMax', () => {
  it('takes the best working set', () => {
    const sets = [working(10, 20), working(8, 25), working(12, 17.5)];

    // 25 * (1 + 8/30) = 31.7 is the best of the three.
    expect(bestOneRepMax(sets)).toBeCloseTo(31.7, 1);
  });

  it('ignores warm-up sets', () => {
    // A heavy-looking warm-up must not inflate the estimate, and light warm-ups
    // must not drag it down.
    const withWarmups = [warmup(15, 10), working(8, 25), warmup(20, 5)];

    expect(bestOneRepMax(withWarmups)).toBeCloseTo(31.7, 1);
  });

  it('returns null when nothing is weighted', () => {
    expect(bestOneRepMax([working(20, null), working(15, null)])).toBeNull();
    expect(bestOneRepMax([])).toBeNull();
  });
});

describe('volume and counts', () => {
  const sets = [warmup(10, 20), working(10, 40), working(8, 45), working(6, 50)];

  it('sums load moved across working sets only', () => {
    // 10*40 + 8*45 + 6*50 = 1060
    expect(totalVolumeKg(sets)).toBe(1060);
  });

  it('counts working sets and reps only', () => {
    expect(workingSetCount(sets)).toBe(3);
    expect(totalReps(sets)).toBe(24);
  });

  it('treats bodyweight work as zero volume rather than failing', () => {
    expect(totalVolumeKg([working(20, null)])).toBe(0);
    expect(totalReps([working(20, null)])).toBe(20);
  });
});

describe('trendPerMonth', () => {
  it('reports a rising trend', () => {
    const trend = trendPerMonth([
      { date: '2026-06-01', value: 100 },
      { date: '2026-07-01', value: 105 },
      { date: '2026-08-01', value: 110 },
    ]);

    // ~5 kg per 30 days.
    expect(trend).not.toBeNull();
    expect(trend).toBeGreaterThan(4);
    expect(trend).toBeLessThan(6);
  });

  it('reports a falling trend as negative', () => {
    const trend = trendPerMonth([
      { date: '2026-06-01', value: 110 },
      { date: '2026-08-01', value: 100 },
    ]);

    expect(trend).toBeLessThan(0);
  });

  it('is not swung by one bad session, unlike first-to-last', () => {
    // A dip at the end would make a naive first-to-last comparison negative.
    const trend = trendPerMonth([
      { date: '2026-07-01', value: 100 },
      { date: '2026-07-08', value: 103 },
      { date: '2026-07-15', value: 106 },
      { date: '2026-07-22', value: 109 },
      { date: '2026-07-29', value: 99 },
    ]);

    expect(trend).toBeGreaterThan(0);
  });

  it('has no trend from fewer than two points', () => {
    expect(trendPerMonth([])).toBeNull();
    expect(trendPerMonth([{ date: '2026-08-01', value: 100 }])).toBeNull();
  });

  it('has no trend when every point is the same day', () => {
    expect(
      trendPerMonth([
        { date: '2026-08-01', value: 100 },
        { date: '2026-08-01', value: 110 },
      ]),
    ).toBeNull();
  });
});
