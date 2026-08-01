import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureMarketingSchema, syncBotCommands } from './schema.js';

describe('telegram schema helpers', () => {
  it('runs the marketing schema migration and syncs command scopes', async () => {
    const queries = [];
    await ensureMarketingSchema({ query: async (sql) => queries.push(sql) });
    assert.equal(queries.length, 1);
    assert.match(queries[0], /ADD COLUMN IF NOT EXISTS repliz_status/);

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
});
