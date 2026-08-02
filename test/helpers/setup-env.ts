/**
 * Test environment. Loaded by Vitest before any test file so `loadEnv()` always
 * finds a valid, hermetic configuration and never reads a developer's .env.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.PORT ??= '3001';
process.env.CORS_ORIGINS ??= '*';
process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ?? 'postgresql://pulse:pulse@localhost:5432/pulse_test?schema=public';
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-000000000000000000000000';
process.env.JWT_REFRESH_PEPPER ??= 'test-refresh-pepper-000000000000000000000000';
process.env.OTP_DEV_MODE ??= 'true';
