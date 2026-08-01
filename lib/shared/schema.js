import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));

export function readLatestSchemaMigration(directory = migrationsDirectory) {
  try {
    const migrations = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{4}_.*\.js$/.test(entry.name))
      .map((entry) => entry.name.replace(/\.js$/, ''))
      .sort();
    return migrations.at(-1) || null;
  } catch {
    return null;
  }
}

export const LATEST_SCHEMA_MIGRATION = readLatestSchemaMigration();

export async function getSchemaStatus(dbPool, { requiredMigration = LATEST_SCHEMA_MIGRATION } = {}) {
  const base = {
    ok: false,
    status: requiredMigration ? 'pending' : 'unknown',
    latestMigration: null,
    requiredMigration,
  };

  if (!dbPool) return { ...base, error: 'Database pool not provided' };
  if (!requiredMigration) {
    return { ...base, error: 'Direktori migrations tidak dapat dibaca' };
  }

  try {
    const result = await dbPool.query('SELECT max(name) AS name FROM pgmigrations');
    const latestMigration = result.rows[0]?.name || null;
    const ok = latestMigration === requiredMigration;
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
