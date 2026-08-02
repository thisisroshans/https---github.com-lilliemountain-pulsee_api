import type { ActivityLevel, GoalType, Sex, TargetDeadline } from '@prisma/client';

/**
 * Daily calorie and macro targets.
 *
 * Pure functions, no I/O: onboarding shows a live estimate on screen 3, and
 * plan generation will reuse exactly the same maths so the number the user was
 * promised is the number they get.
 *
 * Mifflin-St Jeor is used for BMR — it is the better-validated equation for
 * modern populations than Harris-Benedict, which the prototype approximated.
 */

export interface BodyStats {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
}

export interface TargetInputs extends BodyStats {
  activityLevel: ActivityLevel;
  targetWeightKg: number;
  targetDeadline: TargetDeadline;
  goals: GoalType[];
}

export interface NutritionTargets {
  bmr: number;
  tdee: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Positive = deficit, negative = surplus. */
  dailyDeficitKcal: number;
  /** Weekly weight change the target implies, kg. */
  projectedWeeklyChangeKg: number;
  /** Set when the requested deadline was too aggressive to pursue safely. */
  warning?: string;
}

const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  VERY_ACTIVE: 1.725,
};

const DEADLINE_WEEKS: Record<TargetDeadline, number> = {
  ONE_MONTH: 4,
  TWO_MONTHS: 9,
  THREE_MONTHS: 13,
  SIX_MONTHS: 26,
  ONE_YEAR: 52,
};

/** Roughly the energy in a kilogram of body fat. */
const KCAL_PER_KG = 7700;

/**
 * Safety rails. Losing faster than ~1% of bodyweight per week costs muscle, and
 * eating below BMR is not something we will program for anyone.
 */
const MAX_WEEKLY_LOSS_FRACTION = 0.01;
const MAX_WEEKLY_GAIN_KG = 0.35;
const MIN_KCAL_BY_SEX: Record<Sex, number> = { MALE: 1500, FEMALE: 1200, OTHER: 1200 };

/** Mifflin-St Jeor. */
export function calculateBmr(stats: BodyStats): number {
  const base = 10 * stats.weightKg + 6.25 * stats.heightCm - 5 * stats.ageYears;

  // "Other" uses the midpoint rather than defaulting to one sex's constant.
  const sexOffset = stats.sex === 'MALE' ? 5 : stats.sex === 'FEMALE' ? -161 : -78;

  return Math.round(base + sexOffset);
}

export function calculateTdee(stats: BodyStats, activityLevel: ActivityLevel): number {
  return Math.round(calculateBmr(stats) * ACTIVITY_MULTIPLIER[activityLevel]);
}

/**
 * Protein target in g/kg of bodyweight, chosen by goal. Muscle gain and fat loss
 * both need more than maintenance — during a deficit protein is what preserves
 * lean mass.
 */
function proteinPerKg(goals: GoalType[]): number {
  if (goals.includes('BUILD_MUSCLE')) return 2.0;
  if (goals.includes('LOSE_WEIGHT') || goals.includes('LOSE_BELLY_FAT')) return 1.8;
  if (goals.includes('GET_TONED')) return 1.8;
  return 1.6;
}

/** Fat as a share of total calories. Never below ~20%: hormones need it. */
const FAT_FRACTION = 0.25;

export function calculateTargets(inputs: TargetInputs): NutritionTargets {
  const bmr = calculateBmr(inputs);
  const tdee = calculateTdee(inputs, inputs.activityLevel);

  const weeks = DEADLINE_WEEKS[inputs.targetDeadline];
  const totalChangeKg = inputs.targetWeightKg - inputs.weightKg;
  const requestedWeeklyChangeKg = totalChangeKg / weeks;

  const { weeklyChangeKg, warning: paceWarning } = clampPace(requestedWeeklyChangeKg, inputs.weightKg);

  const rawKcal = Math.round(tdee + (weeklyChangeKg * KCAL_PER_KG) / 7);
  const floor = Math.max(MIN_KCAL_BY_SEX[inputs.sex], Math.round(bmr));
  const kcal = Math.max(floor, rawKcal);

  const warning =
    kcal > rawKcal
      ? 'Your target needs a bigger deficit than is safe, so we have set intake at a healthy floor. This will take longer than requested.'
      : paceWarning;

  const proteinG = Math.round(inputs.weightKg * proteinPerKg(inputs.goals));
  const fatG = Math.round((kcal * FAT_FRACTION) / 9);
  // Carbs take whatever calories remain, never negative.
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));

  const result: NutritionTargets = {
    bmr,
    tdee,
    kcal,
    proteinG,
    carbsG,
    fatG,
    dailyDeficitKcal: tdee - kcal,
    projectedWeeklyChangeKg: round2(((kcal - tdee) * 7) / KCAL_PER_KG),
  };

  return warning === undefined ? result : { ...result, warning };
}

/**
 * Caps how fast we will plan for someone to change weight. A user asking to
 * lose 10 kg in a month gets a safe plan plus an honest warning, not a
 * dangerous one.
 */
function clampPace(
  requestedWeeklyChangeKg: number,
  currentWeightKg: number,
): { weeklyChangeKg: number; warning?: string } {
  const maxLoss = -(currentWeightKg * MAX_WEEKLY_LOSS_FRACTION);

  if (requestedWeeklyChangeKg < maxLoss) {
    return {
      weeklyChangeKg: maxLoss,
      warning:
        'That timeline needs faster weight loss than is safe, so we have paced it to protect muscle. You will reach the goal a little later.',
    };
  }

  if (requestedWeeklyChangeKg > MAX_WEEKLY_GAIN_KG) {
    return {
      weeklyChangeKg: MAX_WEEKLY_GAIN_KG,
      warning:
        'That timeline needs faster weight gain than is useful — beyond this, most of it is fat. We have paced it for lean gain.',
    };
  }

  return { weeklyChangeKg: requestedWeeklyChangeKg };
}

/**
 * Protein from supplements counts toward the daily target; the food plan only
 * needs to cover the remainder.
 */
export function proteinFromFood(targets: NutritionTargets, supplementProteinG: number): number {
  return Math.max(0, targets.proteinG - supplementProteinG);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// --- Unit conversion, applied at the edge -----------------------------------

export function feetInchesToCm(feet: number, inches: number): number {
  return round2(feet * 30.48 + inches * 2.54);
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: Math.round(totalInches - feet * 12) };
}

export function poundsToKg(pounds: number): number {
  return round2(pounds / 2.2046226218);
}

export function kgToPounds(kg: number): number {
  return round2(kg * 2.2046226218);
}
