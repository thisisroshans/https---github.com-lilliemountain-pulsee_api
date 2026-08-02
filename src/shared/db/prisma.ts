import { PrismaClient } from '@prisma/client';

import { loadEnv } from '../../config/env.js';
import { getLogger } from '../logger/index.js';

/**
 * A single pooled PrismaClient per process. Repositories are the only layer
 * allowed to import this.
 */
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (client) return client;

  const env = loadEnv();
  const url = env.NODE_ENV === 'test' ? (env.TEST_DATABASE_URL ?? env.DATABASE_URL) : env.DATABASE_URL;

  client = new PrismaClient({
    datasources: { db: { url } },
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });

  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = undefined;
  getLogger().info('prisma disconnected');
}

/** Transaction client type — what repositories accept when enlisted in a tx. */
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Anything that can run a query: the root client or an open transaction. */
export type PrismaExecutor = PrismaClient | PrismaTransaction;
