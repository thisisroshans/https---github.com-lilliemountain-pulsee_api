import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Populate process.env from .env for local development and CLI scripts.
// In production the platform injects real env vars and there is no file to read;
// existing variables always win, so this can never override a deployed value.
loadDotenv({ quiet: true });

/**
 * Environment schema. Boot fails fast and loudly when anything is missing or
 * malformed — we never want a half-configured process serving traffic.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CORS_ORIGINS: z.string().default('*'),

    /**
     * Publicly reachable base URL of the deployed API, e.g.
     * https://api.pulse.fit. Listed in the OpenAPI `servers` block so Swagger
     * UI can target a deployed environment instead of localhost.
     */
    API_PUBLIC_URL: z.string().url().optional(),

    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: z.string().url().optional(),

    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_PEPPER: z.string().min(32),
    ACCESS_TOKEN_TTL: z.string().min(2).default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),

    /**
     * Firebase service account. Phone verification happens client-side via the
     * Firebase SDK; the backend only verifies the resulting ID token, so these
     * are the credentials for the Admin SDK rather than for sending SMS.
     */
    FIREBASE_PROJECT_ID: z.string().min(1).optional(),
    FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
    /**
     * PEM private key. Env files and dashboards cannot hold real newlines, so
     * an escaped "\n" sequence is accepted and expanded back into the PEM.
     */
    FIREBASE_PRIVATE_KEY: z
      .string()
      .optional()
      .transform((key) => key?.replace(/\\n/g, '\n')),
    /** host:port of the Firebase Auth emulator. Local development only. */
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),

    LLM_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().default('claude-sonnet-5'),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

    VISION_API_KEY: z.string().optional(),
    VISION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),

    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().default('pulse-media'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    REVENUECAT_API_KEY: z.string().optional(),
    REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.FIREBASE_AUTH_EMULATOR_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_AUTH_EMULATOR_HOST'],
        message:
          'FIREBASE_AUTH_EMULATOR_HOST must not be set in production — the emulator accepts forged tokens.',
      });
    }
    if (env.CORS_ORIGINS.trim() === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must be an explicit allowlist in production.',
      });
    }
    for (const key of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required in production to verify Firebase ID tokens.`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parse and memoise process.env. Throws a readable error on misconfiguration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: drop the memoised env so a fresh one can be loaded. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function corsOriginList(env: Env): string[] | true {
  const raw = env.CORS_ORIGINS.trim();
  if (raw === '*') return true;
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}
