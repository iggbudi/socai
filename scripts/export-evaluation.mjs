#!/usr/bin/env node
/**
 * Export evaluation metrics M1–M7 as JSON.
 * Usage: npm run eval:export [-- --days=30] [-- --channel=threads]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getEvaluationMetrics } from '../lib/features/evaluasi/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const pool = new pg.Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'socai',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
});

try {
  const metrics = await getEvaluationMetrics(pool, {
    days: parseArg('days', '30'),
    channel: parseArg('channel', null),
    autonomy_mode: parseArg('autonomy_mode', null),
    source: parseArg('source', null),
    since: parseArg('since', null),
  });

  const outArg = parseArg('out', null);
  const payload = JSON.stringify(metrics, null, 2);
  if (outArg) {
    const outPath = path.isAbsolute(outArg) ? outArg : path.join(__dirname, '..', outArg);
    fs.writeFileSync(outPath, payload);
    console.log(`Metrik evaluasi ditulis ke ${outPath}`);
  } else {
    console.log(payload);
  }
} catch (err) {
  console.error('Export evaluasi gagal:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}