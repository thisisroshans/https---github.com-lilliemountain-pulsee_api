import { z } from 'zod';

import { paginationMetaSchema } from '../../shared/http/envelope.js';
import { localDateSchema, uuidSchema } from '../../shared/validation/common.js';

/**
 * Contracts for the exercise catalog and the training log (screen 9).
 */

export const muscleGroupSchema = z.enum([
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'lats',
  'traps',
  'lower_back',
  'rear_delts',
  'full_body',
  'cardio',
]);

export const exerciseCategorySchema = z.enum(['push', 'pull', 'legs', 'core', 'cardio', 'mobility']);

export const equipmentSchema = z.enum([
  'none',
  'dumbbell',
  'barbell',
  'machine',
  'cable',
  'kettlebell',
  'resistance_band',
  'bodyweight',
  'cardio_machine',
]);

export const sessionStatusSchema = z.enum(['in_progress', 'completed', 'abandoned']);

// --- Catalog ----------------------------------------------------------------

export const listExercisesQuerySchema = z.object({
  category: exerciseCategorySchema.optional(),
  muscle: muscleGroupSchema.optional(),
  equipment: equipmentSchema.optional(),
  /** Free-text search over the exercise name. */
  q: z.string().trim().min(1).max(60).optional(),
});
export type ListExercisesQuery = z.infer<typeof listExercisesQuerySchema>;

export const exerciseSummarySchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  category: exerciseCategorySchema,
  primaryMuscles: z.array(muscleGroupSchema),
  secondaryMuscles: z.array(muscleGroupSchema),
  equipment: z.array(equipmentSchema),
  isWeighted: z.boolean(),
});

export const exerciseDetailSchema = exerciseSummarySchema.extend({
  howToSteps: z.array(z.string()),
  demoVideoKey: z.string().nullable(),
  /** The caller's most recent working set, for pre-filling the log. */
  lastPerformed: z
    .object({
      performedAt: z.string(),
      weightKg: z.number().nullable(),
      reps: z.number().int(),
      estimatedOneRepMaxKg: z.number().nullable(),
    })
    .nullable(),
});

// --- Sessions ---------------------------------------------------------------

export const startSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});
export type StartSessionInput = z.infer<typeof startSessionSchema>;

export const logSetSchema = z
  .object({
    exerciseId: uuidSchema,
    setNumber: z.number().int().min(1).max(50),
    reps: z.number().int().min(0).max(500),
    weightKg: z.number().min(0).max(1000).nullable().default(null),
    durationSeconds: z.number().int().min(0).max(36_000).nullable().default(null),
    isWarmup: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    // A set records work: reps, or time for a hold or cardio interval.
    if (input.reps === 0 && (input.durationSeconds ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reps'],
        message: 'A set needs either reps or a duration.',
      });
    }
  });
export type LogSetInput = z.infer<typeof logSetSchema>;

export const completeSessionSchema = z.object({
  perceivedExertion: z.number().int().min(1).max(10).nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
});
export type CompleteSessionInput = z.infer<typeof completeSessionSchema>;

export const setLogSchema = z.object({
  id: uuidSchema,
  exerciseId: uuidSchema,
  exerciseName: z.string(),
  setNumber: z.number().int(),
  reps: z.number().int(),
  weightKg: z.number().nullable(),
  durationSeconds: z.number().int().nullable(),
  isWarmup: z.boolean(),
});

export const sessionSummarySchema = z.object({
  id: uuidSchema,
  status: sessionStatusSchema,
  title: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  localDate: localDateSchema,
  perceivedExertion: z.number().int().nullable(),
  notes: z.string().nullable(),
  exerciseCount: z.number().int(),
  setCount: z.number().int(),
  totalVolumeKg: z.number(),
  totalReps: z.number().int(),
  durationSeconds: z.number().int().nullable(),
});

export const sessionDetailSchema = sessionSummarySchema.extend({
  sets: z.array(setLogSchema),
});

export const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  status: sessionStatusSchema.optional(),
});
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

export const sessionPageSchema = z.object({
  items: z.array(sessionSummarySchema),
  pagination: paginationMetaSchema,
});

// --- Per-exercise history and progress --------------------------------------

export const exerciseHistoryEntrySchema = z.object({
  sessionId: uuidSchema,
  performedAt: z.string(),
  localDate: localDateSchema,
  sets: z.array(
    z.object({
      setNumber: z.number().int(),
      reps: z.number().int(),
      weightKg: z.number().nullable(),
      isWarmup: z.boolean(),
    }),
  ),
  topSetWeightKg: z.number().nullable(),
  estimatedOneRepMaxKg: z.number().nullable(),
  totalVolumeKg: z.number(),
});

export const exerciseHistoryPageSchema = z.object({
  items: z.array(exerciseHistoryEntrySchema),
  pagination: paginationMetaSchema,
});

export const exerciseProgressSchema = z.object({
  exerciseId: uuidSchema,
  isWeighted: z.boolean(),
  /** Null for bodyweight and cardio work, where load is not meaningful. */
  currentOneRepMaxKg: z.number().nullable(),
  oneRepMaxChangePerMonthKg: z.number().nullable(),
  oneRepMaxTrend: z.array(z.object({ date: localDateSchema, value: z.number() })),
  weeklyVolume: z.array(
    z.object({
      /** Monday of the week, as a local date. */
      weekStart: localDateSchema,
      volumeKg: z.number(),
      sets: z.number().int(),
    }),
  ),
  totalSessions: z.number().int(),
});
