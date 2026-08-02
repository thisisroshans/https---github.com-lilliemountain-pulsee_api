import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { uuidv7 } from 'uuidv7';

import { REQUEST_ID_HEADER } from '../../config/constants.js';

/**
 * Correlates every log line and error response with a request id, propagating
 * an inbound `x-request-id` when the caller supplied one.
 */
async function requestContextPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (request, reply) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
  });
}

export const requestContext = fp(requestContextPlugin, { name: 'request-context' });

/** Fastify `genReqId`: reuse the caller's id when present, else mint a UUID v7. */
export function generateRequestId(req: { headers: Record<string, unknown> }): string {
  const header = req.headers[REQUEST_ID_HEADER];
  if (typeof header === 'string' && header.length > 0 && header.length <= 200) return header;
  return uuidv7();
}
