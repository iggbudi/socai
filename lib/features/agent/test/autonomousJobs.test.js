import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAutonomousJobConfig } from '../autonomousConfig.js';
import { resolveAutonomyMode, resolveSourceFromSessionKey } from '../actuator/index.js';
import { shouldGenerateWeeklyPlans, runPublishFeedbackRefresh, runAgentRunsPurge } from '../autonomousJobs.js';

describe('autonomousJobs config', () => {
  it('exports autonomous job config shape', () => {
    const config = getAutonomousJobConfig();
    assert.ok('auto_plan_cron_interval_ms' in config);
    assert.ok('auto_plan_min_gaps' in config);
    assert.ok('agent_runs_purge_interval_ms' in config);
    assert.ok('require_approval' in config);
  });
});

describe('cron session resolution', () => {
  it('resolveSourceFromSessionKey detects cron prefix', () => {
    assert.equal(resolveSourceFromSessionKey('cron:weekly-plan'), 'cron');
  });

  it('resolveAutonomyMode uses AUTO_PLAN_CRON_AUTONOMY_MODE for cron', () => {
    const prev = process.env.AUTO_PLAN_CRON_AUTONOMY_MODE;
    process.env.AUTO_PLAN_CRON_AUTONOMY_MODE = 'supervised';
    try {
      assert.equal(resolveAutonomyMode('cron'), 'supervised');
    } finally {
      if (prev === undefined) delete process.env.AUTO_PLAN_CRON_AUTONOMY_MODE;
      else process.env.AUTO_PLAN_CRON_AUTONOMY_MODE = prev;
    }
  });
});

// Regresi bug laten F9: dynamic import path + fungsi background jobs yang
// sebelumnya tidak pernah dipanggil test suite (Prioritas 2).
function createMockPool({ rows = [], rowCount = 0 } = {}) {
  const queries = [];
  return {
    queries,
    async query(text, params) {
      queries.push({ text: String(text).replace(/\s+/g, ' ').trim(), params });
      return { rows, rowCount };
    },
  };
}

describe('autonomousJobs background functions', () => {
  it('shouldGenerateWeeklyPlans returns free calendar gaps (mock read pool)', async () => {
    const pool = createMockPool({ rows: [] });
    const result = await shouldGenerateWeeklyPlans(pool);
    assert.equal(result.shouldRun, true, 'selalu ada slot kosong 7 hari ke depan');
    assert.ok(result.gapCount >= 1);
    assert.ok(Array.isArray(result.gaps));
    assert.ok(pool.queries.length >= 1, 'query kalender dipanggil');
  });

  it('runPublishFeedbackRefresh returns ok with summary (mock read pool)', async () => {
    const pool = createMockPool({ rows: [] });
    const result = await runPublishFeedbackRefresh(pool);
    assert.equal(result.ok, true);
    assert.equal(result.summary.total_sampled, 0);
    assert.ok(pool.queries.length >= 1, 'query pemasaran dipanggil');
  });

  it('runAgentRunsPurge returns deleted rowCount (mock pool)', async () => {
    const pool = createMockPool({ rowCount: 3 });
    const result = await runAgentRunsPurge(pool);
    assert.equal(result.deleted, 3);
    assert.equal(result.retainDays, 90);
    assert.ok(String(pool.queries[0].text).startsWith('DELETE FROM agent_runs'));
  });
});