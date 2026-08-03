/**
 * S33 (D2) — bootstrap server.js.
 * server.js sendiri self-executing (app.listen langsung) dan tidak pernah masuk laporan
 * coverage karena node --test tidak mengimpornya. createShutdownHandler dan
 * scheduleBackgroundJobs diekstrak murni (nilai default = perilaku lama) agar jalur
 * shutdown graceful dan penjadwalan job cron bisa diuji tanpa DB/port nyata.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShutdownHandler, scheduleBackgroundJobs } from '../server.js';

function fakeLogger() {
  const calls = { info: [], error: [] };
  return {
    calls,
    info: (...args) => calls.info.push(args),
    error: (...args) => calls.error.push(args),
  };
}

function fakeSessionMap(entries) {
  const map = new Map(entries.map(([key, session]) => [key, session]));
  return map;
}

function fakeSession() {
  let aborted = false;
  return {
    get aborted() {
      return aborted;
    },
    abort: async () => {
      aborted = true;
    },
  };
}

test('shutdown: menutup HTTP server, tutup pool, exit 0 pada sukses', async () => {
  const logger = fakeLogger();
  const closed = { httpServer: false, pools: false };
  const httpServer = {
    close: (cb) => {
      closed.httpServer = true;
      cb();
    },
  };
  const exitCodes = [];
  const cleared = [];
  const telegramSession = fakeSession();
  const webSession = fakeSession();
  const sessions = fakeSessionMap([
    ['telegram:1', telegramSession],
    ['web:abc', webSession],
  ]);
  const lastUsed = new Map([
    ['telegram:1', 1],
    ['web:abc', 2],
  ]);
  const promises = new Map([
    ['telegram:1', Promise.resolve()],
    ['web:abc', Promise.resolve()],
  ]);

  const shutdown = createShutdownHandler({
    getHttpServer: () => httpServer,
    intervalHandles: [111, 222],
    agentSessions: sessions,
    agentSessionLastUsed: lastUsed,
    agentSessionPromises: promises,
    closeAgentPools: async () => {
      closed.pools = true;
    },
    setTimeoutFn: (fn) => {
      // catat, tapi jangan pernah jalankan force-exit di jalur sukses
      return { unref: () => {} };
    },
    processRef: { exit: (code) => exitCodes.push(code) },
    logger,
  });

  const originalClearInterval = global.clearInterval;
  global.clearInterval = (id) => cleared.push(id);
  try {
    shutdown('SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    global.clearInterval = originalClearInterval;
  }

  assert.deepEqual(cleared, [111, 222]);
  assert.equal(closed.httpServer, true);
  assert.equal(closed.pools, true);
  assert.deepEqual(exitCodes, [0]);
  // Sesi non-telegram dibersihkan, sesi telegram (dikelola bot terpisah) dibiarkan.
  assert.equal(webSession.aborted, true);
  assert.equal(telegramSession.aborted, false);
  assert.equal(sessions.has('web:abc'), false);
  assert.equal(sessions.has('telegram:1'), true);
});

test('shutdown: tanpa httpServer aktif tetap menutup pool dan exit 0', async () => {
  const exitCodes = [];
  const shutdown = createShutdownHandler({
    getHttpServer: () => undefined,
    intervalHandles: [],
    agentSessions: new Map(),
    agentSessionLastUsed: new Map(),
    agentSessionPromises: new Map(),
    closeAgentPools: async () => {},
    setTimeoutFn: () => ({ unref: () => {} }),
    processRef: { exit: (code) => exitCodes.push(code) },
    logger: fakeLogger(),
  });

  shutdown('SIGINT');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(exitCodes, [0]);
});

test('shutdown: closeAgentPools gagal → exit 1', async () => {
  const exitCodes = [];
  const shutdown = createShutdownHandler({
    getHttpServer: () => undefined,
    intervalHandles: [],
    agentSessions: new Map(),
    agentSessionLastUsed: new Map(),
    agentSessionPromises: new Map(),
    closeAgentPools: async () => {
      throw new Error('pool close gagal');
    },
    setTimeoutFn: () => ({ unref: () => {} }),
    processRef: { exit: (code) => exitCodes.push(code) },
    logger: fakeLogger(),
  });

  shutdown('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(exitCodes, [1]);
});

test('shutdown: sinyal kedua diabaikan (idempotent)', async () => {
  let closeCalls = 0;
  const httpServer = {
    close: (cb) => {
      closeCalls++;
      cb();
    },
  };
  const shutdown = createShutdownHandler({
    getHttpServer: () => httpServer,
    intervalHandles: [],
    agentSessions: new Map(),
    agentSessionLastUsed: new Map(),
    agentSessionPromises: new Map(),
    closeAgentPools: async () => {},
    setTimeoutFn: () => ({ unref: () => {} }),
    processRef: { exit: () => {} },
    logger: fakeLogger(),
  });

  shutdown('SIGTERM');
  shutdown('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(closeCalls, 1);
});

test('shutdown: force exit terpicu bila closeAgentPools tidak pernah selesai', async () => {
  const exitCodes = [];
  let forceExitFn;
  const shutdown = createShutdownHandler({
    getHttpServer: () => undefined,
    intervalHandles: [],
    agentSessions: new Map(),
    agentSessionLastUsed: new Map(),
    agentSessionPromises: new Map(),
    closeAgentPools: () => new Promise(() => {}), // tidak pernah resolve
    setTimeoutFn: (fn) => {
      forceExitFn = fn;
      return { unref: () => {} };
    },
    processRef: { exit: (code) => exitCodes.push(code) },
    logger: fakeLogger(),
  });

  shutdown('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exitCodes, []); // belum force-exit
  forceExitFn();
  assert.deepEqual(exitCodes, [1]);
});

test('scheduleBackgroundJobs: semua interval nol/negatif → hanya refresh feedback awal yang jalan', async () => {
  const intervals = [];
  const timeouts = [];
  let feedbackCalled = 0;

  await scheduleBackgroundJobs({
    trackInterval: (fn, ms) => intervals.push(ms),
    replizAutoScheduleIntervalMs: 0,
    replizSyncIntervalMs: 0,
    autoPlanCronIntervalMs: 0,
    agentRunsPurgeIntervalMs: 0,
    jobs: {
      runPublishFeedbackRefresh: async () => {
        feedbackCalled++;
      },
    },
    setTimeoutFn: (fn, ms) => timeouts.push(ms),
    logger: fakeLogger(),
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(intervals, []);
  assert.deepEqual(timeouts, []);
  assert.equal(feedbackCalled, 1);
});

test('scheduleBackgroundJobs: semua interval aktif → 4 interval + 3 timeout awal terdaftar', async () => {
  const intervals = [];
  const timeouts = [];

  await scheduleBackgroundJobs({
    trackInterval: (fn, ms) => intervals.push(ms),
    replizAutoScheduleIntervalMs: 600_000,
    replizSyncIntervalMs: 300_000,
    autoPlanCronIntervalMs: 3_600_000,
    agentRunsPurgeIntervalMs: 86_400_000,
    jobs: {
      autoSchedulePendingRepliz: async () => ({ skipped: true }),
      syncPendingReplizStatuses: async () => ({}),
      runPublishFeedbackRefresh: async () => ({}),
      generateWeeklyPlans: async () => ({ skipped: true }),
      runAgentRunsPurge: async () => ({ deleted: 0 }),
    },
    setTimeoutFn: (fn, ms) => timeouts.push(ms),
    logger: fakeLogger(),
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(intervals, [600_000, 300_000, 3_600_000, 86_400_000]);
  assert.deepEqual(timeouts, [30_000, 60_000, 120_000]);
});

test('scheduleBackgroundJobs: error di job auto-schedule tidak melempar, hanya dicatat', async () => {
  const intervals = [];
  const logger = fakeLogger();
  let autoScheduleFn;

  await scheduleBackgroundJobs({
    trackInterval: (fn, ms) => {
      intervals.push(ms);
      autoScheduleFn = fn;
    },
    replizAutoScheduleIntervalMs: 600_000,
    replizSyncIntervalMs: 0,
    autoPlanCronIntervalMs: 0,
    agentRunsPurgeIntervalMs: 0,
    jobs: {
      autoSchedulePendingRepliz: async () => {
        throw new Error('repliz mati');
      },
      runPublishFeedbackRefresh: async () => ({}),
    },
    setTimeoutFn: () => {},
    logger,
  });

  await autoScheduleFn();
  assert.ok(logger.calls.error.some(([, msg]) => msg === 'Repliz auto schedule error'));
});

test('scheduleBackgroundJobs: dua pemanggilan auto-schedule bersamaan → yang kedua dilewati (guard re-entrancy)', async () => {
  let running = 0;
  let maxConcurrent = 0;
  let autoScheduleFn;

  await scheduleBackgroundJobs({
    trackInterval: (fn) => {
      autoScheduleFn = fn;
    },
    replizAutoScheduleIntervalMs: 600_000,
    replizSyncIntervalMs: 0,
    autoPlanCronIntervalMs: 0,
    agentRunsPurgeIntervalMs: 0,
    jobs: {
      autoSchedulePendingRepliz: async () => {
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((resolve) => setImmediate(resolve));
        running--;
        return { skipped: false, scheduled: 1, failed: 0 };
      },
      runPublishFeedbackRefresh: async () => ({}),
    },
    setTimeoutFn: () => {},
    logger: fakeLogger(),
  });

  const first = autoScheduleFn();
  const second = autoScheduleFn();
  await Promise.all([first, second]);

  assert.equal(maxConcurrent, 1);
});
