import { buildContentPrompt } from '../wizards/konten.js';
import { showProductConfirm } from '../wizards/produk.js';

export function registerPhotoHandler(
  bot,
  { contentWizard, productWizard, downloadTelegramPhoto, uploadDir },
) {
  bot.on('photo', async (ctx) => {
    const chatId = ctx.chat.id;
    const content = contentWizard.get(chatId);
    if (content) {
      if (content.step !== 'gambar') {
        await ctx.reply(
          '⚠️ Foto diterima, tapi wizard konten belum masuk tahap gambar. Ketik /batal untuk mulai ulang.',
        );
        return;
      }

      await ctx.sendChatAction('typing');
      try {
        const photo = ctx.message.photo;
        const fileId = photo[photo.length - 1].file_id;
        const url = await downloadTelegramPhoto(fileId, {
          bot,
          uploadDir,
          cloudinary: true,
          folder: 'socai/content',
          prefix: 'konten-telegram',
        });
        content.data.gambar = url;
        const prompt = buildContentPrompt(content.data);
        contentWizard.delete(chatId);
        await ctx.reply(
          '✅ Gambar berhasil ditambahkan. Saya lempar brief ke AI untuk dibuatkan kontennya...',
        );
        return bot.handleUpdate({
          update_id: ctx.update.update_id,
          message: {
            message_id: ctx.message.message_id,
            from: ctx.from,
            chat: ctx.chat,
            date: ctx.message.date,
            text: prompt,
          },
        });
      } catch (err) {
        await ctx.reply('❌ ' + err.message + '\n\nKetik *skip* untuk tanpa gambar, atau kirim foto lagi.', {
          parse_mode: 'Markdown',
        });
        return;
      }
    }

    const wizard = productWizard.get(chatId);
    if (!wizard) return;
    if (wizard.step !== 'waiting_gambar') {
      await ctx.reply(
        '⚠️ Foto diterima, tapi sedang tidak dalam tahap gambar. Ketik /batal untuk mulai ulang.',
      );
      return;
    }

    await ctx.sendChatAction('typing');
    try {
      const photo = ctx.message.photo;
      const fileId = photo[photo.length - 1].file_id;
      const url = await downloadTelegramPhoto(fileId, { bot, uploadDir });
      wizard.data.gambar = url;
      wizard.step = 'confirm';
      await ctx.reply('✅ Foto berhasil diunggah!');
      await showProductConfirm(ctx, wizard.data);
      productWizard.set(chatId, wizard);
    } catch (err) {
      await ctx.reply('❌ ' + err.message + '\n\nKetik *skip* untuk lewati gambar, atau kirim foto lagi.', {
        parse_mode: 'Markdown',
      });
    }
  });
}
