import 'dotenv/config';
import { Telegraf } from 'telegraf';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateBotEnvironment } from '../../env.js';
import { pool } from '../../shared/db.js';
import {
  agentSessions,
  agentSessionLastUsed,
  agentSessionPromises,
  touchAgentSession,
  initAgent,
} from '../agent/core.js';
import { createAgentRun, completeAgentRun } from '../agent/runs.js';
import { resolveAutonomyMode } from '../agent/actuator/index.js';
import { isReplizConfigured } from '../../shared/repliz.js';
import {
  savePlansToDb,
  schedulePlanToRepliz,
  schedulePlanToReplizNow,
  syncPlanReplizStatus,
} from '../pemasaran/domain.js';
import { normalizeAiMessage, AiMessageError } from '../agent/aiLimits.js';
import { createRateLimiter } from '../../shared/rateLimit.js';
import { createTelegramAccess } from './access.js';
import { approvePlanSchedule, rejectPlanSchedule } from '../agent/approval.js';
import { registerTelegramHandlers, defaultBotCommands, superAdminBotCommands } from './commands.js';
import { ensureSchemaReady, syncBotCommands } from './schema.js';
import { childLogger } from '../../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'public', 'uploads');
const TELEGRAM_USERS_FILE = path.join(__dirname, '..', '..', '..', 'telegram-users.json');
const log = childLogger('telegram.bot');

export function resolveBotToken(env = process.env) {
  return env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || env.TELEGRAM_TOKEN || '';
}

function createDefaultRateLimiter(env) {
  return createRateLimiter({
    limit: Number(env.TELEGRAM_AI_RATE_LIMIT) || 10,
    windowMs: Number(env.TELEGRAM_AI_RATE_WINDOW_MS) || 60000,
    keyFn: (chatId) => `telegram:${chatId}`,
  });
}

function createRuntimeState(options = {}) {
  return (
    options.state || {
      pendingPlans: new Map(),
      contentWizard: new Map(),
      productWizard: new Map(),
      uploadDir: options.uploadDir || UPLOAD_DIR,
    }
  );
}

/**
 * Build and register a Telegram bot without starting long polling.
 * The optional seams keep factory tests independent from Telegram, DB, and AI services.
 */
export function createBot(options = {}) {
  const env = options.env || process.env;
  const token = options.token ?? resolveBotToken(env);
  if (!token) {
    throw new Error(
      'Token bot Telegram tidak diatur. Isi TELEGRAM_BOT_TOKEN di .env (fallback alias: BOT_TOKEN atau TELEGRAM_TOKEN).',
    );
  }

  const createTelegraf =
    options.telegrafFactory || ((botToken, telegrafOptions) => new Telegraf(botToken, telegrafOptions));
  const bot = createTelegraf(token, {
    // AI responses/planning can take longer than Telegraf's default 90s timeout.
    handlerTimeout: Number(env.TELEGRAM_HANDLER_TIMEOUT_MS) || 10 * 60 * 1000,
  });
  const superAdminId = Number((options.superAdminId ?? env.TELEGRAM_SUPER_ADMIN_ID) || 275313615);
  const access =
    options.access ||
    createTelegramAccess({
      usersFile: options.usersFile || TELEGRAM_USERS_FILE,
      superAdminId,
    });
  const state = createRuntimeState(options);
  const dbPool = options.dbPool || pool;
  const telegramAiRateLimiter = options.rateLimiter || createDefaultRateLimiter(env);

  registerTelegramHandlers({
    bot,
    access,
    superAdminId,
    state,
    dependencies: {
      dbPool,
      telegramAiRateLimiter,
      agentSessions: options.agentSessions || agentSessions,
      agentSessionLastUsed: options.agentSessionLastUsed || agentSessionLastUsed,
      agentSessionPromises: options.agentSessionPromises || agentSessionPromises,
      touchAgentSession: options.touchAgentSession || touchAgentSession,
      initAgent: options.initAgent || initAgent,
      createAgentRun: options.createAgentRun || createAgentRun,
      completeAgentRun: options.completeAgentRun || completeAgentRun,
      resolveAutonomyMode: options.resolveAutonomyMode || resolveAutonomyMode,
      normalizeAiMessage: options.normalizeAiMessage || normalizeAiMessage,
      AiMessageError: options.AiMessageError || AiMessageError,
      isReplizConfigured: options.isReplizConfigured || isReplizConfigured,
      savePlansToDb: options.savePlansToDb || savePlansToDb,
      schedulePlanToRepliz: options.schedulePlanToRepliz || schedulePlanToRepliz,
      schedulePlanToReplizNow: options.schedulePlanToReplizNow || schedulePlanToReplizNow,
      syncPlanReplizStatus: options.syncPlanReplizStatus || syncPlanReplizStatus,
      approvePlanSchedule: options.approvePlanSchedule || approvePlanSchedule,
      rejectPlanSchedule: options.rejectPlanSchedule || rejectPlanSchedule,
    },
  });

  bot.__socaiRuntime = {
    dbPool,
    access,
    state,
    superAdminId,
    agentSessions: options.agentSessions || agentSessions,
    agentSessionLastUsed: options.agentSessionLastUsed || agentSessionLastUsed,
    agentSessionPromises: options.agentSessionPromises || agentSessionPromises,
  };
  return bot;
}

