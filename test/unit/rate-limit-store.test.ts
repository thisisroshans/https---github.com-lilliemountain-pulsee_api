import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createResilientRateLimitStore,
  type RateLimitResult,
} from '../../src/shared/middleware/rate-limit-store.js';

/**
 * These tests pin the two behaviours that matter operationally:
 *   1. a Redis outage must never fail a request, and
 *   2. limits must still be enforced (in memory) while Redis is down —
 *      otherwise an outage silently opens an OTP brute-force window.
 */

/** Minimal Redis stand-in: only `eval` is exercised by the store. */
function fakeRedis(evalImpl: () => Promise<[number, number]>): Redis {
  return { eval: vi.fn(evalImpl) } as unknown as Redis;
}

/** Promisified `incr`, which the plugin calls callback-style. */
function incr(
  store: { incr: (k: string, cb: (e: Error | null, r?: RateLimitResult) => void) => void },
  key: string,
): Promise<RateLimitResult | undefined> {
  return new Promise((resolve, reject) => {
    store.incr(key, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

describe('ResilientRateLimitStore — Redis healthy', () => {
  it('counts through Redis and reports the returned TTL', async () => {
    let count = 0;
    const redis = fakeRedis(() => {
      count += 1;
      return Promise.resolve([count, 45_000]);
    });
    const Store = createResilientRateLimitStore({ redis });
    const store = new Store({ timeWindow: 60_000 });

    expect(await incr(store, 'ip-1')).toEqual({ current: 1, ttl: 45_000 });
    expect(await incr(store, 'ip-1')).toEqual({ current: 2, ttl: 45_000 });
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });
});

describe('ResilientRateLimitStore — Redis down', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const downRedis = () => fakeRedis(() => Promise.reject(new Error('ECONNREFUSED')));

  it('never surfaces an error to the caller', async () => {
    const Store = createResilientRateLimitStore({ redis: downRedis() });
    const store = new Store({ timeWindow: 60_000 });

    await expect(incr(store, 'ip-1')).resolves.toBeDefined();
  });

  it('still enforces a limit using in-memory counters', async () => {
    const Store = createResilientRateLimitStore({ redis: downRedis() });
    const store = new Store({ timeWindow: 60_000 });

    expect((await incr(store, 'ip-1'))?.current).toBe(1);
    expect((await incr(store, 'ip-1'))?.current).toBe(2);
    expect((await incr(store, 'ip-1'))?.current).toBe(3);
    // A different client gets its own counter.
    expect((await incr(store, 'ip-2'))?.current).toBe(1);
  });

  it('resets the counter once the window elapses', async () => {
    const Store = createResilientRateLimitStore({ redis: downRedis() });
    const store = new Store({ timeWindow: 60_000 });

    expect((await incr(store, 'ip-1'))?.current).toBe(1);
    expect((await incr(store, 'ip-1'))?.current).toBe(2);

    vi.advanceTimersByTime(60_001);
    expect((await incr(store, 'ip-1'))?.current).toBe(1);
  });

  it('opens the circuit breaker so it stops calling a dead Redis', async () => {
    const redis = downRedis();
    const Store = createResilientRateLimitStore({ redis });
    const store = new Store({ timeWindow: 60_000 });

    // Threshold is 3 consecutive failures.
    for (let i = 0; i < 3; i += 1) await incr(store, 'ip-1');
    expect(redis.eval).toHaveBeenCalledTimes(3);

    // Breaker now open: further requests skip Redis entirely.
    await incr(store, 'ip-1');
    await incr(store, 'ip-1');
    expect(redis.eval).toHaveBeenCalledTimes(3);
  });

  it('retries Redis after the breaker cooldown expires', async () => {
    const redis = downRedis();
    const Store = createResilientRateLimitStore({ redis });
    const store = new Store({ timeWindow: 60_000 });

    for (let i = 0; i < 3; i += 1) await incr(store, 'ip-1');
    await incr(store, 'ip-1');
    expect(redis.eval).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(10_001);
    await incr(store, 'ip-1');
    expect(redis.eval).toHaveBeenCalledTimes(4);
  });

  it('recovers to Redis once it comes back', async () => {
    let healthy = false;
    const redis = fakeRedis(() =>
      healthy ? Promise.resolve<[number, number]>([7, 30_000]) : Promise.reject(new Error('down')),
    );
    const Store = createResilientRateLimitStore({ redis });
    const store = new Store({ timeWindow: 60_000 });

    await incr(store, 'ip-1');
    expect((await incr(store, 'ip-1'))?.current).toBe(2); // local fallback

    healthy = true;
    expect((await incr(store, 'ip-1'))?.current).toBe(7); // back on the shared counter
  });
});

describe('ResilientRateLimitStore — no Redis configured', () => {
  it('works purely in memory', async () => {
    const Store = createResilientRateLimitStore({ redis: null });
    const store = new Store({ timeWindow: 60_000 });

    expect((await incr(store, 'ip-1'))?.current).toBe(1);
    expect((await incr(store, 'ip-1'))?.current).toBe(2);
  });

  it('gives each route its own counters via child()', async () => {
    const Store = createResilientRateLimitStore({ redis: null });
    const store = new Store({ timeWindow: 60_000 });

    const otp = store.child({
      timeWindow: 60_000,
      routeInfo: { method: 'POST', url: '/api/v1/auth/otp/request' },
    });
    const coach = store.child({
      timeWindow: 60_000,
      routeInfo: { method: 'POST', url: '/api/v1/coach/messages' },
    });

    await incr(otp, 'ip-1');
    await incr(otp, 'ip-1');

    expect((await incr(otp, 'ip-1'))?.current).toBe(3);
    expect((await incr(coach, 'ip-1'))?.current).toBe(1);
  });

  it('falls back to a default window when the plugin omits one', async () => {
    const Store = createResilientRateLimitStore({ redis: null });
    const store = new Store({});

    expect((await incr(store, 'ip-1'))?.ttl).toBe(60_000);
  });
});
