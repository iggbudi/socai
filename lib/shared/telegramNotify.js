import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Telegraf } from 'telegraf';
import { createTelegramAccess } from '../features/telegram/access.js';
import { childLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let telegramApi = null;
const log = childLogger('telegram.notify');

function getTelegramApi() {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  if (!token) return null;
  if (!telegramApi) {
    telegramApi = new Telegraf(token).telegram;
  }
  return telegramApi;
}

const ROLE_NOTIFY_RANK = { viewer: 1, operator: 2, super_admin: 3 };

// D4: reduce lama diinisialisasi 'operator' (rank 2) sebagai akumulator, sehingga peran
// dengan rank lebih tinggi (super_admin) tidak pernah menang melawan default itu sendiri.
// Hitung rank minimum dari peran yang benar-benar dikonfigurasi, lalu petakan balik ke nama peran.
export function resolveNotifyMinRole(value = process.env.TELEGRAM_APPROVAL_NOTIFY_ROLES) {
  const roles = (value || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  if (roles.length === 0) return 'operator';

  const minRank = Math.min(...roles.map((role) => ROLE_NOTIFY_RANK[role] || ROLE_NOTIFY_RANK.operator));
  return Object.keys(ROLE_NOTIFY_RANK).find((name) => ROLE_NOTIFY_RANK[name] === minRank) || 'operator';
}

function loadNotifyUserIds() {
  const superAdminId = Number(process.env.TELEGRAM_SUPER_ADMIN_ID || 0);
  const usersFile = path.join(__dirname, '..', 'telegram-users.json');
  const access = createTelegramAccess({ usersFile, superAdminId });
  const minRole = resolveNotifyMinRole();

  return access
    .listUsers()
    .filter((u) => access.hasRole(u.id, minRole))
    .map((u) => u.id);
}

export async function notifyTelegramOperators(
  text,
  extra = {},
  { api = getTelegramApi(), listUserIds = loadNotifyUserIds } = {},
) {
  if (!api) {
    log.warn('Bot token tidak tersedia; notifikasi dilewati');
    return { sent: 0, skipped: true, reason: 'no_token' };
  }

  const userIds = [...new Set(listUserIds())];
  let sent = 0;
  for (const chatId of userIds) {
    try {
      await api.sendMessage(chatId, text, extra);
      sent++;
    } catch (err) {
      log.error({ err, chatId }, 'Gagal mengirim notifikasi Telegram');
    }
  }
  return { sent, skipped: false, targets: userIds.length };
}
