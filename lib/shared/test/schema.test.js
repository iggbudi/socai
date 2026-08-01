import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchemaStatus, LATEST_SCHEMA_MIGRATION, readLatestSchemaMigration } from '../schema.js';

test('LATEST_SCHEMA_MIGRATION follows the newest migration file', () => {
  assert.equal(LATEST_SCHEMA_MIGRATION, '0002_baseline_agent_runs');
});

test('getSchemaStatus reports a missing database pool', async () => {
  const status = await getSchemaStatus(null);

  assert.equal(status.ok, false);
  assert.equal(status.error, 'Database pool not provided');
});

test('getSchemaStatus reports the current migration as ok', async () => {
  const status = await getSchemaStatus({
    query: async () => ({ rows: [{ name: '0002_baseline_agent_runs' }] }),
  });

  assert.equal(status.ok, true);
  assert.equal(status.status, 'ok');
});

test('getSchemaStatus reports an older migration as pending', async () => {
  const status = await getSchemaStatus({
    query: async () => ({ rows: [{ name: '0001_baseline_pemasaran_repliz' }] }),
  });

  assert.equal(status.ok, false);
  assert.equal(status.status, 'pending');
});

test('getSchemaStatus explains a missing migration table', async () => {
  const error = Object.assign(new Error('relation pgmigrations does not exist'), { code: '42P01' });
  const status = await getSchemaStatus({ query: async () => Promise.reject(error) });

  assert.equal(status.ok, false);
  assert.equal(status.error, 'Migration table pgmigrations belum ada');
});

test('getSchemaStatus passes through unknown database errors without throwing', async () => {
  const status = await getSchemaStatus({
    query: async () => Promise.reject(new Error('database unavailable')),
  });

  assert.equal(status.ok, false);
  assert.equal(status.error, 'database unavailable');
});

test('an unreadable migrations directory produces unknown status', async () => {
  const missingDirectory = join(mkdtempSync(join(tmpdir(), 'socai-schema-')), 'migrations');

  try {
    const requiredMigration = readLatestSchemaMigration(missingDirectory);
    const status = await getSchemaStatus({ query: async () => ({ rows: [] }) }, { requiredMigration });

    assert.equal(requiredMigration, null);
    assert.equal(status.ok, false);
    assert.equal(status.status, 'unknown');
  } finally {
    rmSync(missingDirectory.replace(/\/migrations$/, ''), { recursive: true, force: true });
  }
});
