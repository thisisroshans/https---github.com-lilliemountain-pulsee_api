/**
 * Strength progression maths. Pure functions, no I/O — the same reason the
 * nutrition targets live apart from their service: this is the part that must
 * be provably right, and it is trivially testable in isolation.
 */

export interface CompletedSet {
  reps: number;
  weightKg: number | null;
  isWarmup: boolean;
}

/**
 * Estimated one-rep max, Epley formula.
 *
 * Only meaningful in the low-rep range: past about 12 reps the estimate drifts
 * badly upward, so we cap it rather than report a confident wrong number.
 */
const EPLEY_MAX_REPS = 12;

export function estimateOneRepMax(weightKg: number, reps: number): number | null {
  if (weightKg <= 0 || reps <= 0 || reps > EPLEY_MAX_REPS) return null;
  if (reps === 1) return round1(weightKg);

  return round1(weightKg * (1 + reps / 30));
}

/**
 * Best estimated 1RM across a set of working sets. Warm-ups are excluded — they
 * are deliberately light and would drag the estimate down if averaged, or add
 * noise if included.
 */
export function bestOneRepMax(sets: CompletedSet[]): number | null {
  const estimates = sets
    .filter((set) => !set.isWarmup && set.weightKg !== null)
    .map((set) => estimateOneRepMax(set.weightKg ?? 0, set.reps))
    .filter((estimate): estimate is number => estimate !== null);

  return estimates.length === 0 ? null : Math.max(...estimates);
}

/** Total load moved: the standard volume measure, sets x reps x weight. */
export function totalVolumeKg(sets: CompletedSet[]): number {
  return round1(
    sets
      .filter((set) => !set.isWarmup && set.weightKg !== null)
      .reduce((total, set) => total + (set.weightKg ?? 0) * set.reps, 0),
  );
}

/** Working sets only — what "6 exercises, 18 sets" on the summary card means. */
export function workingSetCount(sets: CompletedSet[]): number {
  return sets.filter((set) => !set.isWarmup).length;
}

export function totalReps(sets: CompletedSet[]): number {
  return sets.filter((set) => !set.isWarmup).reduce((total, set) => total + set.reps, 0);
}

export interface TrendPoint {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  value: number;
}

/**
 * Change per 30 days, from a simple least-squares fit.
 *
 * A first-to-last comparison would swing wildly on one bad session; a fitted
 * slope uses every point. Fewer than two points has no trend at all.
 */
export function trendPerMonth(points: TrendPoint[]): number | null {
  if (points.length < 2) return null;

  const times = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  const meanTime = average(times);
  const meanValue = average(points.map((point) => point.value));

  let covariance = 0;
  let variance = 0;

  for (const [index, time] of times.entries()) {
    const timeDelta = time - meanTime;
    covariance += timeDelta * ((points[index]?.value ?? 0) - meanValue);
    variance += timeDelta * timeDelta;
  }

  // Every point on the same day: no slope to fit.
  if (variance === 0) return null;

  const perMillisecond = covariance / variance;
  return round1(perMillisecond * 30 * 24 * 60 * 60 * 1000);
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
