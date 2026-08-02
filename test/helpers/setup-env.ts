import { config as loadDotenv } from 'dotenv';

/**
 * Test environment, loaded by Vitest before any test file.
 *
 * Order matters: .env is read first so TEST_DATABASE_URL is visible, then the
 * test database is forced into DATABASE_URL. Without the explicit load, these
 * `??=` defaults would win over the real configuration and the suite would try
 * to reach localhost.
 */
loadDotenv({ quiet: true });

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.PORT ??= '3001';
process.env.CORS_ORIGINS ??= '*';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-000000000000000000000000';
process.env.JWT_REFRESH_PEPPER ??= 'test-refresh-pepper-000000000000000000000000';

const devDatabase = process.env.DATABASE_URL;
const testDatabase = process.env.TEST_DATABASE_URL;

if (testDatabase === undefined) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Point it at a throwaway database; the suite truncates tables.',
  );
}

/**
 * Integration tests TRUNCATE tables. Pointing them at the development database
 * would silently destroy real data, so refuse to start instead.
 */
if (devDatabase !== undefined && testDatabase === devDatabase) {
  throw new Error(
    'TEST_DATABASE_URL must differ from DATABASE_URL — the suite truncates every table it touches.',
  );
}

// DATABASE_URL is deliberately left alone: getPrisma() already selects
// TEST_DATABASE_URL under NODE_ENV=test. Overwriting it here would make this
// file non-idempotent, and Vitest runs setup once per test file — the second
// run would see the two URLs as equal and trip the guard above.
