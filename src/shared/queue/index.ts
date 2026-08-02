import { Queue, Worker, type ConnectionOptions, type Processor } from 'bullmq';

import { loadEnv } from '../../config/env.js';
import { getLogger } from '../logger/index.js';

/**
 * Background work. Anything slow or external — plan generation, food-photo
 * vision, push notifications, the weekly re-plan — runs here rather than on the
 * request path.
 */
export const QUEUE_NAMES = {
  planGeneration: 'plan-generation',
  foodPhotoAnalysis: 'food-photo-analysis',
  notifications: 'notifications',
  weeklyReplan: 'weekly-replan',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * BullMQ needs its own connections (it issues blocking commands), so we build
 * options from REDIS_URL rather than sharing the cache client.
 *
 * `rediss://` means TLS — managed providers such as Upstash require it, and
 * dropping the scheme here would fail to connect with a confusing error.
 */
export function buildRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const isTls = url.protocol === 'rediss:';

  return {
    host: url.hostname,
    port: Number(url.port) || (isTls ? 6380 : 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(isTls ? { tls: { servername: url.hostname } } : {}),
    // BullMQ requires this to be null so blocking commands are not aborted.
    maxRetriesPerRequest: null,
  };
}

function connection(): ConnectionOptions {
  return buildRedisConnection(loadEnv().REDIS_URL);
}

const queues = new Map<QueueName, Queue>();
const workers = new Map<QueueName, Worker>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection: connection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });

  queues.set(name, queue);
  return queue;
}

export function registerWorker<T>(name: QueueName, processor: Processor<T>, concurrency = 5): Worker<T> {
  const worker = new Worker<T>(name, processor, { connection: connection(), concurrency });

  worker.on('failed', (job, err) => {
    getLogger().error({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err }, 'job failed');
  });
  worker.on('completed', (job) => {
    getLogger().info({ queue: name, jobId: job.id }, 'job completed');
  });

  workers.set(name, worker as Worker);
  return worker;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...workers.values()].map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
  workers.clear();
  queues.clear();
  getLogger().info('queues closed');
}
