import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEvaluationMetrics, resolveEvaluationPeriod } from '../metrics.js';

describe('resolveEvaluationPeriod', () => {
  it('parses explicit since ISO date', () => {
    const { since, days } = resolveEvaluationPeriod({ since: '2026-06-01T00:00:00.000Z' });
    assert.equal(since.toISOString(), '2026-06-01T00:00:00.000Z');
    assert.equal(days, null);
  });

  it('rejects invalid since value', () => {
    assert.throws(() => resolveEvaluationPeriod({ since: 'not-a-date' }), /since tidak valid/);
  });

  it('defaults to 30-day window', () => {
    const { since, days } = resolveEvaluationPeriod({});
    assert.equal(days, 30);
    assert.ok(since instanceof Date);
    assert.ok(since.getTime() < Date.now());
  });

  it('respects custom days window', () => {
    const { days } = resolveEvaluationPeriod({ days: 7 });
    assert.equal(days, 7);
  });
});

describe('getEvaluationMetrics', () => {
  it('computes M1–M7 and filtered breakdowns from the nine aggregate queries', async () => {
    const queries = [];
    const pool = {
      async query(sql) {
        queries.push(String(sql));
        if (queries.length === 1) {
          return {
            rows: [
              {
                total_runs: 2,
                error_runs: 1,
                completed_runs: 1,
                total_plans_saved: 3,
                total_plans_scheduled: 2,
              },
            ],
          };
        }
        if (queries.length === 2) return { rows: [{ save_attempts: 4, save_success: 3 }] };
        if (queries.length === 3) return { rows: [{ schedule_attempts: 2, schedule_success: 1 }] };
        if (queries.length === 4) return { rows: [{ manual_saves: 2, manual_schedules: 1 }] };
        if (queries.length === 5) return { rows: [{ median_ms: 1234 }] };
        if (queries.length === 6) return { rows: [{ days_in_window: 7, days_with_content: 5 }] };
        if (queries.length === 7) return { rows: [{ total_scheduled: 4, posted: 3, failed: 1 }] };
        if (queries.length === 8) return { rows: [{ autonomy_mode: 'bounded', runs: 2 }] };
        return { rows: [{ source: 'telegram', runs: 1 }] };
      },
    };

    const metrics = await getEvaluationMetrics(pool, {
      since: '2026-06-01T00:00:00.000Z',
      channel: ' Threads ',
      autonomy_mode: ' BOUNDED ',
      source: ' Telegram ',
    });
    assert.equal(queries.length, 9);
    assert.equal(metrics.filters.channel, 'threads');
    assert.equal(metrics.filters.autonomy_mode, 'bounded');
    assert.equal(metrics.filters.source, 'telegram');
    assert.equal(metrics.M1_planning_success_rate, 0.75);
    assert.equal(metrics.M2_schedule_success_rate, 0.5);
    assert.equal(metrics.M3_human_intervention_count, 3);
    assert.equal(metrics.M4_time_to_publish_median_ms, 1234);
    assert.equal(metrics.M5_tool_error_rate, 0.5);
    assert.equal(metrics.M6_calendar_coverage_rate, 5 / 7);
    assert.equal(metrics.M7_publish_success_rate, 0.75);
    assert.equal(metrics.by_autonomy_mode[0].autonomy_mode, 'bounded');
    assert.equal(metrics.by_source[0].source, 'telegram');
  });
});
