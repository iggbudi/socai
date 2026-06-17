import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isReplizConfigured } from './repliz.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, '../package.json'), 'utf8'),
    );
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export async function collectHealthStatus({ pool, detail = false } = {}) {
  const checks = {
    database: { ok: false, latencyMs: null },
  };

  let status = 'ok';

  if (pool) {
    const start = Date.now();
    try {
      await pool.query('SELECT 1');
      checks.database.ok = true;
      checks.database.latencyMs = Date.now() - start;
    } catch (err) {
      checks.database.error = err.message;
      checks.database.latencyMs = null;
      status = 'down';
    }
  } else {
    checks.database.error = 'Database pool not provided';
    status = 'down';
  }

  if (detail) {
    checks.repliz = { configured: isReplizConfigured() };
    checks.telegram = { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN) };
    checks.ai = { dbReadOnlyConfigured: Boolean(process.env.DB_AI_READ_USER) };
  }

  return {
    status,
    service: 'socai.my.id',
    timestamp: new Date().toISOString(),
    version: getVersion(),
    checks,
  };
}

export function getHealthHttpStatus(health) {
  return health?.status === 'down' ? 503 : 200;
}