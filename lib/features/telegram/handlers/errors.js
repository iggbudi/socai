export function registerTelegramErrorHandler(bot) {
  bot.catch((err, ctx) => {
    console.error(`[Telegram] Unhandled error for ${ctx?.updateType}:`, err);
  });
}
