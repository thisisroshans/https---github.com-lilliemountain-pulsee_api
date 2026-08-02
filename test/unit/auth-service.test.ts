import type { RefreshToken, User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../src/config/env.js';
import type { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import { AUTH_AUDIT_ACTIONS, AuthService } from '../../src/modules/auth/auth.service.js';
import { TokenService } from '../../src/shared/auth/token-service.js';
import { UnauthorizedError, UpstreamError } from '../../src/shared/errors/index.js';
import {
  FORGED_TOKEN,
  FakeIdentityVerifier,
  NO_PHONE_TOKEN,
  UPSTREAM_DOWN_TOKEN,
  fakeIdToken,
} from '../helpers/fake-identity-verifier.js';

/**
 * Unit tests for the security decisions: who gets a session, what a reused
 * refresh token means, and what logout guarantees. The repository is a stub —
 * database behaviour is covered by the integration suite.
 */

const PHONE = '+919876543210';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    phone: PHONE,
    firebaseUid: 'firebase-1',
    phoneVerifiedAt: new Date('2026-08-02T00:00:00.000Z'),
    displayName: null,
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    roles: ['USER'],
    entitlement: 'FREE',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function buildStoredToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'token-1',
    userId: 'user-1',
    tokenHash: 'hash',
    familyId: 'family-1',
    replacedById: null,
    deviceId: null,
    userAgent: null,
    ip: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildRepository() {
  return {
    findActiveUserByPhone: vi.fn(),
    findActiveUserById: vi.fn().mockResolvedValue(buildUser()),
    upsertUserByPhone: vi.fn().mockResolvedValue({ user: buildUser(), isNew: false }),
    createRefreshToken: vi.fn().mockResolvedValue(buildStoredToken()),
    findRefreshTokenById: vi.fn(),
    rotateRefreshToken: vi.fn().mockResolvedValue(buildStoredToken()),
    revokeToken: vi.fn().mockResolvedValue({ count: 1 }),
    revokeFamily: vi.fn().mockResolvedValue({ count: 3 }),
    revokeAllForUser: vi.fn().mockResolvedValue({ count: 5 }),
    writeAudit: vi.fn().mockResolvedValue(undefined),
  };
}

type Repo = ReturnType<typeof buildRepository>;

function buildService(repo: Repo, identity = new FakeIdentityVerifier()) {
  const tokens = new TokenService({
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_PEPPER: 'b'.repeat(48),
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL_DAYS: 60,
  } as Env);

  // The stub implements every method the service calls; the cast bridges it to
  // the concrete class without pulling in Prisma.
  return {
    service: new AuthService(repo as unknown as AuthRepository, identity, tokens),
    tokens,
  };
}

const context = { ip: '1.2.3.4', userAgent: 'PulseApp/1.0' };

describe('exchangeFirebaseToken', () => {
  let repo: Repo;

  beforeEach(() => {
    repo = buildRepository();
  });

  it('issues a session for a verified phone number', async () => {
    const { service } = buildService(repo);

    const session = await service.exchangeFirebaseToken({
      idToken: fakeIdToken(PHONE),
      deviceId: 'device-1',
      ...context,
    });

    expect(session.tokenType).toBe('Bearer');
    expect(session.accessToken.split('.')).toHaveLength(3);
    expect(session.refreshToken).toContain('.');
    expect(session.expiresIn).toBe(900);
    expect(session.user.phone).toBe(PHONE);
  });

  it('flags a first-time sign-in as a new user', async () => {
    repo.upsertUserByPhone.mockResolvedValue({ user: buildUser(), isNew: true });
    const { service } = buildService(repo);

    const session = await service.exchangeFirebaseToken({
      idToken: fakeIdToken(PHONE),
      deviceId: undefined,
      ...context,
    });

    expect(session.isNewUser).toBe(true);
    expect(repo.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.signup }),
    );
  });

  it('audits a returning user as a login, not a signup', async () => {
    const { service } = buildService(repo);

    await service.exchangeFirebaseToken({
      idToken: fakeIdToken(PHONE),
      deviceId: undefined,
      ...context,
    });

    expect(repo.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.login }),
    );
  });

  it('stores the phone Firebase verified, not one supplied by the client', async () => {
    const { service } = buildService(repo);

    await service.exchangeFirebaseToken({
      idToken: fakeIdToken('+919999888877', 'uid-42'),
      deviceId: undefined,
      ...context,
    });

    expect(repo.upsertUserByPhone).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+919999888877', firebaseUid: 'uid-42' }),
    );
  });

  it('starts a fresh token family per sign-in, so devices revoke independently', async () => {
    const { service } = buildService(repo);

    await service.exchangeFirebaseToken({ idToken: fakeIdToken(PHONE), deviceId: 'a', ...context });
    await service.exchangeFirebaseToken({ idToken: fakeIdToken(PHONE), deviceId: 'b', ...context });

    const [first, second] = repo.createRefreshToken.mock.calls;
    expect(first?.[0].familyId).not.toBe(second?.[0].familyId);
  });

  it('rejects an invalid token and creates no user', async () => {
    const { service } = buildService(repo);

    await expect(
      service.exchangeFirebaseToken({ idToken: FORGED_TOKEN, deviceId: undefined, ...context }),
    ).rejects.toThrow(UnauthorizedError);
    expect(repo.upsertUserByPhone).not.toHaveBeenCalled();
  });

  it('rejects a non-phone sign-in', async () => {
    const { service } = buildService(repo);

    await expect(
      service.exchangeFirebaseToken({ idToken: NO_PHONE_TOKEN, deviceId: undefined, ...context }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('surfaces a provider outage as an upstream failure, not an auth failure', async () => {
    const { service } = buildService(repo);

    // 503 tells the client to retry; 401 would wrongly tell them to sign in again.
    await expect(
      service.exchangeFirebaseToken({ idToken: UPSTREAM_DOWN_TOKEN, deviceId: undefined, ...context }),
    ).rejects.toThrow(UpstreamError);
  });

  it('stores only a hash of the refresh secret', async () => {
    const { service } = buildService(repo);

    const session = await service.exchangeFirebaseToken({
      idToken: fakeIdToken(PHONE),
      deviceId: undefined,
      ...context,
    });

    const stored = repo.createRefreshToken.mock.calls[0]?.[0] as { tokenHash: string };
    const secret = session.refreshToken.split('.')[1] ?? '';
    expect(stored.tokenHash).not.toContain(secret);
    expect(stored.tokenHash.startsWith('$argon2id$')).toBe(true);
  });
});

describe('refresh', () => {
  let repo: Repo;

  beforeEach(() => {
    repo = buildRepository();
  });

  /** Builds a token the service will consider genuine. */
  async function issueStoredToken(overrides: Partial<RefreshToken> = {}) {
    const { service, tokens } = buildService(repo);
    const { token, parts } = tokens.generateRefreshToken();
    const tokenHash = await tokens.hashRefreshSecret(parts.secret);
    const stored = buildStoredToken({ id: parts.id, tokenHash, ...overrides });
    repo.findRefreshTokenById.mockResolvedValue(stored);
    return { service, token, stored };
  }

  it('rotates a valid token', async () => {
    const { service, token, stored } = await issueStoredToken();

    const session = await service.refresh({ refreshToken: token, ...context });

    expect(session.refreshToken).not.toBe(token);
    expect(repo.rotateRefreshToken).toHaveBeenCalledWith(
      stored.id,
      expect.objectContaining({ familyId: stored.familyId }),
      expect.any(Date),
    );
  });

  it('keeps the rotated token in the same family', async () => {
    const { service, token } = await issueStoredToken({ familyId: 'family-xyz' });

    await service.refresh({ refreshToken: token, ...context });

    expect(repo.rotateRefreshToken.mock.calls[0]?.[1].familyId).toBe('family-xyz');
  });

  it('rejects an unknown token', async () => {
    repo.findRefreshTokenById.mockResolvedValue(null);
    const { service } = buildService(repo);

    await expect(service.refresh({ refreshToken: 'abc.def', ...context })).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a correct id with a wrong secret, and revokes nothing', async () => {
    const { service, token } = await issueStoredToken();
    const id = token.split('.')[0] ?? '';

    await expect(service.refresh({ refreshToken: `${id}.wrong-secret`, ...context })).rejects.toThrow(
      UnauthorizedError,
    );
    // Otherwise a guessed id would be a denial-of-service against that family.
    expect(repo.revokeFamily).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const { service, token } = await issueStoredToken({ expiresAt: new Date(Date.now() - 1000) });

    await expect(service.refresh({ refreshToken: token, ...context })).rejects.toThrow(UnauthorizedError);
    expect(repo.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('revokes the whole family when an already-rotated token is reused', async () => {
    const { service, token, stored } = await issueStoredToken({ revokedAt: new Date() });

    await expect(service.refresh({ refreshToken: token, ...context })).rejects.toThrow(UnauthorizedError);
    expect(repo.revokeFamily).toHaveBeenCalledWith(stored.familyId, expect.any(Date));
    expect(repo.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.refreshReuse }),
    );
  });

  it('refuses to refresh into a deleted account', async () => {
    const { service, token } = await issueStoredToken();
    repo.findActiveUserById.mockResolvedValue(null);

    await expect(service.refresh({ refreshToken: token, ...context })).rejects.toThrow(UnauthorizedError);
  });

  it('never reports a new user on refresh', async () => {
    const { service, token } = await issueStoredToken();

    expect((await service.refresh({ refreshToken: token, ...context })).isNewUser).toBe(false);
  });
});

describe('logout', () => {
  let repo: Repo;

  beforeEach(() => {
    repo = buildRepository();
  });

  async function issueStoredToken(overrides: Partial<RefreshToken> = {}) {
    const { service, tokens } = buildService(repo);
    const { token, parts } = tokens.generateRefreshToken();
    const tokenHash = await tokens.hashRefreshSecret(parts.secret);
    repo.findRefreshTokenById.mockResolvedValue(buildStoredToken({ id: parts.id, tokenHash, ...overrides }));
    return { service, token };
  }

  it('revokes the presented session family', async () => {
    const { service, token } = await issueStoredToken({ familyId: 'family-1' });

    await service.logout({ refreshToken: token, allDevices: false, ...context });

    expect(repo.revokeFamily).toHaveBeenCalledWith('family-1', expect.any(Date));
    expect(repo.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('revokes every session when allDevices is set', async () => {
    const { service, token } = await issueStoredToken();

    await service.logout({ refreshToken: token, allDevices: true, ...context });

    expect(repo.revokeAllForUser).toHaveBeenCalledWith('user-1', expect.any(Date));
  });

  it.each([
    ['a malformed token', 'not-a-token'],
    ['an unknown token', 'aaaa.bbbb'],
  ])('succeeds silently for %s', async (_label, token) => {
    repo.findRefreshTokenById.mockResolvedValue(null);
    const { service } = buildService(repo);

    // Reporting failure would confirm whether a token exists.
    await expect(
      service.logout({ refreshToken: token, allDevices: false, ...context }),
    ).resolves.toBeUndefined();
    expect(repo.revokeFamily).not.toHaveBeenCalled();
  });

  it('does not revoke anything when the secret is wrong', async () => {
    const { service, token } = await issueStoredToken();
    const id = token.split('.')[0] ?? '';

    await service.logout({ refreshToken: `${id}.wrong`, allDevices: true, ...context });

    expect(repo.revokeAllForUser).not.toHaveBeenCalled();
    expect(repo.revokeFamily).not.toHaveBeenCalled();
  });
});

describe('getCurrentUser', () => {
  it('returns the public projection without internal columns', async () => {
    const repo = buildRepository();
    const { service } = buildService(repo);

    const user = await service.getCurrentUser('user-1');

    expect(user).toMatchObject({ id: 'user-1', phone: PHONE, entitlement: 'free', roles: ['user'] });
    expect(user).not.toHaveProperty('firebaseUid');
    expect(user).not.toHaveProperty('deletedAt');
  });

  it('rejects a token whose account has been deleted', async () => {
    const repo = buildRepository();
    repo.findActiveUserById.mockResolvedValue(null);
    const { service } = buildService(repo);

    await expect(service.getCurrentUser('user-1')).rejects.toThrow(UnauthorizedError);
  });
});
