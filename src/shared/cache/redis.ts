import { Redis } from 'ioredis';

import { loadEnv } from '../../config/env.js';
import { getLogger } from '../logger/index.js';

/**
 * One shared Redis connection for cache + rate limiting + OTP storage.
 * BullMQ needs its own connections (see shared/queue) because it blocks.
 */
let client: Redis | undefined;

export function getRedis(): Redis {
  if (client) return client;

  const env = loadEnv();
  // Lazy: the socket opens on first command, so building the app (tests, the
  // OpenAPI generator) never requires a running Redis.
  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    getLogger().error({ err }, 'redis connection error');
  });

  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;

  // A lazy client that never issued a command has no socket to close politely;
  // quit() on it would hang waiting for a connection that was never made.
  if (client.status === 'ready') {
    await client.quit();
  } else {
    client.disconnect();
  }

  client = undefined;
  getLogger().info('redis disconnected');
}

// --- Typed cache-aside helpers ---------------------------------------------

/** Read a JSON value, returning undefined on a miss or unparseable payload. */
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const raw = await getRedis().get(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    getLogger().warn({ key }, 'discarding unparseable cache entry');
    return undefined;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await getRedis().del(...keys);
}

/**
 * Cache-aside: return the cached value, otherwise produce it, store it, and
 * return it. Producer errors are never cached.
 */
export async function cached<T>(key: string, ttlSeconds: number, produce: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== undefined) return hit;

  const value = await produce();
  await cacheSet(key, value, ttlSeconds);
  return value;
}
