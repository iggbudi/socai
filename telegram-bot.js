import 'dotenv/config';
import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { validateBotEnvironment } from './lib/env.js';
import { sanitizeImageUrl } from './lib/mediaUrl.js';
import { pool, agentSessions, agentSessionLastUsed, agentSessionPromises, touchAgentSession, initAgent } from './lib/agent.js';
import { createThreadsSchedule, getReplizSchedule, isReplizConfigured } from './lib/repliz.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

validateBotEnvironment();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ Token bot Telegram tidak diatur. Isi TELEGRAM_BOT_TOKEN di .env (fallback alias: BOT_TOKEN atau TELEGRAM_TOKEN).');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN, {
  // AI responses/planning can take longer than Telegraf's default 90s timeout.
  handlerTimeout: Number(process.env.TELEGRAM_HANDLER_TIMEOUT_MS) || 10 * 60 * 1000,
});

// ---------- Telegram access control ----------
const SUPER_ADMIN_ID = Number(process.env.TELEGRAM_SUPER_ADMIN_ID || 275313615);
const TELEGRAM_USERS_FILE = path.join(__dirname, 'telegram-users.json');

function loadTelegramUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(TELEGRAM_USERS_FILE, 'utf8'));
    return new Set((data.allowed_user_ids || []).map(Number).filter(Number.isFinite));
  } catch (_) {
    return new Set();
  }
}

const allowedTelegramUsers = loadTelegramUsers();
allowedTelegramUsers.add(SUPER_ADMIN_ID);

const defaultBotCommands = [
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

const superAdminBotCommands = [
  ...defaultBotCommands,
  { command: 'adduser', description: 'Tambah user yang boleh memakai bot' },
];

async function syncBotCommands() {
  await bot.telegram.setMyCommands(defaultBotCommands);
  await bot.telegram.setMyCommands(superAdminBotCommands, {
    scope: { type: 'chat', chat_id: SUPER_ADMIN_ID },
  });
}

async function ensureMarketingSchema() {
  await pool.query(`
    ALTER TABLE IF EXISTS pemasaran
      ADD COLUMN IF NOT EXISTS gambar text,
      ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
      ADD COLUMN IF NOT EXISTS published_at timestamptz,
      ADD COLUMN IF NOT EXISTS external_post_id text,
      ADD COLUMN IF NOT EXISTS external_status text,
      ADD COLUMN IF NOT EXISTS last_error text,
      ADD COLUMN IF NOT EXISTS repliz_schedule_id text,
      ADD COLUMN IF NOT EXISTS repliz_status text,
      ADD COLUMN IF NOT EXISTS repliz_scheduled_at timestamptz,
      ADD COLUMN IF NOT EXISTS repliz_last_error text,
      ADD COLUMN IF NOT EXISTS repliz_synced_at timestamptz,
      ADD COLUMN IF NOT EXISTS repliz_attempts integer DEFAULT 0
  `);
}

function saveTelegramUsers() {
  const data = {
    super_admin_id: SUPER_ADMIN_ID,
    allowed_user_ids: [...allowedTelegramUsers].sort((a, b) => a - b),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(TELEGRAM_USERS_FILE, JSON.stringify(data, null, 2) + '\n');
}

function getTelegramUserId(ctx) {
  return Number(ctx.from?.id);
}

function isSuperAdmin(ctx) {
  return getTelegramUserId(ctx) === SUPER_ADMIN_ID;
}

function isAllowedTelegramUser(ctx) {
  const userId = getTelegramUserId(ctx);
  return userId === SUPER_ADMIN_ID || allowedTelegramUsers.has(userId);
}

bot.use(async (ctx, next) => {
  const text = ctx.message?.text || ctx.callbackQuery?.message?.text || '';
  const command = text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';

  // /start, /help, dan /whoami tetap dibuka agar user bisa melihat ID untuk didaftarkan admin.
  if (['/start', '/help', '/whoami'].includes(command)) return next();

  if (!isAllowedTelegramUser(ctx)) {
    return ctx.reply(
      '⛔ Akses ditolak.\n\n' +
      'Minta super admin menambahkan User ID kamu dengan perintah:\n' +
      '`/adduser ' + (ctx.from?.id || '<user_id>') + '`\n\n' +
      'Gunakan /whoami untuk melihat data akun Telegram kamu.',
      { parse_mode: 'Markdown' }
    );
  }

  return next();
});

// ---------- Helper: simpan rencana ke database ----------
async function savePlansToDb(planData) {
  const normalizePlansInput = (body) => {
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.rencana_mingguan)) return body.rencana_mingguan;
    if (Array.isArray(body?.rencana)) return body.rencana;
    if (Array.isArray(body?.plans)) return body.plans;
    return [body];
  };
  const toText = (value) => {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) return value.filter(Boolean).map(toText).filter(Boolean).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    const text = String(value).trim();
    return text || null;
  };
  const limitText = (value, max) => {
    const text = toText(value);
    return text && text.length > max ? text.slice(0, max) : text;
  };
  const normalizePlan = (rawPlan, index) => {
    const rawGambar = toText(rawPlan?.gambar || rawPlan?.image || rawPlan?.image_url || rawPlan?.url_gambar);
    let gambar = '';
    if (rawGambar) {
      gambar = sanitizeImageUrl(rawGambar, { allowEmpty: true });
    }
    return {
      judul: limitText(rawPlan?.judul || rawPlan?.title || `Rencana Threads Hari ${index + 1}`, 255),
      strategi: toText(rawPlan?.strategi || rawPlan?.strategy),
      target_audiens: limitText(rawPlan?.target_audiens || rawPlan?.target || rawPlan?.audience, 255),
      kanal: 'threads',
      jadwal: toText(rawPlan?.jadwal || rawPlan?.schedule),
      scheduled_at: toText(rawPlan?.scheduled_at || rawPlan?.schedule_at || rawPlan?.scheduledAt),
      copywriting: toText(rawPlan?.copywriting || rawPlan?.caption || rawPlan?.copy),
      produk_terkait: limitText(rawPlan?.produk_terkait || rawPlan?.produk || rawPlan?.product, 255),
      gambar,
    };
  };

  const rawPlans = normalizePlansInput(planData).filter(Boolean);
  const plans = rawPlans.map(normalizePlan);
  if (plans.length === 0 || plans.some(plan => !plan.judul || !plan.strategi)) {
    throw new Error('Data rencana tidak valid. Pastikan setiap item memiliki judul dan strategi.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];
    const seenSchedules = new Set();
    for (const plan of plans) {
      const scheduleKey = (plan.jadwal || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (scheduleKey) {
        if (seenSchedules.has(scheduleKey)) {
          throw new Error(`Jadwal duplikat dalam rencana yang sama: ${plan.jadwal}`);
        }
        seenSchedules.add(scheduleKey);
        const duplicate = await client.query(
          `SELECT id, judul, jadwal FROM pemasaran
           WHERE lower(regexp_replace(coalesce(jadwal, ''), '\\s+', ' ', 'g')) = $1
             AND lower(coalesce(kanal, '')) = 'threads'
           LIMIT 1`,
          [scheduleKey]
        );
        if (duplicate.rows.length > 0) {
          throw new Error(`Jadwal sudah ada di pemasaran Threads: ${plan.jadwal}. Buat jadwal lanjutan agar tidak menumpuk.`);
        }
      }
      const result = await client.query(
        `INSERT INTO pemasaran (judul, strategi, target_audiens, kanal, jadwal, scheduled_at, copywriting, produk_terkait, gambar, status)
         VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::timestamptz, $7, $8, $9, 'draft') RETURNING *`,
        [plan.judul, plan.strategi, plan.target_audiens, plan.kanal, plan.jadwal, plan.scheduled_at, plan.copywriting, plan.produk_terkait, plan.gambar]
      );
      saved.push(result.rows[0]);
    }
    await client.query('COMMIT');
    return saved;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Handler: /start ----------
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
    { parse_mode: 'Markdown' }
  );
});

