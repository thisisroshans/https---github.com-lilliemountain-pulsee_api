import type { User } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

import type { PhoneIdentityVerifier } from '../../integrations/identity/phone-identity-verifier.js';
import type { TokenService } from '../../shared/auth/token-service.js';
import { UnauthorizedError } from '../../shared/errors/index.js';
import { getLogger, maskPhone } from '../../shared/logger/index.js';
import type { Entitlement, UserRole } from '../../shared/middleware/auth.js';
import type { AuthRepository } from './auth.repository.js';
import type { PublicUser, Session } from './auth.schema.js';

/**
 * Authentication business rules.
 *
 * Firebase proves the user controls a phone number. Everything after that —
 * who they are in Pulse, what they may do, and how long their session lives —
 * is decided here, so revoking access never depends on an external provider.
 */

export const AUTH_AUDIT_ACTIONS = {
  login: 'AUTH_LOGIN',
  signup: 'AUTH_SIGNUP',
  refresh: 'AUTH_REFRESH',
  logout: 'AUTH_LOGOUT',
  logoutAll: 'AUTH_LOGOUT_ALL',
  refreshReuse: 'AUTH_REFRESH_REUSE_DETECTED',
} as const;

/** Request-scoped context for auditing. Never trusted for authorization. */
export interface RequestContext {
  ip: string | undefined;
  userAgent: string | undefined;
}

export interface ExchangeCommand extends RequestContext {
  idToken: string;
  deviceId: string | undefined;
}

export interface RefreshCommand extends RequestContext {
  refreshToken: string;
}

