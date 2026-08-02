import { afterEach, describe, expect, it } from 'vitest';

import { corsOriginList, loadEnv, resetEnvCache } from '../../src/config/env.js';

const validEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/pulse',
  REDIS_URL: 'redis://cache:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_PEPPER: 'b'.repeat(48),
  CORS_ORIGINS: 'https://app.pulse.fit',
  OTP_DEV_MODE: 'false',
  MSG91_AUTH_KEY: 'key',
} satisfies NodeJS.ProcessEnv;

afterEach(() => {
  resetEnvCache();
});

describe('loadEnv', () => {
  it('parses a valid production configuration', () => {
    resetEnvCache();
    const env = loadEnv(validEnv);
    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe(3000);
    expect(env.OTP_DEV_MODE).toBe(false);
  });

  it('fails when a required secret is missing', () => {
    resetEnvCache();
    const { JWT_ACCESS_SECRET: _omitted, ...withoutSecret } = validEnv;
    expect(() => loadEnv(withoutSecret)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a short JWT secret', () => {
    resetEnvCache();
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses OTP dev mode in production', () => {
    resetEnvCache();
    expect(() => loadEnv({ ...validEnv, OTP_DEV_MODE: 'true' })).toThrow(/OTP_DEV_MODE/);
  });

  it('refuses a wildcard CORS allowlist in production', () => {
    resetEnvCache();
    expect(() => loadEnv({ ...validEnv, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  it('allows the wildcard outside production', () => {
    resetEnvCache();
    const env = loadEnv({ ...validEnv, NODE_ENV: 'development', CORS_ORIGINS: '*' });
    expect(corsOriginList(env)).toBe(true);
  });

  it('splits an explicit CORS allowlist', () => {
    resetEnvCache();
    const env = loadEnv({ ...validEnv, CORS_ORIGINS: 'https://a.com, https://b.com' });
    expect(corsOriginList(env)).toEqual(['https://a.com', 'https://b.com']);
  });
});
