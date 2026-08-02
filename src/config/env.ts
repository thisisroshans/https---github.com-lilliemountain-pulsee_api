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

    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: z.string().url().optional(),

    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_PEPPER: z.string().min(32),
    ACCESS_TOKEN_TTL: z.string().min(2).default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),

    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_DEV_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_SENDER_ID: z.string().optional(),
    MSG91_TEMPLATE_ID: z.string().optional(),

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

    if (env.OTP_DEV_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_DEV_MODE'],
        message: 'OTP_DEV_MODE must be false in production — it leaks OTP codes to clients.',
      });
    }
    if (env.CORS_ORIGINS.trim() === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must be an explicit allowlist in production.',
      });
    }
    if (!env.MSG91_AUTH_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MSG91_AUTH_KEY'],
        message: 'MSG91_AUTH_KEY is required in production to deliver OTPs.',
      });
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
