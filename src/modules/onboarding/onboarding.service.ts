import type { GoalType, Sex, Supplement } from '@prisma/client';

import { CACHE_TTL } from '../../config/constants.js';
import { cacheDelete, cached } from '../../shared/cache/redis.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../shared/errors/index.js';
import { getLogger } from '../../shared/logger/index.js';
import {
  calculateTargets,
  cmToFeetInches,
  feetInchesToCm,
  poundsToKg,
  proteinFromFood,
} from '../nutrition/nutrition.calculator.js';
import { toApiEnum, toApiEnums, toPrismaEnum, toPrismaEnums } from './onboarding.mappers.js';
import type {
  OnboardingRepository,
  OnboardingSnapshot,
  UserSupplementWithCatalog,
} from './onboarding.repository.js';
import type {
  NutritionTargetsResponse,
  OnboardingState,
  PutDietInput,
  PutGoalsInput,
  PutHealthInput,
  PutProfileInput,
  PutWorkoutInput,
} from './onboarding.schema.js';

/**
 * Onboarding business rules (screens 2-6).
 *
 * Two things are enforced here rather than at the schema: cross-field rules the
 * shape cannot express (a weight-loss goal must not point uphill), and rules
 * that need the database (a supplement must exist in the catalog).
 */

export const ONBOARDING_AUDIT_ACTIONS = {
  sectionUpdated: 'ONBOARDING_SECTION_UPDATED',
  completed: 'ONBOARDING_COMPLETED',
} as const;

const SUPPLEMENT_CATALOG_CACHE_KEY = 'catalog:supplements:v1';

export interface SupplementCatalogItem {
  id: string;
  slug: string;
  name: string;
  kind: 'protein' | 'other';
  defaultProteinPerServingG: number;
}

export class OnboardingService {
  constructor(private readonly repository: OnboardingRepository) {}

  async getState(userId: string): Promise<OnboardingState> {
    const snapshot = await this.repository.findSnapshot(userId);
    if (!snapshot) throw new NotFoundError('User not found.');

    return this.toState(snapshot);
  }

  async putGoals(userId: string, input: PutGoalsInput): Promise<OnboardingState> {
    // The array is already length-checked; this catches "lose_weight" twice.
    const unique = [...new Set(input.goals)];
    if (unique.length !== input.goals.length) {
      throw new ValidationError('Goals must be unique.', [
        { path: 'goals', message: 'The same goal was listed more than once.' },
      ]);
    }

    await this.repository.replaceGoals(userId, toPrismaEnums<GoalType>(unique));
    await this.audit(userId, 'goals');

    return this.getState(userId);
  }

  async putProfile(userId: string, input: PutProfileInput): Promise<OnboardingState> {
    const heightCm = resolveHeightCm(input);
    const weightKg = input.weightUnit === 'lb' ? poundsToKg(input.weight) : input.weight;
    const targetWeightKg = input.weightUnit === 'lb' ? poundsToKg(input.targetWeight) : input.targetWeight;

    // A user who says "lose weight" but sets a higher target has made a
    // mistake we should surface, not silently build an impossible plan around.
    await this.assertTargetMatchesGoals(userId, weightKg, targetWeightKg);

    await this.repository.upsertProfile(userId, {
      sex: toPrismaEnum<Sex>(input.sex),
      ageYears: input.ageYears,
      heightCm,
      weightKg,
      targetWeightKg,
      targetDeadline: toPrismaEnum(input.targetDeadline),
      activityLevel: toPrismaEnum(input.activityLevel),
      heightUnit: toPrismaEnum(input.heightUnit),
      weightUnit: toPrismaEnum(input.weightUnit),
    });
    await this.audit(userId, 'profile');

    return this.getState(userId);
  }

  async putHealth(userId: string, input: PutHealthInput): Promise<OnboardingState> {
    await this.repository.upsertHealth(userId, {
      conditions: toPrismaEnums(input.conditions),
      allergies: toPrismaEnums(input.allergies),
      medications: input.medications === null || input.medications === '' ? null : input.medications,
      tracksCycle: input.tracksCycle,
      pregnantOrNursing: input.pregnantOrNursing,
    });

    // Deliberately not logging which conditions: audit rows are queried far more
    // widely than the health table they would be duplicating.
    await this.audit(userId, 'health');

    return this.getState(userId);
  }

