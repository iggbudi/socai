/**
 * S29 (C1) — aktuator schedule_content / sync_content_status.
 * Ini gerbang tempat agent menyentuh dunia luar, jadi yang diuji adalah
 * validasi input, penolakan policy, dan pembungkusan error — bukan Repliz-nya.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleContent, syncContentStatus } from '../actuator/schedule.js';

const dbPool = { query: async () => ({ rows: [] }) };
const bounded = { autonomyMode: 'bounded', schedulesToday: 0 };

function withEnv(overrides, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('scheduleContent menolak pemasaran_id yang bukan angka positif', async () => {
  for (const id of [undefined, 'abc', 0, -3, Number.NaN]) {
    await assert.rejects(
      () => scheduleContent(dbPool, bounded, { pemasaran_id: id }, { schedulePlan: async () => ({}) }),
      /pemasaran_id wajib berupa angka positif/,
      `id ${String(id)} seharusnya ditolak`,
    );
  }
});

test('scheduleContent diblokir di mode non-bounded dan ditandai policyDenied', async () => {
  let dipanggil = false;
  const schedulePlan = async () => {
    dipanggil = true;
  };

  await withEnv({ REQUIRE_APPROVAL: 'false' }, async () => {
    const err = await scheduleContent(
      dbPool,
      { autonomyMode: 'assistive' },
      { pemasaran_id: 5 },
      { schedulePlan },
    ).catch((e) => e);

    assert.equal(err.policyDenied, true);
    assert.match(err.message, /Mode assistive/);
  });

  assert.equal(dipanggil, false, 'penjadwalan tidak boleh dieksekusi saat policy menolak');
});

test('scheduleContent diblokir saat REQUIRE_APPROVAL aktif meski mode bounded', async () => {
  await withEnv({ REQUIRE_APPROVAL: 'true' }, async () => {
    const err = await scheduleContent(
      dbPool,
      bounded,
      { pemasaran_id: 5 },
      { schedulePlan: async () => ({}) },
    ).catch((e) => e);

    assert.equal(err.policyDenied, true);
    assert.match(err.message, /REQUIRE_APPROVAL aktif/);
  });
});

test('scheduleContent diblokir saat kuota harian tercapai', async () => {
  await withEnv({ REQUIRE_APPROVAL: 'false', MAX_AGENT_SCHEDULES_PER_DAY: '2' }, async () => {
    const err = await scheduleContent(
      dbPool,
      { autonomyMode: 'bounded', schedulesToday: 2 },
      { pemasaran_id: 5 },
      { schedulePlan: async () => ({}) },
    ).catch((e) => e);

    assert.equal(err.policyDenied, true);
    assert.match(err.message, /Batas jadwal agent per hari \(2\)/);
  });
});

test('scheduleContent sukses memetakan hasil dan meneruskan force', async () => {
  const calls = [];
  const schedulePlan = async (planId, pool, opts) => {
    calls.push({ planId, pool, opts });
    return { plan: { id: 9, repliz_schedule_id: 'sch-1', repliz_status: 'scheduled' } };
  };

  const result = await withEnv({ REQUIRE_APPROVAL: 'false', MAX_AGENT_SCHEDULES_PER_DAY: '10' }, () =>
    scheduleContent(dbPool, bounded, { pemasaran_id: '9', force: true }, { schedulePlan }),
  );

  assert.deepEqual(calls[0].opts, { force: true });
  assert.equal(calls[0].planId, 9);
  assert.equal(calls[0].pool, dbPool);
  assert.equal(result.pemasaran_id, 9);
  assert.equal(result.repliz_schedule_id, 'sch-1');
  assert.equal(result.repliz_status, 'scheduled');
});

test('scheduleContent memberi default aman saat domain mengembalikan plan minimal', async () => {
  const result = await withEnv({ REQUIRE_APPROVAL: 'false', MAX_AGENT_SCHEDULES_PER_DAY: '10' }, () =>
    scheduleContent(dbPool, bounded, { pemasaran_id: 4 }, { schedulePlan: async () => ({}) }),
  );

  assert.equal(result.pemasaran_id, 4);
  assert.equal(result.repliz_schedule_id, null);
  assert.equal(result.repliz_status, 'pending');
});

test('scheduleContent membungkus error domain sambil mempertahankan statusCode dan cause', async () => {
  const asli = new Error('Repliz menolak jadwal');
  asli.statusCode = 422;

  const err = await withEnv({ REQUIRE_APPROVAL: 'false', MAX_AGENT_SCHEDULES_PER_DAY: '10' }, () =>
    scheduleContent(
      dbPool,
      bounded,
      { pemasaran_id: 4 },
      {
        schedulePlan: async () => {
          throw asli;
        },
      },
    ).catch((e) => e),
  );

  assert.equal(err.message, 'Repliz menolak jadwal');
  assert.equal(err.statusCode, 422);
  assert.equal(err.cause, asli);
  assert.notEqual(err.policyDenied, true);
});

test('syncContentStatus menolak pemasaran_id tidak valid', async () => {
  await assert.rejects(
    () => syncContentStatus(dbPool, {}, { pemasaran_id: 'x' }, { syncPlan: async () => ({}) }),
    /pemasaran_id wajib berupa angka positif/,
  );
});

test('syncContentStatus memetakan status dan payload repliz', async () => {
  const result = await syncContentStatus(
    dbPool,
    {},
    { pemasaran_id: 12 },
    {
      syncPlan: async () => ({
        plan: { id: 12, repliz_status: 'published', status: 'posted' },
        repliz: { state: 'done' },
      }),
    },
  );

  assert.equal(result.pemasaran_id, 12);
  assert.equal(result.repliz_status, 'published');
  assert.equal(result.status, 'posted');
  assert.deepEqual(result.repliz, { state: 'done' });
});

test('syncContentStatus jatuh ke external_status saat repliz_status kosong', async () => {
  const result = await syncContentStatus(
    dbPool,
    {},
    { pemasaran_id: 12 },
    { syncPlan: async () => ({ plan: { id: 12, external_status: 'processing' } }) },
  );

  assert.equal(result.repliz_status, 'processing');
  assert.equal(result.status, null);
  assert.equal(result.repliz, null);
});

test('syncContentStatus membungkus error domain dengan cause', async () => {
  const asli = new Error('Repliz timeout');
  asli.statusCode = 504;

  const err = await syncContentStatus(
    dbPool,
    {},
    { pemasaran_id: 12 },
    {
      syncPlan: async () => {
        throw asli;
      },
    },
  ).catch((e) => e);

  assert.equal(err.message, 'Repliz timeout');
  assert.equal(err.statusCode, 504);
  assert.equal(err.cause, asli);
});
