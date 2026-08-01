import { replyLong } from '../helpers.js';
import { fmtPlan } from '../helpers/format.js';
import { requireTelegramRole } from './akses.js';

export function registerScheduleCommands(
  bot,
  {
    dbPool,
    access,
    isReplizConfigured,
    schedulePlanToRepliz,
    schedulePlanToReplizNow,
    syncPlanReplizStatus,
    approvePlanSchedule,
    rejectPlanSchedule,
    scheduleViaRepliz,
  },
) {
  bot.action(/^approve_schedule:(\d+)$/, async (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    const id = ctx.match[1];
    await ctx.answerCbQuery('⏳ Menjadwalkan...');
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) {}
    try {
      const result = await approvePlanSchedule(dbPool, id);
      const status = result?.plan?.repliz_status || result?.repliz_status || 'scheduled';
      await ctx.reply(`✅ Rencana #${id} dijadwalkan ke Repliz.\nStatus: ${status}`);
    } catch (err) {
      await ctx.reply(`❌ Gagal menjadwalkan #${id}: ${err.message.slice(0, 500)}`);
    }
  });

  bot.action(/^reject_schedule:(\d+)$/, async (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    const id = ctx.match[1];
    await ctx.answerCbQuery('Dibatalkan');
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) {}
    try {
      await rejectPlanSchedule(dbPool, id);
      await ctx.reply(`❌ Rencana #${id} dibatalkan (status: cancelled).`);
    } catch (err) {
      await ctx.answerCbQuery(`❌ ${err.message.slice(0, 180)}`).catch(() => {});
      await ctx.reply(`❌ Gagal membatalkan #${id}: ${err.message.slice(0, 500)}`);
    }
  });

  bot.command('jadwalkonten', async (ctx) => {
    const scope = (ctx.message.text.split(/\s+/)[1] || 'minggu').toLowerCase();
    const limit = scope === 'bulan' ? 30 : scope === 'hariini' || scope === 'hari' ? 10 : 20;
    const result = await dbPool.query(
      `SELECT * FROM pemasaran
       WHERE lower(coalesce(kanal, 'threads')) = 'threads'
       ORDER BY coalesce(scheduled_at, created_at) ASC, id ASC
       LIMIT $1`,
      [limit],
    );
    if (!result.rows.length) return ctx.reply('Belum ada rencana konten.');
    return replyLong(ctx, '📅 Kalender konten:\n\n' + result.rows.map(fmtPlan).join('\n\n'));
  });

  bot.command('statuskonten', async (ctx) => {
    const status = (ctx.message.text.split(/\s+/)[1] || 'scheduled').toLowerCase();
    const allowed = new Set(['draft', 'scheduled', 'posting', 'posted', 'failed', 'cancelled']);
    if (!allowed.has(status))
      return ctx.reply(
        'Status valid: draft, scheduled, posting, posted, failed, cancelled.\nContoh: /statuskonten draft',
      );
    const result = await dbPool.query(
      'SELECT * FROM pemasaran WHERE lower(coalesce(status, $1)) = $1 ORDER BY created_at DESC, id DESC LIMIT 20',
      [status],
    );
    if (!result.rows.length) return ctx.reply(`Tidak ada konten berstatus ${status}.`);
    return replyLong(ctx, `📌 Konten status ${status}:\n\n` + result.rows.map(fmtPlan).join('\n\n'));
  });

  bot.command('ubahstatuskonten', async (ctx) => {
    if (!requireTelegramRole(ctx, 'super_admin', access)) return;
    const [, id, status] = ctx.message.text.trim().split(/\s+/);
    const allowed = new Set(['draft', 'scheduled', 'posting', 'posted', 'failed', 'cancelled']);
    if (!/^\d+$/.test(String(id || '')) || !allowed.has((status || '').toLowerCase()))
      return ctx.reply(
        'Format: /ubahstatuskonten ID status\nStatus: draft, scheduled, posting, posted, failed, cancelled',
      );
    const result = await dbPool.query('UPDATE pemasaran SET status = $2 WHERE id = $1 RETURNING *', [
      id,
      status.toLowerCase(),
    ]);
    if (!result.rows.length) return ctx.reply('Rencana konten tidak ditemukan.');
    return ctx.reply('✅ Status diperbarui:\n\n' + fmtPlan(result.rows[0]));
  });

  bot.command('hapuskonten', async (ctx) => {
    if (!requireTelegramRole(ctx, 'super_admin', access)) return;
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts[1] !== 'HAPUS' || !/^\d+$/.test(String(parts[2] || '')))
      return ctx.reply(
        'Konfirmasi ganda diperlukan. Format: /hapuskonten HAPUS ID\nContoh: /hapuskonten HAPUS 12',
      );
    const result = await dbPool.query('DELETE FROM pemasaran WHERE id = $1 RETURNING id, judul', [parts[2]]);
    if (!result.rows.length) return ctx.reply('Rencana konten tidak ditemukan.');
    return ctx.reply(`✅ Rencana #${result.rows[0].id} dihapus: ${result.rows[0].judul || '-'}`);
  });

  bot.command('jadwalkan', (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    return scheduleViaRepliz(ctx, ctx.message.text.trim().split(/\s+/)[1], {
      dbPool,
      replizConfigured: isReplizConfigured,
      schedule: schedulePlanToRepliz,
      scheduleNow: schedulePlanToReplizNow,
      postNow: false,
      force: false,
    });
  });
  bot.command('postnow', (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    return scheduleViaRepliz(ctx, ctx.message.text.trim().split(/\s+/)[1], {
      dbPool,
      replizConfigured: isReplizConfigured,
      schedule: schedulePlanToRepliz,
      scheduleNow: schedulePlanToReplizNow,
      postNow: true,
      force: false,
    });
  });
  bot.command('retrypost', (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    return scheduleViaRepliz(ctx, ctx.message.text.trim().split(/\s+/)[1], {
      dbPool,
      replizConfigured: isReplizConfigured,
      schedule: schedulePlanToRepliz,
      scheduleNow: schedulePlanToReplizNow,
      postNow: false,
      force: true,
    });
  });
  bot.command('cekpost', async (ctx) => {
    const id = ctx.message.text.trim().split(/\s+/)[1];
    if (!/^\d+$/.test(String(id || ''))) return ctx.reply('Format: /cekpost ID');
    try {
      const result = await syncPlanReplizStatus(id, dbPool);
      return ctx.reply(
        `📡 Status Repliz #${id}\n\nSchedule ID: ${result.plan.repliz_schedule_id}\nStatus Repliz: ${result.plan.repliz_status}\nStatus lokal: ${result.plan.status}`,
      );
    } catch (err) {
      return ctx.reply(`❌ Gagal cek status: ${err.message.slice(0, 500)}`);
    }
  });
}