  async putDiet(userId: string, input: PutDietInput): Promise<OnboardingState> {
    await this.assertSupplementsExist(input.supplements.map((entry) => entry.supplementId));

    const duplicates =
      input.supplements.length !== new Set(input.supplements.map((s) => s.supplementId)).size;
    if (duplicates) {
      throw new ValidationError('Each supplement may appear only once.', [
        { path: 'supplements', message: 'Duplicate supplementId.' },
      ]);
    }

    // Veg-only days only mean something for diets that include meat or eggs.
    const vegOnlyDays =
      input.dietType === 'non_vegetarian' || input.dietType === 'eggetarian' ? input.vegOnlyDays : [];

    await this.repository.upsertDietWithSupplements(
      userId,
      {
        dietType: toPrismaEnum(input.dietType),
        cuisines: normaliseTags(input.cuisines),
        dislikes: normaliseTags(input.dislikes),
        budgetTier: toPrismaEnum(input.budgetTier),
        cookedBy: toPrismaEnum(input.cookedBy),
        cookingMinutes: input.cookingMinutes,
        vegOnlyDays: toPrismaEnums(vegOnlyDays),
      },
      input.supplements,
    );
    await this.audit(userId, 'diet');

    return this.getState(userId);
  }

  async putWorkout(userId: string, input: PutWorkoutInput): Promise<OnboardingState> {
    const locations = [...new Set(input.locations)];

    await this.repository.upsertWorkout(userId, {
      locations: toPrismaEnums(locations),
      daysPerWeek: input.daysPerWeek,
      sessionMinutes: input.sessionMinutes,
      preferredTime: toPrismaEnum(input.preferredTime),
      experienceLevel: toPrismaEnum(input.experienceLevel),
      injuries: input.injuries === null || input.injuries === '' ? null : input.injuries,
    });
    await this.audit(userId, 'workout');

    return this.getState(userId);
  }

  /**
   * Marks onboarding done. Health is skippable in the UI, so it is not required;
   * everything else is, because plan generation cannot run without it.
   */
  async complete(userId: string): Promise<OnboardingState> {
    const snapshot = await this.repository.findSnapshot(userId);
    if (!snapshot) throw new NotFoundError('User not found.');

    const missing = missingRequiredSections(snapshot);
    if (missing.length > 0) {
      throw new BusinessRuleError(
        `Finish these steps first: ${missing.join(', ')}.`,
        missing.map((section) => ({ path: section, message: 'This step is not complete.' })),
      );
    }

    // Idempotent: re-completing keeps the original timestamp so "member since"
    // style data cannot be reset by a client retry.
    if (snapshot.onboardingCompletedAt === null) {
      await this.repository.markOnboardingComplete(userId, new Date());
      await this.repository.writeAudit({
        actorUserId: userId,
        action: ONBOARDING_AUDIT_ACTIONS.completed,
        entity: 'User',
        entityId: userId,
      });
      getLogger().info({ userId }, 'onboarding completed');
    }

    return this.getState(userId);
  }

  /** Reference data: small, stable, and read on every visit to screen 5. */
  async getSupplementCatalog(): Promise<SupplementCatalogItem[]> {
    return cached(SUPPLEMENT_CATALOG_CACHE_KEY, CACHE_TTL.supplementCatalog, async () => {
      const supplements = await this.repository.findActiveSupplements();
      return supplements.map(toCatalogItem);
    });
  }

  /** Call after any catalog write so the next read is not stale. */
  static async invalidateSupplementCatalog(): Promise<void> {
    await cacheDelete(SUPPLEMENT_CATALOG_CACHE_KEY);
  }

