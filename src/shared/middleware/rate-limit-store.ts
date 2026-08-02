import type { Redis } from 'ioredis';

import { getLogger } from '../logger/index.js';

/**
 * Rate-limit store that survives a Redis outage.
 *
 * @fastify/rate-limit's built-in Redis store propagates connection errors, which
 * our error handler turns into a 500 — meaning a Redis blip would take down
 * every rate-limited route. Its `skipOnError` escape hatch avoids that by
 * disabling limiting altogether, which opens an OTP brute-force window exactly
 * when we are least able to observe it.
 *
 * This store does neither. On a Redis failure it degrades to per-instance
 * in-memory limiting: weaker than a shared counter across instances, but still
 * a real limit. A circuit breaker stops us paying the Redis timeout on every
 * request while it is down.
 */

/** Counter state for one key: hits so far in the window, and ms until it resets. */
export interface RateLimitResult {
  current: number;
  ttl: number;
}

/**
 * Callback shape @fastify/rate-limit passes in. `max` and `ban` are declared
 * optional so this store stays assignable to the plugin's public store type,
 * which types `incr` with only two parameters.
 */
type IncrCallback = (error: Error | null, result?: RateLimitResult) => void;

/**
 * The subset of the plugin's route options we care about. `child` accepts
 * `unknown` and narrows to this, because the plugin's declared parameter is
 * Fastify's full RouteOptions intersection — far more than a store needs, and
 * not something we want to depend on structurally.
 */
interface RouteChildOptions {
  timeWindow?: number | string | undefined;
  routeInfo?: { method?: string; url?: string } | undefined;
}

/**
 * What @fastify/rate-limit hands a custom store. Its public type marks
 * `timeWindow` optional (and allows a string like "1 minute"), even though the
 * plugin always passes a resolved millisecond number — so we accept both.
 */
interface StoreParams {
  timeWindow?: number | string | undefined;
}

const DEFAULT_TIME_WINDOW_MS = 60_000;

/** Resolve the plugin's loosely typed window to milliseconds. */
function toMilliseconds(window: number | string | undefined): number {
  if (typeof window === 'number' && Number.isFinite(window) && window > 0) return window;
  return DEFAULT_TIME_WINDOW_MS;
}

/**
 * Atomic increment-and-expire. Returns the new count and remaining TTL, setting
 * the TTL only when the key is new so the window does not slide on every hit.
 */
const INCR_LUA = `
  local current = redis.call('INCR', KEYS[1])
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl == -1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
  end
  return {current, ttl}
`;

/** How long to stop trying Redis after it fails, and how many failures trip it. */
const BREAKER_COOLDOWN_MS = 10_000;
const BREAKER_FAILURE_THRESHOLD = 3;

/** Cap on distinct keys held by the in-memory fallback (one per client). */
const LOCAL_MAX_KEYS = 10_000;

interface LocalEntry {
  current: number;
  startedAtMs: number;
}

/** Shared breaker state — one Redis outage should trip every route's store at once. */
interface BreakerState {
  consecutiveFailures: number;
  openUntilMs: number;
  degraded: boolean;
}

export interface ResilientStoreDeps {
  /** Null disables the Redis path entirely (tests, single-instance dev). */
  redis: Redis | null;
  namespace?: string;
}

/**
 * Builds the store *class* that @fastify/rate-limit instantiates. A factory is
 * needed because the plugin constructs the store itself and passes only its own
 * params — this closes over the Redis handle.
 */
export function createResilientRateLimitStore(
  deps: ResilientStoreDeps,
): new (params: StoreParams) => ResilientRateLimitStore {
  const breaker: BreakerState = { consecutiveFailures: 0, openUntilMs: 0, degraded: false };
  const namespace = deps.namespace ?? 'pulse-rl:';

  return class BoundStore extends ResilientRateLimitStore {
    constructor(params: StoreParams) {
      super(params, deps.redis, namespace, breaker);
    }
  };
}

