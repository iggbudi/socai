/**
 * S29 (C1) — route rencana pemasaran + jembatan Repliz.
 * Fokus: guard login, batas bulk schedule, pemetaan statusCode domain, dan
 * hasil parsial 207 saat sebagian jadwal gagal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerPemasaranRoutes } from '../routes.js';
import { createRouteApp, listen, fakePool } from '../../../../test/helpers/webApp.mjs';

const LOGIN = { user: { id: 1, username: 'budi' } };

async function withApp(deps, fn, { session = LOGIN } = {}) {
  const { app } = createRouteApp(
    (a) => registerPemasaranRoutes(a, { dbPool: fakePool([]), sleepFn: async () => {}, ...deps }),
    { session },
  );
  const server = await listen(app);
  try {
    return await fn(server);
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

test('GET /api/pemasaran butuh sesi login', async () => {
  await withApp(
    {},
    async ({ base }) => {
      assert.equal((await fetch(`${base}/api/pemasaran`)).status, 401);
    },
    { session: null },
  );
});

test('GET /api/pemasaran/:id → 404 bila tidak ada', async () => {
  await withApp({ dbPool: fakePool([]) }, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/pemasaran/9`)).status, 404);
  });
});

test('POST /api/pemasaran mengembalikan satu objek untuk satu rencana', async () => {
  await withApp({ savePlans: async () => [{ id: 1, judul: 'Promo' }] }, async ({ base }) => {
    const res = await postJson(base, '/api/pemasaran', { judul: 'Promo', strategi: 'diskon' });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: 1, judul: 'Promo' });
  });
});

test('POST /api/pemasaran mengembalikan ringkasan count untuk banyak rencana', async () => {
  await withApp({ savePlans: async () => [{ id: 1 }, { id: 2 }] }, async ({ base }) => {
    const body = await (await postJson(base, '/api/pemasaran', [{}, {}])).json();
    assert.equal(body.count, 2);
    assert.equal(body.rows.length, 2);
  });
});

test('POST /api/pemasaran memetakan error validasi domain ke 400', async () => {
  const kasus = [
    ['URL gambar tidak valid', /URL gambar tidak valid/],
    ['Data rencana tidak valid: judul kosong', /judul dan strategi/],
  ];

  for (const [pesan, cocok] of kasus) {
    await withApp(
      {
        savePlans: async () => {
          throw new Error(pesan);
        },
      },
      async ({ base }) => {
        const res = await postJson(base, '/api/pemasaran', {});
        assert.equal(res.status, 400, `"${pesan}" seharusnya 400`);
        assert.match((await res.json()).error, cocok);
      },
    );
  }
});

test('bulk schedule menolak daftar kosong atau id non-numerik', async () => {
  await withApp({}, async ({ base }) => {
    for (const ids of [undefined, [], ['abc'], ['1; DROP TABLE']]) {
      const res = await postJson(base, '/api/pemasaran/repliz/schedule', { ids });
      assert.equal(res.status, 400, `ids=${JSON.stringify(ids)} seharusnya 400`);
      assert.match((await res.json()).error, /minimal satu rencana/);
    }
  });
});

test('bulk schedule menolak lebih dari 20 rencana', async () => {
  await withApp({}, async ({ base }) => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1);
    const res = await postJson(base, '/api/pemasaran/repliz/schedule', { ids });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Maksimal 20/);
  });
});

test('bulk schedule sebagian gagal → 207 dengan rincian per id', async () => {
  const jeda = [];
  await withApp(
    {
      sleepFn: async (ms) => jeda.push(ms),
      schedulePlan: async (id) => {
        if (String(id) === '2') throw new Error('Repliz menolak');
        return { plan: { repliz_schedule_id: `sch-${id}` } };
      },
    },
    async ({ base }) => {
      const res = await postJson(base, '/api/pemasaran/repliz/schedule', { ids: [1, 2, 3] });
      assert.equal(res.status, 207);

      const body = await res.json();
      assert.equal(body.success, 2);
      assert.equal(body.failed, 1);
      assert.deepEqual(
        body.results.map((r) => r.ok),
        [true, false, true],
      );
      assert.equal(body.results[1].error, 'Repliz menolak');
      assert.equal(jeda.length, 2, '3 id → 2 jeda antar kiriman');
    },
  );
});

test('bulk schedule gagal semua → 400', async () => {
  await withApp(
    {
      schedulePlan: async () => {
        throw new Error('Repliz mati');
      },
    },
    async ({ base }) => {
      const res = await postJson(base, '/api/pemasaran/repliz/schedule', { ids: [1, 2] });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).success, 0);
    },
  );
});

test('schedule per id meneruskan statusCode domain apa adanya', async () => {
  await withApp(
    {
      schedulePlan: async () => {
        const err = new Error('Rencana sudah dijadwalkan');
        err.statusCode = 409;
        throw err;
      },
    },
    async ({ base }) => {
      const res = await postJson(base, '/api/pemasaran/5/repliz/schedule', {});
      assert.equal(res.status, 409);
      assert.equal((await res.json()).error, 'Rencana sudah dijadwalkan');
    },
  );
});

test('retry memakai force: true, schedule biasa force: false', async () => {
  const calls = [];
  await withApp(
    {
      schedulePlan: async (id, pool, opts) => {
        calls.push(opts);
        return { plan: {}, repliz: {} };
      },
    },
    async ({ base }) => {
      await postJson(base, '/api/pemasaran/5/repliz/schedule', {});
      await postJson(base, '/api/pemasaran/5/repliz/retry', {});
      assert.deepEqual(calls, [{ force: false }, { force: true }]);
    },
  );
});

test('sync mengembalikan plan dan payload repliz', async () => {
  await withApp(
    { syncPlan: async () => ({ plan: { id: 5, repliz_status: 'published' }, repliz: { state: 'done' } }) },
    async ({ base }) => {
      const body = await (await postJson(base, '/api/pemasaran/5/repliz/sync', {})).json();
      assert.equal(body.plan.repliz_status, 'published');
      assert.deepEqual(body.repliz, { state: 'done' });
    },
  );
});

test('DELETE /api/pemasaran/:id → 404 bila tidak ada baris terhapus', async () => {
  await withApp({ dbPool: fakePool([]) }, async ({ base }) => {
    const res = await fetch(`${base}/api/pemasaran/9`, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });
});

test('error DB pada DELETE → 500 generik tanpa detail internal', async () => {
  await withApp({ dbPool: fakePool(new Error('deadlock pada tabel pemasaran')) }, async ({ base }) => {
    const res = await fetch(`${base}/api/pemasaran/9`, { method: 'DELETE' });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Gagal menghapus rencana');
    assert.doesNotMatch(JSON.stringify(body), /deadlock/);
  });
});
