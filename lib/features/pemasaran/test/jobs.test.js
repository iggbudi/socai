/**
 * S29 (C1) — cron background Repliz (sync + auto schedule).
 * Semua dependensi eksternal di-inject; tidak ada DB, jaringan, atau sleep nyata.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncPendingReplizStatuses, autoSchedulePendingRepliz } from '../jobs.js';

const NOW = Date.UTC(2026, 7, 2, 0, 0, 0);
const nowFn = () => NOW;
const menit = 60 * 1000;

/** Plan dengan jadwal relatif terhadap NOW. */
function plan(id, offsetMs, extra = {}) {
  return { id, kanal: 'threads', scheduled_at: new Date(NOW + offsetMs).toISOString(), ...extra };
}

function poolWith(rows) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows };
    },
  };
}

test('syncPendingReplizStatuses dilewati saat Repliz belum dikonfigurasi', async () => {
  const dbPool = poolWith([]);
  const result = await syncPendingReplizStatuses({ replizConfigured: () => false, dbPool });

  assert.deepEqual(result, { skipped: true, reason: 'repliz_not_configured', synced: 0, failed: 0 });
  assert.equal(dbPool.queries.length, 0, 'tidak boleh menyentuh DB saat dilewati');
});

test('syncPendingReplizStatuses menghitung sukses dan gagal secara terpisah', async () => {
  const disinkron = [];
  const result = await syncPendingReplizStatuses({
    limit: 5,
    dbPool: poolWith([{ id: 1 }, { id: 2 }, { id: 3 }]),
    replizConfigured: () => true,
    refreshFeedback: async () => {},
    syncPlan: async (id) => {
      if (id === 2) throw new Error('repliz 500');
      disinkron.push(id);
    },
  });

  assert.deepEqual(result, { skipped: false, synced: 2, failed: 1 });
  assert.deepEqual(disinkron, [1, 3], 'satu kegagalan tidak boleh menghentikan sisanya');
});

test('syncPendingReplizStatuses meneruskan limit ke query', async () => {
  const dbPool = poolWith([]);
  await syncPendingReplizStatuses({
    limit: 7,
    dbPool,
    replizConfigured: () => true,
    syncPlan: async () => {},
    refreshFeedback: async () => {},
  });

  assert.deepEqual(dbPool.queries[0].params, [7]);
});

test('publish feedback hanya di-refresh bila ada yang tersinkron', async () => {
  let refreshCount = 0;
  const refreshFeedback = async () => {
    refreshCount++;
  };
  const common = { replizConfigured: () => true, refreshFeedback };

  await syncPendingReplizStatuses({
    ...common,
    dbPool: poolWith([{ id: 1 }]),
    syncPlan: async () => {
      throw new Error('gagal');
    },
  });
  assert.equal(refreshCount, 0, 'tidak ada yang sukses → tidak perlu refresh');

  await syncPendingReplizStatuses({
    ...common,
    dbPool: poolWith([{ id: 1 }]),
    syncPlan: async () => {},
  });
  assert.equal(refreshCount, 1);
});

test('refresh feedback yang gagal tidak menggagalkan job sync', async () => {
  const result = await syncPendingReplizStatuses({
    dbPool: poolWith([{ id: 1 }]),
    replizConfigured: () => true,
    syncPlan: async () => {},
    refreshFeedback: async () => {
      throw new Error('ai pool mati');
    },
  });

  assert.deepEqual(result, { skipped: false, synced: 1, failed: 0 });
});

test('autoSchedule dilewati saat Repliz belum dikonfigurasi', async () => {
  const result = await autoSchedulePendingRepliz({ replizConfigured: () => false });
  assert.deepEqual(result, { skipped: true, reason: 'repliz_not_configured', scheduled: 0, failed: 0 });
});

test('autoSchedule dilewati saat tak ada kanal yang bisa dijadwalkan', async () => {
  const dbPool = poolWith([]);
  const result = await autoSchedulePendingRepliz({
    dbPool,
    replizConfigured: () => true,
    listChannelIds: () => ['threads', 'instagram'],
    channelSchedulable: () => false,
  });

  assert.deepEqual(result, { skipped: true, reason: 'no_schedulable_channels', scheduled: 0, failed: 0 });
  assert.equal(dbPool.queries.length, 0);
});

