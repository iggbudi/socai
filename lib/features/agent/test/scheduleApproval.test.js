import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRequestScheduleApproval,
  markPlansPendingApproval,
  notifyScheduleApprovalRequest,
  handlePostSaveApproval,
  approvePlanSchedule,
  rejectPlanSchedule,
} from '../approval.js';

describe('scheduleApproval', () => {
  const originalRequireApproval = process.env.REQUIRE_APPROVAL;

  afterEach(() => {
    if (originalRequireApproval === undefined) delete process.env.REQUIRE_APPROVAL;
    else process.env.REQUIRE_APPROVAL = originalRequireApproval;
  });

  it('requests approval only for bounded + REQUIRE_APPROVAL', () => {
    process.env.REQUIRE_APPROVAL = 'true';
    assert.equal(shouldRequestScheduleApproval('bounded'), true);
    assert.equal(shouldRequestScheduleApproval('supervised'), false);
    assert.equal(shouldRequestScheduleApproval('assistive'), false);
  });

  it('skips approval when REQUIRE_APPROVAL is false', () => {
    process.env.REQUIRE_APPROVAL = 'false';
    assert.equal(shouldRequestScheduleApproval('bounded'), false);
  });

  it('markPlansPendingApproval updates matching rows', async () => {
    const updates = [];
    const pool = {
      async query(sql, params) {
        if (String(sql).includes('UPDATE pemasaran')) {
          updates.push(params[0]);
          return {
            rows: params[0].map((id) => ({ id, judul: `Plan ${id}`, jadwal: 'Senin jam 19:00' })),
          };
        }
        return { rows: [] };
      },
    };
    const rows = await markPlansPendingApproval(pool, [1, 2]);
    assert.equal(rows.length, 2);
    assert.deepEqual(updates[0], [1, 2]);
  });

  it('notifyScheduleApprovalRequest sends one approve/reject keyboard per plan', async () => {
    const messages = [];
    const result = await notifyScheduleApprovalRequest(
      [
        { id: 11, judul: 'Batik Pesisir', jadwal: 'Senin jam 19:00' },
        { id: 12, judul: 'Batik Klasik', jadwal: 'Selasa jam 19:00' },
      ],
      {
        notify: async (text, options) => {
          messages.push({ text, options });
          return { sent: 1 };
        },
      },
    );

    assert.deepEqual(result, { sent: 2, plans: 2 });
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0].options.reply_markup.inline_keyboard[0], [
      { text: '✅ Jadwalkan', callback_data: 'approve_schedule:11' },
      { text: '❌ Batal', callback_data: 'reject_schedule:11' },
    ]);
    assert.deepEqual(messages[1].options.reply_markup.inline_keyboard[0], [
      { text: '✅ Jadwalkan', callback_data: 'approve_schedule:12' },
      { text: '❌ Batal', callback_data: 'reject_schedule:12' },
    ]);
  });

  it('notifyScheduleApprovalRequest skips empty plans without notifying', async () => {
    let notified = false;
    const result = await notifyScheduleApprovalRequest([], {
      notify: async () => {
        notified = true;
        return { sent: 1 };
      },
    });

    assert.deepEqual(result, { sent: 0, plans: 0 });
    assert.equal(notified, false);
  });

  it('handlePostSaveApproval skips assistive mode without touching the pool', async () => {
    process.env.REQUIRE_APPROVAL = 'true';
    let queried = false;
    const result = await handlePostSaveApproval(
      {
        async query() {
          queried = true;
          throw new Error('pool should not be queried');
        },
      },
      { ids: [1] },
      { autonomyMode: 'assistive' },
    );

    assert.deepEqual(result, { requested: false });
    assert.equal(queried, false);
  });

  it('handlePostSaveApproval marks bounded plans and forwards the notifier', async () => {
    process.env.REQUIRE_APPROVAL = 'true';
    const notified = [];
    const pool = {
      async query(sql, params) {
        assert.match(String(sql), /UPDATE pemasaran/);
        assert.deepEqual(params, [[21, 22]]);
        return {
          rows: [
            { id: 21, judul: 'Plan 21', jadwal: 'Rabu jam 19:00' },
            { id: 22, judul: 'Plan 22', jadwal: 'Kamis jam 19:00' },
          ],
        };
      },
    };

    const result = await handlePostSaveApproval(
      pool,
      { ids: [21, 22] },
      {
        autonomyMode: 'bounded',
        notify: async (text, options) => {
          notified.push({ text, options });
          return { sent: 1 };
        },
      },
    );

    assert.equal(result.requested, true);
    assert.equal(result.marked.length, 2);
    assert.deepEqual(result.notify, { sent: 2, plans: 2 });
    assert.equal(notified.length, 2);
  });

  it('handlePostSaveApproval skips plans already scheduled in Repliz', async () => {
    process.env.REQUIRE_APPROVAL = 'true';
    let notified = false;
    const result = await handlePostSaveApproval(
      {
        async query() {
          return { rows: [] };
        },
      },
      { ids: [31] },
      {
        autonomyMode: 'bounded',
        notify: async () => {
          notified = true;
          return { sent: 1 };
        },
      },
    );

    assert.deepEqual(result, { requested: false });
    assert.equal(notified, false);
  });

  it('approvePlanSchedule rejects non-positive or non-numeric ids', async () => {
    let queried = false;
    const pool = {
      async query() {
        queried = true;
        return { rows: [] };
      },
    };

    for (const invalidId of ['abc', 0, -1]) {
      await assert.rejects(approvePlanSchedule(pool, invalidId), (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      });
    }
    assert.equal(queried, false);
  });

  it('approvePlanSchedule returns 404 when the plan does not exist', async () => {
    const pool = { async query() { return { rows: [] }; } };
    await assert.rejects(approvePlanSchedule(pool, 41), (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });

  it('approvePlanSchedule returns 409 when the plan already has a Repliz id', async () => {
    const pool = {
      async query() {
        return { rows: [{ id: 42, status: 'pending_approval', repliz_schedule_id: 'repliz-42' }] };
      },
    };
    await assert.rejects(approvePlanSchedule(pool, 42), (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    });
  });

  it('approvePlanSchedule rejects published plans', async () => {
    const pool = {
      async query() {
        return { rows: [{ id: 43, status: 'published', repliz_schedule_id: null }] };
      },
    };
    await assert.rejects(approvePlanSchedule(pool, 43), (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });

  it('approvePlanSchedule schedules pending_approval plans with force false', async () => {
    const pool = {
      async query() {
        return { rows: [{ id: 44, status: 'pending_approval', repliz_schedule_id: null }] };
      },
    };
    const calls = [];
    const result = await approvePlanSchedule(pool, 44, {
      schedule: async (...args) => {
        calls.push(args);
        return { plan: { id: 44 }, repliz: { id: 'repliz-44' } };
      },
    });

    assert.deepEqual(result, { plan: { id: 44 }, repliz: { id: 'repliz-44' } });
    assert.deepEqual(calls, [[44, pool, { force: false }]]);
  });

  it('approvePlanSchedule also allows draft plans', async () => {
    const pool = {
      async query() {
        return { rows: [{ id: 45, status: 'draft', repliz_schedule_id: null }] };
      },
    };
    let called = false;
    await approvePlanSchedule(pool, 45, {
      schedule: async (id, dbPool, options) => {
        called = true;
        assert.equal(id, 45);
        assert.equal(dbPool, pool);
        assert.deepEqual(options, { force: false });
        return { plan: { id } };
      },
    });
    assert.equal(called, true);
  });

  it('rejectPlanSchedule returns 404 when no pending row matches', async () => {
    const pool = { async query() { return { rows: [] }; } };
    await assert.rejects(rejectPlanSchedule(pool, 46), (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });

  it('rejectPlanSchedule cancels pending_approval row', async () => {
    const pool = {
      async query(sql, params) {
        if (String(sql).includes('status = \'cancelled\'')) {
          return { rows: [{ id: params[0], status: 'cancelled' }] };
        }
        return { rows: [] };
      },
    };
    const row = await rejectPlanSchedule(pool, 5);
    assert.equal(row.status, 'cancelled');
  });
});