// ---------- Handler: /help ----------
bot.help(async (ctx) => {
  const adminHelp = isSuperAdmin(ctx)
    ? '/adduser `<user_id>` — Tambah user yang boleh memakai bot\n'
    : '';
  await safeReply(
    ctx,
    '📋 *Perintah yang tersedia:*\n\n' +
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
    { parse_mode: 'Markdown' }
  );
});

// ---------- Handler: /status ----------
bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id;
  const sessionKey = `telegram:${chatId}`;
  const hasSession = agentSessions.has(sessionKey);

  let dbStatus = '❌ Gagal';
  try {
    await pool.query('SELECT 1');
    dbStatus = '✅ OK';
  } catch (_) {}

  await ctx.reply(
    `📊 *Status*\n\n` +
    `• Database: ${dbStatus}\n` +
    `• Sesi AI: ${hasSession ? '✅ Aktif' : '⏳ Belum dibuat'}\n` +
    `• Chat ID: \`${chatId}\``,
    { parse_mode: 'Markdown' }
  );
});

// ---------- Handler: /whoami ----------
bot.command('whoami', async (ctx) => {
  const from = ctx.from || {};
  const chat = ctx.chat || {};
  const username = from.username ? '@' + from.username : '-';
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || '-';
  const chatTitle = chat.title || '-';
  const chatType = chat.type || '-';
  const role = isSuperAdmin(ctx) ? 'Super Admin' : isAllowedTelegramUser(ctx) ? 'User Terdaftar' : 'Belum Terdaftar';

  await ctx.reply(
    `👤 *Whoami*\n\n` +
    `• User ID: \`${from.id || '-'}\`\n` +
    `• Username: \`${username}\`\n` +
    `• Nama: ${escMarkdown(fullName)}\n` +
    `• Role: ${escMarkdown(role)}\n` +
    `• Chat ID: \`${chat.id || '-'}\`\n` +
    `• Chat Type: \`${chatType}\`\n` +
    `• Chat Title: ${escMarkdown(chatTitle)}`,
    { parse_mode: 'Markdown' }
  );
});

// ---------- Handler: /adduser (super admin only) ----------
bot.command('adduser', async (ctx) => {
  if (!isSuperAdmin(ctx)) {
    return ctx.reply('⛔ Perintah /adduser hanya bisa digunakan oleh super admin.');
  }

  const parts = ctx.message.text.trim().split(/\s+/);
  const userId = Number(parts[1]);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return ctx.reply(
      'Format salah. Gunakan:\n' +
      '`/adduser 123456789`\n\n' +
      'User bisa cek ID dengan /whoami.',
      { parse_mode: 'Markdown' }
    );
  }

  const alreadyAdded = allowedTelegramUsers.has(userId);
  allowedTelegramUsers.add(userId);
  saveTelegramUsers();

  await ctx.reply(
    (alreadyAdded ? 'ℹ️ User sudah terdaftar.' : '✅ User berhasil ditambahkan.') + '\n\n' +
    `• User ID: \`${userId}\`\n` +
    `• Total user terdaftar: \`${allowedTelegramUsers.size}\``,
    { parse_mode: 'Markdown' }
  );
});

