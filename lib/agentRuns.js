import { normalizeAiMessage } from './aiLimits.js';

const activeRunBySession = new Map();

export function setActiveAgentRunContext(sessionKey, context) {
  if (context) {
    activeRunBySession.set(sessionKey, context);
  } else {
    activeRunBySession.delete(sessionKey);
  }
}

export function getActiveAgentRunContext(sessionKey) {
  return activeRunBySession.get(sessionKey) ?? null;
}

export async function initAgentRunsSchema(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id              bigserial PRIMARY KEY,
      run_id          uuid NOT NULL DEFAULT gen_random_uuid(),
      session_key     text NOT NULL,
      source          text NOT NULL,
      autonomy_mode   text NOT NULL DEFAULT 'assistive',
      trigger_type    text NOT NULL,
      user_prompt     text,
      status          text NOT NULL DEFAULT 'running',
      model_ref       text,
      tools_called    jsonb NOT NULL DEFAULT '[]'::jsonb,
      plans_saved     integer NOT NULL DEFAULT 0,
      plans_scheduled integer NOT NULL DEFAULT 0,
      pemasaran_ids   integer[] NOT NULL DEFAULT '{}',
      error_message   text,
      started_at      timestamptz NOT NULL DEFAULT NOW(),
      ended_at        timestamptz,
      duration_ms     integer
    )
  `);

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS agent_runs_session_key_idx ON agent_runs (session_key)
  `);
  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS agent_runs_started_at_idx ON agent_runs (started_at DESC)
  `);
  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS agent_runs_status_idx ON agent_runs (status)
  `);
}

function normalizeUserPrompt(raw) {
  try {
    return normalizeAiMessage(raw);
  } catch {
    const text = String(raw ?? '').trim();
    const max = Number(process.env.AI_MESSAGE_MAX_LENGTH) || 4000;
    return text.length > max ? text.slice(0, max) : text;
  }
}

function summarizeToolResult(toolName, result) {
  if (!result || typeof result !== 'object') return String(result ?? '').slice(0, 500);
  if (toolName === 'save_content_plan') {
    return `saved=${result.saved_count ?? 0}, ids=${(result.ids || []).join(',')}`;
  }
  if (toolName === 'schedule_content') {
    return `pemasaran_id=${result.pemasaran_id}, status=${result.repliz_status ?? 'unknown'}`;
  }
  if (toolName === 'sync_content_status') {
    return `pemasaran_id=${result.pemasaran_id}, status=${result.repliz_status ?? result.status ?? 'unknown'}`;
  }
  if (toolName === 'get_calendar_gaps') {
    const gaps = result.gaps || result.slots || [];
    return `gaps=${Array.isArray(gaps) ? gaps.length : 0}`;
  }
  return JSON.stringify(result).slice(0, 500);
}

export async function createAgentRun(dbPool, {
  session_key,
  source,
  autonomy_mode = 'assistive',
  trigger_type = 'chat',
  user_prompt = null,
  model_ref = null,
} = {}) {
  if (!session_key) throw new Error('session_key wajib untuk agent run.');
  if (!source) throw new Error('source wajib untuk agent run.');

  const result = await dbPool.query(
    `INSERT INTO agent_runs (
       session_key, source, autonomy_mode, trigger_type, user_prompt, model_ref, status
     ) VALUES ($1, $2, $3, $4, $5, $6, 'running')
     RETURNING *`,
    [
      session_key,
      source,
      autonomy_mode,
      trigger_type,
      user_prompt ? normalizeUserPrompt(user_prompt) : null,
      model_ref,
    ],
  );

  const row = result.rows[0];
  const context = {
    id: row.id,
    run_id: row.run_id,
    session_key: row.session_key,
    source: row.source,
    autonomy_mode: row.autonomy_mode,
    plans_saved: 0,
    plans_scheduled: 0,
    started_at: row.started_at,
  };
  setActiveAgentRunContext(session_key, context);
  return row;
}

export async function logToolCall(dbPool, runId, {
  name,
  started_at,
  ended_at,
  status = 'ok',
  result = null,
  error = null,
  plans_saved = 0,
  plans_scheduled = 0,
  pemasaran_ids = [],
} = {}) {
  if (!runId) return null;

  const entry = {
    name,
    started_at: started_at || new Date().toISOString(),
    ended_at: ended_at || new Date().toISOString(),
    status,
    result_summary: status === 'ok' ? summarizeToolResult(name, result) : undefined,
    error: error ? String(error).slice(0, 1000) : undefined,
  };

  const ids = Array.isArray(pemasaran_ids) ? pemasaran_ids.filter((id) => Number.isFinite(Number(id))).map(Number) : [];

  const resultQuery = await dbPool.query(
    `UPDATE agent_runs
     SET tools_called = COALESCE(tools_called, '[]'::jsonb) || $2::jsonb,
         plans_saved = plans_saved + $3,
         plans_scheduled = plans_scheduled + $4,
         pemasaran_ids = pemasaran_ids || $5::integer[]
     WHERE id = $1
     RETURNING *`,
    [runId, JSON.stringify([entry]), plans_saved, plans_scheduled, ids],
  );

  const row = resultQuery.rows[0];
  if (row) {
    const ctx = activeRunBySession.get(row.session_key);
    if (ctx && ctx.id === runId) {
      ctx.plans_saved = row.plans_saved;
      ctx.plans_scheduled = row.plans_scheduled;
    }
  }

  return row;
}

