import type { FastifyReply, FastifyRequest } from 'fastify';

import { ok } from '../../shared/http/envelope.js';
import type { HealthService } from './health.service.js';

/**
 * Controllers are thin: read input, call one service method, shape the
 * response. No business logic, no database access.
 */
export class HealthController {
  constructor(private readonly service: HealthService) {}

  live = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await reply.status(200).send(ok(this.service.live()));
  };

  ready = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const result = await this.service.ready();
    // 503 when a dependency is down so orchestrators pull us out of rotation.
    await reply.status(result.status === 'ok' ? 200 : 503).send(ok(result));
  };
}
