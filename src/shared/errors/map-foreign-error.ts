import { ZodError } from 'zod';

import {
  AppError,
  BusinessRuleError,
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
  type ErrorDetail,
} from './app-error.js';

/**
 * Prisma's known-request errors carry a `code` like "P2002". We match
 * structurally rather than importing Prisma's error classes so that this module
 * stays usable in unit tests without a generated client.
 */
interface PrismaKnownError {
  code: string;
  meta?: Record<string, unknown> | undefined;
}

function isPrismaKnownError(err: unknown): err is PrismaKnownError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof err.code === 'string' &&
    /^P\d{4}$/.test(err.code)
  );
}

export function zodIssuesToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Translate an error from outside our own hierarchy into an AppError.
 * Provider/ORM specifics never reach the client — they are logged instead.
 */
export function mapForeignError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new ValidationError('Request validation failed.', zodIssuesToDetails(err));
  }

  if (isPrismaKnownError(err)) {
    switch (err.code) {
      case 'P2002':
        return new ConflictError('That record already exists.');
      case 'P2025':
        return new NotFoundError('Resource not found.');
      case 'P2003':
        return new BusinessRuleError('Referenced record does not exist.');
      case 'P2000':
        return new ValidationError('A provided value is too long.');
      default:
        return new InternalError('A database error occurred.');
    }
  }

  return new InternalError('An unexpected error occurred.');
}
