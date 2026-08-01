import express from 'express';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../../../shared/rateLimit.js';
import { AI_MESSAGE_MAX_LENGTH } from '../aiLimits.js';
import { handleAsistenChat, registerAsistenRoutes, registerAgentRunsRoutes } from '../routes.js';

function createAuthMiddleware() {
  return (req, _res, next) => {
    req.session = { user: { id: 1 } };
    req.sessionID = 'test-agent-session';
    next();
  };
}

function createDbPool({ runs = [], fail = false } = {}) {
  const queries = [];
  const run = {
    id: 7,
    run_id: 'run-7',
    session_key: 'test-agent-session',
    source: 'web',
    autonomy_mode: 'assistive',
    trigger_type: 'chat',
    user_prompt: 'halo',
    status: 'running',
    model_ref: null,
    started_at: new Date().toISOString(),
  };

  return {
    queries,
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (fail) throw new Error('database unavailable');
      if (String(sql).includes('INSERT INTO agent_runs')) return { rows: [run] };
      if (String(sql).includes('UPDATE agent_runs')) return { rows: [{ ...run, status: 'completed' }] };
      if (String(sql).includes('SELECT id, run_id')) return { rows: runs };
      throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
    },
  };
}

function createFakeAgentSession({ onPrompt, promptError } = {}) {
  let subscriber;
  let stopped = false;
  return {
    subscribe(callback) {
      subscriber = callback;
      return () => {
        stopped = true;
      };
    },
    async prompt(message) {
      if (promptError) throw promptError;
      await onPrompt?.(message, (event) => subscriber?.(event));
    },
    async abort() {},
    get stopped() {
      return stopped;
    },
  };
}

function createTestApp({ dbPool = createDbPool(), sessions = new Map(), initAgent, rateLimit = 10 } = {}) {
  const limiter = createRateLimiter({
    limit: rateLimit,
    windowMs: 60_000,
    keyFn: (req) => req.sessionID,
    onCleanupIntervalMs: 10 * 60_000,
  });
  const app = express();
  app.use(express.json());
  const requireAuth = createAuthMiddleware();

  registerAsistenRoutes(app, {
    dbPool,
    initAgent,
    sessions,
    requireAuth,
    rateLimiter: limiter.middleware,
  });
  registerAgentRunsRoutes(app, { dbPool, requireAuth });

  return { app, dbPool, sessions, stop: limiter.stop };
}

