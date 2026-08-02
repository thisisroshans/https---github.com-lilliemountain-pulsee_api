import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { disconnectRedis } from './shared/cache/redis.js';
import { disconnectPrisma } from './shared/db/prisma.js';
import { getLogger } from './shared/logger/index.js';
import { closeQueues } from './shared/queue/index.js';

/**
 * Process entrypoint: validate env, build the app, listen, and shut down
 * cleanly so in-flight requests finish and connections are released.
 */
const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp();

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      app.log.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await app.close();
      await closeQueues();
      await Promise.all([disconnectPrisma(), disconnectRedis()]);
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  // A rejected promise or thrown error nobody handled is a bug: log it loudly
  // and exit rather than continuing in an unknown state.
  process.on('unhandledRejection', (reason) => {
    getLogger().fatal({ err: reason }, 'unhandled promise rejection');
    void shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    getLogger().fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info({ port: env.PORT, host: env.HOST, env: env.NODE_ENV }, 'pulse api listening');
}

main().catch((err: unknown) => {
  getLogger().fatal({ err }, 'failed to start server');
  process.exit(1);
});
