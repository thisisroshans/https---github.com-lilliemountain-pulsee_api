import type { Env } from './env.js';

/**
 * Builds the OpenAPI `servers` list.
 *
 * Swagger UI renders this as a dropdown, so listing both the local and the
 * deployed base URL lets "Try it out" target either without editing anything.
 *
 * The list is deployment metadata rather than part of the API contract, which
 * is why the committed `docs/openapi.json` snapshot compares everything *except*
 * this block (see src/scripts/generate-openapi.ts) — otherwise setting
 * API_PUBLIC_URL would fail the CI staleness check.
 */

export interface OpenApiServer {
  url: string;
  description: string;
}

/** Trailing slashes produce `//api/v1/...` once Swagger joins path segments. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function buildOpenApiServers(env: Env): OpenApiServer[] {
  const deployed = env.API_PUBLIC_URL === undefined ? undefined : normalizeBaseUrl(env.API_PUBLIC_URL);

  // Never advertise a localhost target from a production deployment.
  if (env.NODE_ENV === 'production') {
    return deployed === undefined ? [] : [{ url: deployed, description: 'Production' }];
  }

  const servers: OpenApiServer[] = [{ url: `http://localhost:${String(env.PORT)}`, description: 'Local' }];

  if (deployed !== undefined) {
    servers.push({ url: deployed, description: 'Deployed' });
  }

  return servers;
}
