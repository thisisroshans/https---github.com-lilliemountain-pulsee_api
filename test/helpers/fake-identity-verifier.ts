import type {
  PhoneIdentityVerifier,
  VerifiedPhoneIdentity,
} from '../../src/integrations/identity/phone-identity-verifier.js';
import { UnauthorizedError, UpstreamError } from '../../src/shared/errors/index.js';

/**
 * Stand-in for Firebase. Tests never call a real identity provider: it would be
 * slow, flaky, and would need live credentials in CI.
 *
 * Token conventions:
 *   "valid:+919876543210"        -> verifies as that phone
 *   "valid:+919876543210:uid-1"  -> ...with an explicit provider uid
 *   "no-phone-sign-in-token"     -> a non-phone sign-in (email/Google)
 *   "upstream-down-token"        -> provider unreachable
 *   anything else                -> rejected
 */
export class FakeIdentityVerifier implements PhoneIdentityVerifier {
  public calls: string[] = [];

  verifyIdToken(idToken: string): Promise<VerifiedPhoneIdentity> {
    this.calls.push(idToken);

    if (idToken === UPSTREAM_DOWN_TOKEN) {
      return Promise.reject(new UpstreamError('Could not verify your sign-in right now.'));
    }

    if (idToken === NO_PHONE_TOKEN) {
      return Promise.reject(
        new UnauthorizedError('This sign-in method is not supported. Use your phone number.'),
      );
    }

    const parts = idToken.split(':');
    if (parts[0] !== 'valid' || parts[1] === undefined) {
      return Promise.reject(new UnauthorizedError('Phone verification failed.'));
    }

    return Promise.resolve({
      providerUid: parts[2] ?? `firebase-${parts[1]}`,
      phone: parts[1],
      authenticatedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
  }
}

/**
 * Sentinel tokens. They must clear the route schema's minimum length, so they
 * are padded — otherwise validation would reject them at 400 before the
 * verifier ever ran, and the test would not exercise what it claims to.
 */
export const UPSTREAM_DOWN_TOKEN = 'upstream-down-token';
export const NO_PHONE_TOKEN = 'no-phone-sign-in-token';
export const FORGED_TOKEN = 'forged-token-that-is-long-enough';

/** Convenience for building the token this fake accepts. */
export function fakeIdToken(phone: string, uid?: string): string {
  return uid === undefined ? `valid:${phone}` : `valid:${phone}:${uid}`;
}
