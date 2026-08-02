import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { API_PREFIX, MAX_BODY_BYTES } from './config/constants.js';
import { corsOriginList, loadEnv } from './config/env.js';
import { buildOpenApiServers } from './config/openapi-servers.js';
import type { PhoneIdentityVerifier } from './integrations/identity/phone-identity-verifier.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { onboardingRoutes } from './modules/onboarding/onboarding.routes.js';
import { workoutRoutes } from './modules/workouts/workouts.routes.js';
import { getRedis } from './shared/cache/redis.js';
import { buildLoggerOptions } from './shared/logger/index.js';
import { optionalUser } from './shared/middleware/auth.js';
import { registerErrorHandler } from './shared/middleware/error-handler.js';
import { createResilientRateLimitStore } from './shared/middleware/rate-limit-store.js';
import { generateRequestId, requestContext } from './shared/middleware/request-context.js';

export interface BuildAppOptions {
  /**
   * Replaces the Firebase verifier. Tests inject a fake so the suite never
   * calls Firebase; production leaves this unset.
   */
  identityVerifier?: PhoneIdentityVerifier;
}

/**
 * Builds a fully configured Fastify instance. Kept separate from `server.ts`
 * so integration tests can build an app without binding a port.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: buildLoggerOptions(),
    genReqId: generateRequestId,
    bodyLimit: MAX_BODY_BYTES,
    trustProxy: true,
    disableRequestLogging: false,
  }).withTypeProvider<ZodTypeProvider>();

  // Zod drives both request validation and response serialization.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);
  await app.register(requestContext);

  // --- Security & transport ------------------------------------------------
  await app.register(helmet, { contentSecurityPolicy: env.NODE_ENV === 'production' });
  await app.register(cors, {
    origin: corsOriginList(env),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);

  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.ACCESS_TOKEN_TTL },
  });

  // Global floor. Sensitive routes (auth/otp, coach, uploads) tighten this
  // per-route via `config.rateLimit`.
  //
  // The store degrades to in-memory counters when Redis is unreachable rather
  // than failing the request, so a cache outage cannot take the API down. Tests
  // pass no Redis handle at all and run purely in memory.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => optionalUser(request)?.id ?? request.ip,
    store: createResilientRateLimitStore({
      redis: env.NODE_ENV === 'test' ? null : getRedis(),
    }),
  });

  // --- API documentation ---------------------------------------------------
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Pulse API',
        description: 'AI diet & fitness coaching API for the Pulse mobile app.',
        version: process.env.npm_package_version ?? '0.1.0',
      },
      servers: buildOpenApiServers(env),
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'auth', description: 'Phone sign-in via Firebase, sessions, token rotation' },
        {
          name: 'onboarding',
          description: 'Goals, body stats, health, food and training preferences (screens 2-6)',
        },
        {
          name: 'workouts',
          description: 'Exercise catalog, training log, and strength progress (screen 9)',
        },
        { name: 'health', description: 'Liveness and readiness probes' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  if (env.NODE_ENV !== 'production') {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  // --- Routes --------------------------------------------------------------
  await app.register(healthRoutes, { prefix: API_PREFIX });
  await app.register(authRoutes, {
    prefix: API_PREFIX,
    ...(options.identityVerifier ? { identityVerifier: options.identityVerifier } : {}),
  });
  await app.register(onboardingRoutes, { prefix: API_PREFIX });
  await app.register(workoutRoutes, { prefix: API_PREFIX });

  return app;
}
