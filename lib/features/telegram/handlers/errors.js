import { telegramLogger } from '../../../shared/logger.js';

export function registerTelegramErrorHandler(bot) {
  bot.catch((err, ctx) => {
    telegramLogger(ctx, 'telegram').error({ err, updateType: ctx?.updateType }, 'Unhandled Telegram error');
  });
}
