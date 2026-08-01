export const LATEST_SCHEMA_MIGRATION = '0002_baseline_agent_runs';

export async function getSchemaStatus(dbPool) {
  const base = {
    ok: false,
    status: 'pending',
    latestMigration: null,
    requiredMigration: LATEST_SCHEMA_MIGRATION,
  };

  if (!dbPool) return { ...base, error: 'Database pool not provided' };

  try {
    const result = await dbPool.query('SELECT max(name) AS name FROM pgmigrations');
    const latestMigration = result.rows[0]?.name || null;
    const ok = latestMigration === LATEST_SCHEMA_MIGRATION;
    return {
      ...base,
      ok,
      status: ok ? 'ok' : 'pending',
      latestMigration,
    };
  } catch (err) {
    return {
      ...base,
      error: err.code === '42P01' ? 'Migration table pgmigrations belum ada' : err.message,
    };
  }
}
