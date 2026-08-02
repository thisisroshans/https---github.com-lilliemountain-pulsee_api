import { describe, expect, it } from 'vitest';

import { buildRedisConnection } from '../../src/shared/queue/index.js';

/**
 * Managed Redis providers (Upstash, ElastiCache in-transit encryption) hand out
 * `rediss://` URLs. Dropping the TLS flag when rebuilding connection options
 * produces a connection failure that looks nothing like its cause, so pin it.
 */
describe('buildRedisConnection', () => {
  it('parses a plain local URL', () => {
    expect(buildRedisConnection('redis://localhost:6379')).toMatchObject({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    });
  });

  it('defaults the port when the URL omits it', () => {
    expect(buildRedisConnection('redis://localhost')).toMatchObject({ port: 6379 });
  });

  it('enables TLS for rediss:// and pins the SNI servername', () => {
    const options = buildRedisConnection('rediss://default:secret@eu1.upstash.io:6379');

    expect(options).toMatchObject({
      host: 'eu1.upstash.io',
      port: 6379,
      username: 'default',
      password: 'secret',
      tls: { servername: 'eu1.upstash.io' },
    });
  });

  it('does not enable TLS for a plain redis:// URL', () => {
    expect(buildRedisConnection('redis://localhost:6379')).not.toHaveProperty('tls');
  });

  it('url-decodes credentials containing reserved characters', () => {
    const options = buildRedisConnection('rediss://user%40x:p%40ss%2Fword@host.example:6380');

    expect(options).toMatchObject({ username: 'user@x', password: 'p@ss/word', port: 6380 });
  });

  it('omits credentials entirely when the URL has none', () => {
    const options = buildRedisConnection('redis://localhost:6379');

    expect(options).not.toHaveProperty('username');
    expect(options).not.toHaveProperty('password');
  });
});
