import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Telegraf } from 'telegraf';
import { createTelegramAccess } from './telegramAccess.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let telegramApi = null;

function getTelegramApi() {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  if (!token) return null;
  if (!telegramApi) {
    telegramApi = new Telegraf(token).telegram;
  }
  return telegramApi;
}

function loadNotifyUserIds() {
  const superAdminId = Number(process.env.TELEGRAM_SUPER_ADMIN_ID || 0);
  const usersFile = path.join(__dirname, '..', 'telegram-users.json');
  const access = createTelegramAccess({ usersFile, superAdminId });
  const minRole = (process.env.TELEGRAM_APPROVAL_NOTIFY_ROLES || 'operator')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .reduce((lowest, role) => {
      const rank = { viewer: 1, operator: 2, super_admin: 3 };
      return (rank[role] || 2) < (rank[lowest] || 2) ? role : lowest;
    }, 'operator');

  return access.listUsers()
    .filter((u) => access.hasRole(u.id, minRole))
    .map((u) => u.id);
}

export async function notifyTelegramOperators(text, extra = {}) {
  const api = getTelegramApi();
  if (!api) {
    console.warn('[TelegramNotify] Bot token tidak tersedia — notifikasi dilewati.');
    return { sent: 0, skipped: true, reason: 'no_token' };
  }

  const userIds = [...new Set(loadNotifyUserIds())];
  let sent = 0;
  for (const chatId of userIds) {
    try {
      await api.sendMessage(chatId, text, extra);
      sent++;
    } catch (err) {
      console.error(`[TelegramNotify] Gagal kirim ke ${chatId}:`, err.message);
    }
  }
  return { sent, skipped: false, targets: userIds.length };
}