import {
  agentSessions as defaultAgentSessions,
  agentSessionLastUsed as defaultAgentSessionLastUsed,
  agentSessionPromises as defaultAgentSessionPromises,
  touchAgentSession as defaultTouchAgentSession,
  initAgent as defaultInitAgent,
} from '../../agent/core.js';
import {
  createAgentRun as defaultCreateAgentRun,
  completeAgentRun as defaultCompleteAgentRun,
} from '../../agent/runs.js';
import { resolveAutonomyMode as defaultResolveAutonomyMode } from '../../agent/actuator/index.js';
import { pool as defaultPool } from '../../../shared/db.js';
import {
  savePlansToDb as defaultSavePlansToDb,
  schedulePlanToRepliz as defaultSchedulePlanToRepliz,
  schedulePlanToReplizNow as defaultSchedulePlanToReplizNow,
  syncPlanReplizStatus as defaultSyncPlanReplizStatus,
} from '../../pemasaran/domain.js';
import {
  normalizeAiMessage as defaultNormalizeAiMessage,
  AiMessageError as DefaultAiMessageError,
} from '../../agent/aiLimits.js';
import { createRateLimiter } from '../../../shared/rateLimit.js';
import { isReplizConfigured as defaultIsReplizConfigured } from '../../../shared/repliz.js';
import {
  approvePlanSchedule as defaultApprovePlanSchedule,
  rejectPlanSchedule as defaultRejectPlanSchedule,
} from '../../agent/approval.js';
import { downloadTelegramPhoto as defaultDownloadTelegramPhoto } from '../media/cloudinary.js';
import { scheduleViaRepliz as defaultScheduleViaRepliz } from '../schedule.js';

function createDefaultRateLimiter() {
  return createRateLimiter({
    limit: Number(process.env.TELEGRAM_AI_RATE_LIMIT) || 10,
    windowMs: Number(process.env.TELEGRAM_AI_RATE_WINDOW_MS) || 60000,
    keyFn: (chatId) => `telegram:${chatId}`,
  });
}

export function resolveTelegramDependencies(dependencies = {}) {
  return {
    dbPool: dependencies.dbPool || defaultPool,
    agentSessions: dependencies.agentSessions || defaultAgentSessions,
    agentSessionLastUsed: dependencies.agentSessionLastUsed || defaultAgentSessionLastUsed,
    agentSessionPromises: dependencies.agentSessionPromises || defaultAgentSessionPromises,
    touchAgentSession: dependencies.touchAgentSession || defaultTouchAgentSession,
    initAgent: dependencies.initAgent || defaultInitAgent,
    createAgentRun: dependencies.createAgentRun || defaultCreateAgentRun,
    completeAgentRun: dependencies.completeAgentRun || defaultCompleteAgentRun,
    resolveAutonomyMode: dependencies.resolveAutonomyMode || defaultResolveAutonomyMode,
    normalizeAiMessage: dependencies.normalizeAiMessage || defaultNormalizeAiMessage,
    AiMessageError: dependencies.AiMessageError || DefaultAiMessageError,
    telegramAiRateLimiter: dependencies.telegramAiRateLimiter || createDefaultRateLimiter(),
    isReplizConfigured: dependencies.isReplizConfigured || defaultIsReplizConfigured,
    savePlansToDb: dependencies.savePlansToDb || defaultSavePlansToDb,
    schedulePlanToRepliz: dependencies.schedulePlanToRepliz || defaultSchedulePlanToRepliz,
    schedulePlanToReplizNow: dependencies.schedulePlanToReplizNow || defaultSchedulePlanToReplizNow,
    syncPlanReplizStatus: dependencies.syncPlanReplizStatus || defaultSyncPlanReplizStatus,
    approvePlanSchedule: dependencies.approvePlanSchedule || defaultApprovePlanSchedule,
    rejectPlanSchedule: dependencies.rejectPlanSchedule || defaultRejectPlanSchedule,
    downloadTelegramPhoto: dependencies.downloadTelegramPhoto || defaultDownloadTelegramPhoto,
    scheduleViaRepliz: dependencies.scheduleViaRepliz || defaultScheduleViaRepliz,
  };
}
