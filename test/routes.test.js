/**
 * Route-level tests (web).
 * Sprint 1 (A1) — regresi: POST /login tanpa body / Content-Type non-form TIDAK 500.
 * Sprint 6 (A7) — health shape, auth guard 401, logout tanpa session, CSRF e2e, redirect.
 * Tidak memerlukan database: health memakai status down saat pool tidak tersedia.
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

test('GET /health → JSON shape status + checks.database (A7)', async () => {
  const res = await fetch(`${base}/health`);
  // 200 saat DB ok; 503 saat down — keduanya harus punya body shape yang sama
  assert.ok([200, 503].includes(res.status), `unexpected status ${res.status}`);
  const body = await res.json();
  assert.equal(typeof body.status, 'string');
  assert.ok(body.checks && typeof body.checks.database === 'object');
  assert.equal(typeof body.checks.database.ok, 'boolean');
});

test('GET /api/produk tanpa session → 401 (A7)', async () => {
  const res = await fetch(`${base}/api/produk`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.match(body.error, /login/i);
});

test('POST /logout tanpa session → 401, bukan 500 (A7)', async () => {
  const res = await fetch(`${base}/logout`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  assert.notEqual(res.status, 500);
  assert.equal(res.status, 401);
});

test('POST /api/produk tanpa Origin → 403 (CSRF, A7)', async () => {
  const res = await fetch(`${base}/api/produk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /CSRF/i);
});

test('POST /api/produk dengan Origin asing → 403 (CSRF, A7)', async () => {
  const res = await fetch(`${base}/api/produk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{}',
  });
  assert.equal(res.status, 403);
});

test('GET / → redirect 302 ke /login (A7)', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location') || '', /\/login/);
});

test('GET /login → 200 halaman login (A7)', async () => {
  const res = await fetch(`${base}/login`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Login/i);
});

test('setiap request web mendapat X-Request-ID UUID (S28)', async () => {
  const first = await fetch(`${base}/login`);
  const second = await fetch(`${base}/login`);
  const firstId = first.headers.get('x-request-id');
  const secondId = second.headers.get('x-request-id');
  assert.match(firstId || '', /^[0-9a-f-]{36}$/i);
  assert.match(secondId || '', /^[0-9a-f-]{36}$/i);
  assert.notEqual(firstId, secondId);
});