  private async assertSupplementsExist(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const found = await this.repository.findSupplementsByIds([...new Set(ids)]);
    const foundIds = new Set(found.map((supplement) => supplement.id));
    const unknown = ids.filter((id) => !foundIds.has(id));

    if (unknown.length > 0) {
      throw new ValidationError('Unknown supplement.', [
        { path: 'supplements', message: `Not in the catalog: ${unknown.join(', ')}` },
      ]);
    }
  }

  private async assertTargetMatchesGoals(
    userId: string,
    weightKg: number,
    targetWeightKg: number,
  ): Promise<void> {
    const goals = await this.repository.findGoalTypes(userId);

    const wantsLoss = goals.includes('LOSE_WEIGHT') || goals.includes('LOSE_BELLY_FAT');
    const wantsGain = goals.includes('BUILD_MUSCLE');

    if (wantsLoss && !wantsGain && targetWeightKg > weightKg) {
      throw new BusinessRuleError(
        'Your goal is to lose weight, but the target weight is higher than your current weight.',
        [{ path: 'targetWeight', message: 'Must not be above your current weight.' }],
      );
    }

    if (wantsGain && !wantsLoss && targetWeightKg < weightKg) {
      throw new BusinessRuleError(
        'Your goal is to build muscle, but the target weight is lower than your current weight.',
        [{ path: 'targetWeight', message: 'Must not be below your current weight.' }],
      );
    }
  }

  private async audit(userId: string, section: string): Promise<void> {
    await this.repository.writeAudit({
      actorUserId: userId,
      action: ONBOARDING_AUDIT_ACTIONS.sectionUpdated,
      entity: 'Onboarding',
      entityId: userId,
      metadata: { section },
    });
  }

  private toState(snapshot: OnboardingSnapshot): OnboardingState {
    const goals = toApiEnums<OnboardingState['goals'][number]>(snapshot.goals.map((goal) => goal.type));

    const supplementProteinG = totalSupplementProtein(snapshot.supplements);
    const targets = this.computeTargets(snapshot, goals, supplementProteinG);
    const missing = missingRequiredSections(snapshot);

    return {
      progress: {
        goals: snapshot.goals.length > 0,
        profile: snapshot.profile !== null,
        health: snapshot.health !== null,
        diet: snapshot.diet !== null,
        workout: snapshot.workout !== null,
        canComplete: missing.length === 0,
        completedAt: snapshot.onboardingCompletedAt?.toISOString() ?? null,
      },
      goals,
      profile: snapshot.profile === null ? null : toProfileSection(snapshot.profile),
      health:
        snapshot.health === null
          ? null
          : {
              conditions: toApiEnums(snapshot.health.conditions),
              allergies: toApiEnums(snapshot.health.allergies),
              medications: snapshot.health.medications,
              tracksCycle: snapshot.health.tracksCycle,
              pregnantOrNursing: snapshot.health.pregnantOrNursing,
            },
      diet:
        snapshot.diet === null
          ? null
          : {
              dietType: toApiEnum(snapshot.diet.dietType),
              cuisines: snapshot.diet.cuisines,
              dislikes: snapshot.diet.dislikes,
              budgetTier: toApiEnum(snapshot.diet.budgetTier),
              cookedBy: toApiEnum(snapshot.diet.cookedBy),
              cookingMinutes: snapshot.diet.cookingMinutes,
              vegOnlyDays: toApiEnums(snapshot.diet.vegOnlyDays),
              supplements: snapshot.supplements.map(toUserSupplement),
              supplementProteinG,
            },
      workout:
        snapshot.workout === null
          ? null
          : {
              locations: toApiEnums(snapshot.workout.locations),
              daysPerWeek: snapshot.workout.daysPerWeek,
              sessionMinutes: snapshot.workout.sessionMinutes,
              preferredTime: toApiEnum(snapshot.workout.preferredTime),
              experienceLevel: toApiEnum(snapshot.workout.experienceLevel),
              injuries: snapshot.workout.injuries,
            },
      targets,
    } as OnboardingState;
  }

