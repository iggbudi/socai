import {
  agentSessions as defaultAgentSessions,
  touchAgentSession as defaultTouchAgentSession,
  initAgent as defaultInitAgent,
} from '../agent/core.js';
import {
  createAgentRun as defaultCreateAgentRun,
  completeAgentRun as defaultCompleteAgentRun,
} from '../agent/runs.js';
import { resolveAutonomyMode as defaultResolveAutonomyMode } from '../agent/actuator/index.js';
import { pool as defaultPool } from '../../shared/db.js';
import {
  savePlansToDb as defaultSavePlansToDb,
  schedulePlanToRepliz as defaultSchedulePlanToRepliz,
  schedulePlanToReplizNow as defaultSchedulePlanToReplizNow,
  syncPlanReplizStatus as defaultSyncPlanReplizStatus,
} from '../pemasaran/domain.js';
import {
  normalizeAiMessage as defaultNormalizeAiMessage,
  AiMessageError as DefaultAiMessageError,
} from '../agent/aiLimits.js';
import { createRateLimiter } from '../../shared/rateLimit.js';
import { isReplizConfigured as defaultIsReplizConfigured } from '../../shared/repliz.js';
import {
  approvePlanSchedule as defaultApprovePlanSchedule,
  rejectPlanSchedule as defaultRejectPlanSchedule,
} from '../agent/approval.js';
import { safeReply, replyLong } from './helpers.js';
import { escMarkdown, fmtPlan } from './helpers/format.js';
import {
  handleWizardText,
  isAddProductIntent,
  renderProdukList,
  showProductConfirm,
  startProductWizard,
} from './wizards/produk.js';
import { buildContentPrompt, handleContentWizardText, startContentWizard } from './wizards/konten.js';
import { downloadTelegramPhoto as defaultDownloadTelegramPhoto } from './media/cloudinary.js';
import { scheduleViaRepliz as defaultScheduleViaRepliz } from './schedule.js';

export const defaultBotCommands = [
  { command: 'start', description: 'Mulai chatbot' },
  { command: 'help', description: 'Bantuan dan daftar perintah' },
  { command: 'whoami', description: 'Lihat User ID, username, dan Chat ID' },
  { command: 'status', description: 'Status koneksi dan sesi AI' },
  { command: 'listproduk', description: 'Lihat daftar produk' },
  { command: 'buatkonten', description: 'Wizard buat konten marketing spesifik' },
  { command: 'jadwalkonten', description: 'Lihat kalender konten' },
  { command: 'statuskonten', description: 'Lihat konten per status' },
  { command: 'ubahstatuskonten', description: 'Ubah status rencana konten' },
  { command: 'hapuskonten', description: 'Hapus rencana konten dengan konfirmasi' },
  { command: 'jadwalkan', description: 'Kirim jadwal konten ke Repliz' },
  { command: 'postnow', description: 'Post konten sekarang via Repliz' },
  { command: 'retrypost', description: 'Coba ulang posting gagal' },
  { command: 'cekpost', description: 'Cek status post Repliz' },
  { command: 'tambahproduk', description: 'Tambah produk baru' },
  { command: 'batal', description: 'Batalkan proses berjalan' },
];

export const superAdminBotCommands = [
  ...defaultBotCommands,
  { command: 'adduser', description: 'Tambah user yang boleh memakai bot' },
  { command: 'removeuser', description: 'Hapus user dari bot' },
  { command: 'listusers', description: 'Lihat daftar user dan role' },
];

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  operator: 'Operator',
  viewer: 'Viewer',
};

function getTelegramUserId(ctx) {
  return Number(ctx.from?.id);
}

export function formatTelegramRole(userId, access) {
  const role = access.getRole(userId);
  return role ? ROLE_LABELS[role] || role : 'Belum Terdaftar';
}

function requireTelegramRole(ctx, minRole, access) {
  const userId = getTelegramUserId(ctx);
  if (!access.hasRole(userId, minRole)) {
    ctx.reply('⛔ Akses ditolak untuk perintah ini.');
    return false;
  }
  return true;
}

function createDefaultRateLimiter() {
  return createRateLimiter({
    limit: Number(process.env.TELEGRAM_AI_RATE_LIMIT) || 10,
    windowMs: Number(process.env.TELEGRAM_AI_RATE_WINDOW_MS) || 60000,
    keyFn: (chatId) => `telegram:${chatId}`,
  });
}

