import { resolveAutonomyMode } from './actuator/index.js';

export const autoPlanCronIntervalMs = Number(process.env.AUTO_PLAN_CRON_INTERVAL_MS || 0);
export const autoPlanMinGaps = Number(process.env.AUTO_PLAN_MIN_GAPS || 3);
export const agentRunsPurgeIntervalMs = Number(process.env.AGENT_RUNS_PURGE_INTERVAL_MS || 24 * 60 * 60 * 1000);

export function getAutonomousJobConfig() {
  return {
    auto_plan_cron_interval_ms: autoPlanCronIntervalMs,
    auto_plan_min_gaps: autoPlanMinGaps,
    auto_plan_cron_autonomy_mode: process.env.AUTO_PLAN_CRON_AUTONOMY_MODE || 'supervised',
    agent_runs_purge_interval_ms: agentRunsPurgeIntervalMs,
    autonomy_mode: resolveAutonomyMode('web'),
    require_approval: String(process.env.REQUIRE_APPROVAL || 'false').toLowerCase() === 'true',
  };
}