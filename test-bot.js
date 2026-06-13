import 'dotenv/config';
import { Telegraf } from 'telegraf';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
console.log('Token length:', BOT_TOKEN?.length);
const bot = new Telegraf(BOT_TOKEN);

let handlerCount = 0;

bot.use((ctx, next) => {
  console.log(`[use] updateType: ${ctx.updateType}, has message: ${!!ctx.message}`);
  handlerCount++;
  return next().catch(e => console.error('[use error]', e.message));
});

bot.command('start', (ctx) => {
  console.log('[command:start] FIRED!');
  handlerCount++;
  return ctx.reply('Hello from /start!');
});

bot.command('test', (ctx) => {
  console.log('[command:test] FIRED!');
  handlerCount++;
  return ctx.reply('Test OK!');
});

bot.on('text', (ctx) => {
  console.log(`[on:text] "${ctx.message.text}"`);
  handlerCount++;
  return ctx.reply('Echo: ' + ctx.message.text);
});

bot.catch((err, ctx) => {
  console.error('[catch]', err?.message || err);
});

async function main() {
  try {
    const info = await bot.telegram.getMe();
    console.log(`Bot: @${info.username} (id: ${info.id})`);

    // Delete webhook to ensure polling works
    await bot.telegram.deleteWebhook();
    console.log('Webhook deleted');

    // Start with both launch() and poll manually
    console.log('Starting polling...');
    
    // Manual long polling loop instead of bot.launch()
    let offset = 0;
    let running = true;
    
    setTimeout(() => {
      console.log('Timeout reached, stopping...');
      running = false;
    }, 20000);

    while (running) {
      try {
        const updates = await bot.telegram.getUpdates({
          offset,
          timeout: 5,
          allowed_updates: ['message'],
        });
        
        for (const update of updates) {
          console.log(`[poll] Got update ${update.update_id}:`, update.message?.text);
          offset = update.update_id + 1;
          await bot.handleUpdate(update);
        }
      } catch (e) {
        console.error('[poll error]', e.message);
      }
    }
    
    console.log(`Handler count: ${handlerCount}`);
    console.log('Done');
    process.exit(0);
  } catch (e) {
    console.error('[main error]', e);
    process.exit(1);
  }
}

main();
