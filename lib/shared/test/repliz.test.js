import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildThreadsSchedulePayload,
  createThreadsSchedule,
  getReplizAccounts,
  getReplizSchedule,
  getThreadsAccounts,
  isReplizConfigured,
  replizFetch,
} from '../repliz.js';

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

describe('repliz HTTP client', () => {
  it('rejects requests when credentials are missing', async () => {
    await withEnv(
      { REPLIZ_API_KEY: undefined, REPLIZ_SECRET: undefined, REPLIZ_ACCOUNT_ID: undefined },
      async () => {
        assert.equal(isReplizConfigured(), false);
        await assert.rejects(() => replizFetch('/public/account'), /Repliz belum dikonfigurasi/);
        await assert.rejects(() => getReplizAccounts(), /Repliz belum dikonfigurasi/);
        await assert.rejects(() => getThreadsAccounts(), /Repliz belum dikonfigurasi/);
      },
    );
  });

  it('serializes successful requests and parses JSON or text responses', async () => {
    const previousFetch = globalThis.fetch;
    const requests = [];
    await withEnv(
      {
        REPLIZ_API_KEY: 'key',
        REPLIZ_SECRET: 'secret',
        REPLIZ_ACCOUNT_ID: 'account',
        REPLIZ_BASE_URL: 'https://repliz.test/api',
      },
      async () => {
        globalThis.fetch = async (url, options) => {
          requests.push({ url: String(url), options });
          return {
            ok: true,
            status: 200,
            text: async () => (requests.length === 1 ? '{"ok":true}' : 'plain'),
          };
        };
        assert.deepEqual(await replizFetch('/one', { method: 'GET' }), { ok: true });
        assert.equal(await replizFetch('/two', { method: 'POST', body: { a: 1 } }), 'plain');
        assert.match(requests[0].url, /repliz\.test\/api\/one$/);
        assert.match(requests[1].options.headers.Authorization, /^Basic /);
        assert.equal(requests[1].options.headers['Content-Type'], 'application/json');
      },
    );
    globalThis.fetch = previousFetch;
  });

  it('normalizes API, timeout, and malformed response errors', async () => {
    const previousFetch = globalThis.fetch;
    await withEnv({ REPLIZ_API_KEY: 'key', REPLIZ_SECRET: 'secret' }, async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'bad request' }),
      });
      await assert.rejects(() => replizFetch('/bad'), /400.*bad request/);

      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        text: async () => 'not-json',
      });
      await assert.rejects(() => replizFetch('/bad-text'), /500.*not-json/);

      globalThis.fetch = async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      };
      await assert.rejects(() => replizFetch('/timeout'), /timeout/);
    });
    globalThis.fetch = previousFetch;
  });
});

describe('Threads schedule payload', () => {
  it('validates account, content, schedule, and image inputs', () => {
    withEnv({ REPLIZ_ACCOUNT_ID: undefined, APP_URL: undefined }, () => {
      assert.throws(
        () => buildThreadsSchedulePayload({ copywriting: 'x', scheduled_at: '2026-08-02T10:00:00Z' }),
        /ACCOUNT_ID/,
      );
    });
    withEnv({ REPLIZ_ACCOUNT_ID: 'account', APP_URL: undefined }, () => {
      assert.throws(() => buildThreadsSchedulePayload({}), /copywriting/);
      assert.throws(() => buildThreadsSchedulePayload({ copywriting: 'x' }), /scheduleAt/);
      const payload = buildThreadsSchedulePayload(
        {
          title: 'Title',
          copywriting: 'Hello *world*\n\nSecond paragraph. ' + 'x'.repeat(600),
          scheduled_at: '2026-08-02T10:00:00Z',
          gambar: '/uploads/image.png',
        },
        { topic: 'Topic', replies: [{ description: 'reply' }], meta: { custom: true }, additionalInfo: {} },
      );
      assert.equal(payload.type, 'text');
      assert.equal(payload.medias.length, 0);
      assert.deepEqual(payload.replies, [{ description: 'reply' }]);
      assert.equal(payload.topic, 'Topic');
    });
    withEnv({ REPLIZ_ACCOUNT_ID: 'account', APP_URL: 'https://socai.my.id' }, () => {
      const payload = buildThreadsSchedulePayload(
        { copywriting: 'Hello', scheduled_at: '2026-08-02T10:00:00Z', gambar: '/uploads/image.png' },
        {},
      );
      assert.equal(payload.type, 'image');
      assert.equal(payload.medias[0].url, 'https://socai.my.id/uploads/image.png');
    });
  });

  it('creates and fetches schedules through the shared client', async () => {
    const previousFetch = globalThis.fetch;
    await withEnv(
      { REPLIZ_API_KEY: 'key', REPLIZ_SECRET: 'secret', REPLIZ_ACCOUNT_ID: 'account' },
      async () => {
        globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{"id":"schedule"}' });
        const plan = { copywriting: 'Hello', scheduled_at: '2026-08-02T10:00:00Z' };
        assert.equal((await createThreadsSchedule(plan)).id, 'schedule');
        assert.equal((await getReplizSchedule('schedule')).id, 'schedule');
        assert.throws(() => getReplizSchedule(''), /scheduleId/);
      },
    );
    globalThis.fetch = previousFetch;
  });
});
