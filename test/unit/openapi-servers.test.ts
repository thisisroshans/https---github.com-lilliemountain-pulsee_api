import { describe, expect, it } from 'vitest';

import type { Env } from '../../src/config/env.js';
import { buildOpenApiServers } from '../../src/config/openapi-servers.js';

/** Only the fields buildOpenApiServers reads; the rest of Env is irrelevant here. */
function env(overrides: Partial<Env>): Env {
  return { NODE_ENV: 'development', PORT: 3000, ...overrides } as Env;
}

describe('buildOpenApiServers', () => {
  it('lists only localhost when no deployed URL is configured', () => {
    expect(buildOpenApiServers(env({}))).toEqual([{ url: 'http://localhost:3000', description: 'Local' }]);
  });

  it('uses the configured port', () => {
    expect(buildOpenApiServers(env({ PORT: 8080 }))[0]?.url).toBe('http://localhost:8080');
  });

  it('offers localhost first, then the deployed URL, in development', () => {
    const servers = buildOpenApiServers(env({ API_PUBLIC_URL: 'https://api.pulse.fit' }));

    expect(servers).toEqual([
      { url: 'http://localhost:3000', description: 'Local' },
      { url: 'https://api.pulse.fit', description: 'Deployed' },
    ]);
  });

  it('never advertises localhost from a production deployment', () => {
    const servers = buildOpenApiServers(
      env({ NODE_ENV: 'production', API_PUBLIC_URL: 'https://api.pulse.fit' }),
    );

    expect(servers).toEqual([{ url: 'https://api.pulse.fit', description: 'Production' }]);
  });

  it('returns no servers in production when none is configured', () => {
    // An empty list makes clients resolve paths relative to the docs host,
    // which is safer than pointing them at a developer's machine.
    expect(buildOpenApiServers(env({ NODE_ENV: 'production' }))).toEqual([]);
  });

  it('strips trailing slashes so joined paths do not double up', () => {
    const servers = buildOpenApiServers(env({ API_PUBLIC_URL: 'https://api.pulse.fit///' }));

    expect(servers[1]?.url).toBe('https://api.pulse.fit');
  });

  it('preserves a base path on the deployed URL', () => {
    const servers = buildOpenApiServers(env({ API_PUBLIC_URL: 'https://pulse.fit/api-gateway' }));

    expect(servers[1]?.url).toBe('https://pulse.fit/api-gateway');
  });
});
