import type { FastifyReply, FastifyRequest } from 'fastify';

import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/index.js';

/**
 * Authentication (who you are) and authorization (what you may do) are separate
 * guards on purpose — a valid token is never by itself permission to act.
 *
 * Resource *ownership* is enforced in services, not here: only the service
 * knows which record an id refers to.
 */

export type UserRole = 'user' | 'admin' | 'support';
export type Entitlement = 'free' | 'premium';

export interface AuthenticatedUser {
  id: string;
  roles: UserRole[];
  entitlement: Entitlement;
}

/** JWT payload we sign. Kept minimal — it is a bearer credential, not a profile. */
export interface AccessTokenClaims {
  sub: string;
  roles: UserRole[];
  entitlement: Entitlement;
  jti: string;
}

/**
 * Teach @fastify/jwt what we sign and what we attach, so `request.user` and
 * `request.jwtVerify()` are typed everywhere instead of being `object`.
 */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenClaims;
    user: AuthenticatedUser;
  }
}

/**
 * Async preHandler hook. Declared explicitly rather than using Fastify's
 * `preHandlerHookHandler`, whose callback-style overload makes an async guard
 * look like a floating promise.
 */
export type AsyncPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** Verifies the access token and attaches `request.user`. */
export const requireAuth: AsyncPreHandler = async (request: FastifyRequest) => {
  let claims: AccessTokenClaims;
  try {
    claims = await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Missing or invalid access token.');
  }

  request.user = {
    id: claims.sub,
    roles: claims.roles,
    entitlement: claims.entitlement,
  };
};

/**
 * `request.user` is only populated once `requireAuth` has run, but @fastify/jwt
 * types it as always present. This narrows it back to the truth.
 */
export function optionalUser(request: FastifyRequest): AuthenticatedUser | undefined {
  return (request as { user?: AuthenticatedUser }).user;
}

/** Reads the authenticated user, throwing if a route forgot `requireAuth`. */
export function currentUser(request: FastifyRequest): AuthenticatedUser {
  const user = optionalUser(request);
  if (!user) {
    throw new UnauthorizedError('Authentication required.');
  }
  return user;
}

export function requireRole(...allowed: UserRole[]): AsyncPreHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = currentUser(request);
    if (!user.roles.some((role) => allowed.includes(role))) {
      throw new ForbiddenError('You do not have permission to perform this action.');
    }
  };
}

/**
 * Gates Premium features. The token carries the entitlement for speed, but any
 * action with real cost (coach messages, pro photo logging) must *also* re-check
 * server state in its service — a token minted before a cancellation is stale.
 */
export function requireEntitlement(required: Entitlement): AsyncPreHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = currentUser(request);
    if (required === 'premium' && user.entitlement !== 'premium') {
      throw new ForbiddenError('This feature requires Pulse Premium.');
    }
  };
}

/**
 * Ownership assertion for services. Narrows the resource to non-null and
 * reports 404 rather than 403, so we never confirm that someone else's record
 * exists.
 */
export function assertOwned<T extends { userId: string }>(
  resource: T | null | undefined,
  userId: string,
  label = 'Resource',
): asserts resource is T {
  if (!resource || resource.userId !== userId) {
    throw new NotFoundError(`${label} not found.`);
  }
}
