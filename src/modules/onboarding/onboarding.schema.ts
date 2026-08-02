import { z } from 'zod';

import { longTextSchema, uuidSchema } from '../../shared/validation/common.js';

/**
 * Onboarding contracts, one section per prototype screen.
 *
 * Each section is a PUT: the screen owns its whole slice of state, so replacing
 * it is idempotent and a user who edits a screen and resubmits gets exactly what
 * they see — no merge surprises from a partial update.
 */

// --- Shared enums, mirroring the Prisma enums in lowercase ------------------

export const goalTypeSchema = z.enum([
  'lose_weight',
  'build_muscle',
  'get_toned',
  'lose_belly_fat',
  'stamina_energy',
  'manage_condition',
]);

export const sexSchema = z.enum(['male', 'female', 'other']);
export const activityLevelSchema = z.enum(['sedentary', 'light', 'moderate', 'very_active']);
export const targetDeadlineSchema = z.enum([
  'one_month',
  'two_months',
  'three_months',
  'six_months',
  'one_year',
]);
export const heightUnitSchema = z.enum(['cm', 'ft_in']);
export const weightUnitSchema = z.enum(['kg', 'lb']);
export const healthConditionSchema = z.enum([
  'pcos',
  'diabetes_type_2',
  'pre_diabetes',
  'hypertension',
  'thyroid',
  'high_cholesterol',
  'ibs_digestive',
]);
export const allergenSchema = z.enum(['lactose', 'gluten', 'nuts', 'eggs', 'shellfish', 'soy']);
export const dietTypeSchema = z.enum(['vegetarian', 'eggetarian', 'non_vegetarian', 'vegan', 'jain']);
export const budgetTierSchema = z.enum(['low', 'mid', 'high']);
export const cookedBySchema = z.enum(['self', 'household', 'order_in', 'mixed']);
export const weekdaySchema = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export const workoutLocationSchema = z.enum([
  'home_no_equipment',
  'home_basic_equipment',
  'gym',
  'yoga_pilates',
  'outdoor',
]);
export const preferredTimeSchema = z.enum(['early_morning', 'morning', 'lunch', 'evening', 'night']);
export const experienceLevelSchema = z.enum(['beginner', 'some', 'advanced']);
export const supplementKindSchema = z.enum(['protein', 'other']);

// --- Screen 2: goals --------------------------------------------------------

export const putGoalsSchema = z.object({
  goals: z.array(goalTypeSchema).min(1, 'Pick at least one goal.').max(6),
});
export type PutGoalsInput = z.infer<typeof putGoalsSchema>;

// --- Screen 3: body basics --------------------------------------------------

/**
 * Height and weight are accepted in the user's units and stored canonically.
 * The bounds are deliberately generous but finite — they exist to reject typos
 * and hostile input, not to judge anyone's body.
 */
export const putProfileSchema = z
  .object({
    sex: sexSchema,
    ageYears: z.number().int().min(13).max(100),

    heightUnit: heightUnitSchema.default('cm'),
    heightCm: z.number().min(90).max(250).optional(),
    heightFeet: z.number().int().min(3).max(8).optional(),
    heightInches: z.number().int().min(0).max(11).optional(),

    weightUnit: weightUnitSchema.default('kg'),
    weight: z.number().min(25).max(400),
    targetWeight: z.number().min(25).max(400),

    targetDeadline: targetDeadlineSchema,
    activityLevel: activityLevelSchema,
  })
  .superRefine((input, ctx) => {
    if (input.heightUnit === 'cm' && input.heightCm === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['heightCm'],
        message: 'heightCm is required when heightUnit is "cm".',
      });
    }

    if (input.heightUnit === 'ft_in' && input.heightFeet === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['heightFeet'],
        message: 'heightFeet is required when heightUnit is "ft_in".',
      });
    }
  });
export type PutProfileInput = z.infer<typeof putProfileSchema>;

// --- Screen 4: health -------------------------------------------------------

export const putHealthSchema = z.object({
  conditions: z.array(healthConditionSchema).max(7).default([]),
  allergies: z.array(allergenSchema).max(6).default([]),
  medications: z.string().trim().max(500).nullable().default(null),
  tracksCycle: z.boolean().default(false),
  pregnantOrNursing: z.boolean().default(false),
});
export type PutHealthInput = z.infer<typeof putHealthSchema>;

// --- Screen 5: food + supplements -------------------------------------------

export const supplementEntrySchema = z.object({
  supplementId: uuidSchema,
  proteinPerServingG: z.number().int().min(0).max(80),
  servingsPerDay: z.number().int().min(1).max(6),
});

