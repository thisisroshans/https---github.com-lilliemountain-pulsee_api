import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { successSchema } from '../../shared/http/envelope.js';
import { HealthController } from './health.controller.js';
import { healthResponseSchema } from './health.schema.js';
import { HealthService } from './health.service.js';

/**
 * Health endpoints are deliberately unauthenticated and exempt from rate
 * limiting — load balancers and k8s probes call them constantly.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const controller = new HealthController(new HealthService());

  app.get(
    '/health/live',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['health'],
        summary: 'Liveness probe',
        description: 'Returns 200 whenever the process is running. Touches no dependencies.',
        response: {
          200: successSchema(z.object({ status: z.literal('ok'), uptimeSeconds: z.number().int() })),
        },
      },
    },
    controller.live,
  );

  app.get(
    '/health/ready',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['health'],
        summary: 'Readiness probe',
        description: 'Probes Postgres and Redis. Returns 503 when any dependency is down.',
        response: {
          200: successSchema(healthResponseSchema),
          503: successSchema(healthResponseSchema),
        },
      },
    },
    controller.ready,
  );
}
