import { pool, aiReadPool } from '../../shared/db.js';
import { isReplizConfigured } from '../../shared/repliz.js';
import { parseMarketingSchedule, schedulePlanToRepliz, syncPlanReplizStatus } from './domain.js';
import { refreshPublishFeedback } from '../../features/agent/publishFeedback.js';
import { getEnabledChannelIds, isChannelSchedulable } from '../channels/index.js';
import { childLogger } from '../../shared/logger.js';

export const replizAutoScheduleLimit = Number(process.env.REPLIZ_AUTO_SCHEDULE_LIMIT || 3);
export const replizAutoScheduleLeadMs = Number(process.env.REPLIZ_AUTO_SCHEDULE_LEAD_MS || 15 * 60 * 1000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBulkDelayMs = () => 3000 + Math.floor(Math.random() * 2001); // 3-5 detik
const log = childLogger('pemasaran.jobs');

export { sleep, randomBulkDelayMs };

export async function syncPendingReplizStatuses({ limit = 20 } = {}) {
  if (!isReplizConfigured()) return { skipped: true, reason: 'repliz_not_configured', synced: 0, failed: 0 };
  const result = await pool.query(
    `SELECT id FROM pemasaran
     WHERE repliz_schedule_id IS NOT NULL
       AND lower(coalesce(repliz_status, 'pending')) IN ('pending', 'process', 'scheduled', 'syncing')
     ORDER BY coalesce(repliz_synced_at, created_at) ASC
     LIMIT $1`,
    [limit],
  );
  let synced = 0;
  let failed = 0;
  for (const row of result.rows) {
    try {
      await syncPlanReplizStatus(row.id, pool);
      synced++;
    } catch (err) {
      failed++;
      log.error({ err, pemasaranId: row.id }, 'Repliz auto sync failed');
    }
  }
  if (synced > 0) {
    await refreshPublishFeedback(aiReadPool).catch((err) => {
      log.error({ err }, 'Publish feedback refresh after sync failed');
    });
  }
  return { skipped: false, synced, failed };
}

export async function autoSchedulePendingRepliz({ limit = replizAutoScheduleLimit } = {}) {
  if (!isReplizConfigured())
    return { skipped: true, reason: 'repliz_not_configured', scheduled: 0, failed: 0 };

  const enabledChannels = getEnabledChannelIds().filter((id) => {
    try {
      return isChannelSchedulable(id);
    } catch {
      return false;
    }
  });
  if (enabledChannels.length === 0) {
    return { skipped: true, reason: 'no_schedulable_channels', scheduled: 0, failed: 0 };
  }

  const candidateLimit = Math.max(Number(limit) * 10, 20);
  const candidates = await pool.query(
    `SELECT * FROM pemasaran
     WHERE repliz_schedule_id IS NULL
       AND coalesce(auto_schedule_enabled, true) = true
       AND lower(coalesce(kanal, '')) = ANY($2::text[])
       AND nullif(trim(coalesce(nullif(copywriting, ''), nullif(strategi, ''), '')), '') IS NOT NULL
       AND lower(coalesce(repliz_status, '')) NOT IN ('syncing')
       AND lower(coalesce(status, 'draft')) NOT IN ('published', 'posted', 'cancelled', 'canceled', 'pending_approval')
     ORDER BY coalesce(scheduled_at, created_at) ASC, id ASC
     LIMIT $1`,
    [candidateLimit, enabledChannels],
  );

  const now = Date.now();
  const ready = candidates.rows
    .map((plan) => ({ plan, scheduledAt: parseMarketingSchedule(plan) }))
    .filter(({ scheduledAt }) => scheduledAt && scheduledAt.getTime() > now + replizAutoScheduleLeadMs)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .slice(0, Math.max(Number(limit) || 0, 0));

  let scheduled = 0;
  let failed = 0;
  for (const [index, item] of ready.entries()) {
    try {
      await schedulePlanToRepliz(item.plan.id, pool, { force: false });
      scheduled++;
      log.info(
        { pemasaranId: item.plan.id, scheduledAt: item.scheduledAt.toISOString() },
        'Repliz auto scheduled pemasaran',
      );
    } catch (err) {
      failed++;
      log.error({ err, pemasaranId: item.plan.id }, 'Repliz auto schedule failed');
    }

    if (index < ready.length - 1) {
      const delayMs = randomBulkDelayMs();
      log.info({ delayMs }, 'Repliz auto schedule delay');
      await sleep(delayMs);
    }
  }

  return { skipped: false, scheduled, failed, candidates: candidates.rows.length, ready: ready.length };
}