// ---------- Handler: pesan teks ----------
bot.on('text', async (ctx, next) => {
  const chatId = ctx.chat.id;
  let message = ctx.message.text;

  // Biarkan command handler yang didefinisikan setelah generic text handler tetap berjalan.
  // Jika sedang dalam wizard, command /batal tetap ditangani oleh wizard di bawah.
  if (message.startsWith('/') && !productWizard.has(chatId) && !contentWizard.has(chatId)) {
    return next();
  }

  // Cek dulu apakah sedang dalam wizard konten marketing.
  if (contentWizard.has(chatId)) {
    const result = await handleContentWizardText(ctx, message);
    if (result === true) return;
    if (typeof result === 'string') message = result;
  }

  // Cek dulu apakah sedang dalam wizard tambah produk
  if (productWizard.has(chatId)) {
    const handled = await handleWizardText(ctx, message);
    if (handled) return;
  }

  // Natural language shortcut: "tambah produk" langsung buka wizard,
  // jangan dikirim ke AI karena tool AI memang SELECT-only.
  if (isAddProductIntent(message)) {
    await startProductWizard(ctx);
    return;
  }

  // Kirim typing indicator
  await ctx.sendChatAction('typing');

  const sessionKey = `telegram:${chatId}`;
  let agentSession;

  try {
    // Dapatkan atau inisialisasi agent session untuk chat ini
    agentSession = agentSessions.get(sessionKey);
    if (agentSession) {
      touchAgentSession(sessionKey);
    } else {
      console.log(`[Telegram] Initializing agent for chat ${chatId}`);
      await ctx.reply('⏳ Menyiapkan AI agent...');
      agentSession = await initAgent(sessionKey);
      console.log(`[Telegram] Agent ready for chat ${chatId}`);
    }

    // Kirim typing lagi karena init mungkin lama
    await ctx.sendChatAction('typing');

    // Collect full response text
    let fullText = '';
    console.log(`[${chatId}] Subscribing to agent events...`);
    const unsubscribe = agentSession.subscribe((event) => {
      try {
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          fullText += event.assistantMessageEvent.delta;
          // Kirim typing indicator periodik (setiap 4 detik)
          if (fullText.length % 200 < 20) {
            ctx.sendChatAction('typing').catch(() => {});
          }
        }
      } catch (_) {}
    });

    console.log(`[${chatId}] Sending prompt to AI: "${message.slice(0, 50)}..."`);
    await agentSession.prompt(message);
    console.log(`[${chatId}] Prompt completed, response length: ${fullText.length}`);
    unsubscribe();

    if (!fullText.trim()) {
      await ctx.reply('✅ Selesai (tidak ada output teks)');
      return;
    }

    // Cek apakah response mengandung JSON plan
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

    // Kirim response ke Telegram (split jika terlalu panjang)
    const MAX_LEN = 4000;
    if (fullText.length <= MAX_LEN) {
      if (hasPlan) {
        // Tawarkan simpan dengan inline keyboard
        await safeReply(ctx, fullText, {
          reply_markup: {
            inline_keyboard: [[
              { text: '📋 Simpan Rencana', callback_data: 'save_plan' }
            ]]
          }
        });
        // Simpan planData di memory untuk callback
        pendingPlans.set(chatId, planData);
      } else {
        await safeReply(ctx, fullText);
      }
    } else {
      // Split teks panjang
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
              inline_keyboard: [[
                { text: '📋 Simpan Rencana', callback_data: 'save_plan' }
              ]]
            }
          });
          pendingPlans.set(chatId, planData);
        } else {
          await safeReply(ctx, parts[i]);
        }
        // Delay antar parts
        if (i < parts.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
  } catch (err) {
    console.error(`[Telegram] Error for chat ${chatId}:`, err.message);
    await ctx.reply(`❌ Gagal: ${err.message.slice(0, 500)}`).catch(() => {});
  }
});

