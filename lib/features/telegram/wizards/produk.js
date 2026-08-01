import { escMarkdown } from '../helpers/format.js';

export function isAddProductIntent(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    /\b(tambah|tambahkan|input|masukkan)\b.*\bproduk\b/.test(normalized) ||
    /\bproduk\b.*\b(baru|tambah|tambahkan|input|masukkan)\b/.test(normalized)
  );
}

export async function startProductWizard(ctx, { productWizard }) {
  const chatId = ctx.chat.id;
  productWizard.set(chatId, {
    step: 'waiting_nama',
    data: { nama: '', harga: '', stok: '', deskripsi: '', gambar: '' },
  });
  await ctx.reply(
    '🏗️ *Tambah Produk Baru*\n\n' +
      'Silakan masukkan *nama produk*:\n\n' +
      '_(Ketik /batal untuk membatalkan)_',
    { parse_mode: 'Markdown' },
  );
}

export async function handleWizardText(ctx, text, { productWizard, showConfirm = showProductConfirm } = {}) {
  const chatId = ctx.chat.id;
  const wizard = productWizard.get(chatId);
  if (!wizard) return false;

  if (text.toLowerCase() === '/batal') {
    productWizard.delete(chatId);
    await ctx.reply('❌ Pembatalan.');
    return true;
  }

  switch (wizard.step) {
    case 'waiting_nama':
      if (!text || text.length < 2) {
        await ctx.reply('⚠️ Nama produk minimal 2 karakter. Coba lagi:');
        return true;
      }
      wizard.data.nama = text.trim();
      wizard.step = 'waiting_harga';
      await ctx.reply(
        '✅ Nama: *' + escMarkdown(text.trim()) + '*\n\nSekarang masukkan *harga* (angka, contoh: 50000):',
        { parse_mode: 'Markdown' },
      );
      return true;

    case 'waiting_harga': {
      const harga = Number(text.replace(/[^0-9]/g, ''));
      if (!Number.isFinite(harga) || harga < 0) {
        await ctx.reply('⚠️ Harga harus angka positif. Coba lagi:');
        return true;
      }
      wizard.data.harga = harga;
      wizard.step = 'waiting_stok';
      await ctx.reply(
        '✅ Harga: Rp ' +
          Number(harga).toLocaleString('id-ID') +
          '\n\nSekarang masukkan *jumlah stok* (angka, contoh: 10):',
        { parse_mode: 'Markdown' },
      );
      return true;
    }

    case 'waiting_stok': {
      const stok = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (!Number.isFinite(stok) || stok < 0) {
        await ctx.reply('⚠️ Stok harus angka positif. Coba lagi:');
        return true;
      }
      wizard.data.stok = stok;
      wizard.step = 'waiting_deskripsi';
      await ctx.reply(
        '✅ Stok: ' +
          stok +
          ' pcs\n\nSekarang masukkan *deskripsi produk* (atau ketik *skip* jika tidak ada):',
        { parse_mode: 'Markdown' },
      );
      return true;
    }

    case 'waiting_deskripsi':
      if (['skip', '-', 'tidak ada'].includes(text.toLowerCase())) {
        wizard.data.deskripsi = '';
      } else {
        wizard.data.deskripsi = text.trim();
      }
      wizard.step = 'waiting_gambar';
      await ctx.reply(
        '✅ Deskripsi: ' +
          (wizard.data.deskripsi ? escMarkdown(wizard.data.deskripsi.slice(0, 100)) : '(kosong)') +
          '\n\nSekarang kirim *foto produk* (atau ketik *skip* jika tidak ada):',
        { parse_mode: 'Markdown' },
      );
      return true;

    case 'waiting_gambar':
      if (['skip', '-', 'tidak ada'].includes(text.toLowerCase())) {
        wizard.data.gambar = '';
        wizard.step = 'confirm';
        await showConfirm(ctx, wizard.data);
        return true;
      }
      await ctx.reply('⚠️ Kirim foto produk, atau ketik *skip* untuk melewati.', { parse_mode: 'Markdown' });
      return true;

    default:
      return false;
  }
}

export async function showProductConfirm(ctx, data) {
  const harga = Number(data.harga).toLocaleString('id-ID');
  const text =
    '🔄 *Konfirmasi Produk*\n\n' +
    'Nama: *' +
    escMarkdown(data.nama) +
    '*\n' +
    'Harga: Rp ' +
    harga +
    '\n' +
    'Stok: ' +
    data.stok +
    ' pcs\n' +
    'Deskripsi: ' +
    (data.deskripsi ? escMarkdown(data.deskripsi.slice(0, 100)) : '_(kosong)_') +
    '\n' +
    'Gambar: ' +
    (data.gambar ? '✅ Ada' : '❌ Tidak ada') +
    '\n\n' +
    'Simpan produk ini?';
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Simpan', callback_data: 'save_produk' }],
        [{ text: '❌ Batal', callback_data: 'cancel_produk' }],
      ],
    },
  });
}

export async function renderProdukList(dbPool) {
  const result = await dbPool.query('SELECT id, nama, harga, stok FROM produk ORDER BY id DESC LIMIT 20');
  if (result.rows.length === 0) return '📭 Belum ada produk.';
  return result.rows
    .map((p, i) => {
      const harga = Number(p.harga).toLocaleString('id-ID');
      const stok = Number(p.stok) > 0 ? Number(p.stok) : '🟡 Habis';
      return `${i + 1}. *${p.nama}*\n   💰 Rp ${harga}  |  📦 Stok: ${stok}`;
    })
    .join('\n\n');
}
