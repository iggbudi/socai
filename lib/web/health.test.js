import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectHealthStatus, getHealthHttpStatus } from './health.js';

test('collectHealthStatus reports current migration as schema ok', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (String(sql).includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [{ name: '0002_baseline_agent_runs' }] };
    },
  };

  const health = await collectHealthStatus({ pool });

  assert.equal(health.status, 'ok');
  assert.deepEqual(health.checks.schema, {
    ok: true,
    status: 'ok',
    latestMigration: '0002_baseline_agent_runs',
    requiredMigration: '0002_baseline_agent_runs',
  });
  assert.equal(queries.length, 2);
  assert.equal(getHealthHttpStatus(health), 200);
});

test('collectHealthStatus marks schema pending when migration is behind', async () => {
  const pool = {
    async query(sql) {
      if (String(sql).includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [{ name: '0001_baseline_pemasaran_repliz' }] };
    },
  };

  const health = await collectHealthStatus({ pool });

  assert.equal(health.status, 'pending');
  assert.equal(health.checks.schema.status, 'pending');
  assert.equal(health.checks.schema.ok, false);
  assert.equal(getHealthHttpStatus(health), 503);
});

test('collectHealthStatus marks schema pending when migration table is missing', async () => {
  const pool = {
    async query(sql) {
      if (String(sql).includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      const error = new Error('relation pgmigrations does not exist');
      error.code = '42P01';
      throw error;
    },
  };

  const health = await collectHealthStatus({ pool });

  assert.equal(health.status, 'pending');
  assert.equal(health.checks.schema.error, 'Migration table pgmigrations belum ada');
});

test('collectHealthStatus keeps schema shape when database is down', async () => {
  const pool = {
    query: async () => {
      throw new Error('connection refused');
    },
  };

  const health = await collectHealthStatus({ pool });

  assert.equal(health.status, 'down');
  assert.equal(health.checks.schema.status, 'pending');
  assert.equal(health.checks.schema.error, 'Database unavailable');
  assert.equal(getHealthHttpStatus(health), 503);
});
