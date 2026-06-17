-- Sample queries for research metrics M1–M7 (agent_runs + pemasaran)
-- Run: psql -d socai -f scripts/export-agent-metrics.sql

-- M1: Planning success rate (save_content_plan tool success / attempts)
SELECT
  COUNT(*) FILTER (WHERE elem->>'name' = 'save_content_plan') AS save_attempts,
  COUNT(*) FILTER (WHERE elem->>'name' = 'save_content_plan' AND elem->>'status' = 'ok') AS save_success,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE elem->>'name' = 'save_content_plan' AND elem->>'status' = 'ok')
    / NULLIF(COUNT(*) FILTER (WHERE elem->>'name' = 'save_content_plan'), 0),
    2
  ) AS m1_planning_success_pct
FROM agent_runs,
     LATERAL jsonb_array_elements(tools_called) AS elem;

-- M2: Schedule success rate (schedule_content tool success / attempts)
SELECT
  COUNT(*) FILTER (WHERE elem->>'name' = 'schedule_content') AS schedule_attempts,
  COUNT(*) FILTER (WHERE elem->>'name' = 'schedule_content' AND elem->>'status' = 'ok') AS schedule_success,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE elem->>'name' = 'schedule_content' AND elem->>'status' = 'ok')
    / NULLIF(COUNT(*) FILTER (WHERE elem->>'name' = 'schedule_content'), 0),
    2
  ) AS m2_schedule_success_pct
FROM agent_runs,
     LATERAL jsonb_array_elements(tools_called) AS elem;

-- M3: Human intervention count (placeholder — track manually or via UI events in P2)
-- SELECT ... manual ops not yet instrumented in agent_runs

-- M4: Time-to-publish median (agent run start → pemasaran.published_at)
SELECT
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (p.published_at - ar.started_at)) * 1000
  )::bigint AS m4_time_to_publish_median_ms
FROM agent_runs ar
JOIN LATERAL unnest(ar.pemasaran_ids) AS pid ON true
JOIN pemasaran p ON p.id = pid
WHERE p.published_at IS NOT NULL
  AND ar.started_at IS NOT NULL;

-- M5: Tool error rate (runs with status=error / total runs)
SELECT
  COUNT(*) AS total_runs,
  COUNT(*) FILTER (WHERE status = 'error') AS error_runs,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'error') / NULLIF(COUNT(*), 0), 2) AS m5_tool_error_pct
FROM agent_runs;

-- M6: Calendar coverage (% distinct scheduled days with threads content in next 7 days)
WITH upcoming AS (
  SELECT generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', INTERVAL '1 day')::date AS day
),
filled AS (
  SELECT DISTINCT (COALESCE(scheduled_at, repliz_scheduled_at, created_at))::date AS day
  FROM pemasaran
  WHERE lower(coalesce(kanal, '')) = 'threads'
    AND COALESCE(scheduled_at, repliz_scheduled_at, created_at) >= CURRENT_DATE
    AND COALESCE(scheduled_at, repliz_scheduled_at, created_at) < CURRENT_DATE + INTERVAL '7 days'
)
SELECT
  COUNT(DISTINCT u.day) AS days_in_window,
  COUNT(DISTINCT f.day) AS days_with_content,
  ROUND(100.0 * COUNT(DISTINCT f.day) / NULLIF(COUNT(DISTINCT u.day), 0), 2) AS m6_calendar_coverage_pct
FROM upcoming u
LEFT JOIN filled f ON f.day = u.day;

-- M7: Publish outcome (% posted vs failed from repliz_status)
SELECT
  COUNT(*) AS total_scheduled,
  COUNT(*) FILTER (WHERE repliz_status = 'success' OR status = 'posted') AS posted,
  COUNT(*) FILTER (WHERE repliz_status = 'error' OR status = 'failed') AS failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE repliz_status = 'success' OR status = 'posted')
    / NULLIF(COUNT(*), 0),
    2
  ) AS m7_posted_pct
FROM pemasaran
WHERE lower(coalesce(kanal, '')) = 'threads'
  AND repliz_schedule_id IS NOT NULL;

-- Breakdown by autonomy mode
SELECT
  autonomy_mode,
  COUNT(*) AS runs,
  SUM(plans_saved) AS plans_saved,
  SUM(plans_scheduled) AS plans_scheduled,
  COUNT(*) FILTER (WHERE status = 'error') AS errors
FROM agent_runs
GROUP BY autonomy_mode
ORDER BY runs DESC;