import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import {
  NotFoundError,
  RateLimitError,
  ValidationError,
  isAppError,
  mapForeignError,
  zodIssuesToDetails,
} from '../errors/index.js';
import type { ErrorEnvelope } from '../http/envelope.js';

/**
 * The single place HTTP error responses are formatted. Services throw typed
 * errors; this turns them into the standard envelope, picks the log level, and
 * makes sure nothing internal ever leaks to the client.
 */

function toEnvelope(
  code: string,
  message: string,
  requestId: string,
  details?: ReturnType<typeof zodIssuesToDetails>,
): ErrorEnvelope {
  return {
    success: false,
    error: details === undefined ? { code, message, requestId } : { code, message, details, requestId },
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const err = new NotFoundError(`Route ${request.method} ${request.url} not found.`);
    request.log.warn({ statusCode: 404, code: err.code }, 'route not found');
    void reply.status(404).send(toEnvelope(err.code, err.message, request.id));
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // Fastify's own schema validation (including fastify-type-provider-zod).
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof ZodError) {
      const err = new ValidationError('Request validation failed.', zodIssuesToDetails(cause));
      request.log.warn({ statusCode: 400, code: err.code, details: err.details }, 'validation failed');
      return reply.status(400).send(toEnvelope(err.code, err.message, request.id, err.details));
    }

    // @fastify/rate-limit surfaces 429 as a plain FastifyError.
    if (error.statusCode === 429) {
      const err = new RateLimitError('Too many requests. Please slow down.');
      request.log.warn({ statusCode: 429, ip: request.ip }, 'rate limit exceeded');
      void reply.header('Retry-After', String(err.retryAfterSeconds));
      return reply.status(429).send(toEnvelope(err.code, err.message, request.id));
    }

    const appError = isAppError(error) ? error : mapForeignError(error);

    if (appError.isOperational) {
      request.log.warn(
        { statusCode: appError.statusCode, code: appError.code, err: error },
        'request failed',
      );
    } else {
      // Unexpected: log everything, tell the client nothing.
      request.log.error(
        { statusCode: appError.statusCode, code: appError.code, err: error },
        'unhandled error',
      );
    }

    if (appError instanceof RateLimitError) {
      void reply.header('Retry-After', String(appError.retryAfterSeconds));
    }

    const clientMessage =
      appError.statusCode >= 500 && !appError.isOperational
        ? 'An unexpected error occurred.'
        : appError.message;

    return reply
      .status(appError.statusCode)
      .send(toEnvelope(appError.code, clientMessage, request.id, appError.details));
  });
}
