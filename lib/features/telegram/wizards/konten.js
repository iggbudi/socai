import { escMarkdown } from '../helpers/format.js';
import { isCloudinaryConfigured } from '../media/cloudinary.js';

export async function startContentWizard(ctx, { contentWizard }) {
  const chatId = ctx.chat.id;
  contentWizard.set(chatId, {
    step: 'jenis',
    data: { jenis: '', tujuan: '', produk: '', audiens: '', jadwal: '', tone: '', catatan: '', gambar: '' },
  });
  await ctx.reply(
    '🧵 *Wizard Konten Marketing Threads*\n\n' +
      'Pilih jenis konten:\n' +
      '1. Edukasi\n' +
      '2. Storytelling / brand story\n' +
      '3. Soft selling\n' +
      '4. Promo / limited stock\n' +
      '5. Engagement / tanya jawab\n' +
      '6. Custom\n\n' +
      'Balas angka atau tulis jenisnya.\n' +
      '_(Ketik /batal untuk membatalkan)_',
    { parse_mode: 'Markdown' },
  );
}

export function normalizeContentType(text) {
  const value = String(text || '')
    .trim()
    .toLowerCase();
  const map = {
    1: 'Edukasi',
    2: 'Storytelling / brand story',
    3: 'Soft selling',
    4: 'Promo / limited stock',
    5: 'Engagement / tanya jawab',
    6: 'Custom',
  };
  return map[value] || String(text || '').trim();
}

export function normalizeContentGoal(text) {
  const value = String(text || '')
    .trim()
    .toLowerCase();
  const map = {
    1: 'Awareness — mengenalkan Batik Bakaran / produk',
    2: 'Edukasi — memberi pengetahuan motif, bahan, perawatan',
    3: 'Engagement — memancing komentar / diskusi',
    4: 'Trust building — membangun kepercayaan dan cerita brand',
    5: 'Traffic / inquiry — mendorong orang tanya stok/harga',
    6: 'Conversion — mendorong pembelian secara halus',
    7: 'Retention — menjaga pelanggan lama tetap ingat',
    8: 'Custom',
  };
  return map[value] || String(text || '').trim();
}

export async function getContentProductOptions(dbPool) {
  const result = await dbPool.query('SELECT id, nama, harga, stok FROM produk ORDER BY id DESC LIMIT 20');
  return result.rows;
}

export function formatContentProductOptions(products) {
  return products
    .map((p, index) => {
      const harga = Number(p.harga).toLocaleString('id-ID');
      const stok = Number(p.stok) > 0 ? `${p.stok} pcs` : 'Habis';
      return `${index + 1}. *${escMarkdown(p.nama)}* — Rp ${harga} | Stok: ${stok}`;
    })
    .join('\n');
}

export function resolveContentProductChoice(text, products) {
  const value = String(text || '').trim();
  if (['0', 'skip', '-', 'tanpa produk', 'tidak ada'].includes(value.toLowerCase())) return '';

  const number = Number.parseInt(value, 10);
  if (Number.isInteger(number) && number >= 1 && number <= products.length) {
    return products[number - 1].nama;
  }

  const exact = products.find((p) => p.nama.toLowerCase() === value.toLowerCase());
  if (exact) return exact.nama;

  return null;
}

export function buildContentPrompt(data) {
  return (
    `Buat 1 rencana konten marketing Threads dari wizard Telegram berikut.\n\n` +
    `Konteks penting:\n` +
    `- Ini BUKAN rencana mingguan, jadi buat tepat 1 konten saja.\n` +
    `- Fokus jenis konten: ${data.jenis}.\n` +
    `- Tujuan: ${data.tujuan}.\n` +
    `- Produk terkait: ${data.produk || 'boleh pilih dari database produk yang paling relevan'}.\n` +
    `- Target audiens: ${data.audiens}.\n` +
    `- Jadwal yang diminta: ${data.jadwal}.\n` +
    `- Tone/gaya bahasa: ${data.tone}.\n` +
    `- Catatan tambahan: ${data.catatan || '-'}.\n` +
    `- URL gambar referensi/asset visual: ${data.gambar || '-'}.\n\n` +
    `Instruksi output:\n` +
    `1. Cek dulu jadwal pemasaran yang sudah tersimpan dengan db_query agar jadwal tidak bentrok.\n` +
    `2. Jika jadwal bentrok, sarankan slot terdekat yang aman dan jelaskan singkat.\n` +
    `3. Buat jawaban OpenClaw style yang rapi, singkat, dan nyaman dibaca di Telegram.\n` +
    `4. Sertakan copywriting Threads siap posting.\n` +
    `5. Jika ada URL gambar, cantumkan di field JSON gambar.\n` +
    `6. Akhiri dengan blok JSON valid berupa ARRAY berisi tepat 1 objek agar bisa disimpan ke database. Field wajib: judul, strategi, target_audiens, kanal, jadwal, scheduled_at, copywriting, produk_terkait, gambar. kanal wajib threads. scheduled_at wajib ISO 8601 +07:00 jika jadwal bisa dipastikan, atau string kosong jika belum pasti.`
  );
}

