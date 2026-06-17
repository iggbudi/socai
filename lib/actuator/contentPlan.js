import { savePlansToDb } from '../pemasaran.js';
import { checkSavePolicy } from './policy.js';

export async function saveContentPlan(dbPool, context, { plans } = {}) {
  const planList = Array.isArray(plans) ? plans : [];
  if (planList.length === 0) {
    throw new Error('plans wajib berupa array berisi minimal 1 rencana konten.');
  }

  const policy = checkSavePolicy({
    autonomyMode: context?.autonomyMode,
    savesInRun: context?.plans_saved ?? 0,
    planCount: planList.length,
  });

  if (!policy.allowed) {
    const err = new Error(policy.reason);
    err.policyDenied = true;
    throw err;
  }

  try {
    const saved = await savePlansToDb(planList, dbPool);
    return {
      saved_count: saved.length,
      ids: saved.map((row) => row.id),
      errors: [],
      plans: saved,
    };
  } catch (err) {
    const wrapped = new Error(err.message || 'Gagal menyimpan rencana konten.');
    wrapped.cause = err;
    throw wrapped;
  }
}