  /** Needs both body stats and at least one goal — protein depends on the goal. */
  private computeTargets(
    snapshot: OnboardingSnapshot,
    goals: string[],
    supplementProteinG: number,
  ): NutritionTargetsResponse | null {
    if (snapshot.profile === null || goals.length === 0) return null;

    const targets = calculateTargets({
      sex: snapshot.profile.sex,
      ageYears: snapshot.profile.ageYears,
      heightCm: snapshot.profile.heightCm,
      weightKg: snapshot.profile.weightKg,
      activityLevel: snapshot.profile.activityLevel,
      targetWeightKg: snapshot.profile.targetWeightKg,
      targetDeadline: snapshot.profile.targetDeadline,
      goals: snapshot.goals.map((goal) => goal.type),
    });

    const response: NutritionTargetsResponse = {
      bmr: targets.bmr,
      tdee: targets.tdee,
      kcal: targets.kcal,
      proteinG: targets.proteinG,
      carbsG: targets.carbsG,
      fatG: targets.fatG,
      proteinFromFoodG: proteinFromFood(targets, supplementProteinG),
      dailyDeficitKcal: targets.dailyDeficitKcal,
      projectedWeeklyChangeKg: targets.projectedWeeklyChangeKg,
    };

    return targets.warning === undefined ? response : { ...response, warning: targets.warning };
  }
}

/** Health is skippable in the UI; the other four gate plan generation. */
function missingRequiredSections(snapshot: OnboardingSnapshot): string[] {
  const missing: string[] = [];
  if (snapshot.goals.length === 0) missing.push('goals');
  if (snapshot.profile === null) missing.push('profile');
  if (snapshot.diet === null) missing.push('diet');
  if (snapshot.workout === null) missing.push('workout');
  return missing;
}

function totalSupplementProtein(supplements: UserSupplementWithCatalog[]): number {
  return supplements.reduce((total, entry) => total + entry.proteinPerServingG * entry.servingsPerDay, 0);
}

function toUserSupplement(entry: UserSupplementWithCatalog) {
  return {
    supplementId: entry.supplementId,
    slug: entry.supplement.slug,
    name: entry.supplement.name,
    kind: toApiEnum<'protein' | 'other'>(entry.supplement.kind),
    proteinPerServingG: entry.proteinPerServingG,
    servingsPerDay: entry.servingsPerDay,
  };
}

function toCatalogItem(supplement: Supplement): SupplementCatalogItem {
  return {
    id: supplement.id,
    slug: supplement.slug,
    name: supplement.name,
    kind: toApiEnum<'protein' | 'other'>(supplement.kind),
    defaultProteinPerServingG: supplement.defaultProteinPerServingG,
  };
}

function toProfileSection(profile: NonNullable<OnboardingSnapshot['profile']>) {
  // Echo height back in the unit the user entered, so screen 3 repopulates
  // exactly as they left it.
  const imperial = profile.heightUnit === 'FT_IN' ? cmToFeetInches(profile.heightCm) : null;

  return {
    sex: toApiEnum(profile.sex),
    ageYears: profile.ageYears,
    heightCm: profile.heightCm,
    heightUnit: toApiEnum(profile.heightUnit),
    heightFeet: imperial?.feet ?? null,
    heightInches: imperial?.inches ?? null,
    weightKg: profile.weightKg,
    targetWeightKg: profile.targetWeightKg,
    weightUnit: toApiEnum(profile.weightUnit),
    targetDeadline: toApiEnum(profile.targetDeadline),
    activityLevel: toApiEnum(profile.activityLevel),
  };
}

function resolveHeightCm(input: PutProfileInput): number {
  if (input.heightUnit === 'cm') {
    if (input.heightCm === undefined) {
      throw new ValidationError('Height is required.', [
        { path: 'heightCm', message: 'Required when heightUnit is "cm".' },
      ]);
    }
    return input.heightCm;
  }

  if (input.heightFeet === undefined) {
    throw new ValidationError('Height is required.', [
      { path: 'heightFeet', message: 'Required when heightUnit is "ft_in".' },
    ]);
  }

  return feetInchesToCm(input.heightFeet, input.heightInches ?? 0);
}

/** Trim, drop blanks, de-duplicate case-insensitively, keep first spelling. */
function normaliseTags(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === '') continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}
