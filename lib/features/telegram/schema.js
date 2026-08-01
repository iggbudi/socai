export async function ensureMarketingSchema(dbPool) {
  await dbPool.query(`
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
      ADD COLUMN IF NOT EXISTS repliz_attempts integer DEFAULT 0
  `);
}

export async function syncBotCommands(bot, defaultCommands, superAdminCommands, superAdminId) {
  await bot.telegram.setMyCommands(defaultCommands);
  await bot.telegram.setMyCommands(superAdminCommands, {
    scope: { type: 'chat', chat_id: superAdminId },
  });
}
