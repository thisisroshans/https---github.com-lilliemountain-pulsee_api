import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildApp } from '../app.js';
import { disconnectRedis } from '../shared/cache/redis.js';

/**
 * Generates docs/openapi.json from the live route schemas.
 *
 *   pnpm openapi:generate   writes the file
 *   pnpm openapi:check      fails if the committed file is stale (used in CI)
 *
 * The generated document is the contract the mobile app builds against, so it
 * must never drift from the code.
 */
const OUTPUT_PATH = resolve(process.cwd(), 'docs/openapi.json');

/**
 * The `servers` block is deployment metadata driven by API_PUBLIC_URL, not part
 * of the API contract. Comparing it would make the staleness check fail on any
 * machine that targets a deployed environment, so it is excluded from the diff.
 */
function withoutServers(spec: string): string {
  const { servers: _servers, ...rest } = JSON.parse(spec) as Record<string, unknown>;
  return JSON.stringify(rest, null, 2);
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');

  const app = await buildApp();
  await app.ready();
  const spec = `${JSON.stringify(app.swagger(), null, 2)}\n`;
  await app.close();
  // Release the Redis handle so the script can exit on its own.
  await disconnectRedis();

  if (!checkOnly) {
    await writeFile(OUTPUT_PATH, spec, 'utf8');
    process.stdout.write(`OpenAPI written to ${OUTPUT_PATH}\n`);
    return;
  }

  let committed: string;
  try {
    committed = await readFile(OUTPUT_PATH, 'utf8');
  } catch {
    process.stderr.write('docs/openapi.json is missing. Run: pnpm openapi:generate\n');
    process.exit(1);
  }

  if (withoutServers(committed) !== withoutServers(spec)) {
    process.stderr.write(
      'docs/openapi.json is out of date with the route schemas. Run: pnpm openapi:generate\n',
    );
    process.exit(1);
  }

  process.stdout.write('OpenAPI contract is up to date.\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`Failed to generate OpenAPI: ${String(err)}\n`);
  process.exit(1);
});
