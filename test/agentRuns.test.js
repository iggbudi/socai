import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setActiveAgentRunContext,
  getActiveAgentRunContext,
  clearActiveAgentRunContext,
  createAgentRun,
  logToolCall,
  completeAgentRun,
  getAgentRunMetrics,
  listAgentRuns,
  purgeOldAgentRuns,
} from '../lib/agentRuns.js';

function createMockPool() {
  const state = {
    runs: [],
    nextId: 1,
  };

  const pool = {
    state,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();

      if (text.startsWith('CREATE TABLE') || text.startsWith('CREATE INDEX')) {
        return { rows: [] };
      }

      if (text.includes('INSERT INTO agent_runs')) {
        const row = {
          id: state.nextId++,
          run_id: `00000000-0000-4000-8000-${String(state.nextId).padStart(12, '0')}`,
          session_key: params[0],
          source: params[1],
          autonomy_mode: params[2],
          trigger_type: params[3],
          user_prompt: params[4],
          model_ref: params[5],
          status: 'running',
          tools_called: [],
          plans_saved: 0,
          plans_scheduled: 0,
          pemasaran_ids: [],
          started_at: new Date().toISOString(),
        };
        state.runs.push(row);
        return { rows: [row] };
      }

      if (text.includes('tools_called = COALESCE')) {
        const run = state.runs.find((item) => item.id === params[0]);
        assert.ok(run, 'run should exist for logToolCall');
        const entry = JSON.parse(params[1])[0];
        run.tools_called = [...(run.tools_called || []), entry];
        run.plans_saved += params[2];
        run.plans_scheduled += params[3];
        run.pemasaran_ids = [...(run.pemasaran_ids || []), ...params[4]];
        return { rows: [{ ...run }] };
      }

      if (text.includes('SET status = $2')) {
        const run = state.runs.find((item) => item.id === params[0]);
        assert.ok(run, 'run should exist for completeAgentRun');
        run.status = params[1];
        run.error_message = params[2];
        run.ended_at = new Date().toISOString();
        run.duration_ms = 1200;
        return { rows: [{ ...run }] };
      }

      if (text.includes('COUNT(*)::integer AS total_runs')) {
        const total = state.runs.length;
        const errorRuns = state.runs.filter((run) => run.status === 'error').length;
        const completedRuns = state.runs.filter((run) => run.status === 'completed').length;
        const totalPlansSaved = state.runs.reduce((sum, run) => sum + (run.plans_saved || 0), 0);
        const totalPlansScheduled = state.runs.reduce((sum, run) => sum + (run.plans_scheduled || 0), 0);
        return {
          rows: [{
            total_runs: total,
            error_runs: errorRuns,
            completed_runs: completedRuns,
            total_plans_saved: totalPlansSaved,
            total_plans_scheduled: totalPlansScheduled,
          }],
        };
      }

      if (text.includes("elem->>'name' = 'save_content_plan'")) {
        let saveAttempts = 0;
        let saveSuccess = 0;
        for (const run of state.runs) {
          for (const tool of run.tools_called || []) {
            if (tool.name === 'save_content_plan') {
              saveAttempts += 1;
              if (tool.status === 'ok') saveSuccess += 1;
            }
          }
        }
        return { rows: [{ save_attempts: saveAttempts, save_success: saveSuccess }] };
      }

      if (text.includes("elem->>'name' = 'schedule_content'")) {
        return { rows: [{ schedule_attempts: 0, schedule_success: 0 }] };
      }

      if (text.includes('FROM agent_runs') && text.includes('ORDER BY started_at DESC')) {
        let rows = [...state.runs];
        if (text.includes('WHERE session_key =')) {
          const filterKey = params[1];
          rows = rows.filter((item) => item.session_key === filterKey);
        }
        rows.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
        const safeLimit = params[0];
        return { rows: rows.slice(0, safeLimit) };
      }

      if (text.includes('DELETE FROM agent_runs')) {
        const before = state.runs.length;
        state.runs = [];
        return { rowCount: before };
      }

      throw new Error(`Unhandled mock query: ${text.slice(0, 120)}`);
    },
  };

  return pool;
}

describe('agentRuns context', () => {
  beforeEach(() => {
    clearActiveAgentRunContext('web:1');
  });

  it('stores and clears active run context per session', () => {
    setActiveAgentRunContext('web:1', { id: 9, plans_saved: 0 });
    assert.equal(getActiveAgentRunContext('web:1').id, 9);
    clearActiveAgentRunContext('web:1');
    assert.equal(getActiveAgentRunContext('web:1'), null);
  });
});

