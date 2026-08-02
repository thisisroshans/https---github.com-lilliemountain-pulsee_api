import { createVerifier } from 'fast-jwt';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../src/config/env.js';
import { TokenService, parseDuration, safeEquals } from '../../src/shared/auth/token-service.js';
import { UnauthorizedError } from '../../src/shared/errors/index.js';

const ACCESS_SECRET = 'a'.repeat(48);
const PEPPER = 'b'.repeat(48);

interface AccessClaims {
  sub: string;
  roles: string[];
  entitlement: string;
  jti: string;
  exp: number;
}

/** Verifies with the same library @fastify/jwt uses, proving compatibility. */
function verifyClaims(token: string): AccessClaims {
  const verified: unknown = createVerifier({ key: ACCESS_SECRET })(token);
  return verified as AccessClaims;
}

function tokenService(overrides: Partial<Env> = {}): TokenService {
  return new TokenService({
    JWT_ACCESS_SECRET: ACCESS_SECRET,
    JWT_REFRESH_PEPPER: PEPPER,
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL_DAYS: 60,
    ...overrides,
  } as Env);
}

describe('parseDuration', () => {
  it.each([
    ['500ms', 500],
    ['30s', 30_000],
    ['15m', 900_000],
    ['24h', 86_400_000],
    ['7d', 604_800_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '15', 'm', '15 minutes', '-5m', '15y'])('rejects %s', (input) => {
    expect(() => parseDuration(input)).toThrow(/duration/i);
  });
});

describe('access tokens', () => {
  it('signs a token @fastify/jwt can verify with the same secret', () => {
    const token = tokenService().issueAccessToken({
      userId: 'user-1',
      roles: ['user'],
      entitlement: 'premium',
    });

    const claims = verifyClaims(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.roles).toEqual(['user']);
    expect(claims.entitlement).toBe('premium');
    expect(claims.exp).toBeTypeOf('number');
  });

  it('gives every token a distinct jti so individual tokens can be traced', () => {
    const service = tokenService();
    const subject = { userId: 'user-1', roles: ['user' as const], entitlement: 'free' as const };

    const a = verifyClaims(service.issueAccessToken(subject));
    const b = verifyClaims(service.issueAccessToken(subject));

    expect(a.jti).not.toBe(b.jti);
  });

  it('rejects a token signed with a different secret', () => {
    const token = tokenService().issueAccessToken({
      userId: 'user-1',
      roles: ['user'],
      entitlement: 'free',
    });

    expect(() => {
      createVerifier({ key: 'c'.repeat(48) })(token);
    }).toThrow();
  });

  it('reports the access token lifetime in seconds', () => {
    expect(tokenService().accessTokenTtlSeconds()).toBe(900);
    expect(tokenService({ ACCESS_TOKEN_TTL: '1h' }).accessTokenTtlSeconds()).toBe(3600);
  });
});

describe('refresh tokens', () => {
  it('mints "<id>.<secret>" so the row can be found without scanning', () => {
    const { token, parts } = tokenService().generateRefreshToken();

    expect(token).toBe(`${parts.id}.${parts.secret}`);
    expect(parts.secret.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it('never repeats a secret', () => {
    const service = tokenService();
    const secrets = new Set(Array.from({ length: 50 }, () => service.generateRefreshToken().parts.secret));

    expect(secrets.size).toBe(50);
  });

  it('round-trips through parseRefreshToken', () => {
    const service = tokenService();
    const { token, parts } = service.generateRefreshToken();

    expect(service.parseRefreshToken(token)).toEqual(parts);
  });

  it.each([['no-separator'], ['.leading'], ['trailing.'], ['']])(
    'treats malformed token %s as an auth failure, not a crash',
    (token) => {
      expect(() => tokenService().parseRefreshToken(token)).toThrow(UnauthorizedError);
    },
  );

  it('verifies a secret against its own hash', async () => {
    const service = tokenService();
    const { parts } = service.generateRefreshToken();
    const hash = await service.hashRefreshSecret(parts.secret);

    expect(hash).not.toContain(parts.secret);
    await expect(service.verifyRefreshSecret(hash, parts.secret)).resolves.toBe(true);
    await expect(service.verifyRefreshSecret(hash, 'wrong-secret')).resolves.toBe(false);
  });

  it('fails verification when the pepper differs', async () => {
    const hash = await tokenService().hashRefreshSecret('shared-secret');
    const otherPepper = tokenService({ JWT_REFRESH_PEPPER: 'z'.repeat(48) });

    // A stolen database alone is not enough to validate a token.
    await expect(otherPepper.verifyRefreshSecret(hash, 'shared-secret')).resolves.toBe(false);
  });

  it('treats a corrupt hash as a mismatch rather than throwing', async () => {
    await expect(tokenService().verifyRefreshSecret('not-a-hash', 'secret')).resolves.toBe(false);
  });

  it('computes expiry from the configured lifetime', () => {
    const now = new Date('2026-08-02T00:00:00.000Z');
    const expiry = tokenService({ REFRESH_TOKEN_TTL_DAYS: 30 }).refreshTokenExpiry(now);

    expect(expiry.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('safeEquals', () => {
  it('matches identical strings and rejects others without leaking length', () => {
    expect(safeEquals('abc', 'abc')).toBe(true);
    expect(safeEquals('abc', 'abd')).toBe(false);
    expect(safeEquals('abc', 'abcd')).toBe(false);
    expect(safeEquals('', '')).toBe(true);
  });
});
