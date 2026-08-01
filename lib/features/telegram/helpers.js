// lib/features/telegram/helpers.js — render aman untuk Telegram (vertical slicing F8).
// Fungsi murni: hanya bergantung pada ctx.reply — bisa diuji tanpa bot.
import { telegramLogger } from '../../shared/logger.js';

export function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function markdownToTelegramHtml(text) {
  const blocks = [];
  const stash = (html) => {
    const token = `@@MD_BLOCK_${blocks.length}@@`;
    blocks.push(html);
    return token;
  };

  let output = String(text ?? '')
    // Code block dulu supaya isi JSON/code tidak ikut diformat.
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) =>
      stash(`<pre>${escapeTelegramHtml(code.trim())}</pre>`),
    )
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

export async function safeReply(ctx, text, extra = {}) {
  if (extra.parse_mode === 'Markdown') {
    try {
      return await ctx.reply(text, extra);
    } catch (err) {
      telegramLogger(ctx, 'telegram.reply').warn({ err }, 'Markdown reply failed; trying HTML');
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
    telegramLogger(ctx, 'telegram.reply').warn({ err }, 'HTML reply failed; sending plain text');
    const { parse_mode, ...rest } = extra;
    return await ctx.reply(text, rest);
  }
}

export async function replyLong(ctx, text, extra = {}) {
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
    if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
}
