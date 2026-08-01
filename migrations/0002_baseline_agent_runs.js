export const up = (pgm) => {
  pgm.sql(`
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

  pgm.sql('CREATE INDEX IF NOT EXISTS agent_runs_session_key_idx ON agent_runs (session_key)');
  pgm.sql('CREATE INDEX IF NOT EXISTS agent_runs_started_at_idx ON agent_runs (started_at DESC)');
  pgm.sql('CREATE INDEX IF NOT EXISTS agent_runs_status_idx ON agent_runs (status)');
};

export const down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS agent_runs_session_key_idx');
  pgm.sql('DROP INDEX IF EXISTS agent_runs_started_at_idx');
  pgm.sql('DROP INDEX IF EXISTS agent_runs_status_idx');
  pgm.sql('DROP TABLE IF EXISTS agent_runs');
};