function cleanupTelegramSessions(bot, runtime) {
  for (const [sessionKey, session] of runtime.agentSessions || agentSessions) {
    if (sessionKey.startsWith('telegram:')) {
      session.abort().catch(() => {});
      (runtime.agentSessions || agentSessions).delete(sessionKey);
      (runtime.agentSessionLastUsed || agentSessionLastUsed).delete(sessionKey);
      (runtime.agentSessionPromises || agentSessionPromises).delete(sessionKey);
    }
  }
  bot.stop?.('shutdown');
}

export function registerShutdownHandlers(bot, runtime, processRef = process) {
  processRef.once('SIGINT', () => {
    log.info('Shutting down');
    cleanupTelegramSessions(bot, runtime);
    processRef.exit(0);
  });

  processRef.once('SIGTERM', () => {
    cleanupTelegramSessions(bot, runtime);
    processRef.exit(0);
  });
}

export function registerProcessErrorHandlers(processRef = process) {
  processRef.on('uncaughtException', (err) => {
    log.fatal({ err }, 'Uncaught exception');
  });

  processRef.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'Unhandled rejection');
  });
}

export async function startBot(options = {}) {
  if (options.validate !== false) validateBotEnvironment();

  try {
    const bot = options.bot || createBot(options);
    const runtime = bot.__socaiRuntime || {
      dbPool: options.dbPool || pool,
      superAdminId: Number(options.superAdminId || process.env.TELEGRAM_SUPER_ADMIN_ID || 275313615),
      agentSessions: options.agentSessions || agentSessions,
      agentSessionLastUsed: options.agentSessionLastUsed || agentSessionLastUsed,
      agentSessionPromises: options.agentSessionPromises || agentSessionPromises,
    };

    if (options.registerProcessHandlers !== false) registerProcessErrorHandlers();
    await runtime.dbPool.query('SELECT 1');
    await ensureSchemaReady(runtime.dbPool);
    log.info('Database connected');

    const botInfo = await bot.telegram.getMe();
    log.info({ username: botInfo.username }, 'Bot connected (long polling)');

    await syncBotCommands(bot, defaultBotCommands, superAdminBotCommands, runtime.superAdminId);
    log.info('Telegram bot commands synced');

    if (options.launch !== false) {
      await bot.launch();
      log.info('Telegram bot ready');
      registerShutdownHandlers(bot, {
        ...runtime,
      });
    }
    return bot;
  } catch (err) {
    log.error({ err }, 'Failed to start bot');
    if (options.exitOnError === false) throw err;
    process.exit(1);
  }
}
