import { clearMemoryCache } from '../../src/shared/cache/redis.js';
import { getPrisma } from '../../src/shared/db/prisma.js';

/**
 * Truncates every mutable table so each integration test starts from a known
 * state. RESTART IDENTITY keeps sequences deterministic; CASCADE handles the
 * foreign keys between users, refresh tokens, and audit logs.
 *
 * `_prisma_migrations` is deliberately untouched — wiping it would strand the
 * schema without its history.
 */
/**
 * Discovered rather than hard-coded: a new table would otherwise silently leak
 * state between tests until someone remembered to add it here.
 */
export async function resetDatabase(): Promise<void> {
  const prisma = getPrisma();

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `;

  if (tables.length === 0) return;

  const quoted = tables.map((table) => `"${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);

  // Cached reference data would otherwise point at rows that no longer exist.
  clearMemoryCache();
}
