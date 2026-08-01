/**
 * S29 (C1) + S30 (C2) — halaman ber-shell web.
 * Menggantikan bagian render halaman dari test/s27Coverage.test.js, ditambah
 * uji route: guard login, nonce CSP diteruskan, dan redirect akar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerPageRoutes } from '../routes/pages.js';
import { dashboardPage } from '../../features/dashboard/view.js';
import { produkPage } from '../../features/produk/view.js';
import { pemasaranPage } from '../../features/pemasaran/view.js';
import { asistenPage } from '../../features/agent/view.js';
import { evaluasiPage } from '../../features/evaluasi/view.js';
import { loginPage } from '../../features/auth/view.js';
import { createRouteApp, listen } from '../../../test/helpers/webApp.mjs';

const HALAMAN = ['/dashboard', '/produk', '/pemasaran', '/asisten', '/evaluasi'];

async function withApp(session, fn) {
  const { app, session: sess } = createRouteApp((a) => registerPageRoutes(a), { session });
  const server = await listen(app);
  try {
    return await fn({ ...server, session: sess });
  } finally {
    await server.close();
  }
}

test('setiap halaman fitur dirender dengan nonce dan field user yang di-escape', () => {
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

test('semua halaman terlindung requireLogin', async () => {
  await withApp(null, async ({ base }) => {
    for (const path of HALAMAN) {
      const res = await fetch(`${base}${path}`, { redirect: 'manual' });
      assert.notEqual(res.status, 200, `${path} tidak boleh terbuka tanpa login`);
    }
  });
});

test('halaman dirender dengan nonce CSP per-request dan token CSRF sesi', async () => {
  await withApp({ user: { id: 1, username: 'budi' } }, async ({ base, session }) => {
    for (const path of HALAMAN) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type') || '', /text\/html/);

      const html = await res.text();
      assert.match(html, /nonce="test-nonce"/, `${path} harus meneruskan nonce CSP`);
      assert.match(html, /budi/, `${path} harus menampilkan username`);
    }
    assert.ok(session._csrf, 'token CSRF dibuat sekali dan dipakai ulang lintas halaman');
  });
});

test('username berisi HTML di-escape di halaman yang dirender route', async () => {
  await withApp({ user: { id: 1, username: '<script>alert(1)</script>' } }, async ({ base }) => {
    const html = await (await fetch(`${base}/dashboard`)).text();
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;/);
  });
});

test('GET / mengalihkan ke /login', async () => {
  await withApp(null, async ({ base }) => {
    const res = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  });
});
