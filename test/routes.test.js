/**
 * Route-level tests (web). Sprint 1 (A1) — regresi: POST /login tanpa body
 * atau Content-Type non-form TIDAK boleh menghasilkan HTTP 500.
 * Pattern ini akan diperluas di Sprint 6 (health, auth guard, dll).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createWebApp } from '../lib/web/createApp.js';

const { app, intervalHandles } = createWebApp();
let server;
let base;

before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  for (const id of intervalHandles) clearInterval(id);
  server?.close();
});

test('POST /login dengan Content-Type non-form → 200 loginPage, bukan 500 (A1)', async () => {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'x=1',
  });
  assert.notEqual(res.status, 500);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Username dan password wajib diisi/i);
});

test('POST /login tanpa body sama sekali → bukan 500 (A1)', async () => {
  const res = await fetch(`${base}/login`, { method: 'POST' });
  assert.notEqual(res.status, 500);
  assert.equal(res.status, 200);
});
