import { z } from 'zod';

import { uuidSchema } from '../../shared/validation/common.js';

/**
 * Request and response contracts for authentication.
 *
 * Note what is absent: there is no endpoint that sends or checks an SMS code.
 * Firebase performs phone verification in the app; the API only exchanges the
 * resulting ID token for a Pulse session.
 */

export const firebaseExchangeSchema = z.object({
  /** Firebase ID token from the client SDK after phone verification. */
  idToken: z.string().min(16).max(4096),
  /** Optional stable device identifier, used to scope and audit sessions. */
  deviceId: z.string().trim().min(1).max(128).optional(),
});
export type FirebaseExchangeInput = z.infer<typeof firebaseExchangeSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(16).max(512),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(16).max(512),
  /** Revoke every session for this user, not just the presented one. */
  allDevices: z.boolean().default(false),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

/** Public shape of a user. Never widen this without checking for PII leaks. */
export const userSchema = z.object({
  id: uuidSchema,
  phone: z.string(),
  displayName: z.string().nullable(),
  timezone: z.string(),
  locale: z.string(),
  entitlement: z.enum(['free', 'premium']),
  roles: z.array(z.enum(['user', 'admin', 'support'])),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof userSchema>;

export const sessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access token lifetime in seconds, so clients can refresh proactively. */
  expiresIn: z.number().int(),
  tokenType: z.literal('Bearer'),
  /** True when this exchange created the account rather than logging in. */
  isNewUser: z.boolean(),
  user: userSchema,
});
export type Session = z.infer<typeof sessionSchema>;
