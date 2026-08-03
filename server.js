import 'dotenv/config';
import { pathToFileURL } from 'url';
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

const log = childLogger('server');

// D2: dipisah dari bootServer() agar shutdown graceful bisa diuji tanpa proses nyata
// (tidak ada perubahan perilaku — nilai default parameter = perilaku lama).
export function createShutdownHandler({
  getHttpServer,
  intervalHandles,
  agentSessions: sessions = agentSessions,
  agentSessionLastUsed: lastUsed = agentSessionLastUsed,
  agentSessionPromises: promises = agentSessionPromises,
  closeAgentPools: closePools = closeAgentPools,
  forceExitMs = 10_000,
  setTimeoutFn = setTimeout,
  processRef = process,
  logger = log,
} = {}) {
  let shuttingDown = false;

  return function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received; shutting down gracefully');

    for (const id of intervalHandles) {
      clearInterval(id);
    }

    for (const [sessionKey, session] of sessions) {
      if (!sessionKey.startsWith('telegram:')) {
        session.abort().catch(() => {});
        sessions.delete(sessionKey);
        lastUsed.delete(sessionKey);
        promises.delete(sessionKey);
      }
    }

    const forceExit = setTimeoutFn(() => {
      logger.error('Force exit after timeout');
      processRef.exit(1);
    }, forceExitMs);
    forceExit.unref?.();

    const finishShutdown = () => {
      closePools()
        .then(() => {
          logger.info('Shutdown complete');
          processRef.exit(0);
        })
        .catch((err) => {
          logger.error({ err }, 'closeAgentPools error');
          processRef.exit(1);
        });
    };

    const httpServer = getHttpServer();
    if (!httpServer) {
      finishShutdown();
      return;
    }

    httpServer.close(() => {
      finishShutdown();
    });
  };
}

// D2: jadwal job latar belakang yang sebelumnya hidup di dalam callback app.listen();
// diekstrak agar bisa diuji dengan trackInterval/timer/job palsu tanpa membuka port nyata.
export function scheduleBackgroundJobs({
  trackInterval,
  replizAutoScheduleIntervalMs,
  replizSyncIntervalMs,
  autoPlanCronIntervalMs: planIntervalMs = autoPlanCronIntervalMs,
  agentRunsPurgeIntervalMs: purgeIntervalMs = agentRunsPurgeIntervalMs,
  replizAutoScheduleLimit: limit = replizAutoScheduleLimit,
  replizAutoScheduleLeadMs: leadMs = replizAutoScheduleLeadMs,
  jobs = {},
  setTimeoutFn = setTimeout,
  logger = log,
}) {
  const {
    autoSchedulePendingRepliz: autoSchedule = autoSchedulePendingRepliz,
    syncPendingReplizStatuses: syncStatuses = syncPendingReplizStatuses,
    runPublishFeedbackRefresh: refreshFeedback = runPublishFeedbackRefresh,
    generateWeeklyPlans: weeklyPlans = generateWeeklyPlans,
    runAgentRunsPurge: runsPurge = runAgentRunsPurge,
  } = jobs;

  if (Number.isFinite(replizAutoScheduleIntervalMs) && replizAutoScheduleIntervalMs > 0) {
    let autoScheduleRunning = false;
    const runAutoSchedule = async () => {
      if (autoScheduleRunning) return;
      autoScheduleRunning = true;
      try {
        const result = await autoSchedule();
        if (!result.skipped && (result.scheduled > 0 || result.failed > 0)) {
          logger.info(
            { scheduled: result.scheduled, failed: result.failed },
            'Repliz auto schedule complete',
          );
        }
      } catch (err) {
        logger.error({ err }, 'Repliz auto schedule error');
      } finally {
        autoScheduleRunning = false;
      }
    };
    setTimeoutFn(runAutoSchedule, 30_000);
    trackInterval(runAutoSchedule, replizAutoScheduleIntervalMs);
    logger.info({ intervalMs: replizAutoScheduleIntervalMs, limit, leadMs }, 'Repliz auto schedule enabled');
  } else {
    logger.info('Repliz auto schedule disabled');
  }

  if (Number.isFinite(replizSyncIntervalMs) && replizSyncIntervalMs > 0) {
    trackInterval(() => {
      syncStatuses().catch((err) => logger.error({ err }, 'Repliz auto sync error'));
    }, replizSyncIntervalMs);
    logger.info({ intervalMs: replizSyncIntervalMs }, 'Repliz auto sync enabled');
  } else {
    logger.info('Repliz auto sync disabled');
  }

  refreshFeedback().catch((err) => {
    logger.error({ err }, 'Initial publish feedback refresh error');
  });

  if (Number.isFinite(planIntervalMs) && planIntervalMs > 0) {
    let autoPlanRunning = false;
    const runAutoPlan = async () => {
      if (autoPlanRunning) return;
      autoPlanRunning = true;
      try {
        const result = await weeklyPlans();
        if (!result.skipped) {
          logger.info(
            { gapCount: result.gapCount, textLength: result.textLength || 0 },
            'AutoPlan cron complete',
          );
        }
      } catch (err) {
        logger.error({ err }, 'AutoPlan cron error');
      } finally {
        autoPlanRunning = false;
      }
    };
    setTimeoutFn(runAutoPlan, 60_000);
    trackInterval(runAutoPlan, planIntervalMs);
    logger.info({ intervalMs: planIntervalMs }, 'Weekly plan cron enabled');
  } else {
    logger.info('Weekly plan cron disabled');
  }

  if (Number.isFinite(purgeIntervalMs) && purgeIntervalMs > 0) {
    const runPurge = async () => {
      const result = await runsPurge();
      if (result.deleted > 0) {
        logger.info({ deleted: result.deleted }, 'Agent runs purge cycle complete');
      }
    };
    setTimeoutFn(runPurge, 120_000);
    trackInterval(runPurge, purgeIntervalMs);
    logger.info({ intervalMs: purgeIntervalMs }, 'Agent runs purge enabled');
  }
}

export function bootServer() {
  validateWebEnvironment();

  const { app, port, trackInterval, intervalHandles, replizSyncIntervalMs, replizAutoScheduleIntervalMs } =
    createWebApp();

  let httpServer;
  const shutdown = createShutdownHandler({
    getHttpServer: () => httpServer,
    intervalHandles,
  });

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  httpServer = app.listen(port, '127.0.0.1', () => {
    log.info({ port, host: '127.0.0.1' }, 'socai.my.id listening');
    scheduleBackgroundJobs({ trackInterval, replizAutoScheduleIntervalMs, replizSyncIntervalMs });
  });

  // D2: sebelumnya tidak ada listener 'error' — kegagalan listen (mis. port terpakai)
  // akan menjatuhkan proses lewat uncaught exception generik. Sekarang log lalu keluar terkendali.
  httpServer.on('error', (err) => {
    log.error({ err }, 'HTTP server failed to start');
    process.exit(1);
  });

  return { app, httpServer, shutdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bootServer();
}
