/**
 * S29 (C1) — endpoint metrik evaluasi M1–M7.
 * Fokus: guard login, penerusan filter query, dan pemetaan error validasi ke 400.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerEvaluasiRoutes } from '../routes.js';
import { createRouteApp, listen, fakePool } from '../../../../test/helpers/webApp.mjs';

const LOGIN = { user: { id: 1, username: 'budi' } };

async function withApp({ pool = fakePool([]), session = LOGIN }, fn) {
  const { app } = createRouteApp((a) => registerEvaluasiRoutes(a, { dbPool: pool }), { session });
  const server = await listen(app);
  try {
    return await fn({ ...server, pool });
  } finally {
    await server.close();
  }
}

test('GET /api/agent/metrics butuh sesi login', async () => {
  await withApp({ session: null }, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/agent/metrics`)).status, 401);
  });
});

test('GET /api/agent/metrics mengembalikan metrik', async () => {
  await withApp({ pool: fakePool([{ total: 3 }]) }, async ({ base }) => {
    const res = await fetch(`${base}/api/agent/metrics`);
    assert.equal(res.status, 200);
    assert.equal(typeof (await res.json()), 'object');
  });
});

test('filter query diteruskan ke lapisan metrik', async () => {
  const pool = fakePool([]);
  await withApp({ pool }, async ({ base }) => {
    const res = await fetch(`${base}/api/agent/metrics?days=7&channel=threads&autonomy_mode=bounded`);
    assert.equal(res.status, 200);
    assert.ok(pool.capture.length > 0, 'metrik harus benar-benar melakukan query');
  });
});

test('error bertuliskan "tidak valid" dipetakan ke 400, bukan 500', async () => {
  await withApp({ pool: fakePool(new Error('Parameter days tidak valid')) }, async ({ base }) => {
    const res = await fetch(`${base}/api/agent/metrics?days=abc`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /tidak valid/);
  });
});

test('error lain dipetakan ke 500', async () => {
  await withApp({ pool: fakePool(new Error('connection terminated')) }, async ({ base }) => {
    const res = await fetch(`${base}/api/agent/metrics`);
    assert.equal(res.status, 500);
  });
});
