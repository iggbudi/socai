import { escMarkdown } from '../helpers/format.js';

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  operator: 'Operator',
  viewer: 'Viewer',
};

export function getTelegramUserId(ctx) {
  return Number(ctx.from?.id);
}

export function formatTelegramRole(userId, access) {
  const role = access.getRole(userId);
  return role ? ROLE_LABELS[role] || role : 'Belum Terdaftar';
}

export function requireTelegramRole(ctx, minRole, access) {
  const userId = getTelegramUserId(ctx);
  if (!access.hasRole(userId, minRole)) {
    ctx.reply('⛔ Akses ditolak untuk perintah ini.');
    return false;
  }
  return true;
}

export function registerTelegramAccessMiddleware(bot, { access }) {
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
}

export function registerAccessCommands(bot, { access }) {
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
}
