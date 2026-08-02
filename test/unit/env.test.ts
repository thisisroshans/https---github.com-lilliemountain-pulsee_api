import { afterEach, describe, expect, it } from 'vitest';

import { corsOriginList, loadEnv, resetEnvCache } from '../../src/config/env.js';

const validEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/pulse',
  REDIS_URL: 'redis://cache:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_PEPPER: 'b'.repeat(48),
  CORS_ORIGINS: 'https://app.pulse.fit',
  FIREBASE_PROJECT_ID: 'pulse-prod',
  FIREBASE_CLIENT_EMAIL: 'admin@pulse-prod.iam.gserviceaccount.com',
  // Escaped newlines, exactly as a dashboard or .env file stores a PEM.
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
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
    expect(env.FIREBASE_PROJECT_ID).toBe('pulse-prod');
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

  it('refuses the Firebase auth emulator in production', () => {
    resetEnvCache();
    // The emulator accepts unsigned tokens, so pointing production at it would
    // let anyone mint a session for any phone number.
    expect(() => loadEnv({ ...validEnv, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(
      /FIREBASE_AUTH_EMULATOR_HOST/,
    );
  });

  it.each(['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'])(
    'requires %s in production',
    (key) => {
      resetEnvCache();
      const incomplete = Object.fromEntries(
        Object.entries(validEnv).filter(([name]) => name !== key),
      ) as NodeJS.ProcessEnv;
      expect(() => loadEnv(incomplete)).toThrow(new RegExp(key));
    },
  );

  it('expands escaped newlines in the Firebase private key', () => {
    resetEnvCache();
    const env = loadEnv(validEnv);
    // Real newlines in the PEM, no leftover two-character escapes.
    expect(env.FIREBASE_PRIVATE_KEY).toContain('\n');
    expect(env.FIREBASE_PRIVATE_KEY).not.toContain('\\n');
  });

  describe('blank values', () => {
    it('treats a blank optional variable as unset', () => {
      resetEnvCache();
      // `.env.example` ships these keys empty; a blank must not read as "set".
      const env = loadEnv({ ...validEnv, API_PUBLIC_URL: '', S3_ACCESS_KEY_ID: '   ' });

      expect(env.API_PUBLIC_URL).toBeUndefined();
      expect(env.S3_ACCESS_KEY_ID).toBeUndefined();
    });

    it('lets a blank variable fall back to its default', () => {
      resetEnvCache();
      const env = loadEnv({ ...validEnv, S3_REGION: '', LOG_LEVEL: '' });

      expect(env.S3_REGION).toBe('ap-south-1');
      expect(env.LOG_LEVEL).toBe('info');
    });

    it('does not treat a blank emulator host as an emulator', () => {
      resetEnvCache();
      // Critical: the emulator does not verify token signatures, so a stray
      // `FIREBASE_AUTH_EMULATOR_HOST=` must never select that code path.
      const env = loadEnv({
        ...validEnv,
        NODE_ENV: 'development',
        FIREBASE_AUTH_EMULATOR_HOST: '',
      });

      expect(env.FIREBASE_AUTH_EMULATOR_HOST).toBeUndefined();
    });

    it('still rejects a blank required variable', () => {
      resetEnvCache();
      expect(() => loadEnv({ ...validEnv, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
    });
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
