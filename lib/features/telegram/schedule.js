import { schedulePlanToRepliz, schedulePlanToReplizNow } from '../pemasaran/domain.js';
import { isReplizConfigured } from '../../shared/repliz.js';

export async function getPlanById(id, dbPool) {
  if (!/^\d+$/.test(String(id || ''))) return null;
  const result = await dbPool.query('SELECT * FROM pemasaran WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function scheduleViaRepliz(
  ctx,
  id,
  {
    dbPool,
    postNow = false,
    force = false,
    replizConfigured = isReplizConfigured,
    schedule = schedulePlanToRepliz,
    scheduleNow = schedulePlanToReplizNow,
  } = {},
) {
  if (!/^\d+$/.test(String(id || '')))
    return ctx.reply('Format: /jadwalkan ID atau /postnow ID atau /retrypost ID');
  if (!replizConfigured())
    return ctx.reply(
      '⚠️ Repliz belum dikonfigurasi. Isi REPLIZ_API_KEY, REPLIZ_SECRET, dan REPLIZ_ACCOUNT_ID.',
    );
  const plan = await getPlanById(id, dbPool);
  if (!plan) return ctx.reply('Rencana konten tidak ditemukan.');
  if (plan.repliz_schedule_id && !postNow && !force) {
    return ctx.reply(
      `ℹ️ Konten #${id} sudah punya Repliz schedule id: ${plan.repliz_schedule_id}\nGunakan /cekpost ${id} untuk cek status.`,
    );
  }
  try {
    const result = postNow ? await scheduleNow(id, dbPool, { force }) : await schedule(id, dbPool, { force });
    const scheduleId = result.plan.repliz_schedule_id;
    return ctx.reply(
      `✅ Konten #${id} dikirim ke Repliz${postNow ? ' untuk post segera' : ''}.\nSchedule ID: ${scheduleId}`,
    );
  } catch (err) {
    return ctx.reply(`❌ Repliz gagal: ${err.message.slice(0, 500)}`);
  }
}
