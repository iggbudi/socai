/**
 * S30 (C2) — adapter kanal Threads & Instagram.
 * Dipindah dari test/s27Coverage.test.js apa adanya; nama file kini menunjuk
 * apa yang diuji, bukan nomor sprint.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as threads from '../threads.js';
import * as instagram from '../instagram.js';

async function withEnv(overrides, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('adapter melaporkan konfigurasi kurang tanpa memanggil jaringan', async () => {
  await withEnv(
    {
      REPLIZ_ACCOUNT_ID: 'threads-account',
      REPLIZ_INSTAGRAM_ACCOUNT_ID: undefined,
      REPLIZ_API_KEY: undefined,
      REPLIZ_SECRET: undefined,
    },
    async () => {
      assert.equal(threads.getAccountId(), 'threads-account');
      assert.match(threads.configurationError(), /Threads/);
      assert.match(
        JSON.stringify(
          threads.buildSchedulePayload({ copywriting: 'hello', scheduled_at: '2026-08-02T10:00:00.000Z' }),
        ),
        /threads-account/,
      );
      assert.equal(instagram.getAccountId(), process.env.REPLIZ_INSTAGRAM_ACCOUNT_ID || '');
      assert.match(instagram.configurationError(), /Instagram/);
      await assert.rejects(
        () => instagram.createSchedule({ copywriting: 'hello', scheduled_at: '2026-08-02T10:00:00.000Z' }),
        /Instagram belum dikonfigurasi/,
      );
    },
  );
});

test('adapter memanggil Repliz saat kredensial lengkap', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ id: 'schedule-1' }),
  });

  try {
    await withEnv(
      {
        REPLIZ_ACCOUNT_ID: 'threads-account',
        REPLIZ_API_KEY: 'key',
        REPLIZ_SECRET: 'secret',
        REPLIZ_INSTAGRAM_ACCOUNT_ID: 'instagram-account',
      },
      async () => {
        assert.equal((await threads.listAccounts()).id, 'schedule-1');
        assert.equal(
          (await threads.createSchedule({ copywriting: 'hello', scheduled_at: '2026-08-02T10:00:00.000Z' }))
            .id,
          'schedule-1',
        );
        assert.equal((await threads.getSchedule('schedule-1')).id, 'schedule-1');
        assert.equal((await instagram.listAccounts()).id, 'schedule-1');
        assert.equal(
          (await instagram.createSchedule({ copywriting: 'hello', scheduled_at: '2026-08-02T10:00:00.000Z' }))
            .id,
          'schedule-1',
        );
        assert.equal((await instagram.getSchedule('schedule-1')).id, 'schedule-1');
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
