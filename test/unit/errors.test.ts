import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BusinessRuleError,
  ConflictError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  isAppError,
  mapForeignError,
} from '../../src/shared/errors/index.js';

describe('AppError hierarchy', () => {
  it('carries a stable code and status per error type', () => {
    expect(new ValidationError('bad').code).toBe('VALIDATION_ERROR');
    expect(new ValidationError('bad').statusCode).toBe(400);
    expect(new NotFoundError('gone').statusCode).toBe(404);
    expect(new ConflictError('dup').statusCode).toBe(409);
    expect(new BusinessRuleError('nope').statusCode).toBe(422);
  });

  it('marks expected errors operational and bugs non-operational', () => {
    expect(new NotFoundError('gone').isOperational).toBe(true);
    expect(new InternalError('boom').isOperational).toBe(false);
  });

  it('defaults RateLimitError retry-after and allows an override', () => {
    expect(new RateLimitError('slow down').retryAfterSeconds).toBe(60);
    expect(new RateLimitError('slow down', 900).retryAfterSeconds).toBe(900);
  });

  it('recognises its own errors', () => {
    expect(isAppError(new NotFoundError('x'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
  });
});

describe('mapForeignError', () => {
  it('passes AppErrors through untouched', () => {
    const original = new NotFoundError('plan not found');
    expect(mapForeignError(original)).toBe(original);
  });

  it('converts a ZodError into a ValidationError with field details', () => {
    const schema = z.object({ phone: z.string().min(10) });
    const result = schema.safeParse({ phone: '123' });
    expect(result.success).toBe(false);
    if (result.success) return;

    const mapped = mapForeignError(result.error);
    expect(mapped).toBeInstanceOf(ValidationError);
    expect(mapped.statusCode).toBe(400);
    expect(mapped.details?.[0]?.path).toBe('phone');
  });

  it.each([
    ['P2002', ConflictError, 409],
    ['P2025', NotFoundError, 404],
    ['P2003', BusinessRuleError, 422],
    ['P2000', ValidationError, 400],
  ] as const)('maps Prisma %s to the right error', (code, expected, status) => {
    const mapped = mapForeignError({ code, meta: {} });
    expect(mapped).toBeInstanceOf(expected);
    expect(mapped.statusCode).toBe(status);
  });

  it('maps an unknown Prisma code to an internal error without leaking detail', () => {
    const mapped = mapForeignError({ code: 'P9999' });
    expect(mapped).toBeInstanceOf(InternalError);
    expect(mapped.message).not.toContain('P9999');
  });

  it('maps an arbitrary throwable to a non-operational internal error', () => {
    const mapped = mapForeignError(new TypeError('undefined is not a function'));
    expect(mapped).toBeInstanceOf(InternalError);
    expect(mapped.isOperational).toBe(false);
    expect(mapped.message).toBe('An unexpected error occurred.');
  });
});
