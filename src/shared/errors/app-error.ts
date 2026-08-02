/**
 * Error hierarchy. Every error thrown by our own code is an AppError carrying
 * an HTTP status, a stable machine-readable code, and a message that is safe to
 * show to an end user. The global error handler (shared/middleware) is the only
 * place that turns these into HTTP responses.
 */

export interface ErrorDetail {
  path: string;
  message: string;
}

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  /** Expected-and-handled (true) vs. programmer bug (false). Drives log level. */
  readonly isOperational: boolean = true;
  readonly details: ErrorDetail[] | undefined;

  constructor(message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    // Hide the constructor frames so the stack points at the throw site.
    Error.captureStackTrace(this, new.target);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

/** Shape is valid but the request breaks a business rule. */
export class BusinessRuleError extends AppError {
  readonly statusCode = 422;
  readonly code = 'UNPROCESSABLE';
}

export class RateLimitError extends AppError {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMITED';

  /** Seconds the client should wait; surfaced as the Retry-After header. */
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 60, details?: ErrorDetail[]) {
    super(message, details);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A downstream provider (LLM, vision, SMS, storage, payments) failed. */
export class UpstreamError extends AppError {
  readonly statusCode = 503;
  readonly code = 'UPSTREAM_UNAVAILABLE';
}

/** An invariant we believed impossible was violated. Always a bug. */
export class InternalError extends AppError {
  readonly statusCode = 500;
  readonly code = 'INTERNAL_ERROR';
  override readonly isOperational = false;
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
