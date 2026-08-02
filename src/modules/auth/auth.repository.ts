import type { Prisma, PrismaClient, RefreshToken, User } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

/**
 * All database access for authentication. No business rules live here — the
 * service decides what a reused token means; this only reads and writes rows.
 */

export interface CreateRefreshTokenInput {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  deviceId: string | undefined;
  userAgent: string | undefined;
  ip: string | undefined;
}

export interface UpsertUserByPhoneInput {
  phone: string;
  firebaseUid: string;
  verifiedAt: Date;
}

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata?: Prisma.InputJsonValue;
  ip: string | undefined;
}

export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Soft-deleted users are invisible everywhere; a fresh sign-in creates a new account. */
  findActiveUserByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { phone, deletedAt: null } });
  }

  findActiveUserById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * Creates the account on first verified sign-in, or refreshes the Firebase uid
   * on an existing one. Phone is the natural key: a number re-registered in
   * Firebase gets a new uid but must map back to the same Pulse account.
   */
  async upsertUserByPhone(input: UpsertUserByPhoneInput): Promise<{ user: User; isNew: boolean }> {
    const existing = await this.findActiveUserByPhone(input.phone);

    if (existing) {
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          firebaseUid: input.firebaseUid,
          phoneVerifiedAt: input.verifiedAt,
        },
      });
      return { user, isNew: false };
    }

    const user = await this.prisma.user.create({
      data: {
        id: uuidv7(),
        phone: input.phone,
        firebaseUid: input.firebaseUid,
        phoneVerifiedAt: input.verifiedAt,
      },
    });
    return { user, isNew: true };
  }

  createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        familyId: input.familyId,
        expiresAt: input.expiresAt,
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
        ...(input.ip === undefined ? {} : { ip: input.ip }),
      },
    });
  }

  findRefreshTokenById(id: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { id } });
  }

  /**
   * Atomically swaps one refresh token for its replacement. Both writes land or
   * neither does, so a crash mid-rotation cannot leave a user with no valid
   * token or with two.
   */
  async rotateRefreshToken(
    previousId: string,
    next: CreateRefreshTokenInput,
    rotatedAt: Date,
  ): Promise<RefreshToken> {
    const [, created] = await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: previousId },
        data: { revokedAt: rotatedAt, replacedById: next.id },
      }),
      this.prisma.refreshToken.create({
        data: {
          id: next.id,
          userId: next.userId,
          tokenHash: next.tokenHash,
          familyId: next.familyId,
          expiresAt: next.expiresAt,
          ...(next.deviceId === undefined ? {} : { deviceId: next.deviceId }),
          ...(next.userAgent === undefined ? {} : { userAgent: next.userAgent }),
          ...(next.ip === undefined ? {} : { ip: next.ip }),
        },
      }),
    ]);

    return created;
  }

  revokeToken(id: string, revokedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt },
    });
  }

  /** Theft response: kill every token descended from the same original login. */
  revokeFamily(familyId: string, revokedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt },
    });
  }

  revokeAllForUser(userId: string, revokedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }

  /** Audit rows are append-only; there is deliberately no update or delete. */
  async writeAudit(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: uuidv7(),
        actorUserId: entry.actorUserId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
        ...(entry.ip === undefined ? {} : { ip: entry.ip }),
      },
    });
  }
}