/**
 * Register all Telegram handlers on an already-created Telegraf instance.
 * Dependencies are injectable so the factory can be tested without launching polling.
 */
export function registerTelegramHandlers({ bot, access, state, dependencies = {} }) {
  const dbPool = dependencies.dbPool || defaultPool;
  const agentSessions = dependencies.agentSessions || defaultAgentSessions;
  const touchAgentSession = dependencies.touchAgentSession || defaultTouchAgentSession;
  const initAgent = dependencies.initAgent || defaultInitAgent;
  const createAgentRun = dependencies.createAgentRun || defaultCreateAgentRun;
  const completeAgentRun = dependencies.completeAgentRun || defaultCompleteAgentRun;
  const resolveAutonomyMode = dependencies.resolveAutonomyMode || defaultResolveAutonomyMode;
  const normalizeAiMessage = dependencies.normalizeAiMessage || defaultNormalizeAiMessage;
  const AiMessageError = dependencies.AiMessageError || DefaultAiMessageError;
  const telegramAiRateLimiter = dependencies.telegramAiRateLimiter || createDefaultRateLimiter();
  const isReplizConfiguredFn = dependencies.isReplizConfigured || defaultIsReplizConfigured;
  const savePlansToDb = dependencies.savePlansToDb || defaultSavePlansToDb;
  const schedulePlanToRepliz = dependencies.schedulePlanToRepliz || defaultSchedulePlanToRepliz;
  const schedulePlanToReplizNow = dependencies.schedulePlanToReplizNow || defaultSchedulePlanToReplizNow;
  const syncPlanReplizStatus = dependencies.syncPlanReplizStatus || defaultSyncPlanReplizStatus;
  const approvePlanSchedule = dependencies.approvePlanSchedule || defaultApprovePlanSchedule;
  const rejectPlanSchedule = dependencies.rejectPlanSchedule || defaultRejectPlanSchedule;
  const downloadTelegramPhoto = dependencies.downloadTelegramPhoto || defaultDownloadTelegramPhoto;
  const scheduleViaRepliz = dependencies.scheduleViaRepliz || defaultScheduleViaRepliz;

  const { pendingPlans, contentWizard, productWizard, uploadDir } = state;

  bot.use(async (ctx, next) => {
    const text = ctx.message?.text || ctx.callbackQuery?.message?.text || '';
    const command = text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';

    // /start, /help, dan /whoami tetap dibuka agar user bisa melihat ID untuk didaftarkan admin.
    if (['/start', '/help', '/whoami'].includes(command)) return next();

    if (!access.isAllowed(getTelegramUserId(ctx))) {
      return ctx.reply(
        '⛔ Akses ditolak.\n\n' +
          'Minta super admin menambahkan User ID kamu dengan perintah:\n' +
          '`/adduser ' +
          (ctx.from?.id || '<user_id>') +
          '`\n\n' +
          'Gunakan /whoami untuk melihat data akun Telegram kamu.',
        { parse_mode: 'Markdown' },
      );
    }

    return next();
  });

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

  bot.command('whoami', async (ctx) => {
    const from = ctx.from || {};
    const chat = ctx.chat || {};
    const username = from.username ? '@' + from.username : '-';
    const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || '-';
    const chatTitle = chat.title || '-';
    const chatType = chat.type || '-';
    const role = formatTelegramRole(from.id, access);

    await ctx.reply(
      `👤 *Whoami*\n\n` +
        `• User ID: \`${from.id || '-'}\`\n` +
        `• Username: \`${username}\`\n` +
        `• Nama: ${escMarkdown(fullName)}\n` +
        `• Role: ${escMarkdown(role)}\n` +
        `• Chat ID: \`${chat.id || '-'}\`\n` +
        `• Chat Type: \`${chatType}\`\n` +
        `• Chat Title: ${escMarkdown(chatTitle)}`,
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('adduser', async (ctx) => {
    if (!requireTelegramRole(ctx, 'super_admin', access)) return;

    const parts = ctx.message.text.trim().split(/\s+/);
    const userId = Number(parts[1]);
    const roleArg = parts[2] || 'operator';
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return ctx.reply(
        'Format salah. Gunakan:\n' +
          '`/adduser 123456789`\n' +
          '`/adduser 123456789 operator`\n' +
          '`/adduser 123456789 viewer`\n\n' +
          'User bisa cek ID dengan /whoami.',
        { parse_mode: 'Markdown' },
      );
    }

    const result = access.addUser(userId, roleArg);
    if (!result.ok) {
      const message =
        result.reason === 'invalid_role'
          ? 'Role tidak valid. Gunakan `operator` atau `viewer`.'
          : 'User ID tidak valid.';
      return ctx.reply(message, { parse_mode: 'Markdown' });
    }

    await ctx.reply(
      (result.alreadyAdded ? 'ℹ️ User sudah terdaftar, role diperbarui.' : '✅ User berhasil ditambahkan.') +
        '\n\n' +
        `• User ID: \`${userId}\`\n` +
        `• Role: \`${result.role}\`\n` +
        `• Total user terdaftar: \`${access.listUsers().length}\``,
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('removeuser', async (ctx) => {
    if (!requireTelegramRole(ctx, 'super_admin', access)) return;

    const userId = Number(ctx.message.text.trim().split(/\s+/)[1]);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return ctx.reply('Format salah. Gunakan:\n' + '`/removeuser 123456789`', { parse_mode: 'Markdown' });
    }

    const result = access.removeUser(userId);
    if (!result.ok) {
      if (result.reason === 'super_admin') return ctx.reply('⛔ Super admin tidak bisa dihapus.');
      if (result.reason === 'not_found') return ctx.reply('ℹ️ User tidak ditemukan dalam daftar terdaftar.');
      return ctx.reply('User ID tidak valid.');
    }

    await ctx.reply(
      '✅ User berhasil dihapus.\n\n' +
        `• User ID: \`${userId}\`\n` +
        `• Total user terdaftar: \`${access.listUsers().length}\``,
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('listusers', async (ctx) => {
    if (!requireTelegramRole(ctx, 'super_admin', access)) return;

    const users = access.listUsers();
    if (!users.length) return ctx.reply('Belum ada user terdaftar.');

    const lines = users.map((user) => `• \`${user.id}\` — ${ROLE_LABELS[user.role] || user.role}`);
    await ctx.reply('👥 *Daftar user terdaftar:*\n\n' + lines.join('\n'), { parse_mode: 'Markdown' });
  });

  const handleText = async (ctx, next) => {
    const chatId = ctx.chat.id;
    let message = ctx.message.text;

    // Biarkan command handler yang didefinisikan setelah generic text handler tetap berjalan.
    if (message.startsWith('/') && !productWizard.has(chatId) && !contentWizard.has(chatId)) return next();

    if (contentWizard.has(chatId)) {
      const result = await handleContentWizardText(ctx, message, { contentWizard, dbPool });
      if (result === true) return;
      if (typeof result === 'string') message = result;
    }

    if (productWizard.has(chatId)) {
      const handled = await handleWizardText(ctx, message, {
        productWizard,
        showConfirm: showProductConfirm,
      });
      if (handled) return;
    }

    if (isAddProductIntent(message)) {
      if (!requireTelegramRole(ctx, 'operator', access)) return;
      await startProductWizard(ctx, { productWizard });
      return;
    }

    if (!requireTelegramRole(ctx, 'operator', access)) return;

    const rateKey = `telegram:${chatId}`;
    const rate = telegramAiRateLimiter.check(rateKey);
    if (!rate.allowed) {
      const retryAfterSec = Math.ceil(rate.retryAfterMs / 1000);
      return ctx.reply(`⏳ Terlalu banyak request AI. Coba lagi dalam ${retryAfterSec} detik.`);
    }
    telegramAiRateLimiter.consume(rateKey);

    try {
      message = normalizeAiMessage(message);
    } catch (e) {
      if (e instanceof AiMessageError) return ctx.reply(`⚠️ ${e.message}`);
      throw e;
    }

    await ctx.sendChatAction('typing');

    const sessionKey = `telegram:${chatId}`;
    let agentSession;

    try {
      agentSession = agentSessions.get(sessionKey);
      if (agentSession) {
        touchAgentSession(sessionKey);
      } else {
        console.log(`[Telegram] Initializing agent for chat ${chatId}`);
        await ctx.reply('⏳ Menyiapkan AI agent...');
        agentSession = await initAgent(sessionKey);
        console.log(`[Telegram] Agent ready for chat ${chatId}`);
      }

      await ctx.sendChatAction('typing');

      let fullText = '';
      console.log(`[${chatId}] Subscribing to agent events...`);
      const unsubscribe = agentSession.subscribe((event) => {
        try {
          if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
            fullText += event.assistantMessageEvent.delta;
            if (fullText.length % 200 < 20) ctx.sendChatAction('typing').catch(() => {});
          }
        } catch (_) {}
      });

      let agentRunId = null;
      try {
        const run = await createAgentRun(dbPool, {
          session_key: sessionKey,
          source: 'telegram',
          autonomy_mode: resolveAutonomyMode('telegram'),
          trigger_type: 'chat',
          user_prompt: message,
          model_ref: process.env.TELEGRAM_AI_MODEL || process.env.AI_MODEL || null,
        });
        agentRunId = run.id;
      } catch (err) {
        console.error(`[Telegram] createAgentRun error for chat ${chatId}:`, err.message);
      }

      console.log(`[${chatId}] Sending prompt to AI: "${message.slice(0, 50)}..."`);
      try {
        await agentSession.prompt(message);
        if (agentRunId) {
          await completeAgentRun(dbPool, agentRunId, { status: 'completed' });
          agentRunId = null;
        }
      } catch (promptErr) {
        if (agentRunId) {
          await completeAgentRun(dbPool, agentRunId, {
            status: 'error',
            error_message: promptErr.message,
          }).catch(() => {});
          agentRunId = null;
        }
        throw promptErr;
      }
      console.log(`[${chatId}] Prompt completed, response length: ${fullText.length}`);
      unsubscribe();

      if (!fullText.trim()) {
        await ctx.reply('✅ Selesai (tidak ada output teks)');
        return;
      }

      const jsonMarker = '```json';
      const startIdx = fullText.lastIndexOf(jsonMarker);
      let hasPlan = false;
      let planData = null;

      if (startIdx !== -1) {
        const afterMarker = fullText.slice(startIdx + jsonMarker.length);
        const endIdx = afterMarker.indexOf('```');
        if (endIdx !== -1) {
          const jsonStr = afterMarker.slice(0, endIdx).trim();
          try {
            planData = JSON.parse(jsonStr);
            hasPlan = true;
          } catch (_) {}
        }
      }

      const MAX_LEN = 4000;
      if (fullText.length <= MAX_LEN) {
        if (hasPlan) {
          await safeReply(ctx, fullText, {
            reply_markup: {
              inline_keyboard: [[{ text: '📋 Simpan Rencana', callback_data: 'save_plan' }]],
            },
          });
          pendingPlans.set(chatId, planData);
        } else {
          await safeReply(ctx, fullText);
        }
      } else {
        const parts = [];
        let remaining = fullText;
        while (remaining.length > 0) {
          let splitAt = remaining.lastIndexOf('\n', MAX_LEN);
          if (splitAt <= 0) splitAt = MAX_LEN;
          parts.push(remaining.slice(0, splitAt));
          remaining = remaining.slice(splitAt).trim();
        }
        for (let i = 0; i < parts.length; i++) {
          if (i === parts.length - 1 && hasPlan) {
            await safeReply(ctx, parts[i], {
              reply_markup: {
                inline_keyboard: [[{ text: '📋 Simpan Rencana', callback_data: 'save_plan' }]],
              },
            });
            pendingPlans.set(chatId, planData);
          } else {
            await safeReply(ctx, parts[i]);
          }
          if (i < parts.length - 1) await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } catch (err) {
      console.error(`[Telegram] Error for chat ${chatId}:`, err.message);
      await ctx.reply(`❌ Gagal: ${err.message.slice(0, 500)}`).catch(() => {});
    }
  };

  bot.on('text', handleText);

  bot.command('listproduk', async (ctx) => {
    await ctx.sendChatAction('typing');
    try {
      const text = await renderProdukList(dbPool);
      await safeReply(ctx, '🛍️ *Daftar Produk:*\n\n' + text, { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply('❌ Gagal mengambil data: ' + err.message);
    }
  });

  bot.command('buatkonten', (ctx) => {
    if (!requireTelegramRole(ctx, 'operator', access)) return;
    return startContentWizard(ctx, { contentWizard });
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
      replizConfigured: isReplizConfiguredFn,
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
      replizConfigured: isReplizConfiguredFn,
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
      replizConfigured: isReplizConfiguredFn,
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

  bot.catch((err, ctx) => {
    console.error(`[Telegram] Unhandled error for ${ctx?.updateType}:`, err);
  });

  return { bot, handleText };
}
