import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchemaReady, syncBotCommands } from './schema.js';

describe('telegram schema helpers', () => {
  it('checks the latest migration and syncs command scopes', async () => {
    const queries = [];
    const result = await ensureSchemaReady({
      query: async (sql) => {
        queries.push(sql);
        return { rows: [{ name: '0002_baseline_agent_runs' }] };
      },
    });
    assert.equal(queries.length, 1);
    assert.match(queries[0], /SELECT max\(name\) AS name FROM pgmigrations/i);
    assert.equal(result.ok, true);

    const calls = [];
    await syncBotCommands(
      { telegram: { setMyCommands: async (...args) => calls.push(args) } },
      [{ command: 'start' }],
      [{ command: 'listusers' }],
      123,
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1][1], { scope: { type: 'chat', chat_id: 123 } });
  });

  it('blocks bot startup when a migration is pending', async () => {
    await assert.rejects(
      () =>
        ensureSchemaReady({
          query: async () => ({ rows: [{ name: '0001_baseline_pemasaran_repliz' }] }),
        }),
      /Database schema pending.*migrate:up/i,
    );
  });
});
