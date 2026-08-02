import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../config/constants.js';

/**
 * Shared Zod primitives. Compose these instead of re-declaring shapes so that
 * one fix (e.g. phone normalisation) lands everywhere at once.
 */

export const uuidSchema = z.string().uuid();

/**
 * Indian mobile number, normalised to E.164. Accepts what users actually type
 * ("98765 43210", "+91-98765-43210", "098765 43210") and emits "+919876543210".
 */
export const indianPhoneSchema = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[\s\-()]/g, ''))
  .transform((v) => v.replace(/^\+?91/, '').replace(/^0/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), {
    message: 'Must be a 10-digit Indian mobile number.',
  })
  .transform((v) => `+91${v}`);

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/, 'Code must be 4–6 digits.');

/** Nutrition macros. Non-negative and bounded — guards against absurd input. */
export const macrosSchema = z.object({
  kcal: z.number().int().min(0).max(20_000),
  proteinG: z.number().min(0).max(1000),
  carbsG: z.number().min(0).max(2000),
  fatG: z.number().min(0).max(1000),
});
export type Macros = z.infer<typeof macrosSchema>;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** IANA timezone. Validated against the runtime's own tz database. */
export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Must be a valid IANA timezone, e.g. Asia/Kolkata.' },
);

/** A calendar day in the user's local timezone, "YYYY-MM-DD". */
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD.');

/** Free text from users — trimmed and length-capped before it reaches the DB. */
export const shortTextSchema = z.string().trim().max(280);
export const longTextSchema = z.string().trim().max(4000);
