import { z } from 'zod';

import type { ErrorDetail } from '../errors/app-error.js';

/**
 * The two response shapes every endpoint returns. Defined once so routes,
 * controllers, tests and the OpenAPI document cannot drift apart.
 */

export interface PaginationMeta {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export interface ResponseMeta {
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

export function ok<T>(data: T, meta?: ResponseMeta): SuccessEnvelope<T> {
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

export function paginated<T>(
  data: T[],
  pagination: PaginationMeta,
  extraMeta?: Omit<ResponseMeta, 'pagination'>,
): SuccessEnvelope<T[]> {
  return { success: true, data, meta: { ...extraMeta, pagination } };
}

// --- Zod builders for route response schemas --------------------------------

const errorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const paginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  limit: z.number().int(),
});

/** Wrap a data schema in the success envelope for use in a route's `response`. */
export function successSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
    meta: z.record(z.unknown()).optional(),
  });
}

export const errorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
    requestId: z.string(),
  }),
});

/**
 * Standard error responses to attach to every route so the generated OpenAPI
 * documents them instead of each route repeating itself.
 */
export const commonErrorResponses = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
  422: errorSchema,
  429: errorSchema,
  500: errorSchema,
  503: errorSchema,
} as const;
