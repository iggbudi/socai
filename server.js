import 'dotenv/config';
import { validateWebEnvironment } from './lib/env.js';
import { pool, agentSessions, agentSessionLastUsed, agentSessionPromises, closeAgentPools } from './lib/agent.js';
import { createWebApp } from './lib/web/createApp.js';
import {
  syncPendingReplizStatuses,
  autoSchedulePendingRepliz,
  replizAutoScheduleLimit,
  replizAutoScheduleLeadMs,
} from './lib/web/replizJobs.js';

validateWebEnvironment();

async function initPemasaranReplizSchema() {
  await pool.query(`
    ALTER TABLE IF EXISTS pemasaran
      ADD COLUMN IF NOT EXISTS gambar text,
      ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
      ADD COLUMN IF NOT EXISTS published_at timestamptz,
      ADD COLUMN IF NOT EXISTS external_post_id text,
      ADD COLUMN IF NOT EXISTS external_status text,
      ADD COLUMN IF NOT EXISTS last_error text,
      ADD COLUMN IF NOT EXISTS repliz_schedule_id text,
      ADD COLUMN IF NOT EXISTS repliz_status text,
      ADD COLUMN IF NOT EXISTS repliz_scheduled_at timestamptz,
      ADD COLUMN IF NOT EXISTS repliz_last_error text,
      ADD COLUMN IF NOT EXISTS repliz_synced_at timestamptz,
      ADD COLUMN IF NOT EXISTS repliz_attempts integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS auto_schedule_enabled boolean DEFAULT true
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pemasaran_repliz_schedule_id_uq
      ON pemasaran (repliz_schedule_id)
      WHERE repliz_schedule_id IS NOT NULL
  `);
}

const {
  app,
  port,
  trackInterval,
  intervalHandles,
  replizSyncIntervalMs,
  replizAutoScheduleIntervalMs,
} = createWebApp();

let httpServer;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received, shutting down gracefully...`);

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
    console.error('[Server] Force exit after timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref?.();

  const finishShutdown = () => {
    closeAgentPools()
      .then(() => {
        console.log('[Server] Shutdown complete');
        process.exit(0);
      })
      .catch((err) => {
        console.error('[Server] closeAgentPools error:', err.message);
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

initPemasaranReplizSchema()
  .then(() => {
    httpServer = app.listen(port, '127.0.0.1', () => {
      console.log(`socai.my.id listening on http://127.0.0.1:${port}`);
    });
    if (Number.isFinite(replizAutoScheduleIntervalMs) && replizAutoScheduleIntervalMs > 0) {
      let autoScheduleRunning = false;
      const runAutoSchedule = async () => {
        if (autoScheduleRunning) return;
        autoScheduleRunning = true;
        try {
          const result = await autoSchedulePendingRepliz();
          if (!result.skipped && (result.scheduled > 0 || result.failed > 0)) {
            console.log(`[Repliz] Auto schedule done: scheduled=${result.scheduled}, failed=${result.failed}`);
          }
        } catch (err) {
          console.error('[Repliz] Auto schedule error:', err.message);
        } finally {
          autoScheduleRunning = false;
        }
      };
      setTimeout(runAutoSchedule, 30_000);
      trackInterval(runAutoSchedule, replizAutoScheduleIntervalMs);
      console.log(`[Repliz] Auto schedule enabled every ${Math.round(replizAutoScheduleIntervalMs / 1000)}s, limit=${replizAutoScheduleLimit}, lead=${Math.round(replizAutoScheduleLeadMs / 60000)}m`);
    } else {
      console.log('[Repliz] Auto schedule disabled (REPLIZ_AUTO_SCHEDULE_INTERVAL_MS <= 0)');
    }

    if (Number.isFinite(replizSyncIntervalMs) && replizSyncIntervalMs > 0) {
      trackInterval(() => {
        syncPendingReplizStatuses().catch((err) => console.error('[Repliz] Auto sync error:', err.message));
      }, replizSyncIntervalMs);
      console.log(`[Repliz] Auto sync enabled every ${Math.round(replizSyncIntervalMs / 1000)}s`);
    } else {
      console.log('[Repliz] Auto sync disabled (REPLIZ_SYNC_INTERVAL_MS <= 0)');
    }
  })
  .catch((err) => {
    console.error('Failed to initialize Repliz database schema:', err.message);
    process.exit(1);
  });