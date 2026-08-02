import { getPrisma } from '../../src/shared/db/prisma.js';

/**
 * Truncates every mutable table so each integration test starts from a known
 * state. RESTART IDENTITY keeps sequences deterministic; CASCADE handles the
 * foreign keys between users, refresh tokens, and audit logs.
 *
 * `_prisma_migrations` is deliberately untouched — wiping it would strand the
 * schema without its history.
 */
export async function resetDatabase(): Promise<void> {
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_logs", "refresh_tokens", "users" RESTART IDENTITY CASCADE',
  );
}
