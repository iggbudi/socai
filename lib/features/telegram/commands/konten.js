import { requireTelegramRole } from './akses.js';
import { startContentWizard } from '../wizards/konten.js';

export function registerContentCommands(bot, { access, contentWizard, pendingPlans, savePlansToDb, dbPool }) {
  bot.command('buatkonten', (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    return startContentWizard(ctx, { contentWizard });
  });

  bot.action('save_plan', async (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    const chatId = ctx.chat.id;
    const planData = pendingPlans.get(chatId);
    if (!planData) {
      await ctx.answerCbQuery('❌ Data rencana tidak ditemukan. Coba generate ulang.');
      return;
    }

    await ctx.answerCbQuery('⏳ Menyimpan...');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    try {
      const saved = await savePlansToDb(planData, dbPool);
      const count = Array.isArray(saved) ? saved.length : 1;
      await ctx.reply(`✅ ${count} rencana pemasaran berhasil disimpan ke database!`);
      pendingPlans.delete(chatId);
    } catch (err) {
      await ctx.reply(`❌ Gagal menyimpan: ${err.message.slice(0, 500)}`);
    }
  });
}
