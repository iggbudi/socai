import { safeReply } from '../helpers.js';
import { escMarkdown } from '../helpers/format.js';
import { formatTelegramRole, getTelegramUserId } from './akses.js';

export function registerStatusCommands(bot, { access, agentSessions, dbPool }) {
  bot.start(async (ctx) => {
    await safeReply(
      ctx,
      '🤖 *Asisten Automation Batik Bakaran*\n\n' +
        'Saya adalah AI assistant untuk membantu pemasaran Batik Bakaran.\n\n' +
        'Yang bisa saya lakukan:\n' +
        '• Lihat / daftar produk\n' +
        '• Riset tren batik & marketing\n' +
        '• Buat rencana konten Threads 1 minggu\n' +
        '• Buat copywriting postingan\n' +
        '• Analisis produk prioritas\n\n' +
        'Coba ketik: *"Tampilkan semua produk"* atau *"Buat rencana konten Threads"*',
      { parse_mode: 'Markdown' },
    );
  });

  bot.help(async (ctx) => {
    const adminHelp = access.isSuperAdmin(getTelegramUserId(ctx))
      ? '/adduser `<user_id>` `[role]` — Tambah user (role: operator|viewer)\n' +
        '/removeuser `<user_id>` — Hapus user terdaftar\n' +
        '/listusers — Lihat daftar user dan role\n'
      : '';
    const role = formatTelegramRole(getTelegramUserId(ctx), access);
    await safeReply(
      ctx,
      '📋 *Perintah yang tersedia:*\n\n' +
        `Role kamu: *${escMarkdown(role)}*\n\n` +
        '/start — Mulai chatbot\n' +
        '/help — Bantuan ini\n' +
        '/status — Status koneksi & sesi\n' +
        '/whoami — Lihat User ID, username, dan Chat ID\n' +
        '/listproduk — Lihat semua produk\n' +
        '/buatkonten — Wizard konten marketing spesifik\n' +
        '/jadwalkonten `[hariini|minggu|bulan]` — Lihat kalender konten\n' +
        '/statuskonten `<status>` — Lihat konten per status\n' +
        '/ubahstatuskonten `<id> <status>` — Ubah status konten\n' +
        '/hapuskonten HAPUS `<id>` — Hapus konten dengan konfirmasi\n' +
        '/jadwalkan `<id>` — Jadwalkan ke Repliz\n' +
        '/postnow `<id>` — Post segera via Repliz\n' +
        '/retrypost `<id>` — Ulangi post gagal\n' +
        '/cekpost `<id>` — Cek status Repliz\n' +
        '/tambahproduk — Tambah produk baru\n' +
        adminHelp +
        '\nAtau langsung kirim pesan ke saya!',
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('status', async (ctx) => {
    const chatId = ctx.chat.id;
    const sessionKey = `telegram:${chatId}`;
    const hasSession = agentSessions.has(sessionKey);

    let dbStatus = '❌ Gagal';
    try {
      await dbPool.query('SELECT 1');
      dbStatus = '✅ OK';
    } catch (_) {}

    await ctx.reply(
      `📊 *Status*\n\n` +
        `• Database: ${dbStatus}\n` +
        `• Sesi AI: ${hasSession ? '✅ Aktif' : '⏳ Belum dibuat'}\n` +
        `• Chat ID: \`${chatId}\``,
      { parse_mode: 'Markdown' },
    );
  });
}