// ---------- Helper: safe reply dengan format Markdown umum -> Telegram HTML ----------
function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function markdownToTelegramHtml(text) {
  const blocks = [];
  const stash = (html) => {
    const token = `@@MD_BLOCK_${blocks.length}@@`;
    blocks.push(html);
    return token;
  };

  let output = String(text ?? '')
    // Code block dulu supaya isi JSON/code tidak ikut diformat.
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => stash(`<pre>${escapeTelegramHtml(code.trim())}</pre>`))
    .replace(/`([^`]+)`/g, (_, code) => stash(`<code>${escapeTelegramHtml(code)}</code>`));

  output = escapeTelegramHtml(output)
    // Heading markdown jadi bold.
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    // Link markdown: [teks](https://...)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    // Bold/italic/strike umum dari LLM.
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n][\s\S]*?[^_\n])__/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1<i>$2</i>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

  blocks.forEach((block, index) => {
    output = output.replace(`@@MD_BLOCK_${index}@@`, block);
  });

  return output;
}

async function safeReply(ctx, text, extra = {}) {
  if (extra.parse_mode === 'Markdown') {
    try {
      return await ctx.reply(text, extra);
    } catch (err) {
      console.log(`[safeReply] Markdown failed, trying HTML: ${err.message.slice(0, 100)}`);
      const { parse_mode, ...rest } = extra;
      try {
        return await ctx.reply(markdownToTelegramHtml(text), { ...rest, parse_mode: 'HTML' });
      } catch (_) {
        return await ctx.reply(text, rest);
      }
    }
  }

  try {
    return await ctx.reply(markdownToTelegramHtml(text), { ...extra, parse_mode: 'HTML' });
  } catch (err) {
    console.log(`[safeReply] HTML failed, sending plain text: ${err.message.slice(0, 100)}`);
    const { parse_mode, ...rest } = extra;
    return await ctx.reply(text, rest);
  }
}

async function replyLong(ctx, text, extra = {}) {
  const MAX_LEN = 3500;
  const raw = String(text ?? '');
  if (raw.length <= MAX_LEN) return safeReply(ctx, raw, extra);

  const parts = [];
  let remaining = raw;
  while (remaining.length > 0) {
    let splitAt = remaining.lastIndexOf('\n\n', MAX_LEN);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', MAX_LEN);
    if (splitAt <= 0) splitAt = MAX_LEN;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  for (let i = 0; i < parts.length; i++) {
    await safeReply(ctx, parts[i], i === parts.length - 1 ? extra : {});
    if (i < parts.length - 1) await new Promise(r => setTimeout(r, 300));
  }
}

// ---------- Pending plans (untuk inline button) ----------
const pendingPlans = new Map();

// =================================================================
// PRODUK WIZARD — Tambah Produk via Telegram
// =================================================================

const contentWizard = new Map(); // chatId -> { step, data }
const productWizard = new Map(); // chatId -> { step, data: { nama, harga, stok, deskripsi, gambar } }

function isAddProductIntent(text) {
  const normalized = String(text || '').toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  return /\b(tambah|tambahkan|input|masukkan)\b.*\bproduk\b/.test(normalized) ||
         /\bproduk\b.*\b(baru|tambah|tambahkan|input|masukkan)\b/.test(normalized);
}

async function startProductWizard(ctx) {
  const chatId = ctx.chat.id;
  productWizard.set(chatId, { step: 'waiting_nama', data: { nama: '', harga: '', stok: '', deskripsi: '', gambar: '' } });
  await ctx.reply(
    '🏗️ *Tambah Produk Baru*\n\n' +
    'Silakan masukkan *nama produk*:\n\n' +
    '_(Ketik /batal untuk membatalkan)_',
    { parse_mode: 'Markdown' }
  );
}

async function startContentWizard(ctx) {
  const chatId = ctx.chat.id;
  contentWizard.set(chatId, {
    step: 'jenis',
    data: { jenis: '', tujuan: '', produk: '', audiens: '', jadwal: '', tone: '', catatan: '' },
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
    { parse_mode: 'Markdown' }
  );
}

function normalizeContentType(text) {
  const value = String(text || '').trim().toLowerCase();
  const map = {
    '1': 'Edukasi',
    '2': 'Storytelling / brand story',
    '3': 'Soft selling',
    '4': 'Promo / limited stock',
    '5': 'Engagement / tanya jawab',
    '6': 'Custom',
  };
  return map[value] || String(text || '').trim();
}

function normalizeContentGoal(text) {
  const value = String(text || '').trim().toLowerCase();
  const map = {
    '1': 'Awareness — mengenalkan Batik Bakaran / produk',
    '2': 'Edukasi — memberi pengetahuan motif, bahan, perawatan',
    '3': 'Engagement — memancing komentar / diskusi',
    '4': 'Trust building — membangun kepercayaan dan cerita brand',
    '5': 'Traffic / inquiry — mendorong orang tanya stok/harga',
    '6': 'Conversion — mendorong pembelian secara halus',
    '7': 'Retention — menjaga pelanggan lama tetap ingat',
    '8': 'Custom',
  };
  return map[value] || String(text || '').trim();
}

async function getContentProductOptions() {
  const result = await pool.query('SELECT id, nama, harga, stok FROM produk ORDER BY id DESC LIMIT 20');
  return result.rows;
}

function formatContentProductOptions(products) {
  return products.map((p, index) => {
    const harga = Number(p.harga).toLocaleString('id-ID');
    const stok = Number(p.stok) > 0 ? `${p.stok} pcs` : 'Habis';
    return `${index + 1}. *${escMarkdown(p.nama)}* — Rp ${harga} | Stok: ${stok}`;
  }).join('\n');
}

function resolveContentProductChoice(text, products) {
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

function buildContentPrompt(data) {
  return `Buat 1 rencana konten marketing Threads dari wizard Telegram berikut.\n\n` +
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
    `6. Akhiri dengan blok JSON valid berupa ARRAY berisi tepat 1 objek agar bisa disimpan ke database. Field wajib: judul, strategi, target_audiens, kanal, jadwal, scheduled_at, copywriting, produk_terkait, gambar. kanal wajib threads. scheduled_at wajib ISO 8601 +07:00 jika jadwal bisa dipastikan, atau string kosong jika belum pasti.`;
}

async function handleContentWizardText(ctx, text) {
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
        'Balas angka atau tulis tujuan sendiri.'
      );
      return true;
    case 'tujuan': {
      wizard.data.tujuan = normalizeContentGoal(value);
      wizard.step = 'produk';
      const products = await getContentProductOptions();
      wizard.products = products;
      if (products.length === 0) {
        wizard.data.produk = '';
        wizard.step = 'audiens';
        await ctx.reply('📭 Belum ada produk di database. Konten akan dibuat tanpa produk spesifik.\n\n👥 Siapa target audiensnya?\nContoh: wanita 25-40, pecinta batik, pekerja kantor, pembeli hadiah.');
        return true;
      }
      await ctx.reply(
        '🛍 Pilih produk terkait untuk konten pemasaran ini:\n\n' +
        formatContentProductOptions(products) +
        '\n\nBalas dengan angka produk. Contoh: *1*\nKetik *0* jika konten tidak terkait produk tertentu.',
        { parse_mode: 'Markdown' }
      );
      return true;
    }
    case 'produk': {
      const selectedProduct = resolveContentProductChoice(value, wizard.products || []);
      if (selectedProduct === null) {
        await ctx.reply('⚠️ Pilihan produk tidak valid. Balas dengan angka sesuai daftar, atau *0* untuk tanpa produk spesifik.', { parse_mode: 'Markdown' });
        return true;
      }
      wizard.data.produk = selectedProduct;
      wizard.step = 'audiens';
      await ctx.reply('👥 Siapa target audiensnya?\nContoh: wanita 25-40, pecinta batik, pekerja kantor, pembeli hadiah.');
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
      await ctx.reply('🎙 Tone/gaya bahasa?\nContoh: hangat, elegan, edukatif, santai, premium, lokal heritage.');
      return true;
    case 'tone':
      wizard.data.tone = value;
      wizard.step = 'catatan';
      await ctx.reply('📝 Catatan tambahan?\nContoh: jangan terlalu jualan, masukkan CTA komentar, tekankan handmade. Ketik *skip* jika tidak ada.', { parse_mode: 'Markdown' });
      return true;
    case 'catatan':
      wizard.data.catatan = ['skip', '-'].includes(value.toLowerCase()) ? '' : value;
      wizard.step = 'gambar';
      await ctx.reply(
        '🖼 Mau tambahkan gambar/asset visual untuk konten ini?\n\n' +
        'Kirim foto sekarang, atau ketik *skip* jika tidak ada.\n' +
        (isCloudinaryConfigured() ? 'Foto akan diunggah ke Cloudinary.' : 'Cloudinary belum dikonfigurasi, foto akan disimpan lokal.'),
        { parse_mode: 'Markdown' }
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

function isCloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

async function uploadBufferToCloudinary(buffer, folder = 'socai') {
  if (!isCloudinaryConfigured()) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'telegram-photo.jpg');
  form.append('api_key', process.env.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const resp = await fetch(url, { method: 'POST', body: form });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error?.message || `Cloudinary upload gagal: ${resp.status}`);
  return data.secure_url;
}

// Download gambar dari Telegram. Produk disimpan lokal; konten bisa diunggah ke Cloudinary.
async function downloadTelegramPhoto(fileId, options = {}) {
  try {
    const link = await bot.telegram.getFileLink(fileId);
    const ext = path.extname(link.pathname) || '.jpg';

    const resp = await fetch(link.href);
    if (!resp.ok) throw new Error('Gagal download gambar: ' + resp.status);
    const buffer = Buffer.from(await resp.arrayBuffer());

    if (options.cloudinary) {
      const cloudUrl = await uploadBufferToCloudinary(buffer, options.folder || 'socai');
      if (cloudUrl) return cloudUrl;
    }

    const prefix = options.prefix || 'produk-telegram';
    const filename = prefix + '-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    const filepath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filepath, buffer);

    return '/uploads/' + filename;
  } catch (err) {
    throw new Error('Gagal memproses gambar: ' + err.message);
  }
}

// Render daftar produk
async function renderProdukList() {
  const result = await pool.query('SELECT id, nama, harga, stok FROM produk ORDER BY id DESC LIMIT 20');
  if (result.rows.length === 0) return '📭 Belum ada produk.';
  return result.rows.map((p, i) => {
    const harga = Number(p.harga).toLocaleString('id-ID');
    const stok = Number(p.stok) > 0 ? Number(p.stok) : '🟡 Habis';
    return `${i + 1}. *${p.nama}*\n   💰 Rp ${harga}  |  📦 Stok: ${stok}`;
  }).join('\n\n');
}

// ---------- /listproduk ----------
bot.command('listproduk', async (ctx) => {
  await ctx.sendChatAction('typing');
  try {
    const text = await renderProdukList();
    await safeReply(ctx, '🛍️ *Daftar Produk:*\n\n' + text, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply('❌ Gagal mengambil data: ' + err.message);
  }
});

// ---------- /buatkonten (content marketing wizard) ----------
bot.command('buatkonten', (ctx) => startContentWizard(ctx));

// ---------- /tambahproduk (start wizard) ----------
bot.command('tambahproduk', (ctx) => startProductWizard(ctx));

// ---------- /batal (cancel wizard) ----------
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
  if (cancelled) {
    ctx.reply('❌ Pembatalan. Tidak ada perubahan yang disimpan.');
  } else {
    ctx.reply('Tidak ada proses yang sedang berjalan.');
  }
});

// ---------- Handler wizard: text (untuk step wizard) ----------
// Kita tangani text yg masuk saat wizard aktif
async function handleWizardText(ctx, text) {
  const chatId = ctx.chat.id;
  const wizard = productWizard.get(chatId);
  if (!wizard) return false; // bukan wizard

  // Cancel jika user kirim /batal (handler command sudah di atas, tapi jaga-jaga)
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
      await ctx.reply('✅ Nama: *' + escMarkdown(text.trim()) + '*\n\nSekarang masukkan *harga* (angka, contoh: 50000):', { parse_mode: 'Markdown' });
      return true;

    case 'waiting_harga':
      {
        const harga = Number(text.replace(/[^0-9]/g, ''));
        if (!Number.isFinite(harga) || harga < 0) {
          await ctx.reply('⚠️ Harga harus angka positif. Coba lagi:');
          return true;
        }
        wizard.data.harga = harga;
        wizard.step = 'waiting_stok';
        await ctx.reply('✅ Harga: Rp ' + Number(harga).toLocaleString('id-ID') + '\n\nSekarang masukkan *jumlah stok* (angka, contoh: 10):', { parse_mode: 'Markdown' });
        return true;
      }

    case 'waiting_stok':
      {
        const stok = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
        if (!Number.isFinite(stok) || stok < 0) {
          await ctx.reply('⚠️ Stok harus angka positif. Coba lagi:');
          return true;
        }
        wizard.data.stok = stok;
        wizard.step = 'waiting_deskripsi';
        await ctx.reply(
          '✅ Stok: ' + stok + ' pcs\n\nSekarang masukkan *deskripsi produk* (atau ketik *skip* jika tidak ada):',
          { parse_mode: 'Markdown' }
        );
        return true;
      }

    case 'waiting_deskripsi':
      if (text.toLowerCase() === 'skip' || text.toLowerCase() === '-' || text.toLowerCase() === 'tidak ada') {
        wizard.data.deskripsi = '';
      } else {
        wizard.data.deskripsi = text.trim();
      }
      wizard.step = 'waiting_gambar';
      await ctx.reply(
        '✅ Deskripsi: ' + (wizard.data.deskripsi ? escMarkdown(wizard.data.deskripsi.slice(0, 100)) : '(kosong)') +
        '\n\nSekarang kirim *foto produk* (atau ketik *skip* jika tidak ada):',
        { parse_mode: 'Markdown' }
      );
      return true;

    case 'waiting_gambar':
      if (text.toLowerCase() === 'skip' || text.toLowerCase() === '-' || text.toLowerCase() === 'tidak ada') {
        wizard.data.gambar = '';
        wizard.step = 'confirm';
        await showProductConfirm(ctx, wizard.data);
        return true;
      }
      await ctx.reply('⚠️ Kirim foto produk, atau ketik *skip* untuk melewati.', { parse_mode: 'Markdown' });
      return true;

    default:
      return false;
  }
}

// Tampilkan konfirmasi sebelum simpan
async function showProductConfirm(ctx, data) {
  const harga = Number(data.harga).toLocaleString('id-ID');
  const text =
    '🔄 *Konfirmasi Produk*\n\n' +
    'Nama: *' + escMarkdown(data.nama) + '*\n' +
    'Harga: Rp ' + harga + '\n' +
    'Stok: ' + data.stok + ' pcs\n' +
    'Deskripsi: ' + (data.deskripsi ? escMarkdown(data.deskripsi.slice(0, 100)) : '_(kosong)_') + '\n' +
    'Gambar: ' + (data.gambar ? '✅ Ada' : '❌ Tidak ada') + '\n\n' +
    'Simpan produk ini?';
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Simpan', callback_data: 'save_produk' }],
        [{ text: '❌ Batal', callback_data: 'cancel_produk' }],
      ]
    }
  });
}

// Escape markdown untuk Telegram
function escMarkdown(s) {
  if (!s) return '';
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// ---------- Handler wizard: foto ----------
bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;

  const content = contentWizard.get(chatId);
  if (content) {
    if (content.step !== 'gambar') {
      await ctx.reply('⚠️ Foto diterima, tapi wizard konten belum masuk tahap gambar. Ketik /batal untuk mulai ulang.');
      return;
    }

    await ctx.sendChatAction('typing');
    try {
      const photo = ctx.message.photo;
      const fileId = photo[photo.length - 1].file_id;
      const url = await downloadTelegramPhoto(fileId, { cloudinary: true, folder: 'socai/content', prefix: 'konten-telegram' });
      content.data.gambar = url;
      const prompt = buildContentPrompt(content.data);
      contentWizard.delete(chatId);
      await ctx.reply('✅ Gambar berhasil ditambahkan. Saya lempar brief ke AI untuk dibuatkan kontennya...');
      // Kirim prompt hasil wizard ke handler AI generic tanpa perlu user mengetik ulang.
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
      await ctx.reply('❌ ' + err.message + '\n\nKetik *skip* untuk tanpa gambar, atau kirim foto lagi.', { parse_mode: 'Markdown' });
      return;
    }
  }

  const wizard = productWizard.get(chatId);
  if (!wizard) return; // bukan wizard, abaikan

  if (wizard.step !== 'waiting_gambar') {
    await ctx.reply('⚠️ Foto diterima, tapi sedang tidak dalam tahap gambar. Ketik /batal untuk mulai ulang.');
    return;
  }

  await ctx.sendChatAction('typing');

  try {
    // Ambil foto resolusi tertinggi (terakhir di array)
    const photo = ctx.message.photo;
    const fileId = photo[photo.length - 1].file_id;
    const url = await downloadTelegramPhoto(fileId);
    wizard.data.gambar = url;
    wizard.step = 'confirm';
    await ctx.reply('✅ Foto berhasil diunggah!');
    await showProductConfirm(ctx, wizard.data);
    productWizard.set(chatId, wizard);
  } catch (err) {
    await ctx.reply('❌ ' + err.message + '\n\nKetik *skip* untuk lewati gambar, atau kirim foto lagi.', { parse_mode: 'Markdown' });
  }
});

// ---------- Callback: simpan produk ----------
bot.action('save_produk', async (ctx) => {
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
    const result = await pool.query(
      'INSERT INTO produk (nama, harga, stok, gambar, deskripsi) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [nama, Number(harga), Number(stok), gambar || '', deskripsi || '']
    );
    productWizard.delete(chatId);
    await ctx.reply(
      '✅ *Produk berhasil ditambahkan!*\n\n' +
      'Nama: *' + escMarkdown(nama) + '*\n' +
      'Harga: Rp ' + Number(harga).toLocaleString('id-ID') + '\n' +
      'Stok: ' + stok + ' pcs\n' +
      'ID: `' + result.rows[0].id + '`',
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.reply('❌ Gagal menyimpan: ' + err.message.slice(0, 500));
  }
});

// ---------- Callback: batal produk ----------
bot.action('cancel_produk', async (ctx) => {
  const chatId = ctx.chat.id;
  productWizard.delete(chatId);
  await ctx.answerCbQuery('❌ Dibatalkan');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await ctx.reply('❌ Pembatalan. Tidak ada perubahan yang disimpan.');
});

// ---------- Handler: callback inline keyboard ----------
bot.action('save_plan', async (ctx) => {
  const chatId = ctx.chat.id;
  const planData = pendingPlans.get(chatId);

  if (!planData) {
    await ctx.answerCbQuery('❌ Data rencana tidak ditemukan. Coba generate ulang.');
    return;
  }

  await ctx.answerCbQuery('⏳ Menyimpan...');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  try {
    const saved = await savePlansToDb(planData);
    const count = Array.isArray(saved) ? saved.length : 1;
    await ctx.reply(`✅ ${count} rencana pemasaran berhasil disimpan ke database!`);
    pendingPlans.delete(chatId);
  } catch (err) {
    await ctx.reply(`❌ Gagal menyimpan: ${err.message.slice(0, 500)}`);
  }
});

function fmtPlan(row) {
  const status = row.status || row.repliz_status || 'draft';
  return `#${row.id} [${status}] ${row.judul || '-'}\n📅 ${row.jadwal || row.scheduled_at || '-'}\n🧵 ${(row.copywriting || row.strategi || '').slice(0, 180)}`;
}

