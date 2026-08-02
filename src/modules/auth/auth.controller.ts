import type { FastifyReply, FastifyRequest } from 'fastify';

import { ok } from '../../shared/http/envelope.js';
import { currentUser } from '../../shared/middleware/auth.js';
import type { FirebaseExchangeInput, LogoutInput, RefreshInput } from './auth.schema.js';
import type { AuthService, RequestContext } from './auth.service.js';

/**
 * HTTP plumbing only. Reads validated input, adds request context for auditing,
 * calls one service method, shapes the response.
 */
export class AuthController {
  constructor(private readonly service: AuthService) {}

  exchange = async (
    request: FastifyRequest<{ Body: FirebaseExchangeInput }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const session = await this.service.exchangeFirebaseToken({
      idToken: request.body.idToken,
      deviceId: request.body.deviceId,
      ...contextOf(request),
    });

    // 201 when the exchange created the account, 200 when it was a login.
    await reply.status(session.isNewUser ? 201 : 200).send(ok(session));
  };

  refresh = async (request: FastifyRequest<{ Body: RefreshInput }>, reply: FastifyReply): Promise<void> => {
    const session = await this.service.refresh({
      refreshToken: request.body.refreshToken,
      ...contextOf(request),
    });

    await reply.status(200).send(ok(session));
  };

  logout = async (request: FastifyRequest<{ Body: LogoutInput }>, reply: FastifyReply): Promise<void> => {
    await this.service.logout({
      refreshToken: request.body.refreshToken,
      allDevices: request.body.allDevices,
      ...contextOf(request),
    });

    await reply.status(204).send();
  };

  me = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = await this.service.getCurrentUser(currentUser(request).id);
    await reply.status(200).send(ok(user));
  };
}

/** Audit context. Recorded, never used to make authorization decisions. */
function contextOf(request: FastifyRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : undefined,
  };
}