export class ResilientRateLimitStore {
  private readonly local = new Map<string, LocalEntry>();
  private readonly timeWindowMs: number;

  constructor(
    params: StoreParams,
    private readonly redis: Redis | null,
    private readonly keyPrefix: string,
    private readonly breaker: BreakerState,
  ) {
    this.timeWindowMs = toMilliseconds(params.timeWindow);
  }

  /** @fastify/rate-limit calls this once per request. */
  incr(key: string, callback: IncrCallback, _max?: number, _ban?: number): void {
    void this.increment(key)
      .then((result) => {
        callback(null, result);
      })
      .catch((err: unknown) => {
        // Unreachable in practice: increment() already falls back. Belt and braces
        // so a bug here can never 500 a request.
        getLogger().error({ err }, 'rate limit store failed unexpectedly; allowing request');
        callback(null, { current: 1, ttl: this.timeWindowMs });
      });
  }

  /** Scopes the store to a route so per-route limits get their own counters. */
  child(routeOptions: unknown): ResilientRateLimitStore {
    const options = routeOptions as RouteChildOptions;
    const route = options.routeInfo;
    const prefix = `${this.keyPrefix}${route?.method ?? ''}${route?.url ?? ''}:`;
    return new ResilientRateLimitStore({ timeWindow: options.timeWindow }, this.redis, prefix, this.breaker);
  }

  private breakerIsOpen(): boolean {
    return Date.now() < this.breaker.openUntilMs;
  }

  private recordSuccess(): void {
    if (this.breaker.degraded) {
      getLogger().info('rate limiting restored to the shared Redis store');
    }
    this.breaker.consecutiveFailures = 0;
    this.breaker.openUntilMs = 0;
    this.breaker.degraded = false;
  }

  private recordFailure(err: unknown): void {
    this.breaker.consecutiveFailures += 1;

    if (this.breaker.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
      this.breaker.openUntilMs = Date.now() + BREAKER_COOLDOWN_MS;
      this.breaker.consecutiveFailures = 0;
    }

    // Log the transition, not every request, so an outage cannot flood the logs.
    if (!this.breaker.degraded) {
      this.breaker.degraded = true;
      getLogger().warn(
        { err },
        'redis unavailable; rate limiting degraded to per-instance in-memory counters',
      );
    }
  }

  private async increment(key: string): Promise<RateLimitResult> {
    if (this.redis && !this.breakerIsOpen()) {
      try {
        const raw = (await this.redis.eval(
          INCR_LUA,
          1,
          `${this.keyPrefix}${key}`,
          String(this.timeWindowMs),
        )) as [number, number];

        this.recordSuccess();
        return { current: raw[0], ttl: raw[1] };
      } catch (err) {
        this.recordFailure(err);
      }
    }

    return this.incrementLocally(key);
  }

  /**
   * Drops expired windows, then the oldest entries if we are still over the cap.
   * Without this the fallback map is an unbounded, attacker-controlled
   * allocation — one entry per distinct IP.
   */
  private evictIfNeeded(now: number): void {
    if (this.local.size < LOCAL_MAX_KEYS) return;

    for (const [key, entry] of this.local) {
      if (entry.startedAtMs + this.timeWindowMs <= now) this.local.delete(key);
    }

    // Map iterates in insertion order, so this drops the least recently created.
    for (const key of this.local.keys()) {
      if (this.local.size < LOCAL_MAX_KEYS) break;
      this.local.delete(key);
    }
  }

  /** Fixed-window counter, mirroring the semantics of the Redis path. */
  private incrementLocally(key: string): RateLimitResult {
    const now = Date.now();
    const entry = this.local.get(key);

    if (!entry || entry.startedAtMs + this.timeWindowMs <= now) {
      this.evictIfNeeded(now);
      this.local.set(key, { current: 1, startedAtMs: now });
      return { current: 1, ttl: this.timeWindowMs };
    }

    entry.current += 1;
    return {
      current: entry.current,
      ttl: this.timeWindowMs - (now - entry.startedAtMs),
    };
  }
}
