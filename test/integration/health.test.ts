import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REQUEST_ID_HEADER } from '../../src/config/constants.js';
import type { ErrorEnvelope, SuccessEnvelope } from '../../src/shared/http/envelope.js';
import { buildTestApp, jsonBody } from '../helpers/build-test-app.js';

/**
 * Route-level tests through the real app: plugins, schemas, error handler.
 * The liveness probe touches no dependencies, so this suite needs no database.
 */
describe('GET /api/v1/health/live', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the success envelope with uptime', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<SuccessEnvelope<{ status: string; uptimeSeconds: number }>>(response.payload);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('echoes a caller-supplied request id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { [REQUEST_ID_HEADER]: 'trace-me-123' },
    });

    expect(response.headers[REQUEST_ID_HEADER]).toBe('trace-me-123');
  });

  it('sets a request id when the caller supplies none', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(response.headers[REQUEST_ID_HEADER]).toBeTypeOf('string');
  });

  it('returns the standard error envelope for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

    expect(response.statusCode).toBe(404);
    const body = jsonBody<ErrorEnvelope>(response.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTypeOf('string');
  });

  it('serves the generated OpenAPI document', () => {
    const spec = app.swagger();
    expect(spec.paths?.['/api/v1/health/live']).toBeDefined();
    expect(spec.paths?.['/api/v1/health/ready']).toBeDefined();
  });
});