export async function completeAgentRun(dbPool, runId, {
  status = 'completed',
  error_message = null,
} = {}) {
  if (!runId) return null;

  const result = await dbPool.query(
    `UPDATE agent_runs
     SET status = $2,
         error_message = $3,
         ended_at = NOW(),
         duration_ms = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::integer
     WHERE id = $1
     RETURNING *`,
    [runId, status, error_message ? String(error_message).slice(0, 2000) : null],
  );

  const row = result.rows[0];
  if (row) clearActiveAgentRunContext(row.session_key);
  return row;
}

export function clearActiveAgentRunContext(sessionKey) {
  activeRunBySession.delete(sessionKey);
}

export async function listAgentRuns(dbPool, { limit = 50, session_key = null } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const params = [safeLimit];
  let whereClause = '';

  if (session_key) {
    params.push(String(session_key));
    whereClause = `WHERE session_key = $${params.length}`;
  }

  const result = await dbPool.query(
    `SELECT id, run_id, session_key, source, autonomy_mode, trigger_type,
            user_prompt, status, model_ref, tools_called, plans_saved,
            plans_scheduled, pemasaran_ids, error_message, started_at, ended_at, duration_ms
     FROM agent_runs
     ${whereClause}
     ORDER BY started_at DESC
     LIMIT $1`,
    params,
  );
  return result.rows;
}

export async function isAgentRunsReady(dbPool) {
  try {
    await dbPool.query('SELECT 1 FROM agent_runs LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

export async function getAgentRunMetrics(dbPool, { since = null } = {}) {
  const params = [];
  let whereClause = '';
  if (since) {
    params.push(since);
    whereClause = `WHERE started_at >= $${params.length}`;
  }

  const totals = await dbPool.query(
    `SELECT
       COUNT(*)::integer AS total_runs,
       COUNT(*) FILTER (WHERE status = 'error')::integer AS error_runs,
       COUNT(*) FILTER (WHERE status = 'completed')::integer AS completed_runs,
       COALESCE(SUM(plans_saved), 0)::integer AS total_plans_saved,
       COALESCE(SUM(plans_scheduled), 0)::integer AS total_plans_scheduled
     FROM agent_runs
     ${whereClause}`,
    params,
  );

  const saveAttempts = await dbPool.query(
    `SELECT
       COUNT(*)::integer AS save_attempts,
       COUNT(*) FILTER (WHERE elem->>'status' = 'ok')::integer AS save_success
     FROM agent_runs,
          LATERAL jsonb_array_elements(tools_called) AS elem
     ${whereClause ? `${whereClause} AND` : 'WHERE'} elem->>'name' = 'save_content_plan'`,
    params,
  );

  const scheduleAttempts = await dbPool.query(
    `SELECT
       COUNT(*)::integer AS schedule_attempts,
       COUNT(*) FILTER (WHERE elem->>'status' = 'ok')::integer AS schedule_success
     FROM agent_runs,
          LATERAL jsonb_array_elements(tools_called) AS elem
     ${whereClause ? `${whereClause} AND` : 'WHERE'} elem->>'name' = 'schedule_content'`,
    params,
  );

  const totalRuns = totals.rows[0]?.total_runs ?? 0;
  const errorRuns = totals.rows[0]?.error_runs ?? 0;
  const saveAttemptsCount = saveAttempts.rows[0]?.save_attempts ?? 0;
  const saveSuccess = saveAttempts.rows[0]?.save_success ?? 0;
  const scheduleAttemptsCount = scheduleAttempts.rows[0]?.schedule_attempts ?? 0;
  const scheduleSuccess = scheduleAttempts.rows[0]?.schedule_success ?? 0;

  return {
    M1_planning_success_rate: saveAttemptsCount > 0 ? saveSuccess / saveAttemptsCount : null,
    M2_schedule_success_rate: scheduleAttemptsCount > 0 ? scheduleSuccess / scheduleAttemptsCount : null,
    M3_human_intervention_count: null,
    M4_time_to_publish_median_ms: null,
    M5_tool_error_rate: totalRuns > 0 ? errorRuns / totalRuns : null,
    totals: totals.rows[0] ?? {},
    save_attempts: saveAttempts.rows[0] ?? {},
    schedule_attempts: scheduleAttempts.rows[0] ?? {},
  };
}

export async function countAgentSchedulesToday(dbPool) {
  const result = await dbPool.query(
    `SELECT COALESCE(SUM(plans_scheduled), 0)::integer AS count
     FROM agent_runs
     WHERE started_at >= CURRENT_DATE`,
  );
  return result.rows[0]?.count ?? 0;
}

export async function purgeOldAgentRuns(dbPool, { retainDays = 90 } = {}) {
  const days = Math.max(Number(retainDays) || 90, 1);
  const result = await dbPool.query(
    `DELETE FROM agent_runs
     WHERE started_at < NOW() - ($1::text || ' days')::interval`,
    [String(days)],
  );
  return result.rowCount ?? 0;
}