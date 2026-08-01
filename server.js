import 'dotenv/config';
import { validateWebEnvironment } from './lib/env.js';
import { closeAgentPools } from './lib/shared/db.js';
import { childLogger } from './lib/shared/logger.js';
import { agentSessions, agentSessionLastUsed, agentSessionPromises } from './lib/features/agent/core.js';
import { createWebApp } from './lib/web/createApp.js';
import {
  syncPendingReplizStatuses,
  autoSchedulePendingRepliz,
  replizAutoScheduleLimit,
  replizAutoScheduleLeadMs,
} from './lib/features/pemasaran/jobs.js';
import {
  generateWeeklyPlans,
  runAgentRunsPurge,
  runPublishFeedbackRefresh,
  autoPlanCronIntervalMs,
  agentRunsPurgeIntervalMs,
} from './lib/features/agent/autonomousJobs.js';

validateWebEnvironment();
const log = childLogger('server');

const { app, port, trackInterval, intervalHandles, replizSyncIntervalMs, replizAutoScheduleIntervalMs } =
  createWebApp();

let httpServer;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'Shutdown signal received; shutting down gracefully');

  for (const id of intervalHandles) {
    clearInterval(id);
  }

  for (const [sessionKey, session] of agentSessions) {
    if (!sessionKey.startsWith('telegram:')) {
      session.abort().catch(() => {});
      agentSessions.delete(sessionKey);
      agentSessionLastUsed.delete(sessionKey);
      agentSessionPromises.delete(sessionKey);
    }
  }

  const forceExit = setTimeout(() => {
    log.error('Force exit after timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref?.();

  const finishShutdown = () => {
    closeAgentPools()
      .then(() => {
        log.info('Shutdown complete');
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err }, 'closeAgentPools error');
        process.exit(1);
      });
  };

  if (!httpServer) {
    finishShutdown();
    return;
  }

  httpServer.close(() => {
    finishShutdown();
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

httpServer = app.listen(port, '127.0.0.1', () => {
  log.info({ port, host: '127.0.0.1' }, 'socai.my.id listening');
  if (Number.isFinite(replizAutoScheduleIntervalMs) && replizAutoScheduleIntervalMs > 0) {
    let autoScheduleRunning = false;
    const runAutoSchedule = async () => {
      if (autoScheduleRunning) return;
      autoScheduleRunning = true;
      try {
        const result = await autoSchedulePendingRepliz();
        if (!result.skipped && (result.scheduled > 0 || result.failed > 0)) {
          log.info({ scheduled: result.scheduled, failed: result.failed }, 'Repliz auto schedule complete');
        }
      } catch (err) {
        log.error({ err }, 'Repliz auto schedule error');
      } finally {
        autoScheduleRunning = false;
      }
    };
    setTimeout(runAutoSchedule, 30_000);
    trackInterval(runAutoSchedule, replizAutoScheduleIntervalMs);
    log.info(
      {
        intervalMs: replizAutoScheduleIntervalMs,
        limit: replizAutoScheduleLimit,
        leadMs: replizAutoScheduleLeadMs,
      },
      'Repliz auto schedule enabled',
    );
  } else {
    log.info('Repliz auto schedule disabled');
  }

  if (Number.isFinite(replizSyncIntervalMs) && replizSyncIntervalMs > 0) {
    trackInterval(() => {
      syncPendingReplizStatuses().catch((err) => log.error({ err }, 'Repliz auto sync error'));
    }, replizSyncIntervalMs);
    log.info({ intervalMs: replizSyncIntervalMs }, 'Repliz auto sync enabled');
  } else {
    log.info('Repliz auto sync disabled');
  }

  runPublishFeedbackRefresh().catch((err) => {
    log.error({ err }, 'Initial publish feedback refresh error');
  });

  if (Number.isFinite(autoPlanCronIntervalMs) && autoPlanCronIntervalMs > 0) {
    let autoPlanRunning = false;
    const runAutoPlan = async () => {
      if (autoPlanRunning) return;
      autoPlanRunning = true;
      try {
        const result = await generateWeeklyPlans();
        if (!result.skipped) {
          log.info(
            { gapCount: result.gapCount, textLength: result.textLength || 0 },
            'AutoPlan cron complete',
          );
        }
      } catch (err) {
        log.error({ err }, 'AutoPlan cron error');
      } finally {
        autoPlanRunning = false;
      }
    };
    setTimeout(runAutoPlan, 60_000);
    trackInterval(runAutoPlan, autoPlanCronIntervalMs);
    log.info({ intervalMs: autoPlanCronIntervalMs }, 'Weekly plan cron enabled');
  } else {
    log.info('Weekly plan cron disabled');
  }

  if (Number.isFinite(agentRunsPurgeIntervalMs) && agentRunsPurgeIntervalMs > 0) {
    const runPurge = async () => {
      const result = await runAgentRunsPurge();
      if (result.deleted > 0) {
        log.info({ deleted: result.deleted }, 'Agent runs purge cycle complete');
      }
    };
    setTimeout(runPurge, 120_000);
    trackInterval(runPurge, agentRunsPurgeIntervalMs);
    log.info({ intervalMs: agentRunsPurgeIntervalMs }, 'Agent runs purge enabled');
  }
});
