import { getEnabledChannelIds } from './channels/index.js';

export function resolveEvaluationPeriod({ since = null, days = null } = {}) {
  if (since) {
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Parameter since tidak valid. Gunakan tanggal ISO.');
    }
    return { since: parsed, days: null };
  }
  const windowDays = Math.max(Number(days) || 30, 1);
  const sinceDate = new Date();
  sinceDate.setUTCHours(0, 0, 0, 0);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - windowDays);
  return { since: sinceDate, days: windowDays };
}

function buildAgentRunFilters({ since, autonomy_mode, source } = {}) {
  const clauses = [];
  const params = [];
  let idx = 1;
  if (since) {
    clauses.push(`started_at >= $${idx++}`);
    params.push(since.toISOString());
  }
  if (autonomy_mode) {
    clauses.push(`autonomy_mode = $${idx++}`);
    params.push(String(autonomy_mode).trim().toLowerCase());
  }
  if (source) {
    clauses.push(`source = $${idx++}`);
    params.push(String(source).trim().toLowerCase());
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    nextIdx: idx,
  };
}

function resolveChannelFilter(channel) {
  if (channel) {
    return [String(channel).trim().toLowerCase()];
  }
  return getEnabledChannelIds();
}

function rate(success, attempts) {
  return attempts > 0 ? success / attempts : null;
}