async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await callback(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function postChat(base, message) {
  return fetch(`${base}/api/asisten`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

describe('agent routes', () => {
  it('POST /api/asisten returns 400 for an empty message', async () => {
    const testApp = createTestApp({
      initAgent: async () => {
        throw new Error('should not initialize');
      },
    });
    try {
      await withServer(testApp.app, async (base) => {
        const res = await postChat(base, '   ');
        assert.equal(res.status, 400);
        assert.match((await res.json()).error, /tidak boleh kosong/i);
      });
    } finally {
      testApp.stop();
    }
  });

  it('POST /api/asisten returns 400 for an oversized message', async () => {
    const testApp = createTestApp({
      initAgent: async () => {
        throw new Error('should not initialize');
      },
    });
    try {
      await withServer(testApp.app, async (base) => {
        const res = await postChat(base, 'x'.repeat(AI_MESSAGE_MAX_LENGTH + 1));
        assert.equal(res.status, 400);
        assert.match((await res.json()).error, /terlalu panjang/i);
      });
    } finally {
      testApp.stop();
    }
  });

  it('POST /api/asisten sends SSE headers and streams a new agent session', async () => {
    const session = createFakeAgentSession({
      onPrompt: async (_message, emit) => {
        await new Promise((resolve) => setImmediate(resolve));
        emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'bagian satu' } });
        emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'bagian dua' } });
        emit({ type: 'agent_end' });
      },
    });
    const sessions = new Map();
    const testApp = createTestApp({
      sessions,
      initAgent: async (sessionKey) => {
        sessions.set(sessionKey, session);
        return session;
      },
    });
    try {
      await withServer(testApp.app, async (base) => {
        const res = await postChat(base, 'halo agent');
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') || '', /^text\/event-stream/);
        assert.equal(res.headers.get('cache-control'), 'no-cache');
        const body = await res.text();
        assert.match(body, /⏳ Menyiapkan AI agent/);
        assert.match(body, /✅ Agent siap/);
        assert.match(body, /bagian satu/);
        assert.match(body, /bagian dua/);
        assert.match(body, /"type":"done"/);
        assert.equal(sessions.get('test-agent-session'), session);
      });
    } finally {
      testApp.stop();
    }
  });

  it('POST /api/asisten emits an SSE error when initAgent throws', async () => {
    const dbPool = createDbPool();
    const testApp = createTestApp({
      dbPool,
      initAgent: async () => {
        throw new Error('model unavailable');
      },
    });
    try {
      await withServer(testApp.app, async (base) => {
        const res = await postChat(base, 'halo agent');
        assert.equal(res.status, 200);
        const body = await res.text();
        assert.match(body, /"type":"error"/);
        assert.match(body, /model unavailable/);
        assert.equal(dbPool.queries.length, 0);
      });
    } finally {
      testApp.stop();
    }
  });

  it('POST /api/asisten emits an SSE error when prompt fails for an existing session', async () => {
    const session = createFakeAgentSession({ promptError: new Error('prompt failed') });
    const sessions = new Map([['test-agent-session', session]]);
    const testApp = createTestApp({ sessions });
    try {
      await withServer(testApp.app, async (base) => {
        const res = await postChat(base, 'halo agent');
        assert.equal(res.status, 200);
        const body = await res.text();
        assert.match(body, /"type":"error"/);
        assert.match(body, /prompt failed/);
      });
    } finally {
      testApp.stop();
    }
  });

  it('handleAsistenChat closes the stream on the safety timeout', async () => {
    let resolvePrompt;
    const promptFinished = new Promise((resolve) => {
      resolvePrompt = resolve;
    });
    const session = {
      subscribe() {
        return () => {};
      },
      prompt: () => promptFinished,
      async abort() {},
    };
    const req = new EventEmitter();
    req.body = { message: 'timeout test' };
    req.sessionID = 'timeout-session';
    req.session = { user: { id: 1 } };
    const writes = [];
    const res = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      write(chunk) {
        writes.push(chunk);
      },
      end() {
        this.ended = true;
      },
    };

    const handler = handleAsistenChat(req, res, {
      dbPool: createDbPool(),
      sessions: new Map([['timeout-session', session]]),
      safetyTimeoutMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(res.ended, true);
    assert.match(writes.join(''), /"type":"done"/);
    resolvePrompt();
    await handler;
  });

  it('handleAsistenChat aborts an active prompt when the request closes', async () => {
    let resolvePrompt;
    const promptFinished = new Promise((resolve) => {
      resolvePrompt = resolve;
    });
    let aborted = false;
    const session = {
      subscribe() {
        return () => {};
      },
      prompt: () => promptFinished,
      async abort() {
        aborted = true;
      },
    };
    const req = new EventEmitter();
    req.body = { message: 'abort test' };
    req.sessionID = 'abort-session';
    req.session = { user: { id: 1 } };
    const res = {
      writeHead() {},
      write() {},
      end() {
        this.ended = true;
      },
    };

    const handler = handleAsistenChat(req, res, {
      dbPool: createDbPool(),
      sessions: new Map([['abort-session', session]]),
    });
    await new Promise((resolve) => setImmediate(resolve));
    req.emit('close');
    assert.equal(aborted, true);
    assert.equal(res.ended, true);
    resolvePrompt();
    await handler;
  });

  it('POST /api/asisten returns 429 on the request after the injected limit', async () => {
    const testApp = createTestApp({
      rateLimit: 2,
      initAgent: async () => {
        throw new Error('should not initialize');
      },
    });
    try {
      await withServer(testApp.app, async (base) => {
        const first = await postChat(base, '');
        const second = await postChat(base, '');
        const third = await postChat(base, '');
        assert.equal(first.status, 400);
        assert.equal(second.status, 400);
        assert.equal(third.status, 429);
        assert.match((await third.json()).error, /terlalu banyak request/i);
        assert.ok(third.headers.get('retry-after'));
      });
    } finally {
      testApp.stop();
    }
  });

  it('registerAsistenRoutes uses the production rate limiter by default', async () => {
    const app = express();
    app.use(express.json());
    registerAsistenRoutes(app, {
      dbPool: createDbPool(),
      initAgent: async () => {
        throw new Error('should not initialize');
      },
      sessions: new Map(),
      requireAuth: createAuthMiddleware(),
    });
    await withServer(app, async (base) => {
      const res = await postChat(base, '');
      assert.equal(res.status, 400);
      await res.text();
    });
  });

  it('GET /api/agent/runs returns rows and clamps the limit', async () => {
    const runs = [{ id: 1, status: 'completed' }];
    const dbPool = createDbPool({ runs });
    const testApp = createTestApp({
      dbPool,
      initAgent: async () => {
        throw new Error('unused');
      },
    });
    try {
      await withServer(testApp.app, async (base) => {
        const res = await fetch(`${base}/api/agent/runs?limit=9999`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), runs);
        const listQuery = dbPool.queries.find(({ sql }) => sql.includes('SELECT id, run_id'));
        assert.deepEqual(listQuery.params, [200, 'test-agent-session']);
      });
    } finally {
      testApp.stop();
    }
  });

  it('GET /api/agent/runs returns a safe 500 JSON error when the pool fails', async () => {
    const testApp = createTestApp({
      dbPool: createDbPool({ fail: true }),
      initAgent: async () => {
        throw new Error('unused');
      },
    });
    try {
      await withServer(testApp.app, async (base) => {
        const res = await fetch(`${base}/api/agent/runs`);
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: 'Gagal mengambil data agent runs' });
      });
    } finally {
      testApp.stop();
    }
  });
});
