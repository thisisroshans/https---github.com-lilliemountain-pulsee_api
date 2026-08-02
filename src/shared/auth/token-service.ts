import { randomBytes, timingSafeEqual } from 'node:crypto';

import argon2 from 'argon2';
import { createSigner } from 'fast-jwt';
import { uuidv7 } from 'uuidv7';

import { REFRESH_TOKEN_SECRET_BYTES } from '../../config/constants.js';
import type { Env } from '../../config/env.js';
import { UnauthorizedError } from '../errors/index.js';
import type { Entitlement, UserRole } from '../middleware/auth.js';

/**
 * Issues and validates Pulse's own session credentials.
 *
 * Deliberately free of any Fastify dependency so services can use it directly.
 * It signs with the same secret and algorithm `@fastify/jwt` verifies with, so
 * `requireAuth` accepts these tokens unchanged.
 */

export interface AccessTokenSubject {
  userId: string;
  roles: UserRole[];
  entitlement: Entitlement;
}

/** The two halves of a refresh token: an id we can look up, and a secret we cannot. */
export interface RefreshTokenParts {
  id: string;
  secret: string;
}

const REFRESH_TOKEN_SEPARATOR = '.';

/**
 * argon2id parameters. Refresh tokens are 256 bits of true randomness rather
 * than user-chosen passwords, so the cost only needs to make offline attacks on
 * a leaked table impractical — not to survive a dictionary attack.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * fast-jwt signs synchronously when given a static key, and asynchronously when
 * given a key-fetching callback. Its type covers both, so the synchronous shape
 * is asserted here — the constructor only ever passes a string key.
 */
type SyncSigner = (payload: Record<string, unknown>) => string;

export class TokenService {
  private readonly signAccessToken: SyncSigner;
  private readonly pepper: Buffer;

  constructor(private readonly env: Env) {
    this.signAccessToken = createSigner({
      key: env.JWT_ACCESS_SECRET,
      algorithm: 'HS256',
      expiresIn: parseDuration(env.ACCESS_TOKEN_TTL),
    });
    // Peppering means a stolen database alone cannot be brute-forced offline;
    // the attacker also needs the application secret.
    this.pepper = Buffer.from(env.JWT_REFRESH_PEPPER, 'utf8');
  }

  /** Short-lived bearer token carrying just enough to authorize a request. */
  issueAccessToken(subject: AccessTokenSubject): string {
    return this.signAccessToken({
      sub: subject.userId,
      roles: subject.roles,
      entitlement: subject.entitlement,
      jti: uuidv7(),
    });
  }

  accessTokenTtlSeconds(): number {
    return Math.floor(parseDuration(this.env.ACCESS_TOKEN_TTL) / 1000);
  }

  refreshTokenExpiry(now: Date): Date {
    return new Date(now.getTime() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Mints a refresh token as `<id>.<secret>`.
   *
   * The id is stored in the clear so a presented token can be looked up in one
   * indexed query; only the secret is hashed. Hashing the whole token would
   * force a table scan, since every argon2 hash uses a distinct salt.
   */
  generateRefreshToken(): { token: string; parts: RefreshTokenParts } {
    const id = uuidv7();
    const secret = randomBytes(REFRESH_TOKEN_SECRET_BYTES).toString('base64url');

    return { token: `${id}${REFRESH_TOKEN_SEPARATOR}${secret}`, parts: { id, secret } };
  }

  /** Splits a client-supplied token. Malformed input is an auth failure, not a 500. */
  parseRefreshToken(token: string): RefreshTokenParts {
    const separatorAt = token.indexOf(REFRESH_TOKEN_SEPARATOR);
    if (separatorAt <= 0 || separatorAt === token.length - 1) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    return {
      id: token.slice(0, separatorAt),
      secret: token.slice(separatorAt + 1),
    };
  }

  hashRefreshSecret(secret: string): Promise<string> {
    return argon2.hash(secret, { ...ARGON2_OPTIONS, secret: this.pepper });
  }

  async verifyRefreshSecret(hash: string, secret: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, secret, { secret: this.pepper });
    } catch {
      // A malformed or truncated hash must read as "no match", never as a crash.
      return false;
    }
  }
}

/** Constant-time comparison for opaque identifiers. */
export function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;
const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Converts "15m" to milliseconds. Throws on boot for an unparseable value. */
export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  const unit = match?.[2];
  const amount = match?.[1];

  if (unit === undefined || amount === undefined) {
    throw new Error(`Invalid duration "${value}". Expected a form like "15m", "24h" or "60s".`);
  }

  const multiplier = DURATION_UNITS[unit];
  if (multiplier === undefined) {
    throw new Error(`Unsupported duration unit "${unit}".`);
  }

  return Number(amount) * multiplier;
}
