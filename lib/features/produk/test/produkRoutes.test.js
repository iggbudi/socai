/**
 * S29 (C1) — CRUD produk.
 * Fokus: guard login, validasi input, 404, sanitasi URL gambar, dan penanganan
 * error DB yang tidak membocorkan detail internal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerProdukRoutes } from '../routes.js';
import { createRouteApp, listen, fakePool } from '../../../../test/helpers/webApp.mjs';

const LOGIN = { user: { id: 1, username: 'budi' } };

async function withApp({ pool = fakePool([]), session = LOGIN }, fn) {
  const { app } = createRouteApp((a) => registerProdukRoutes(a, { dbPool: pool }), { session });
  const server = await listen(app);
  try {
    return await fn({ ...server, pool });
  } finally {
    await server.close();
  }
}

const postJson = (base, path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('GET /api/produk butuh sesi login', async () => {
  await withApp({ session: null }, async ({ base }) => {
    const res = await fetch(`${base}/api/produk`);
    assert.equal(res.status, 401);
  });
});

test('GET /api/produk mengembalikan daftar produk', async () => {
  await withApp({ pool: fakePool([{ id: 2, nama: 'Kopi' }]) }, async ({ base }) => {
    const res = await fetch(`${base}/api/produk`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: 2, nama: 'Kopi' }]);
  });
});

test('GET /api/produk/:id → 404 saat tidak ada', async () => {
  await withApp({ pool: fakePool([]) }, async ({ base }) => {
    const res = await fetch(`${base}/api/produk/99`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Produk tidak ditemukan' });
  });
});

test('GET /api/produk/:id memakai parameter terikat', async () => {
  const pool = fakePool([{ id: 3 }]);
  await withApp({ pool }, async ({ base }) => {
    await fetch(`${base}/api/produk/3`);
    assert.deepEqual(pool.capture[0].params, ['3']);
  });
});

test('POST /api/produk menolak nama atau harga yang tidak valid', async () => {
  const kasus = [
    { harga: 1000, keterangan: 'tanpa nama' },
    { nama: 'Kopi', keterangan: 'tanpa harga' },
    { nama: 'Kopi', harga: '', keterangan: 'harga kosong' },
    { nama: 'Kopi', harga: 'mahal', keterangan: 'harga bukan angka' },
    { nama: 'Kopi', harga: -5, keterangan: 'harga negatif' },
  ];

  await withApp({}, async ({ base, pool }) => {
    for (const { keterangan, ...body } of kasus) {
      const res = await postJson(base, '/api/produk', body);
      assert.equal(res.status, 400, `kasus "${keterangan}" seharusnya 400`);
      assert.match((await res.json()).error, /Nama dan harga valid wajib diisi/);
    }
    assert.equal(pool.capture.length, 0, 'input tidak valid tidak boleh menyentuh DB');
  });
});

test('POST /api/produk menolak URL gambar berbahaya', async () => {
  await withApp({}, async ({ base }) => {
    const res = await postJson(base, '/api/produk', {
      nama: 'Kopi',
      harga: 1000,
      gambar: 'javascript:alert(1)',
    });
    assert.equal(res.status, 400);
  });
});

test('DELETE /api/produk/:id → 404 saat tidak ada baris terhapus', async () => {
  await withApp({ pool: fakePool([]) }, async ({ base }) => {
    const res = await fetch(`${base}/api/produk/99`, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });
});

test('error database → 500 dengan pesan generik', async () => {
  await withApp({ pool: fakePool(new Error('kolom harga hilang')) }, async ({ base }) => {
    const res = await fetch(`${base}/api/produk`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Gagal mengambil data produk');
    assert.doesNotMatch(JSON.stringify(body), /kolom harga hilang/);
  });
});
