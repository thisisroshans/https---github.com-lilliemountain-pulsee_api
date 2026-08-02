import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AUTH_EXCHANGE_RATE_LIMIT, AUTH_REFRESH_RATE_LIMIT } from '../../config/constants.js';
import { loadEnv } from '../../config/env.js';
import { FirebaseIdentityVerifier } from '../../integrations/identity/firebase-identity-verifier.js';
import type { PhoneIdentityVerifier } from '../../integrations/identity/phone-identity-verifier.js';
import { TokenService } from '../../shared/auth/token-service.js';
import { getPrisma } from '../../shared/db/prisma.js';
import { commonErrorResponses, successSchema } from '../../shared/http/envelope.js';
import { requireAuth } from '../../shared/middleware/auth.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import {
  firebaseExchangeSchema,
  logoutSchema,
  refreshSchema,
  sessionSchema,
  userSchema,
} from './auth.schema.js';
import { AuthService } from './auth.service.js';

export interface AuthRouteOptions {
  /** Injected by tests to avoid calling Firebase. Production builds the real one. */
  identityVerifier?: PhoneIdentityVerifier;
}

export async function authRoutes(app: FastifyInstance, options: AuthRouteOptions): Promise<void> {
  const env = loadEnv();
  const identity = options.identityVerifier ?? new FirebaseIdentityVerifier(env);

  const controller = new AuthController(
    new AuthService(new AuthRepository(getPrisma()), identity, new TokenService(env)),
  );

  app.post(
    '/auth/firebase',
    {
      // Tighter than the global floor: this endpoint is the entry point to an
      // account, and each call costs a Firebase verification round trip.
      config: { rateLimit: AUTH_EXCHANGE_RATE_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Exchange a Firebase ID token for a Pulse session',
        description:
          'The app verifies the phone number with Firebase Phone Auth and sends the resulting ' +
          'ID token here. Creates the account on first sign-in (201) or logs in (200). ' +
          'There is no server-side OTP endpoint — Pulse never sees the SMS code.',
        body: firebaseExchangeSchema,
        response: {
          200: successSchema(sessionSchema),
          201: successSchema(sessionSchema),
          ...commonErrorResponses,
        },
      },
    },
    controller.exchange,
  );

  app.post(
    '/auth/refresh',
    {
      config: { rateLimit: AUTH_REFRESH_RATE_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Rotate a refresh token',
        description:
          'Returns a new access and refresh token, revoking the presented one. Reusing an ' +
          'already-rotated token revokes every session descended from that login.',
        body: refreshSchema,
        response: {
          200: successSchema(sessionSchema),
          ...commonErrorResponses,
        },
      },
    },
    controller.refresh,
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke the current session',
        description:
          'Always returns 204, including for an unknown or already-revoked token — reporting ' +
          'otherwise would leak whether a token exists.',
        body: logoutSchema,
        response: {
          204: z.null(),
          ...commonErrorResponses,
        },
      },
    },
    controller.logout,
  );

  app.get(
    '/auth/me',
    {
      // onRequest so authentication precedes schema validation; see the note in
      // onboarding.routes.ts. Fastify awaits a two-argument async hook — the
      // lint rule fires only because the type also permits a callback form. Do
      // NOT "fix" it by wrapping in `void`, which would stop the guard blocking.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: requireAuth,
      schema: {
        tags: ['auth'],
        summary: 'Current user',
        security: [{ bearerAuth: [] }],
        response: {
          200: successSchema(userSchema),
          ...commonErrorResponses,
        },
      },
    },
    controller.me,
  );
}
