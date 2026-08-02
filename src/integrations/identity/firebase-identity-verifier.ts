import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';

import type { Env } from '../../config/env.js';
import { UnauthorizedError, UpstreamError } from '../../shared/errors/index.js';
import { getLogger } from '../../shared/logger/index.js';
import type { PhoneIdentityVerifier, VerifiedPhoneIdentity } from './phone-identity-verifier.js';

/**
 * Firebase Phone Auth implementation.
 *
 * Firebase performs the SMS challenge in the mobile app and issues an ID token.
 * We verify that token's signature, audience, issuer and expiry, and read the
 * verified phone number out of it.
 */

/** Firebase error codes that mean "this token is not acceptable", not "we broke". */
const CLIENT_TOKEN_ERROR_CODES = new Set([
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/argument-error',
  'auth/user-disabled',
  'auth/session-cookie-expired',
  'auth/session-cookie-revoked',
]);

function errorCodeOf(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    if (typeof err.code === 'string') return err.code;
  }
  return undefined;
}

export class FirebaseIdentityVerifier implements PhoneIdentityVerifier {
  private auth: Auth | undefined;

  constructor(private readonly env: Env) {}

  /**
   * Initialised on first use rather than in the constructor.
   *
   * Building the app must not require Firebase credentials: a developer with no
   * Firebase project should still be able to boot the API and serve health and
   * every non-auth route. Production is covered by env validation, which refuses
   * to start without these credentials.
   */
  private getAuthClient(): Auth {
    this.auth ??= getAuth(resolveApp(this.env));
    return this.auth;
  }

  async verifyIdToken(idToken: string): Promise<VerifiedPhoneIdentity> {
    if (idToken.trim().length === 0) {
      throw new UnauthorizedError('Firebase ID token is missing.');
    }

    let decoded: DecodedIdToken;
    try {
      // checkRevoked forces a lookup against Firebase so that a signed-out or
      // disabled user cannot keep exchanging an otherwise-valid token.
      decoded = await this.getAuthClient().verifyIdToken(idToken, true);
    } catch (err) {
      const code = errorCodeOf(err);

      if (code !== undefined && CLIENT_TOKEN_ERROR_CODES.has(code)) {
        getLogger().warn({ code }, 'rejected firebase id token');
        throw new UnauthorizedError('Phone verification failed. Please sign in again.');
      }

      // Network failure, bad service account, Firebase outage: ours, not theirs.
      getLogger().error({ err, code }, 'firebase id token verification failed unexpectedly');
      throw new UpstreamError('Could not verify your sign-in right now. Please try again.');
    }

    const phone = decoded.phone_number;
    if (typeof phone !== 'string' || phone.length === 0) {
      // An email or Google sign-in would land here. Pulse is phone-only.
      throw new UnauthorizedError('This sign-in method is not supported. Use your phone number.');
    }

    return {
      providerUid: decoded.uid,
      phone,
      authenticatedAt: toDate(decoded.auth_time),
    };
  }
}

/** Firebase reports auth_time in seconds since epoch. */
function toDate(secondsSinceEpoch: number | undefined): Date | undefined {
  return typeof secondsSinceEpoch === 'number' ? new Date(secondsSinceEpoch * 1000) : undefined;
}

/**
 * The Admin SDK keeps a global app registry and throws on duplicate names, so
 * reuse an existing app rather than initialising per instance.
 */
function resolveApp(env: Env): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;

  // The emulator needs no credentials and ignores signatures; env validation
  // already refuses to let this variable be set in production.
  if (env.FIREBASE_AUTH_EMULATOR_HOST !== undefined) {
    getLogger().warn(
      { emulator: env.FIREBASE_AUTH_EMULATOR_HOST },
      'using the firebase auth emulator — ID token signatures are NOT verified',
    );
    return initializeApp({ projectId: env.FIREBASE_PROJECT_ID ?? 'pulse-local' }, APP_NAME);
  }

  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error(
      'Firebase credentials are not configured. Set FIREBASE_PROJECT_ID, ' +
        'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or point ' +
        'FIREBASE_AUTH_EMULATOR_HOST at a local emulator.',
    );
  }

  return initializeApp(
    {
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
      }),
      projectId: env.FIREBASE_PROJECT_ID,
    },
    APP_NAME,
  );
}

const APP_NAME = 'pulse-auth';