export async function getEvaluationMetrics(dbPool, {
  since = null,
  days = null,
  channel = null,
  autonomy_mode = null,
  source = null,
} = {}) {
  const period = resolveEvaluationPeriod({ since, days });
  const runFilters = buildAgentRunFilters({
    since: period.since,
    autonomy_mode,
    source,
  });
  const channels = resolveChannelFilter(channel);

  const totals = await dbPool.query(
    `SELECT
       COUNT(*)::integer AS total_runs,
       COUNT(*) FILTER (WHERE status = 'error')::integer AS error_runs,
       COUNT(*) FILTER (WHERE status = 'completed')::integer AS completed_runs,
       COALESCE(SUM(plans_saved), 0)::integer AS total_plans_saved,
       COALESCE(SUM(plans_scheduled), 0)::integer AS total_plans_scheduled
     FROM agent_runs
     ${runFilters.where}`,
    runFilters.params,
  );

  const saveAttempts = await dbPool.query(
    `SELECT
       COUNT(*)::integer AS save_attempts,
       COUNT(*) FILTER (WHERE elem->>'status' = 'ok')::integer AS save_success
     FROM agent_runs,
          LATERAL jsonb_array_elements(tools_called) AS elem
     ${runFilters.where ? `${runFilters.where} AND` : 'WHERE'} elem->>'name' = 'save_content_plan'`,
    runFilters.params,
  );

  const scheduleAttempts = await dbPool.query(
    `SELECT
       COUNT(*)::integer AS schedule_attempts,
       COUNT(*) FILTER (WHERE elem->>'status' = 'ok')::integer AS schedule_success
     FROM agent_runs,
          LATERAL jsonb_array_elements(tools_called) AS elem
     ${runFilters.where ? `${runFilters.where} AND` : 'WHERE'} elem->>'name' = 'schedule_content'`,
    runFilters.params,
  );

  const m3Params = [...runFilters.params];
  const arFilterSql = runFilters.where
    ? `AND ${runFilters.where
      .replace(/^WHERE /, '')
      .replace(/\bstarted_at\b/g, 'ar.started_at')
      .replace(/\bautonomy_mode\b/g, 'ar.autonomy_mode')
      .replace(/\bsource\b/g, 'ar.source')}`
    : '';

  const sinceParamIdx = 1;
  let m3ChannelClause = '';
  if (channel) {
    m3Params.push(String(channel).trim().toLowerCase());
    m3ChannelClause = `AND lower(coalesce(p.kanal, '')) = $${m3Params.length}`;
  }

  const m3 = await dbPool.query(
    `WITH agent_saved AS (
       SELECT DISTINCT pid::integer AS id
       FROM agent_runs ar, LATERAL unnest(ar.pemasaran_ids) pid
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(ar.tools_called) e
         WHERE e->>'name' = 'save_content_plan' AND e->>'status' = 'ok'
       )
       ${arFilterSql}
     ),
     agent_scheduled AS (
       SELECT DISTINCT pid::integer AS id
       FROM agent_runs ar, LATERAL unnest(ar.pemasaran_ids) pid
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(ar.tools_called) e
         WHERE e->>'name' = 'schedule_content' AND e->>'status' = 'ok'
       )
       ${arFilterSql}
     )
     SELECT
       (SELECT COUNT(*)::integer
        FROM pemasaran p
        WHERE p.created_at >= $${sinceParamIdx}
          AND p.id NOT IN (SELECT id FROM agent_saved WHERE id IS NOT NULL)
          ${m3ChannelClause}
       ) AS manual_saves,
       (SELECT COUNT(*)::integer
        FROM pemasaran p
        WHERE p.repliz_schedule_id IS NOT NULL
          AND COALESCE(p.repliz_synced_at, p.scheduled_at, p.created_at) >= $${sinceParamIdx}
          AND p.id NOT IN (SELECT id FROM agent_scheduled WHERE id IS NOT NULL)
          ${m3ChannelClause}
       ) AS manual_schedules`,
    m3Params,
  );

  const m4Params = [...runFilters.params];
  const m4ChannelClause = channel
    ? `AND lower(coalesce(p.kanal, '')) = $${m4Params.length + 1}`
    : `AND lower(coalesce(p.kanal, '')) = ANY($${m4Params.length + 1}::text[])`;
  if (channel) m4Params.push(String(channel).trim().toLowerCase());
  else m4Params.push(channels);

  const m4 = await dbPool.query(
    `SELECT
       PERCENTILE_CONT(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (p.published_at - ar.started_at)) * 1000
       )::bigint AS median_ms
     FROM agent_runs ar
     JOIN LATERAL unnest(ar.pemasaran_ids) AS pid ON true
     JOIN pemasaran p ON p.id = pid
     ${runFilters.where ? `${runFilters.where} AND` : 'WHERE'} p.published_at IS NOT NULL
       AND ar.started_at IS NOT NULL
       ${m4ChannelClause}`,
    m4Params,
  );

  const m6 = await dbPool.query(
    `WITH channels AS (
       SELECT unnest($1::text[]) AS kanal
     ),
     upcoming AS (
       SELECT generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', INTERVAL '1 day')::date AS day
     ),
     filled AS (
       SELECT DISTINCT (COALESCE(p.scheduled_at, p.repliz_scheduled_at, p.created_at))::date AS day
       FROM pemasaran p
       INNER JOIN channels c ON lower(coalesce(p.kanal, 'threads')) = c.kanal
       WHERE COALESCE(p.scheduled_at, p.repliz_scheduled_at, p.created_at) >= CURRENT_DATE
         AND COALESCE(p.scheduled_at, p.repliz_scheduled_at, p.created_at) < CURRENT_DATE + INTERVAL '7 days'
     )
     SELECT
       COUNT(DISTINCT u.day)::integer AS days_in_window,
       COUNT(DISTINCT f.day)::integer AS days_with_content
     FROM upcoming u
     LEFT JOIN filled f ON f.day = u.day`,
    [channels],
  );

  const m7Params = [period.since.toISOString(), channels];
  const m7 = await dbPool.query(
    `SELECT
       COUNT(*)::integer AS total_scheduled,
       COUNT(*) FILTER (WHERE repliz_status = 'success' OR status = 'posted')::integer AS posted,
       COUNT(*) FILTER (WHERE repliz_status = 'error' OR status = 'failed')::integer AS failed
     FROM pemasaran p
     WHERE repliz_schedule_id IS NOT NULL
       AND COALESCE(p.repliz_synced_at, p.scheduled_at, p.created_at) >= $1
       AND lower(coalesce(p.kanal, 'threads')) = ANY($2::text[])`,
    m7Params,
  );

  const byMode = await dbPool.query(
    `SELECT
       autonomy_mode,
       COUNT(*)::integer AS runs,
       COALESCE(SUM(plans_saved), 0)::integer AS plans_saved,
       COALESCE(SUM(plans_scheduled), 0)::integer AS plans_scheduled,
       COUNT(*) FILTER (WHERE status = 'error')::integer AS errors
     FROM agent_runs
     ${runFilters.where}
     GROUP BY autonomy_mode
     ORDER BY runs DESC`,
    runFilters.params,
  );

  const bySource = await dbPool.query(
    `SELECT
       source,
       COUNT(*)::integer AS runs,
       COALESCE(SUM(plans_saved), 0)::integer AS plans_saved,
       COALESCE(SUM(plans_scheduled), 0)::integer AS plans_scheduled,
       COUNT(*) FILTER (WHERE status = 'error')::integer AS errors
     FROM agent_runs
     ${runFilters.where}
     GROUP BY source
     ORDER BY runs DESC`,
    runFilters.params,
  );

  const totalRuns = totals.rows[0]?.total_runs ?? 0;
  const errorRuns = totals.rows[0]?.error_runs ?? 0;
  const saveAttemptsCount = saveAttempts.rows[0]?.save_attempts ?? 0;
  const saveSuccess = saveAttempts.rows[0]?.save_success ?? 0;
  const scheduleAttemptsCount = scheduleAttempts.rows[0]?.schedule_attempts ?? 0;
  const scheduleSuccess = scheduleAttempts.rows[0]?.schedule_success ?? 0;
  const manualSaves = m3.rows[0]?.manual_saves ?? 0;
  const manualSchedules = m3.rows[0]?.manual_schedules ?? 0;
  const daysInWindow = m6.rows[0]?.days_in_window ?? 0;
  const daysWithContent = m6.rows[0]?.days_with_content ?? 0;
  const totalScheduled = m7.rows[0]?.total_scheduled ?? 0;
  const posted = m7.rows[0]?.posted ?? 0;

  return {
    generated_at: new Date().toISOString(),
    period: {
      since: period.since.toISOString(),
      days: period.days,
    },
    filters: {
      channel: channel ? String(channel).trim().toLowerCase() : null,
      channels,
      autonomy_mode: autonomy_mode ? String(autonomy_mode).trim().toLowerCase() : null,
      source: source ? String(source).trim().toLowerCase() : null,
    },
    M1_planning_success_rate: rate(saveSuccess, saveAttemptsCount),
    M2_schedule_success_rate: rate(scheduleSuccess, scheduleAttemptsCount),
    M3_human_intervention_count: manualSaves + manualSchedules,
    M3_manual_saves: manualSaves,
    M3_manual_schedules: manualSchedules,
    M4_time_to_publish_median_ms: m4.rows[0]?.median_ms ?? null,
    M5_tool_error_rate: rate(errorRuns, totalRuns),
    M6_calendar_coverage_rate: rate(daysWithContent, daysInWindow),
    M7_publish_success_rate: rate(posted, totalScheduled),
    totals: totals.rows[0] ?? {},
    save_attempts: saveAttempts.rows[0] ?? {},
    schedule_attempts: scheduleAttempts.rows[0] ?? {},
    calendar_coverage: m6.rows[0] ?? {},
    publish_outcome: m7.rows[0] ?? {},
    by_autonomy_mode: byMode.rows,
    by_source: bySource.rows,
  };
}