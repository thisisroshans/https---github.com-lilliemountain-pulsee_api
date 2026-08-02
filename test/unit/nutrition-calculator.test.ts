import { describe, expect, it } from 'vitest';

import {
  calculateBmr,
  calculateTargets,
  calculateTdee,
  cmToFeetInches,
  feetInchesToCm,
  kgToPounds,
  poundsToKg,
  proteinFromFood,
  type TargetInputs,
} from '../../src/modules/nutrition/nutrition.calculator.js';

/**
 * These numbers drive what a real person eats every day, so the safety rails
 * matter more than the happy path: nothing here may produce a starvation diet or
 * an unsafe rate of weight loss, however aggressive the user's request.
 */

const BASE: TargetInputs = {
  sex: 'MALE',
  ageYears: 29,
  heightCm: 174,
  weightKg: 78,
  activityLevel: 'MODERATE',
  targetWeightKg: 72,
  targetDeadline: 'THREE_MONTHS',
  goals: ['LOSE_WEIGHT'],
};

describe('calculateBmr', () => {
  it('matches Mifflin-St Jeor for a male', () => {
    // 10*78 + 6.25*174 - 5*29 + 5 = 1727.5 -> 1728
    expect(calculateBmr({ sex: 'MALE', ageYears: 29, heightCm: 174, weightKg: 78 })).toBe(1728);
  });

  it('matches Mifflin-St Jeor for a female', () => {
    // 10*62 + 6.25*162 - 5*31 - 161 = 1316.5 -> 1317
    expect(calculateBmr({ sex: 'FEMALE', ageYears: 31, heightCm: 162, weightKg: 62 })).toBe(1317);
  });

  it('places "other" between the two rather than defaulting to one', () => {
    const stats = { ageYears: 29, heightCm: 174, weightKg: 78 } as const;
    const male = calculateBmr({ ...stats, sex: 'MALE' });
    const female = calculateBmr({ ...stats, sex: 'FEMALE' });
    const other = calculateBmr({ ...stats, sex: 'OTHER' });

    expect(other).toBeGreaterThan(female);
    expect(other).toBeLessThan(male);
  });

  it('falls as age rises, all else equal', () => {
    const young = calculateBmr({ sex: 'MALE', ageYears: 25, heightCm: 174, weightKg: 78 });
    const older = calculateBmr({ sex: 'MALE', ageYears: 55, heightCm: 174, weightKg: 78 });

    expect(older).toBeLessThan(young);
  });
});

describe('calculateTdee', () => {
  const stats = { sex: 'MALE', ageYears: 29, heightCm: 174, weightKg: 78 } as const;

  it('rises with activity level', () => {
    const sedentary = calculateTdee(stats, 'SEDENTARY');
    const light = calculateTdee(stats, 'LIGHT');
    const moderate = calculateTdee(stats, 'MODERATE');
    const veryActive = calculateTdee(stats, 'VERY_ACTIVE');

    expect(sedentary).toBeLessThan(light);
    expect(light).toBeLessThan(moderate);
    expect(moderate).toBeLessThan(veryActive);
  });

  it('applies the sedentary multiplier exactly', () => {
    expect(calculateTdee(stats, 'SEDENTARY')).toBe(Math.round(1728 * 1.2));
  });
});

describe('calculateTargets — weight loss', () => {
  it('produces a deficit below maintenance', () => {
    const targets = calculateTargets(BASE);

    expect(targets.kcal).toBeLessThan(targets.tdee);
    expect(targets.dailyDeficitKcal).toBeGreaterThan(0);
    expect(targets.projectedWeeklyChangeKg).toBeLessThan(0);
  });

  it('never prescribes fewer calories than BMR', () => {
    const targets = calculateTargets({ ...BASE, targetWeightKg: 60, targetDeadline: 'ONE_MONTH' });

    expect(targets.kcal).toBeGreaterThanOrEqual(targets.bmr);
    expect(targets.warning).toBeDefined();
  });

  it('caps an unsafe pace and says so', () => {
    // 18 kg in a month is roughly 4.5 kg/week; the cap is ~1% of bodyweight.
    const targets = calculateTargets({ ...BASE, targetWeightKg: 60, targetDeadline: 'ONE_MONTH' });

    expect(Math.abs(targets.projectedWeeklyChangeKg)).toBeLessThanOrEqual(0.78 + 0.01);
    expect(targets.warning).toMatch(/safe|floor/i);
  });

  it('leaves a reasonable request unclamped and unwarned', () => {
    const targets = calculateTargets(BASE);

    expect(targets.warning).toBeUndefined();
    expect(targets.projectedWeeklyChangeKg).toBeGreaterThan(-0.78);
  });

  it('respects a female calorie floor', () => {
    const targets = calculateTargets({
      ...BASE,
      sex: 'FEMALE',
      weightKg: 55,
      heightCm: 155,
      targetWeightKg: 45,
      targetDeadline: 'ONE_MONTH',
    });

    expect(targets.kcal).toBeGreaterThanOrEqual(1200);
  });
});