async function getPlanById(id) {
  if (!/^\d+$/.test(String(id || ''))) return null;
  const result = await pool.query('SELECT * FROM pemasaran WHERE id = $1', [id]);
  return result.rows[0] || null;
}

bot.command('jadwalkonten', async (ctx) => {
  const scope = (ctx.message.text.split(/\s+/)[1] || 'minggu').toLowerCase();
  const limit = scope === 'bulan' ? 30 : scope === 'hariini' || scope === 'hari' ? 10 : 20;
  const result = await pool.query(
    `SELECT * FROM pemasaran
     WHERE lower(coalesce(kanal, 'threads')) = 'threads'
     ORDER BY coalesce(scheduled_at, created_at) ASC, id ASC
     LIMIT $1`, [limit]
  );
  if (!result.rows.length) return ctx.reply('Belum ada rencana konten.');
  return replyLong(ctx, '📅 Kalender konten:\n\n' + result.rows.map(fmtPlan).join('\n\n'));
});

bot.command('statuskonten', async (ctx) => {
  const status = (ctx.message.text.split(/\s+/)[1] || 'scheduled').toLowerCase();
  const allowed = new Set(['draft', 'scheduled', 'posting', 'posted', 'failed', 'cancelled']);
  if (!allowed.has(status)) return ctx.reply('Status valid: draft, scheduled, posting, posted, failed, cancelled.\nContoh: /statuskonten draft');
  const result = await pool.query('SELECT * FROM pemasaran WHERE lower(coalesce(status, $1)) = $1 ORDER BY created_at DESC, id DESC LIMIT 20', [status]);
  if (!result.rows.length) return ctx.reply(`Tidak ada konten berstatus ${status}.`);
  return replyLong(ctx, `📌 Konten status ${status}:\n\n` + result.rows.map(fmtPlan).join('\n\n'));
});

