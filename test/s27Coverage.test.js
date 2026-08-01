import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPage } from '../lib/features/dashboard/view.js';
import { produkPage } from '../lib/features/produk/view.js';
import { pemasaranPage } from '../lib/features/pemasaran/view.js';
import { asistenPage } from '../lib/features/agent/view.js';
import { evaluasiPage } from '../lib/features/evaluasi/view.js';
import { loginPage } from '../lib/features/auth/view.js';
import * as threads from '../lib/features/channels/threads.js';
import * as instagram from '../lib/features/channels/instagram.js';
import { agentSessions } from '../lib/features/agent/core.js';
import { resetAgentSession, runAgentTask } from '../lib/features/agent/runner.js';

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

test('renders all feature pages with a nonce and escaped user fields', () => {
  const pages = [
    dashboardPage('Test <user>', 'csrf', { nonce: 'nonce' }),
    produkPage('Test <user>', 'csrf', { nonce: 'nonce' }),
    pemasaranPage('Test <user>', 'csrf', { nonce: 'nonce' }),
    asistenPage('Test <user>', 'csrf', { nonce: 'nonce' }),
    evaluasiPage('Test <user>', 'csrf', { nonce: 'nonce' }),
    loginPage('Login error', { nonce: 'nonce' }),
  ];

  for (const page of pages) {
    assert.match(page, /nonce="nonce"/);
    assert.match(page, /<!doctype html>/i);
  }
  assert.match(pages[0], /Test &lt;user&gt;/);
});

test('covers pure channel adapter payload/configuration paths', async () => {
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

test('covers agent runner validation and session reset seams', async () => {
  const aborted = [];
  agentSessions.set('telegram:coverage', { abort: async () => aborted.push(true) });
  resetAgentSession('telegram:coverage');
  resetAgentSession('telegram:missing');
  assert.deepEqual(aborted, [true]);
  await assert.rejects(() => runAgentTask({}), /sessionKey dan prompt wajib/);
});
