import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRequestScheduleApproval,
  markPlansPendingApproval,
  rejectPlanSchedule,
} from '../lib/scheduleApproval.js';

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