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
import { healthRoutes } from './modules/health/health.routes.js';
import { getRedis } from './shared/cache/redis.js';
import { buildLoggerOptions } from './shared/logger/index.js';
import { optionalUser } from './shared/middleware/auth.js';
import { registerErrorHandler } from './shared/middleware/error-handler.js';
import { generateRequestId, requestContext } from './shared/middleware/request-context.js';

/**
 * Builds a fully configured Fastify instance. Kept separate from `server.ts`
 * so integration tests can build an app without binding a port.
 */
export async function buildApp(): Promise<FastifyInstance> {
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
  // Tests run against the in-memory store so the suite needs no Redis.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => optionalUser(request)?.id ?? request.ip,
    ...(env.NODE_ENV === 'test' ? {} : { redis: getRedis() }),
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
      servers: [{ url: `http://localhost:${String(env.PORT)}`, description: 'Local' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [{ name: 'health', description: 'Liveness and readiness probes' }],
    },
    transform: jsonSchemaTransform,
  });

  if (env.NODE_ENV !== 'production') {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  // --- Routes --------------------------------------------------------------
  await app.register(healthRoutes, { prefix: API_PREFIX });

  return app;
}
