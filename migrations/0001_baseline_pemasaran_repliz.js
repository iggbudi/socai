export const up = (pgm) => {
  pgm.sql(`
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

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS pemasaran_repliz_schedule_id_uq
      ON pemasaran (repliz_schedule_id)
      WHERE repliz_schedule_id IS NOT NULL
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS pemasaran_repliz_schedule_id_uq');
  pgm.sql(`
    ALTER TABLE IF EXISTS pemasaran
      DROP COLUMN IF EXISTS auto_schedule_enabled,
      DROP COLUMN IF EXISTS repliz_attempts,
      DROP COLUMN IF EXISTS repliz_synced_at,
      DROP COLUMN IF EXISTS repliz_last_error,
      DROP COLUMN IF EXISTS repliz_scheduled_at,
      DROP COLUMN IF EXISTS repliz_status,
      DROP COLUMN IF EXISTS repliz_schedule_id,
      DROP COLUMN IF EXISTS last_error,
      DROP COLUMN IF EXISTS external_status,
      DROP COLUMN IF EXISTS external_post_id,
      DROP COLUMN IF EXISTS published_at,
      DROP COLUMN IF EXISTS scheduled_at,
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS gambar
  `);
};