describe('agentRuns lifecycle', () => {
  it('creates, logs tool call, and completes a run', async () => {
    const pool = createMockPool();

    const run = await createAgentRun(pool, {
      session_key: 'web:session-1',
      source: 'web',
      autonomy_mode: 'supervised',
      trigger_type: 'chat',
      user_prompt: 'buat rencana 7 hari',
      model_ref: 'xiaomi/mimo-v2.5-pro',
    });

    assert.equal(run.status, 'running');
    assert.equal(getActiveAgentRunContext('web:session-1').id, run.id);

    await logToolCall(pool, run.id, {
      name: 'save_content_plan',
      status: 'ok',
      result: { saved_count: 2, ids: [10, 11] },
      plans_saved: 2,
      pemasaran_ids: [10, 11],
    });

    const completed = await completeAgentRun(pool, run.id, { status: 'completed' });
    assert.equal(completed.status, 'completed');
    assert.equal(getActiveAgentRunContext('web:session-1'), null);
    assert.equal(pool.state.runs[0].plans_saved, 2);
  });

  it('truncates overly long user_prompt before insert', async () => {
    const pool = createMockPool();
    const longPrompt = 'x'.repeat(5000);
    const run = await createAgentRun(pool, {
      session_key: 'web:long',
      source: 'web',
      user_prompt: longPrompt,
    });
    assert.ok(run.user_prompt.length <= 4000);
  });

  it('records error details in tools_called for failed tool calls', async () => {
    const pool = createMockPool();
    const run = await createAgentRun(pool, {
      session_key: 'web:error-tool',
      source: 'web',
    });

    await logToolCall(pool, run.id, {
      name: 'save_content_plan',
      status: 'error',
      error: 'Mode assistive: simpan manual',
    });

    const entry = pool.state.runs[0].tools_called[0];
    assert.equal(entry.status, 'error');
    assert.match(entry.error, /assistive/i);
    assert.equal(entry.result_summary, undefined);
  });

  it('completes a run with error status and message', async () => {
    const pool = createMockPool();
    const run = await createAgentRun(pool, {
      session_key: 'web:error-run',
      source: 'web',
    });

    const completed = await completeAgentRun(pool, run.id, {
      status: 'error',
      error_message: 'Model timeout',
    });

    assert.equal(completed.status, 'error');
    assert.equal(completed.error_message, 'Model timeout');
    assert.equal(getActiveAgentRunContext('web:error-run'), null);
  });

  it('filters listAgentRuns by session_key when provided', async () => {
    const pool = createMockPool();
    await createAgentRun(pool, { session_key: 'web:alice', source: 'web', user_prompt: 'alice prompt' });
    await createAgentRun(pool, { session_key: 'web:bob', source: 'web', user_prompt: 'bob prompt' });

    const aliceRuns = await listAgentRuns(pool, { session_key: 'web:alice', limit: 10 });
    assert.equal(aliceRuns.length, 1);
    assert.equal(aliceRuns[0].session_key, 'web:alice');
    assert.equal(aliceRuns[0].user_prompt, 'alice prompt');

    const allRuns = await listAgentRuns(pool, { limit: 10 });
    assert.equal(allRuns.length, 2);
  });

  it('computes basic metrics from logged runs', async () => {
    const pool = createMockPool();
    const run = await createAgentRun(pool, {
      session_key: 'web:metrics',
      source: 'web',
      autonomy_mode: 'bounded',
    });

    await logToolCall(pool, run.id, {
      name: 'save_content_plan',
      status: 'ok',
      result: { saved_count: 1, ids: [1] },
      plans_saved: 1,
      pemasaran_ids: [1],
    });
    await completeAgentRun(pool, run.id, { status: 'completed' });

    const metrics = await getAgentRunMetrics(pool);
    assert.equal(metrics.M1_planning_success_rate, 1);
    assert.equal(metrics.totals.total_runs, 1);
  });

  it('purgeOldAgentRuns deletes aged rows', async () => {
    const pool = createMockPool();
    await createAgentRun(pool, { session_key: 'web:purge', source: 'web' });
    const deleted = await purgeOldAgentRuns(pool, { retainDays: 90 });
    assert.equal(deleted, 1);
    assert.equal(pool.state.runs.length, 0);
  });
});