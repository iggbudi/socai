import { schedulePlanToRepliz, syncPlanReplizStatus } from '../pemasaran.js';
import { checkSchedulePolicy, checkSyncPolicy } from './policy.js';

export async function scheduleContent(dbPool, context, { pemasaran_id, force = false } = {}) {
  const planId = Number(pemasaran_id);
  if (!Number.isFinite(planId) || planId <= 0) {
    throw new Error('pemasaran_id wajib berupa angka positif.');
  }

  const policy = checkSchedulePolicy({
    autonomyMode: context?.autonomyMode,
    schedulesToday: context?.schedulesToday ?? 0,
  });

  if (!policy.allowed) {
    const err = new Error(policy.reason);
    err.policyDenied = true;
    throw err;
  }

  try {
    const result = await schedulePlanToRepliz(planId, dbPool, { force: Boolean(force) });
    const plan = result.plan || result;
    return {
      pemasaran_id: plan.id ?? planId,
      repliz_schedule_id: plan.repliz_schedule_id ?? null,
      repliz_status: plan.repliz_status ?? 'pending',
      plan,
    };
  } catch (err) {
    const wrapped = new Error(err.message || 'Gagal menjadwalkan konten ke Repliz.');
    wrapped.statusCode = err.statusCode;
    wrapped.cause = err;
    throw wrapped;
  }
}

export async function syncContentStatus(dbPool, context, { pemasaran_id } = {}) {
  const planId = Number(pemasaran_id);
  if (!Number.isFinite(planId) || planId <= 0) {
    throw new Error('pemasaran_id wajib berupa angka positif.');
  }

  const policy = checkSyncPolicy();
  if (!policy.allowed) {
    const err = new Error('sync_content_status tidak diizinkan oleh policy.');
    err.policyDenied = true;
    throw err;
  }

  try {
    const result = await syncPlanReplizStatus(planId, dbPool);
    const plan = result.plan || result;
    return {
      pemasaran_id: plan.id ?? planId,
      repliz_status: plan.repliz_status ?? plan.external_status ?? null,
      status: plan.status ?? null,
      plan,
      repliz: result.repliz ?? null,
    };
  } catch (err) {
    const wrapped = new Error(err.message || 'Gagal sinkronisasi status Repliz.');
    wrapped.statusCode = err.statusCode;
    wrapped.cause = err;
    throw wrapped;
  }
}