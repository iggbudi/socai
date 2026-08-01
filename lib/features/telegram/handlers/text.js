import { safeReply } from '../helpers.js';
import { requireTelegramRole } from '../commands/akses.js';
import {
  handleWizardText,
  isAddProductIntent,
  showProductConfirm,
  startProductWizard,
} from '../wizards/produk.js';
import { handleContentWizardText } from '../wizards/konten.js';
import { telegramLogger } from '../../../shared/logger.js';

export function registerTextHandler(
  bot,
  {
    access,
    dbPool,
    agentSessions,
    touchAgentSession,
    initAgent,
    createAgentRun,
    completeAgentRun,
    resolveAutonomyMode,
    normalizeAiMessage,
    AiMessageError,
    telegramAiRateLimiter,
    pendingPlans,
    contentWizard,
    productWizard,
  },
) {
  const handleText = async (ctx, next) => {
    const chatId = ctx.chat.id;
    const log = telegramLogger(ctx, 'telegram.text');
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
        log.info({ chatId }, 'Initializing agent');
        await ctx.reply('⏳ Menyiapkan AI agent...');
        agentSession = await initAgent(sessionKey);
        log.info({ chatId }, 'Agent ready');
      }

      await ctx.sendChatAction('typing');

      let fullText = '';
      log.debug({ chatId }, 'Subscribing to agent events');
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
        log.error({ err, chatId }, 'createAgentRun error');
      }

      log.debug({ chatId, messagePreview: message.slice(0, 50) }, 'Sending prompt to AI');
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
      log.debug({ chatId, responseLength: fullText.length }, 'Prompt completed');
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
      log.error({ err, chatId }, 'Telegram text handler error');
      await ctx.reply(`❌ Gagal: ${err.message.slice(0, 500)}`).catch(() => {});
    }
  };

  bot.on('text', handleText);
  return handleText;
}
