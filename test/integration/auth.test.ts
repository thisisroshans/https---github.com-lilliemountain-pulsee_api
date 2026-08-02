import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '../../src/modules/auth/auth.schema.js';
import { disconnectPrisma, getPrisma } from '../../src/shared/db/prisma.js';
import type { ErrorEnvelope, SuccessEnvelope } from '../../src/shared/http/envelope.js';
import { buildTestApp, jsonBody } from '../helpers/build-test-app.js';
import {
  FORGED_TOKEN,
  FakeIdentityVerifier,
  UPSTREAM_DOWN_TOKEN,
  fakeIdToken,
} from '../helpers/fake-identity-verifier.js';
import { resetDatabase } from '../helpers/reset-db.js';

/**
 * Full route → controller → service → repository → Postgres path, using the
 * real app. Firebase is faked; everything else is genuine.
 */

const PHONE = '+919876543210';
const OTHER_PHONE = '+919812345678';

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ identityVerifier: new FakeIdentityVerifier() });
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  /**
   * Every request gets a distinct client IP. Rate limits are keyed on IP, and a
   * shared one would make unrelated tests trip the /auth/firebase limit and fail
   * for reasons that have nothing to do with what they assert.
   */
  let clientCounter = 0;
  const nextIp = () => {
    clientCounter += 1;
    return `10.0.${String(Math.floor(clientCounter / 250))}.${String(clientCounter % 250)}`;
  };

  const call = (options: InjectOptions) => app.inject({ ...options, remoteAddress: nextIp() });

  const exchange = (idToken: string, deviceId?: string) =>
    call({
      method: 'POST',
      url: '/api/v1/auth/firebase',
      payload: deviceId === undefined ? { idToken } : { idToken, deviceId },
    });

  const sessionFrom = (payload: string) => jsonBody<SuccessEnvelope<Session>>(payload).data;

  describe('POST /auth/firebase', () => {
    it('creates the account on first sign-in and returns 201', async () => {
      const response = await exchange(fakeIdToken(PHONE), 'device-1');

      expect(response.statusCode).toBe(201);
      const session = sessionFrom(response.payload);
      expect(session.isNewUser).toBe(true);
      expect(session.user.phone).toBe(PHONE);
      expect(session.user.entitlement).toBe('free');
      expect(session.tokenType).toBe('Bearer');

      const stored = await getPrisma().user.findUnique({ where: { phone: PHONE } });
      expect(stored?.phoneVerifiedAt).not.toBeNull();
    });

    it('logs an existing user in with 200 and does not duplicate the account', async () => {
      await exchange(fakeIdToken(PHONE));
      const response = await exchange(fakeIdToken(PHONE));

      expect(response.statusCode).toBe(200);
      expect(sessionFrom(response.payload).isNewUser).toBe(false);
      expect(await getPrisma().user.count({ where: { phone: PHONE } })).toBe(1);
    });

    it('re-links the account when the same phone gets a new Firebase uid', async () => {
      await exchange(fakeIdToken(PHONE, 'uid-old'));
      const response = await exchange(fakeIdToken(PHONE, 'uid-new'));

      expect(response.statusCode).toBe(200);
      const stored = await getPrisma().user.findUnique({ where: { phone: PHONE } });
      expect(stored?.firebaseUid).toBe('uid-new');
    });

    it('rejects a forged token with 401 and the standard envelope', async () => {
      const response = await exchange(FORGED_TOKEN);

      expect(response.statusCode).toBe(401);
      const body = jsonBody<ErrorEnvelope>(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.requestId).toBeTypeOf('string');
      expect(await getPrisma().user.count()).toBe(0);
    });

    it('returns 503, not 401, when the identity provider is unreachable', async () => {
      const response = await exchange(UPSTREAM_DOWN_TOKEN);

      expect(response.statusCode).toBe(503);
      expect(jsonBody<ErrorEnvelope>(response.payload).error.code).toBe('UPSTREAM_UNAVAILABLE');
    });

    it('rejects a request with no ID token as a validation error', async () => {
      const response = await call({
        method: 'POST',
        url: '/api/v1/auth/firebase',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = jsonBody<ErrorEnvelope>(response.payload);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.[0]?.path).toBe('idToken');
    });

    it('never returns the Firebase uid to the client', async () => {
      const response = await exchange(fakeIdToken(PHONE, 'secret-uid'));

      expect(response.payload).not.toContain('secret-uid');
      expect(response.payload).not.toContain('firebaseUid');
    });

    it('writes an audit row for the signup', async () => {
      await exchange(fakeIdToken(PHONE));

      const audits = await getPrisma().auditLog.findMany();
      expect(audits).toHaveLength(1);
      expect(audits[0]?.action).toBe('AUTH_SIGNUP');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates tokens and invalidates the presented one', async () => {
      const first = sessionFrom((await exchange(fakeIdToken(PHONE))).payload);

      const response = await call({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: first.refreshToken },
      });

      expect(response.statusCode).toBe(200);
      const second = sessionFrom(response.payload);
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // The original token is now dead.
      const replay = await call({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: first.refreshToken },
      });
      expect(replay.statusCode).toBe(401);
    });

    it('revokes the entire family when a rotated token is replayed', async () => {
      const first = sessionFrom((await exchange(fakeIdToken(PHONE))).payload);
      const second = sessionFrom(
        (
          await call({
            method: 'POST',
            url: '/api/v1/auth/refresh',
            payload: { refreshToken: first.refreshToken },
          })
        ).payload,
      );

      // Attacker replays the stolen, already-rotated token.
      await call({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: first.refreshToken },
      });

      // The legitimate user's current token must now also be dead.
      const victim = await call({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: second.refreshToken },
      });

      expect(victim.statusCode).toBe(401);
      const reuseAudit = await getPrisma().auditLog.findFirst({
        where: { action: 'AUTH_REFRESH_REUSE_DETECTED' },
      });
      expect(reuseAudit).not.toBeNull();
    });

    it('rejects a token belonging to nobody', async () => {
      const response = await call({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: '0192f000-0000-7000-8000-000000000000.bogus-secret' },
      });

      expect(response.statusCode).toBe(401);
    });

    it("does not let one user refresh with another user's token", async () => {
      const mine = sessionFrom((await exchange(fakeIdToken(PHONE))).payload);
      const theirs = sessionFrom((await exchange(fakeIdToken(OTHER_PHONE))).payload);

      // Splice my id onto their secret — neither half should be enough.
      const forged = `${mine.refreshToken.split('.')[0] ?? ''}.${theirs.refreshToken.split('.')[1] ?? ''}`;
      const response = await call({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: forged },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session and returns 204', async () => {
      const session = sessionFrom((await exchange(fakeIdToken(PHONE))).payload);

      const response = await call({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: session.refreshToken },
      });

      expect(response.statusCode).toBe(204);

      const afterLogout = await call({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });
      expect(afterLogout.statusCode).toBe(401);
    });

    it('returns 204 for an unknown token rather than leaking its absence', async () => {
      const response = await call({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: '0192f000-0000-7000-8000-000000000000.nope' },
      });

      expect(response.statusCode).toBe(204);
    });

    it('revokes every device when allDevices is set', async () => {
      const phoneSession = sessionFrom((await exchange(fakeIdToken(PHONE), 'phone')).payload);
      const tabletSession = sessionFrom((await exchange(fakeIdToken(PHONE), 'tablet')).payload);

      await call({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: phoneSession.refreshToken, allDevices: true },
      });

      const tablet = await call({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: tabletSession.refreshToken },
      });
      expect(tablet.statusCode).toBe(401);
    });

    it('leaves other devices signed in by default', async () => {
      const phoneSession = sessionFrom((await exchange(fakeIdToken(PHONE), 'phone')).payload);
      const tabletSession = sessionFrom((await exchange(fakeIdToken(PHONE), 'tablet')).payload);

      await call({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: phoneSession.refreshToken },
      });

      const tablet = await call({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: tabletSession.refreshToken },
      });
      expect(tablet.statusCode).toBe(200);
    });
  });

  describe('rate limiting', () => {
    it('throttles repeated sign-in attempts from one client', async () => {
      // The other tests rotate IPs so limits never interfere; this one pins a
      // single IP, so a broken limiter cannot hide behind that rotation.
      const attacker = '203.0.113.99';
      const attempt = () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/firebase',
          remoteAddress: attacker,
          payload: { idToken: FORGED_TOKEN },
        });

      const statuses: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        statuses.push((await attempt()).statusCode);
      }

      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the caller with a valid access token', async () => {
      const session = sessionFrom((await exchange(fakeIdToken(PHONE))).payload);

      const response = await call({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${session.accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(jsonBody<SuccessEnvelope<{ phone: string }>>(response.payload).data.phone).toBe(PHONE);
    });

    it.each([
      ['no token', undefined],
      ['a malformed token', 'Bearer not-a-jwt'],
      ['a token signed with the wrong key', `Bearer ${FOREIGN_JWT}`],
    ])('rejects %s with 401', async (_label, authorization) => {
      const response = await call({
        method: 'GET',
        url: '/api/v1/auth/me',
        ...(authorization === undefined ? {} : { headers: { authorization } }),
      });

      expect(response.statusCode).toBe(401);
      expect(jsonBody<ErrorEnvelope>(response.payload).error.code).toBe('UNAUTHORIZED');
    });
  });
});

/** HS256 JWT signed with a different secret; structurally valid, not ours. */
const FOREIGN_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlcyI6WyJ1c2VyIl0sImVudGl0bGVtZW50IjoicHJlbWl1bSIsImV4cCI6NDEwMjQ0NDgwMH0.qFhbYQ0Ff1ijMJ2wUcJvQO0z3n7oJ5vJ8xZ0K2mQ9dA';