test('kanal yang melempar error saat dicek dianggap tidak schedulable', async () => {
  const result = await autoSchedulePendingRepliz({
    dbPool: poolWith([]),
    replizConfigured: () => true,
    listChannelIds: () => ['rusak'],
    channelSchedulable: () => {
      throw new Error('adapter tidak terdaftar');
    },
  });

  assert.equal(result.reason, 'no_schedulable_channels');
});

test('autoSchedule melewati jadwal yang lebih dekat dari lead time', async () => {
  const dijadwalkan = [];
  const result = await autoSchedulePendingRepliz({
    limit: 5,
    nowFn,
    leadMs: 15 * menit,
    dbPool: poolWith([plan(1, 5 * menit), plan(2, 60 * menit), plan(3, -30 * menit)]),
    replizConfigured: () => true,
    listChannelIds: () => ['threads'],
    channelSchedulable: () => true,
    schedulePlan: async (id) => dijadwalkan.push(id),
    sleepFn: async () => {},
  });

  assert.deepEqual(dijadwalkan, [2], 'hanya jadwal di luar lead time yang diambil');
  assert.equal(result.candidates, 3);
  assert.equal(result.ready, 1);
  assert.equal(result.scheduled, 1);
});

test('autoSchedule mengurutkan menaik dan menghormati limit', async () => {
  const dijadwalkan = [];
  const result = await autoSchedulePendingRepliz({
    limit: 2,
    nowFn,
    leadMs: 15 * menit,
    dbPool: poolWith([plan(1, 180 * menit), plan(2, 30 * menit), plan(3, 90 * menit)]),
    replizConfigured: () => true,
    listChannelIds: () => ['threads'],
    channelSchedulable: () => true,
    schedulePlan: async (id) => dijadwalkan.push(id),
    sleepFn: async () => {},
  });

  assert.deepEqual(dijadwalkan, [2, 3], 'yang paling dekat duluan, dipotong pada limit');
  assert.equal(result.ready, 2);
});

test('autoSchedule memberi jeda antar kiriman kecuali pada item terakhir', async () => {
  const jeda = [];
  await autoSchedulePendingRepliz({
    limit: 3,
    nowFn,
    leadMs: 15 * menit,
    dbPool: poolWith([plan(1, 30 * menit), plan(2, 60 * menit), plan(3, 90 * menit)]),
    replizConfigured: () => true,
    listChannelIds: () => ['threads'],
    channelSchedulable: () => true,
    schedulePlan: async () => {},
    sleepFn: async (ms) => jeda.push(ms),
  });

  assert.equal(jeda.length, 2, '3 item → 2 jeda');
  for (const ms of jeda) {
    assert.ok(ms >= 3000 && ms <= 5000, `jeda ${ms}ms harus di rentang 3-5 detik`);
  }
});

test('autoSchedule menghitung kegagalan tanpa berhenti', async () => {
  const result = await autoSchedulePendingRepliz({
    limit: 3,
    nowFn,
    leadMs: 15 * menit,
    dbPool: poolWith([plan(1, 30 * menit), plan(2, 60 * menit)]),
    replizConfigured: () => true,
    listChannelIds: () => ['threads'],
    channelSchedulable: () => true,
    sleepFn: async () => {},
    schedulePlan: async (id) => {
      if (id === 1) throw new Error('repliz menolak');
    },
  });

  assert.equal(result.scheduled, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, false);
});

test('autoSchedule meneruskan kanal aktif dan candidate limit ke query', async () => {
  const dbPool = poolWith([]);
  await autoSchedulePendingRepliz({
    limit: 3,
    dbPool,
    replizConfigured: () => true,
    listChannelIds: () => ['threads', 'instagram'],
    channelSchedulable: (id) => id === 'threads',
    schedulePlan: async () => {},
    sleepFn: async () => {},
  });

  // candidateLimit = max(limit * 10, 20) = 30
  assert.deepEqual(dbPool.queries[0].params, [30, ['threads']]);
});