bot.command('ubahstatuskonten', async (ctx) => {
  const [, id, status] = ctx.message.text.trim().split(/\s+/);
  const allowed = new Set(['draft', 'scheduled', 'posting', 'posted', 'failed', 'cancelled']);
  if (!/^\d+$/.test(String(id || '')) || !allowed.has((status || '').toLowerCase())) return ctx.reply('Format: /ubahstatuskonten ID status\nStatus: draft, scheduled, posting, posted, failed, cancelled');
  const result = await pool.query('UPDATE pemasaran SET status = $2 WHERE id = $1 RETURNING *', [id, status.toLowerCase()]);
  if (!result.rows.length) return ctx.reply('Rencana konten tidak ditemukan.');
  return ctx.reply('✅ Status diperbarui:\n\n' + fmtPlan(result.rows[0]));
});

bot.command('hapuskonten', async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts[1] !== 'HAPUS' || !/^\d+$/.test(String(parts[2] || ''))) return ctx.reply('Konfirmasi ganda diperlukan. Format: /hapuskonten HAPUS ID\nContoh: /hapuskonten HAPUS 12');
  const result = await pool.query('DELETE FROM pemasaran WHERE id = $1 RETURNING id, judul', [parts[2]]);
  if (!result.rows.length) return ctx.reply('Rencana konten tidak ditemukan.');
  return ctx.reply(`✅ Rencana #${result.rows[0].id} dihapus: ${result.rows[0].judul || '-'}`);
});