export async function handleContentWizardText(
  ctx,
  text,
  { contentWizard, dbPool, cloudinaryConfigured = isCloudinaryConfigured } = {},
) {
  const chatId = ctx.chat.id;
  const wizard = contentWizard.get(chatId);
  if (!wizard) return false;

  if (text.toLowerCase() === '/batal') {
    contentWizard.delete(chatId);
    await ctx.reply('❌ Pembatalan.');
    return true;
  }

  const value = text.trim();
  if (!value) {
    await ctx.reply('⚠️ Jawaban tidak boleh kosong. Coba lagi atau ketik /batal.');
    return true;
  }

  switch (wizard.step) {
    case 'jenis':
      wizard.data.jenis = normalizeContentType(value);
      wizard.step = 'tujuan';
      await ctx.reply(
        '🎯 Pilih tujuan konten:\n' +
          '1. Awareness — mengenalkan Batik Bakaran / produk\n' +
          '2. Edukasi — memberi pengetahuan motif, bahan, perawatan\n' +
          '3. Engagement — memancing komentar / diskusi\n' +
          '4. Trust building — membangun kepercayaan dan cerita brand\n' +
          '5. Traffic / inquiry — mendorong orang tanya stok/harga\n' +
          '6. Conversion — mendorong pembelian secara halus\n' +
          '7. Retention — menjaga pelanggan lama tetap ingat\n' +
          '8. Custom — tulis tujuan sendiri\n\n' +
          'Balas angka atau tulis tujuan sendiri.',
      );
      return true;
    case 'tujuan': {
      wizard.data.tujuan = normalizeContentGoal(value);
      wizard.step = 'produk';
      const products = await getContentProductOptions(dbPool);
      wizard.products = products;
      if (products.length === 0) {
        wizard.data.produk = '';
        wizard.step = 'audiens';
        await ctx.reply(
          '📭 Belum ada produk di database. Konten akan dibuat tanpa produk spesifik.\n\n👥 Siapa target audiensnya?\nContoh: wanita 25-40, pecinta batik, pekerja kantor, pembeli hadiah.',
        );
        return true;
      }
      await ctx.reply(
        '🛍 Pilih produk terkait untuk konten pemasaran ini:\n\n' +
          formatContentProductOptions(products) +
          '\n\nBalas dengan angka produk. Contoh: *1*\nKetik *0* jika konten tidak terkait produk tertentu.',
        { parse_mode: 'Markdown' },
      );
      return true;
    }
    case 'produk': {
      const selectedProduct = resolveContentProductChoice(value, wizard.products || []);
      if (selectedProduct === null) {
        await ctx.reply(
          '⚠️ Pilihan produk tidak valid. Balas dengan angka sesuai daftar, atau *0* untuk tanpa produk spesifik.',
          { parse_mode: 'Markdown' },
        );
        return true;
      }
      wizard.data.produk = selectedProduct;
      wizard.step = 'audiens';
      await ctx.reply(
        '👥 Siapa target audiensnya?\nContoh: wanita 25-40, pecinta batik, pekerja kantor, pembeli hadiah.',
      );
      return true;
    }
    case 'audiens':
      wizard.data.audiens = value;
      wizard.step = 'jadwal';
      await ctx.reply('📅 Kapan dijadwalkan?\nContoh: Jumat, 29 Mei 2026 jam 19:00 WIB.');
      return true;
    case 'jadwal':
      wizard.data.jadwal = value;
      wizard.step = 'tone';
      await ctx.reply(
        '🎙 Tone/gaya bahasa?\nContoh: hangat, elegan, edukatif, santai, premium, lokal heritage.',
      );
      return true;
    case 'tone':
      wizard.data.tone = value;
      wizard.step = 'catatan';
      await ctx.reply(
        '📝 Catatan tambahan?\nContoh: jangan terlalu jualan, masukkan CTA komentar, tekankan handmade. Ketik *skip* jika tidak ada.',
        { parse_mode: 'Markdown' },
      );
      return true;
    case 'catatan':
      wizard.data.catatan = ['skip', '-'].includes(value.toLowerCase()) ? '' : value;
      wizard.step = 'gambar';
      await ctx.reply(
        '🖼 Mau tambahkan gambar/asset visual untuk konten ini?\n\n' +
          'Kirim foto sekarang, atau ketik *skip* jika tidak ada.\n' +
          (cloudinaryConfigured()
            ? 'Foto akan diunggah ke Cloudinary.'
            : 'Cloudinary belum dikonfigurasi, foto akan disimpan lokal.'),
        { parse_mode: 'Markdown' },
      );
      return true;
    case 'gambar': {
      if (!['skip', '-', 'tidak ada'].includes(value.toLowerCase())) {
        await ctx.reply('⚠️ Kirim foto, atau ketik *skip* untuk tanpa gambar.', { parse_mode: 'Markdown' });
        return true;
      }
      wizard.data.gambar = '';
      const prompt = buildContentPrompt(wizard.data);
      contentWizard.delete(chatId);
      await ctx.reply('✅ Brief lengkap. Saya lempar ke AI untuk dibuatkan kontennya...');
      return prompt;
    }
    default:
      contentWizard.delete(chatId);
      await ctx.reply('⚠️ Sesi wizard tidak valid. Mulai ulang dengan /buatkonten.');
      return true;
  }
}