describe('calculateTargets — muscle gain', () => {
  const gaining: TargetInputs = {
    ...BASE,
    goals: ['BUILD_MUSCLE'],
    targetWeightKg: 84,
    targetDeadline: 'SIX_MONTHS',
  };

  it('produces a surplus', () => {
    const targets = calculateTargets(gaining);

    expect(targets.kcal).toBeGreaterThan(targets.tdee);
    expect(targets.dailyDeficitKcal).toBeLessThan(0);
    expect(targets.projectedWeeklyChangeKg).toBeGreaterThan(0);
  });

  it('caps the rate of gain so it is not mostly fat', () => {
    const targets = calculateTargets({ ...gaining, targetWeightKg: 100, targetDeadline: 'ONE_MONTH' });

    expect(targets.projectedWeeklyChangeKg).toBeLessThanOrEqual(0.36);
    expect(targets.warning).toBeDefined();
  });

  it('sets protein higher for muscle gain than for general health', () => {
    const building = calculateTargets(gaining);
    const stamina = calculateTargets({ ...gaining, goals: ['STAMINA_ENERGY'] });

    expect(building.proteinG).toBeGreaterThan(stamina.proteinG);
  });
});

describe('calculateTargets — macros', () => {
  it('roughly reconciles macros with the calorie target', () => {
    const targets = calculateTargets(BASE);
    const fromMacros = targets.proteinG * 4 + targets.carbsG * 4 + targets.fatG * 9;

    // Rounding each macro to a whole gram costs a few kcal.
    expect(Math.abs(fromMacros - targets.kcal)).toBeLessThanOrEqual(12);
  });

  it('never produces negative carbohydrates', () => {
    const targets = calculateTargets({
      ...BASE,
      weightKg: 150,
      targetWeightKg: 90,
      targetDeadline: 'THREE_MONTHS',
      goals: ['BUILD_MUSCLE'],
    });

    expect(targets.carbsG).toBeGreaterThanOrEqual(0);
  });

  it('scales protein with bodyweight', () => {
    const lighter = calculateTargets({ ...BASE, weightKg: 60, targetWeightKg: 58 });
    const heavier = calculateTargets({ ...BASE, weightKg: 95, targetWeightKg: 90 });

    expect(heavier.proteinG).toBeGreaterThan(lighter.proteinG);
  });
});

describe('proteinFromFood', () => {
  it('subtracts what supplements already cover', () => {
    const targets = calculateTargets(BASE);

    expect(proteinFromFood(targets, 48)).toBe(targets.proteinG - 48);
  });

  it('never goes negative when supplements exceed the target', () => {
    const targets = calculateTargets(BASE);

    expect(proteinFromFood(targets, 999)).toBe(0);
  });
});

describe('unit conversion', () => {
  it('round-trips feet and inches', () => {
    expect(feetInchesToCm(5, 9)).toBeCloseTo(175.26, 2);
    expect(cmToFeetInches(175.26)).toEqual({ feet: 5, inches: 9 });
  });

  it('round-trips pounds and kilograms', () => {
    expect(poundsToKg(172)).toBeCloseTo(78.02, 2);
    expect(kgToPounds(78)).toBeCloseTo(171.96, 2);
  });

  it('handles a whole number of feet', () => {
    expect(cmToFeetInches(feetInchesToCm(6, 0))).toEqual({ feet: 6, inches: 0 });
  });
});
