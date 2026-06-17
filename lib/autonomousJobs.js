import { getCalendarGaps } from './actuator/calendar.js';
import { runAgentTask, CRON_WEEKLY_SESSION_KEY } from './agentRunner.js';
import { purgeOldAgentRuns } from './agentRuns.js';
import { refreshPublishFeedback } from './publishFeedback.js';
import {
  autoPlanCronIntervalMs,
  autoPlanMinGaps,
  agentRunsPurgeIntervalMs,
} from './autonomousConfig.js';

export { autoPlanCronIntervalMs, autoPlanMinGaps, agentRunsPurgeIntervalMs, getAutonomousJobConfig } from './autonomousConfig.js';

const WEEKLY_PLAN_PROMPT = `Tugas cron otomatis: isi kalender konten Threads mingguan untuk Batik Bakaran.

Langkah wajib:
1. Panggil tool get_calendar_gaps (days_ahead=7, preferred_hour=19).
2. Buat rencana konten hanya untuk slot kosong yang ditemukan (maks 7 item).
3. Cek produk via db_query jika perlu.
4. Simpan semua rencana dengan save_content_plan (jangan schedule_content — approval operator jika REQUIRE_APPROVAL aktif).
5. Akhiri dengan ringkasan singkat berapa rencana tersimpan.

Jangan membuat jadwal di luar slot kosong. Semua kanal threads.`;

export async function shouldGenerateWeeklyPlans(readPool) {
  const { aiReadPool } = await import('./agent.js');
  const pool = readPool || aiReadPool;
  const gaps = await getCalendarGaps(pool, { days_ahead: 7, preferred_hour: 19 });
  const minGaps = Math.max(Number(autoPlanMinGaps) || 1, 1);
  return {
    shouldRun: gaps.gaps.length >= minGaps,
    gapCount: gaps.gaps.length,
    minGaps,
    gaps: gaps.gaps,
  };
}

export async function generateWeeklyPlans() {
  const check = await shouldGenerateWeeklyPlans();
  if (!check.shouldRun) {
    return {
      skipped: true,
      reason: 'enough_coverage',
      gapCount: check.gapCount,
      minGaps: check.minGaps,
    };
  }

  const cronMode = (process.env.AUTO_PLAN_CRON_AUTONOMY_MODE || 'supervised').trim().toLowerCase();
  if (cronMode === 'assistive') {
    return { skipped: true, reason: 'assistive_mode_disabled_for_cron' };
  }

  console.log(`[AutoPlan] Starting weekly plan cron (gaps=${check.gapCount}, mode=${cronMode})`);

  const result = await runAgentTask({
    sessionKey: CRON_WEEKLY_SESSION_KEY,
    source: 'cron',
    triggerType: 'cron',
    prompt: WEEKLY_PLAN_PROMPT,
    autonomyMode: cronMode,
    modelRef: process.env.AI_MODEL || null,
    resetSession: true,
  });

  return {
    skipped: false,
    gapCount: check.gapCount,
    autonomyMode: cronMode,
    ...result,
  };
}

export async function runPublishFeedbackRefresh() {
  try {
    const { aiReadPool } = await import('./agent.js');
    const summary = await refreshPublishFeedback(aiReadPool);
    return { ok: true, summary };
  } catch (err) {
    console.error('[PublishFeedback] Refresh error:', err.message);
    return { ok: false, error: err.message };
  }
}

export async function runAgentRunsPurge() {
  const retainDays = Number(process.env.AGENT_RUNS_RETAIN_DAYS) || 90;
  try {
    const { pool } = await import('./agent.js');
    const deleted = await purgeOldAgentRuns(pool, { retainDays });
    if (deleted > 0) {
      console.log(`[AgentRuns] Purged ${deleted} rows older than ${retainDays} days`);
    }
    return { deleted, retainDays };
  } catch (err) {
    console.error('[AgentRuns] Purge error:', err.message);
    return { deleted: 0, error: err.message };
  }
}

