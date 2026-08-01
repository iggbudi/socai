import { safeReply } from '../helpers.js';
import { escMarkdown } from '../helpers/format.js';
import { requireTelegramRole } from './akses.js';
import { renderProdukList, startProductWizard } from '../wizards/produk.js';

export function registerProductCommands(bot, { dbPool, access, productWizard, contentWizard }) {
  bot.command('listproduk', async (ctx) => {
    await ctx.sendChatAction('typing');
    try {
      const text = await renderProdukList(dbPool);
      await safeReply(ctx, '🛍️ *Daftar Produk:*\n\n' + text, { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply('❌ Gagal mengambil data: ' + err.message);
    }
  });

  bot.command('tambahproduk', (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    return startProductWizard(ctx, { productWizard });
  });

  bot.command('batal', (ctx) => {
    const chatId = ctx.chat.id;
    let cancelled = false;
    if (productWizard.has(chatId)) {
      productWizard.delete(chatId);
      cancelled = true;
    }
    if (contentWizard.has(chatId)) {
      contentWizard.delete(chatId);
      cancelled = true;
    }
    if (cancelled) ctx.reply('❌ Pembatalan. Tidak ada perubahan yang disimpan.');
    else ctx.reply('Tidak ada proses yang sedang berjalan.');
  });

  bot.action('save_produk', async (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    const chatId = ctx.chat.id;
    const wizard = productWizard.get(chatId);
    if (!wizard) {
      await ctx.answerCbQuery('❌ Sesi habis. Mulai ulang dengan /tambahproduk');
      return;
    }

    await ctx.answerCbQuery('⏳ Menyimpan...');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    try {
      const { nama, harga, stok, deskripsi, gambar } = wizard.data;
      const result = await dbPool.query(
        'INSERT INTO produk (nama, harga, stok, gambar, deskripsi) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [nama, Number(harga), Number(stok), gambar || '', deskripsi || ''],
      );
      productWizard.delete(chatId);
      await ctx.reply(
        '✅ *Produk berhasil ditambahkan!*\n\n' +
          'Nama: *' +
          escMarkdown(nama) +
          '*\n' +
          'Harga: Rp ' +
          Number(harga).toLocaleString('id-ID') +
          '\n' +
          'Stok: ' +
          stok +
          ' pcs\n' +
          'ID: `' +
          result.rows[0].id +
          '`',
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      await ctx.reply('❌ Gagal menyimpan: ' + err.message.slice(0, 500));
    }
  });

  bot.action('cancel_produk', async (ctx) => {
    const chatId = ctx.chat.id;
    productWizard.delete(chatId);
    await ctx.answerCbQuery('❌ Dibatalkan');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply('❌ Pembatalan. Tidak ada perubahan yang disimpan.');
  });
}
