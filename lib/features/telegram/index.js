// lib/features/telegram/index.js — public API fitur telegram (vertical slicing F8).
// CATATAN: bot.js bersifat self-executing (launch long-polling saat di-import) —
// jangan di-import dari test/atau modul lain; entry point root: telegram-bot.js.
export { createTelegramAccess } from './access.js';
export { safeReply, replyLong, markdownToTelegramHtml, escapeTelegramHtml } from './helpers.js';
