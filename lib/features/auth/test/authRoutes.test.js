/**
 * S29 (C1) — jalur login/logout.
 * Ini permukaan paling sensitif keamanannya, jadi yang dikunci di sini adalah
 * pesan error yang tidak membocorkan info, regenerasi sesi (anti session-fixation),
 * penghitung rate limit, dan guard CSRF pada logout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAuthRoutes } from '../routes.js';
import { createRouteApp, listen, fakePool } from '../../../../test/helpers/webApp.mjs';

function rateLimiterSpy() {
  const calls = { increment: [], reset: [] };
  return {
    calls,
    middleware: (req, res, next) => next(),
    increment: (ip) => calls.increment.push(ip),
    reset: (ip) => calls.reset.push(ip),
  };
}

const USER_ROW = { id: 7, username: 'budi', password: '$2a$10$hashpalsu' };

async function withApp({ pool = fakePool([]), compare = async () => true, session, regenerateError }, fn) {
  const limiter = rateLimiterSpy();
  const { app, session: sess } = createRouteApp(
    (a) =>
      registerAuthRoutes(a, {
        loginRateLimiter: limiter,
        dbPool: pool,
        comparePassword: compare,
      }),
    { session, regenerateError },
  );
  const server = await listen(app);
  try {
    return await fn({ ...server, limiter, session: sess, pool });
  } finally {
    await server.close();
  }
}

const postForm = (base, path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });

test('GET /login menampilkan form saat belum login', async () => {
  await withApp({}, async ({ base }) => {
    const res = await fetch(`${base}/login`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /nonce="test-nonce"/);
  });
});

test('GET /login mengalihkan ke dashboard bila sudah login', async () => {
  await withApp({ session: { user: { id: 1, username: 'budi' } } }, async ({ base }) => {
    const res = await fetch(`${base}/login`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/dashboard');
  });
});

test('kredensial kosong tidak menyentuh database dan tetap menambah penghitung rate limit', async () => {
  const pool = fakePool([]);
  await withApp({ pool }, async ({ base, limiter }) => {
    const res = await postForm(base, '/login', { username: '', password: '' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Username dan password wajib diisi/);
    assert.equal(pool.capture.length, 0);
    assert.equal(limiter.calls.increment.length, 1);
  });
});

test('username tak dikenal dan password salah memberi pesan yang identik', async () => {
  let pesanUsernameSalah;
  let pesanPasswordSalah;

  await withApp({ pool: fakePool([]) }, async ({ base }) => {
    pesanUsernameSalah = await (await postForm(base, '/login', { username: 'hantu', password: 'x' })).text();
  });

  await withApp({ pool: fakePool([USER_ROW]), compare: async () => false }, async ({ base }) => {
    pesanPasswordSalah = await (await postForm(base, '/login', { username: 'budi', password: 'x' })).text();
  });

  assert.match(pesanUsernameSalah, /Username atau password salah/);
  assert.equal(
    pesanUsernameSalah,
    pesanPasswordSalah,
    'pesan harus identik agar tidak membocorkan username mana yang terdaftar',
  );
});

test('login gagal tidak mereset rate limit', async () => {
  await withApp({ pool: fakePool([USER_ROW]), compare: async () => false }, async ({ base, limiter }) => {
    await postForm(base, '/login', { username: 'budi', password: 'salah' });
    assert.equal(limiter.calls.increment.length, 1);
    assert.equal(limiter.calls.reset.length, 0);
  });
});

test('login sukses meregenerasi sesi sebelum menyimpan user (anti session-fixation)', async () => {
  await withApp({ pool: fakePool([USER_ROW]) }, async ({ base, limiter, session }) => {
    const res = await postForm(base, '/login', { username: 'budi', password: 'benar' });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/dashboard');
    assert.deepEqual(session.events, ['regenerate']);
    assert.deepEqual(session.user, { id: 7, username: 'budi' });
    assert.ok(session._csrf, 'token CSRF harus dibuat setelah login');
    assert.equal(limiter.calls.reset.length, 1);
    assert.equal(limiter.calls.increment.length, 0);
  });
});

test('login memakai query berparameter, bukan string yang dirangkai', async () => {
  const pool = fakePool([USER_ROW]);
  await withApp({ pool }, async ({ base }) => {
    await postForm(base, '/login', { username: "budi' OR 1=1--", password: 'x' });
    assert.deepEqual(pool.capture[0].params, ["budi' OR 1=1--"]);
    assert.match(pool.capture[0].sql, /WHERE username = \$1/);
  });
});

test('regenerate yang gagal → halaman error, sesi tidak menyimpan user', async () => {
  await withApp(
    { pool: fakePool([USER_ROW]), regenerateError: new Error('store mati') },
    async ({ base, session }) => {
      const res = await postForm(base, '/login', { username: 'budi', password: 'benar' });
      assert.equal(res.status, 200);
      assert.match(await res.text(), /Terjadi kesalahan server/);
      assert.equal(session.user, undefined);
    },
  );
});

test('database error → halaman error generik, bukan 500 mentah', async () => {
  await withApp({ pool: fakePool(new Error('pg down')) }, async ({ base }) => {
    const res = await postForm(base, '/login', { username: 'budi', password: 'x' });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Terjadi kesalahan server/);
    assert.doesNotMatch(html, /pg down/, 'detail error internal tidak boleh bocor ke halaman');
  });
});

test('POST /logout tanpa token CSRF valid → 403 JSON dan sesi tidak dihancurkan (D3)', async () => {
  await withApp(
    { session: { user: { id: 7, username: 'budi' }, _csrf: 'token-benar' } },
    async ({ base, session }) => {
      const res = await postForm(base, '/logout', { _csrf: 'token-salah' });
      // D3: sebelumnya res.status(403).redirect(...) — res.redirect() Express menimpa
      // statusCode menjadi 302, jadi 403-nya mati. Diganti balas JSON agar status benar-benar 403.
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.error, 'CSRF validation failed');
      assert.deepEqual(session.events, []);
      assert.ok(session.user, 'sesi harus tetap utuh saat CSRF gagal');
    },
  );
});

test('POST /logout dengan token valid menghancurkan sesi', async () => {
  await withApp(
    { session: { user: { id: 7, username: 'budi' }, _csrf: 'token-benar' } },
    async ({ base, session }) => {
      const res = await postForm(base, '/logout', { _csrf: 'token-benar' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
      assert.deepEqual(session.events, ['destroy']);
      assert.equal(session.user, undefined);
    },
  );
});

test('POST /logout tanpa sesi login ditolak oleh requireLogin', async () => {
  await withApp({}, async ({ base }) => {
    const res = await postForm(base, '/logout', { _csrf: 'apa pun' });
    assert.notEqual(res.status, 302);
    assert.ok(res.status === 401 || res.status === 403, `status tak terduga: ${res.status}`);
  });
});

test('GET /logout hanya mengalihkan, tidak menghancurkan sesi', async () => {
  await withApp({ session: { user: { id: 7, username: 'budi' } } }, async ({ base, session }) => {
    const res = await fetch(`${base}/logout`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/dashboard');
    assert.deepEqual(session.events, [], 'GET tidak boleh punya efek samping');
  });
});
