import { getRedis } from '../../shared/cache/redis.js';
import { getPrisma } from '../../shared/db/prisma.js';
import { getLogger } from '../../shared/logger/index.js';
import type { DependencyStatus, HealthResponse } from './health.schema.js';

const PROBE_TIMEOUT_MS = 2000;

/** Race a probe against a timeout so a hung dependency cannot hang the check. */
async function probe(name: string, run: () => Promise<unknown>): Promise<DependencyStatus> {
  const startedAt = Date.now();
  try {
    await Promise.race([
      run(),
      new Promise((_resolve, reject) =>
        setTimeout(() => {
          reject(new Error(`${name} probe timed out`));
        }, PROBE_TIMEOUT_MS),
      ),
    ]);
    return { status: 'up', latencyMs: Date.now() - startedAt };
  } catch (err) {
    getLogger().warn({ dependency: name, err }, 'health probe failed');
    return { status: 'down', latencyMs: null };
  }
}

export class HealthService {
  /** Liveness: is the process itself running? Never touches dependencies. */
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** Readiness: can we actually serve traffic? Probes Postgres and Redis. */
  async ready(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      probe('database', () => getPrisma().$queryRaw`SELECT 1`),
      probe('redis', () => getRedis().ping()),
    ]);

    const allUp = database.status === 'up' && redis.status === 'up';

    return {
      status: allUp ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? '0.0.0',
      dependencies: { database, redis },
    };
  }
}