export interface LogoutCommand extends RequestContext {
  refreshToken: string;
  allDevices: boolean;
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly identity: PhoneIdentityVerifier,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Exchanges a verified Firebase ID token for a Pulse session, creating the
   * account on first sign-in. Deliberately one endpoint for login and signup:
   * separate ones would reveal whether a number is already registered.
   */
  async exchangeFirebaseToken(command: ExchangeCommand): Promise<Session> {
    const identity = await this.identity.verifyIdToken(command.idToken);
    const now = new Date();

    const { user, isNew } = await this.repository.upsertUserByPhone({
      phone: identity.phone,
      firebaseUid: identity.providerUid,
      verifiedAt: identity.authenticatedAt ?? now,
    });

    const session = await this.issueSession(user, {
      familyId: uuidv7(),
      isNewUser: isNew,
      deviceId: command.deviceId,
      ip: command.ip,
      userAgent: command.userAgent,
      now,
    });

    await this.repository.writeAudit({
      actorUserId: user.id,
      action: isNew ? AUTH_AUDIT_ACTIONS.signup : AUTH_AUDIT_ACTIONS.login,
      entity: 'User',
      entityId: user.id,
      metadata: { provider: 'firebase', deviceId: command.deviceId ?? null },
      ip: command.ip,
    });

    getLogger().info(
      { userId: user.id, phone: maskPhone(user.phone), isNew },
      'session issued from firebase identity',
    );

    return session;
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a replacement
   * issued. Reusing an already-revoked token means it leaked, so the whole
   * family — every session descended from that login — is revoked.
   */
  async refresh(command: RefreshCommand): Promise<Session> {
    const parts = this.tokens.parseRefreshToken(command.refreshToken);
    const stored = await this.repository.findRefreshTokenById(parts.id);
    const now = new Date();

    if (!stored) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    // Verify the secret before acting on the row at all, so a valid-looking id
    // with a wrong secret cannot be used to revoke somebody else's family.
    const secretMatches = await this.tokens.verifyRefreshSecret(stored.tokenHash, parts.secret);
    if (!secretMatches) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    if (stored.revokedAt !== null) {
      await this.handleTokenReuse(stored.familyId, stored.userId, now, command.ip);
      throw new UnauthorizedError('This session has expired. Please sign in again.');
    }

    if (stored.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedError('This session has expired. Please sign in again.');
    }

    const user = await this.repository.findActiveUserById(stored.userId);
    if (!user) {
      // Account deleted or deactivated since the token was issued.
      throw new UnauthorizedError('This session is no longer valid.');
    }

    const session = await this.issueSession(user, {
      familyId: stored.familyId,
      isNewUser: false,
      rotatesTokenId: stored.id,
      deviceId: stored.deviceId ?? undefined,
      ip: command.ip,
      userAgent: command.userAgent,
      now,
    });

    await this.repository.writeAudit({
      actorUserId: user.id,
      action: AUTH_AUDIT_ACTIONS.refresh,
      entity: 'RefreshToken',
      entityId: stored.id,
      metadata: { familyId: stored.familyId },
      ip: command.ip,
    });

    return session;
  }

  /**
   * Revokes the presented token, or every session for the user.
   *
   * Logout never reports failure: telling a caller their token was already
   * invalid leaks information, and the desired end state — no valid session —
   * holds either way.
   */
  async logout(command: LogoutCommand): Promise<void> {
    const now = new Date();

    let parts;
    try {
      parts = this.tokens.parseRefreshToken(command.refreshToken);
    } catch {
      return;
    }

    const stored = await this.repository.findRefreshTokenById(parts.id);
    if (!stored) return;

    const secretMatches = await this.tokens.verifyRefreshSecret(stored.tokenHash, parts.secret);
    if (!secretMatches) return;

    if (command.allDevices) {
      await this.repository.revokeAllForUser(stored.userId, now);
    } else {
      // Revoke the family, not just this token: a rotated-out token in the same
      // chain would otherwise still be usable.
      await this.repository.revokeFamily(stored.familyId, now);
    }

    await this.repository.writeAudit({
      actorUserId: stored.userId,
      action: command.allDevices ? AUTH_AUDIT_ACTIONS.logoutAll : AUTH_AUDIT_ACTIONS.logout,
      entity: 'RefreshToken',
      entityId: stored.id,
      metadata: { familyId: stored.familyId },
      ip: command.ip,
    });
  }

  async getCurrentUser(userId: string): Promise<PublicUser> {
    const user = await this.repository.findActiveUserById(userId);
    if (!user) {
      throw new UnauthorizedError('This session is no longer valid.');
    }
    return toPublicUser(user);
  }

  /** A revoked token being presented again means it leaked. Burn the family. */
  private async handleTokenReuse(
    familyId: string,
    userId: string,
    now: Date,
    ip: string | undefined,
  ): Promise<void> {
    const revoked = await this.repository.revokeFamily(familyId, now);

    getLogger().warn(
      { userId, familyId, revokedCount: revoked.count },
      'refresh token reuse detected — revoked entire token family',
    );

    await this.repository.writeAudit({
      actorUserId: userId,
      action: AUTH_AUDIT_ACTIONS.refreshReuse,
      entity: 'RefreshToken',
      entityId: familyId,
      metadata: { familyId, revokedCount: revoked.count },
      ip,
    });
  }

  private async issueSession(
    user: User,
    options: {
      familyId: string;
      isNewUser: boolean;
      rotatesTokenId?: string;
      deviceId: string | undefined;
      ip: string | undefined;
      userAgent: string | undefined;
      now: Date;
    },
  ): Promise<Session> {
    const { token, parts } = this.tokens.generateRefreshToken();
    const tokenHash = await this.tokens.hashRefreshSecret(parts.secret);

    const row = {
      id: parts.id,
      userId: user.id,
      tokenHash,
      familyId: options.familyId,
      expiresAt: this.tokens.refreshTokenExpiry(options.now),
      deviceId: options.deviceId,
      userAgent: options.userAgent,
      ip: options.ip,
    };

    if (options.rotatesTokenId === undefined) {
      await this.repository.createRefreshToken(row);
    } else {
      await this.repository.rotateRefreshToken(options.rotatesTokenId, row, options.now);
    }

    const accessToken = this.tokens.issueAccessToken({
      userId: user.id,
      roles: toRoles(user.roles),
      entitlement: toEntitlement(user.entitlement),
    });

    return {
      accessToken,
      refreshToken: token,
      expiresIn: this.tokens.accessTokenTtlSeconds(),
      tokenType: 'Bearer',
      isNewUser: options.isNewUser,
      user: toPublicUser(user),
    };
  }
}

/** Prisma enums are SCREAMING_SNAKE; the API contract uses lowercase. */
function toRoles(roles: User['roles']): UserRole[] {
  return roles.map((role) => role.toLowerCase() as UserRole);
}

function toEntitlement(entitlement: User['entitlement']): Entitlement {
  return entitlement.toLowerCase() as Entitlement;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    phone: user.phone,
    displayName: user.displayName,
    timezone: user.timezone,
    locale: user.locale,
    entitlement: toEntitlement(user.entitlement),
    roles: toRoles(user.roles),
    createdAt: user.createdAt.toISOString(),
  };
}
