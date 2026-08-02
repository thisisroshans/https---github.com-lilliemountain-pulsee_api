import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../src/app.js';

/**
 * Builds the real application for integration tests — same plugins, same
 * guards, same error handler — without binding a port. Tests exercise it via
 * `app.inject()`.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Parse an injected response body, failing loudly if it is not JSON. */
export function jsonBody<T>(payload: string): T {
  return JSON.parse(payload) as T;
}
