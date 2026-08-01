import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPlanById, scheduleViaRepliz } from '../schedule.js';

describe('telegram schedule helpers', () => {
  it('rejects invalid ids before querying the database', async () => {
    let queried = false;
    const result = await getPlanById('abc', { query: async () => (queried = true) });
    assert.equal(result, null);
    assert.equal(queried, false);
  });

  it('reports missing Repliz configuration without querying a plan', async () => {
    const replies = [];
    const result = await scheduleViaRepliz({ reply: async (text) => replies.push(text) }, '7', {
      replizConfigured: () => false,
      dbPool: { query: async () => ({ rows: [] }) },
    });
    assert.equal(result, 1);
    assert.match(replies[0], /Repliz belum dikonfigurasi/);
  });
});
