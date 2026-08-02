import { pino, type Logger, type LoggerOptions } from 'pino';

import { loadEnv } from '../../config/env.js';

/**
 * Redaction is not optional. Phone numbers, tokens, cookies and OTP codes must
 * never reach the log platform in plaintext.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'body.code',
  'body.otp',
  'body.password',
  'body.token',
  'body.refreshToken',
  '*.accessToken',
  '*.refreshToken',
  '*.tokenHash',
  '*.otpCode',
  '*.authKey',
  '*.apiKey',
];

/** Mask a phone to its last two digits: "+919876543210" -> "+91********10". */
export function maskPhone(phone: string): string {
  if (phone.length <= 5) return '***';
  const head = phone.slice(0, 3);
  const tail = phone.slice(-2);
  return `${head}${'*'.repeat(Math.max(0, phone.length - 5))}${tail}`;
}

export function buildLoggerOptions(): LoggerOptions {
  const env = loadEnv();
  const isDev = env.NODE_ENV === 'development';

  const options: LoggerOptions = {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: {
      service: 'pulse-api',
      env: env.NODE_ENV,
      version: process.env.npm_package_version ?? '0.0.0',
    },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (isDev) {
    return {
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    };
  }

  return options;
}

let rootLogger: Logger | undefined;

/** Process-wide logger for code outside a request (boot, jobs, shutdown). */
export function getLogger(): Logger {
  rootLogger ??= pino(buildLoggerOptions());
  return rootLogger;
}
