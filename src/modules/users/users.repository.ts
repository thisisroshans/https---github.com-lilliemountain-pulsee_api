import type { PrismaClient, User } from '@prisma/client';

import { DEFAULT_TIMEZONE } from '../../config/constants.js';
import { NotFoundError } from '../../shared/errors/index.js';

/**
 * User records. Kept separate from auth, which owns credentials and sessions —
 * this owns who the person is.
 */
export class UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findActiveById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  async findActiveByIdOrThrow(id: string): Promise<User> {
    const user = await this.findActiveById(id);
    if (!user) throw new NotFoundError('User not found.');
    return user;
  }

  /**
   * Just the timezone. Almost every date-sensitive endpoint needs it, and
   * loading a whole user row for one column on each request is wasteful.
   */
  async findTimezone(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { timezone: true },
    });

    // Falling back rather than throwing: a missing user will fail the actual
    // operation with a clearer error than "no timezone".
    return user?.timezone ?? DEFAULT_TIMEZONE;
  }
}
