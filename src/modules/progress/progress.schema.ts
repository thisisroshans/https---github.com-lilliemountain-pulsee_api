import { z } from 'zod';

import { paginationMetaSchema } from '../../shared/http/envelope.js';
import { localDateSchema, uuidSchema } from '../../shared/validation/common.js';

/** Screen 12 contracts. */

export const weightSourceSchema = z.enum(['manual', 'scale', 'import']);
export const progressPeriodSchema = z.enum(['week', 'month', 'all']);

export const recordWeightSchema = z.object({
  /** Accepted in the user's unit; stored canonically in kg. */
  weight: z.number().min(25).max(400),
  unit: z.enum(['kg', 'lb']).default('kg'),
  /** Defaults to today in the user's timezone. */
  date: localDateSchema.optional(),
  source: weightSourceSchema.default('manual'),
  note: z.string().trim().max(280).nullable().default(null),
});
export type RecordWeightInput = z.infer<typeof recordWeightSchema>;

export const weightEntrySchema = z.object({
  id: uuidSchema,
  weightKg: z.number(),
  date: localDateSchema,
  recordedAt: z.string(),
  source: weightSourceSchema,
  note: z.string().nullable(),
});

export const weightPageSchema = z.object({
  items: z.array(weightEntrySchema),
  pagination: paginationMetaSchema,
});

export const streakSchema = z.object({
  currentDays: z.number().int(),
  longestDays: z.number().int(),
  lastActiveDate: localDateSchema.nullable(),
  /** True when today already counts, so the app can nudge only when it matters. */
  activeToday: z.boolean(),
});

export const adherenceSchema = z.object({
  /** Sessions the user planned to do per week, from onboarding. */
  targetPerWeek: z.number().int(),
  completedThisWeek: z.number().int(),
  /** Monday-anchored, seven entries, oldest first. */
  week: z.array(z.object({ date: localDateSchema, trained: z.boolean() })),
  completedInPeriod: z.number().int(),
});

export const weightSummarySchema = z.object({
  currentKg: z.number().nullable(),
  startingKg: z.number().nullable(),
  targetKg: z.number().nullable(),
  changeKg: z.number().nullable(),
  /** Negative means losing. Null until there are at least two weigh-ins. */
  changePerWeekKg: z.number().nullable(),
  /** Null when there is no target, no trend, or the trend points away from it. */
  estimatedWeeksToTarget: z.number().int().nullable(),
  trend: z.array(z.object({ date: localDateSchema, weightKg: z.number() })),
});

export const progressSummarySchema = z.object({
  period: progressPeriodSchema,
  from: localDateSchema,
  to: localDateSchema,
  weight: weightSummarySchema,
  streak: streakSchema,
  adherence: adherenceSchema,
  training: z.object({
    sessions: z.number().int(),
    totalVolumeKg: z.number(),
    totalSets: z.number().int(),
  }),
});

export const listWeightQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(365).default(30),
  cursor: z.string().min(1).optional(),
});
export type ListWeightQuery = z.infer<typeof listWeightQuerySchema>;

export const summaryQuerySchema = z.object({
  period: progressPeriodSchema.default('week'),
});
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
