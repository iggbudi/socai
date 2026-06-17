import { schedulePlanToRepliz } from './pemasaran.js';
import { getAutonomyConfig } from './actuator/policy.js';
import { notifyTelegramOperators } from './telegramNotify.js';

export function shouldRequestScheduleApproval(autonomyMode) {
  const config = getAutonomyConfig();
  return config.requireApproval && autonomyMode === 'bounded';
}

export async function markPlansPendingApproval(dbPool, planIds) {
  const ids = (planIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return [];
  const result = await dbPool.query(
    `UPDATE pemasaran
     SET status = 'pending_approval'
     WHERE id = ANY($1::int[])
       AND repliz_schedule_id IS NULL
     RETURNING id, judul, jadwal, copywriting`,
    [ids],
  );
  return result.rows;
}

export async function notifyScheduleApprovalRequest(plans) {
  if (!plans?.length) return { sent: 0, plans: 0 };

  let sent = 0;
  for (const plan of plans) {
    const text = `📋 Rencana #${plan.id}\n${plan.judul || '-'}\n📅 ${plan.jadwal || '-'}\n\nSetujui penjadwalan ke Repliz?`;
    const result = await notifyTelegramOperators(text, {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Jadwalkan', callback_data: `approve_schedule:${plan.id}` },
          { text: '❌ Batal', callback_data: `reject_schedule:${plan.id}` },
        ]],
      },
    });
    sent += result.sent || 0;
  }

  return { sent, plans: plans.length };
}

export async function handlePostSaveApproval(dbPool, { ids = [] } = {}, { autonomyMode } = {}) {
  if (!shouldRequestScheduleApproval(autonomyMode)) {
    return { requested: false };
  }
  const marked = await markPlansPendingApproval(dbPool, ids);
  if (marked.length === 0) return { requested: false };
  const notify = await notifyScheduleApprovalRequest(marked);
  return { requested: true, marked, notify };
}

export async function approvePlanSchedule(dbPool, planId) {
  const id = Number(planId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('ID rencana tidak valid.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await dbPool.query('SELECT * FROM pemasaran WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    const err = new Error('Rencana tidak ditemukan.');
    err.statusCode = 404;
    throw err;
  }

  const plan = existing.rows[0];
  if (plan.repliz_schedule_id) {
    const err = new Error('Rencana sudah dijadwalkan ke Repliz.');
    err.statusCode = 409;
    throw err;
  }

  if (plan.status !== 'pending_approval' && plan.status !== 'draft') {
    const err = new Error(`Rencana berstatus ${plan.status}; tidak bisa dijadwalkan via approval.`);
    err.statusCode = 400;
    throw err;
  }

  return schedulePlanToRepliz(id, dbPool, { force: false });
}

export async function rejectPlanSchedule(dbPool, planId) {
  const id = Number(planId);
  const result = await dbPool.query(
    `UPDATE pemasaran
     SET status = 'cancelled'
     WHERE id = $1
       AND status = 'pending_approval'
       AND repliz_schedule_id IS NULL
     RETURNING *`,
    [id],
  );
  if (result.rows.length === 0) {
    const err = new Error('Rencana tidak ditemukan atau bukan pending approval.');
    err.statusCode = 404;
    throw err;
  }
  return result.rows[0];
}