export const putDietSchema = z.object({
  dietType: dietTypeSchema,
  // Blanks are tolerated and dropped server-side rather than rejected: the
  // chip-input on screen 5 can easily emit one, and failing the whole save for
  // an empty tag would be hostile.
  cuisines: z.array(z.string().trim().max(40)).max(15).default([]),
  dislikes: z.array(z.string().trim().max(40)).max(30).default([]),
  budgetTier: budgetTierSchema,
  cookedBy: cookedBySchema,
  cookingMinutes: z.number().int().min(5).max(120),
  vegOnlyDays: z.array(weekdaySchema).max(7).default([]),
  supplements: z.array(supplementEntrySchema).max(20).default([]),
});
export type PutDietInput = z.infer<typeof putDietSchema>;

// --- Screen 6: workout ------------------------------------------------------

export const putWorkoutSchema = z.object({
  locations: z.array(workoutLocationSchema).min(1, 'Pick at least one place to train.').max(5),
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(10).max(180),
  preferredTime: preferredTimeSchema,
  experienceLevel: experienceLevelSchema,
  injuries: longTextSchema.max(500).nullable().default(null),
});
export type PutWorkoutInput = z.infer<typeof putWorkoutSchema>;

// --- Responses --------------------------------------------------------------

export const supplementCatalogItemSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  kind: supplementKindSchema,
  defaultProteinPerServingG: z.number().int(),
});

export const userSupplementSchema = z.object({
  supplementId: uuidSchema,
  slug: z.string(),
  name: z.string(),
  kind: supplementKindSchema,
  proteinPerServingG: z.number().int(),
  servingsPerDay: z.number().int(),
});

export const profileSectionSchema = z.object({
  sex: sexSchema,
  ageYears: z.number().int(),
  heightCm: z.number(),
  heightUnit: heightUnitSchema,
  heightFeet: z.number().int().nullable(),
  heightInches: z.number().int().nullable(),
  weightKg: z.number(),
  targetWeightKg: z.number(),
  weightUnit: weightUnitSchema,
  targetDeadline: targetDeadlineSchema,
  activityLevel: activityLevelSchema,
});

export const healthSectionSchema = z.object({
  conditions: z.array(healthConditionSchema),
  allergies: z.array(allergenSchema),
  medications: z.string().nullable(),
  tracksCycle: z.boolean(),
  pregnantOrNursing: z.boolean(),
});

export const dietSectionSchema = z.object({
  dietType: dietTypeSchema,
  cuisines: z.array(z.string()),
  dislikes: z.array(z.string()),
  budgetTier: budgetTierSchema,
  cookedBy: cookedBySchema,
  cookingMinutes: z.number().int(),
  vegOnlyDays: z.array(weekdaySchema),
  supplements: z.array(userSupplementSchema),
  supplementProteinG: z.number().int(),
});

export const workoutSectionSchema = z.object({
  locations: z.array(workoutLocationSchema),
  daysPerWeek: z.number().int(),
  sessionMinutes: z.number().int(),
  preferredTime: preferredTimeSchema,
  experienceLevel: experienceLevelSchema,
  injuries: z.string().nullable(),
});

/** Live estimate for the footer on screen 3, and the basis for plan generation. */
export const targetsSchema = z.object({
  bmr: z.number().int(),
  tdee: z.number().int(),
  kcal: z.number().int(),
  proteinG: z.number().int(),
  carbsG: z.number().int(),
  fatG: z.number().int(),
  proteinFromFoodG: z.number().int(),
  dailyDeficitKcal: z.number().int(),
  projectedWeeklyChangeKg: z.number(),
  warning: z.string().optional(),
});

/** Which screens are done — lets the app resume where the user left off. */
export const onboardingProgressSchema = z.object({
  goals: z.boolean(),
  profile: z.boolean(),
  health: z.boolean(),
  diet: z.boolean(),
  workout: z.boolean(),
  /** Health is optional (the screen has a Skip button); the rest are required. */
  canComplete: z.boolean(),
  completedAt: z.string().nullable(),
});

export const onboardingStateSchema = z.object({
  progress: onboardingProgressSchema,
  goals: z.array(goalTypeSchema),
  profile: profileSectionSchema.nullable(),
  health: healthSectionSchema.nullable(),
  diet: dietSectionSchema.nullable(),
  workout: workoutSectionSchema.nullable(),
  /** Null until body stats and goals exist — both are needed to compute it. */
  targets: targetsSchema.nullable(),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
export type NutritionTargetsResponse = z.infer<typeof targetsSchema>;
