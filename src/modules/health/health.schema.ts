import { z } from 'zod';

export const dependencyStatusSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().int().nullable(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number().int(),
  version: z.string(),
  dependencies: z.object({
    database: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;
