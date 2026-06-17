import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAutonomousJobConfig } from '../lib/autonomousConfig.js';
import { resolveAutonomyMode, resolveSourceFromSessionKey } from '../lib/actuator/index.js';

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