const bulanIndonesia = {
  jan: 0, januari: 0,
  feb: 1, februari: 1,
  mar: 2, maret: 2,
  apr: 3, april: 3,
  mei: 4,
  jun: 5, juni: 5,
  jul: 6, juli: 6,
  agu: 7, agustus: 7,
  sep: 8, september: 8,
  okt: 9, oktober: 9,
  nov: 10, november: 10,
  des: 11, desember: 11,
};

function parseMarketingSchedule(plan) {
  const raw = plan?.scheduled_at || plan?.repliz_scheduled_at;
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const text = String(plan?.jadwal || '').trim().toLowerCase();
  const isoLike = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t,]+(\d{1,2})(?::|\.)(\d{2}))?/i);
  if (isoLike) {
    const [, y, m, d, hh = '0', mm = '0'] = isoLike;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
    if (!Number.isNaN(date.getTime())) return date;
  }
  const idDate = text.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (idDate) {
    const time = text.match(/(?:jam|pukul)?\s*(\d{1,2})(?:[:.](\d{2}))\s*(?:wib)?/i);
    const date = new Date(Number(idDate[3]), bulanIndonesia[idDate[2]], Number(idDate[1]), time ? Number(time[1]) : 0, time ? Number(time[2]) : 0);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function extractReplizScheduleId(response) {
  return response?.scheduleId || response?.id || response?._id || response?.data?.scheduleId || response?.data?.id || response?.data?._id || response?.schedule?.id || null;
}

function normalizeReplizStatus(schedule) {
  const status = String(schedule?.status || '').toLowerCase();
  if (['pending', 'process', 'error', 'success'].includes(status)) return status;
  return status || 'unknown';
}

async function syncReplizPlanStatus(id) {
  const plan = await getPlanById(id);
  if (!plan) throw new Error('Rencana konten tidak ditemukan.');
  if (!plan.repliz_schedule_id) throw new Error('Rencana ini belum punya schedule id Repliz.');
  const schedule = await getReplizSchedule(plan.repliz_schedule_id);
  const replizStatus = normalizeReplizStatus(schedule);
  const localStatus = replizStatus === 'success' ? 'posted' : replizStatus === 'error' ? 'failed' : 'scheduled';
  const saved = await pool.query(
    `UPDATE pemasaran
     SET repliz_status = $2,
         repliz_synced_at = NOW(),
         external_status = $2,
         status = $3,
         published_at = CASE WHEN $2 = 'success' THEN coalesce(published_at, NOW()) ELSE published_at END,
         repliz_last_error = CASE WHEN $2 = 'error' THEN coalesce($4, repliz_last_error) ELSE NULL END,
         last_error = CASE WHEN $2 = 'error' THEN coalesce($4, last_error) ELSE NULL END
     WHERE id = $1 RETURNING *`,
    [id, replizStatus, localStatus, schedule?.error || schedule?.message || null]
  );
  return { plan: saved.rows[0], repliz: schedule };
}

async function scheduleViaRepliz(ctx, id, { postNow = false, force = false } = {}) {
  if (!/^\d+$/.test(String(id || ''))) return ctx.reply('Format: /jadwalkan ID atau /postnow ID atau /retrypost ID');
  if (!isReplizConfigured()) return ctx.reply('⚠️ Repliz belum dikonfigurasi. Isi REPLIZ_API_KEY, REPLIZ_SECRET, dan REPLIZ_ACCOUNT_ID.');
  const plan = await getPlanById(id);
  if (!plan) return ctx.reply('Rencana konten tidak ditemukan.');
  if (plan.repliz_schedule_id && !postNow && !force) return ctx.reply(`ℹ️ Konten #${id} sudah punya Repliz schedule id: ${plan.repliz_schedule_id}\nGunakan /cekpost ${id} untuk cek status.`);
  const parsedSchedule = parseMarketingSchedule(plan);
  const scheduleAt = postNow ? new Date(Date.now() + 60_000).toISOString() : parsedSchedule?.toISOString();
  if (!scheduleAt) return ctx.reply('Jadwal belum bisa diparse. Gunakan format seperti: 2026-06-05 19:00 atau 5 Juni 2026 jam 19:00.');
  await pool.query('UPDATE pemasaran SET status = $2::varchar, repliz_status = $2::text, repliz_attempts = coalesce(repliz_attempts,0)+1, scheduled_at = $3, repliz_last_error = NULL WHERE id = $1', [id, 'posting', scheduleAt]);
  try {
    const response = await createThreadsSchedule(plan, { scheduleAt });
    const externalId = extractReplizScheduleId(response);
    if (!externalId) throw new Error('Repliz tidak mengembalikan schedule id.');
    await pool.query(
      `UPDATE pemasaran SET status = 'scheduled', repliz_status = 'pending', external_status = 'pending', repliz_schedule_id = $2, external_post_id = $2, repliz_scheduled_at = $3, repliz_synced_at = now(), repliz_last_error = null, last_error = null WHERE id = $1`,
      [id, externalId, scheduleAt]
    );
    return ctx.reply(`✅ Konten #${id} dikirim ke Repliz${postNow ? ' untuk post segera' : ''}.\nSchedule ID: ${externalId}`);
  } catch (err) {
    await pool.query("UPDATE pemasaran SET status = 'failed', repliz_status = 'error', external_status = 'error', repliz_last_error = $2, last_error = $2 WHERE id = $1", [id, err.message.slice(0, 1000)]);
    return ctx.reply(`❌ Repliz gagal: ${err.message.slice(0, 500)}`);
  }
}

bot.command('jadwalkan', (ctx) => scheduleViaRepliz(ctx, ctx.message.text.trim().split(/\s+/)[1], { postNow: false, force: false }));
bot.command('postnow', (ctx) => scheduleViaRepliz(ctx, ctx.message.text.trim().split(/\s+/)[1], { postNow: true, force: false }));
bot.command('retrypost', (ctx) => scheduleViaRepliz(ctx, ctx.message.text.trim().split(/\s+/)[1], { postNow: false, force: true }));
bot.command('cekpost', async (ctx) => {
  const id = ctx.message.text.trim().split(/\s+/)[1];
  if (!/^\d+$/.test(String(id || ''))) return ctx.reply('Format: /cekpost ID');
  try {
    const result = await syncReplizPlanStatus(id);
    return ctx.reply(`📡 Status Repliz #${id}\n\nSchedule ID: ${result.plan.repliz_schedule_id}\nStatus Repliz: ${result.plan.repliz_status}\nStatus lokal: ${result.plan.status}`);
  } catch (err) {
    return ctx.reply(`❌ Gagal cek status: ${err.message.slice(0, 500)}`);
  }
});

// ---------- Error handler ----------
bot.catch((err, ctx) => {
  console.error(`[Telegram] Unhandled error for ${ctx?.updateType}:`, err);
});

// ---------- Global error handlers ----------
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection:', reason?.message || reason);
});

// ---------- Start bot (long polling) ----------
const startBot = async () => {
  try {
    // Test koneksi database
    await pool.query('SELECT 1');
    await ensureMarketingSchema();
    console.log('✅ Database connected');

    // Test koneksi Telegram
    const botInfo = await bot.telegram.getMe();
    console.log(`✅ Bot @${botInfo.username} terhubung (long polling)`);

    // Sinkronkan menu command Telegram agar tidak memakai command lama dari BotFather/aplikasi lain.
    await syncBotCommands();
    console.log('✅ Telegram bot commands synced');

    // Launch bot (this never resolves - polling runs forever)
    await bot.launch();
    console.log('🤖 Telegram bot siap!');
  } catch (err) {
    console.error('❌ Gagal start bot:', err.message);
    process.exit(1);
  }
};

startBot();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n[Telegram] Shutting down...');
  bot.stop('SIGINT');
  // Cleanup agent sessions
  for (const [sessionKey, session] of agentSessions) {
    if (sessionKey.startsWith('telegram:')) {
      session.abort().catch(() => {});
      agentSessions.delete(sessionKey);
      agentSessionLastUsed.delete(sessionKey);
      agentSessionPromises.delete(sessionKey);
    }
  }
  process.exit(0);
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
