/**
 * QA smoke checks — run: node test/qa-smoke.mjs
 * Exits 0 if all checks pass, 1 otherwise.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebApp } from '../lib/web/createApp.js';
import { getAutonomyConfig } from '../lib/actuator/policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
import { loginPage } from '../lib/web/views/login.js';
import { dashboardPage } from '../lib/web/views/dashboard.js';
import { produkPage } from '../lib/web/views/produk.js';
import { pemasaranPage } from '../lib/web/views/pemasaran.js';
import { asistenPage } from '../lib/web/views/asisten.js';

// HTML attributes only — JS property assignment (saveBtn.onclick =) is CSP-safe
const INLINE_HANDLER = /<[^>]+\son(click|change|keydown|submit|input)\s*=/i;
const pages = [
  ['login', () => loginPage('', { nonce: 'qa-nonce' })],
  ['dashboard', () => dashboardPage('qauser', 'csrf', { nonce: 'qa-nonce' })],
  ['produk', () => produkPage('qauser', 'csrf', { nonce: 'qa-nonce' })],
  ['pemasaran', () => pemasaranPage('qauser', 'csrf', { nonce: 'qa-nonce' })],
  ['asisten', () => asistenPage('qauser', 'csrf', { nonce: 'qa-nonce' })],
];

let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failed++;
    console.error(`✘ ${name}: ${err.message}`);
  }
}

check('createWebApp exports app', () => {
  const { app } = createWebApp();
  assert.ok(app);
  assert.equal(typeof app.listen, 'function');
});

const actuatorFiles = [
  'lib/actuator/index.js',
  'lib/actuator/policy.js',
  'lib/actuator/calendar.js',
  'lib/actuator/contentPlan.js',
  'lib/actuator/schedule.js',
  'lib/agentRuns.js',
  'lib/agentRunner.js',
  'lib/autonomousJobs.js',
  'lib/scheduleApproval.js',
  'lib/publishFeedback.js',
  'lib/telegramNotify.js',
];
for (const rel of actuatorFiles) {
  check(`actuator file exists: ${rel}`, () => {
    assert.ok(fs.existsSync(path.join(repoRoot, rel)));
  });
}

check('AUTONOMY_MODE defaults to assistive in policy', () => {
  const prev = process.env.AUTONOMY_MODE;
  delete process.env.AUTONOMY_MODE;
  try {
    const config = getAutonomyConfig();
    assert.equal(config.autonomyMode, 'assistive');
  } finally {
    if (prev === undefined) delete process.env.AUTONOMY_MODE;
    else process.env.AUTONOMY_MODE = prev;
  }
});

for (const [name, render] of pages) {
  const html = render();
  check(`${name}: no inline event handlers`, () => {
    assert.equal(INLINE_HANDLER.test(html), false, `found inline handler in ${name}`);
  });
  if (name === 'login') {
    check(`${name}: style nonce present`, () => {
      assert.match(html, /<style nonce="qa-nonce">/);
    });
  } else {
    check(`${name}: script nonce present`, () => {
      assert.match(html, /<script nonce="qa-nonce">/);
    });
  }
}

const asistenHtml = asistenPage('qauser', 'csrf', { nonce: 'qa-nonce' });
check('asisten: send button wired via addEventListener', () => {
  assert.match(asistenHtml, /getElementById\('send-btn'\)\.addEventListener\('click', sendMessage\)/);
});
check('asisten: suggestion delegation', () => {
  assert.match(asistenHtml, /getElementById\('chat-messages'\)\.addEventListener\('click'/);
  assert.match(asistenHtml, /\.closest\('\.suggestion-chip'\)/);
});
check('asisten: hamburger bind snippet', () => {
  assert.match(asistenHtml, /querySelectorAll\('\.hamburger'\)/);
});

const produkHtml = produkPage('qauser', 'csrf', { nonce: 'qa-nonce' });
check('produk: table delegation', () => {
  assert.match(produkHtml, /getElementById\('produk-tbody'\)\.addEventListener\('click'/);
  assert.match(produkHtml, /data-action/);
});

const pemasaranHtml = pemasaranPage('qauser', 'csrf', { nonce: 'qa-nonce' });
check('pemasaran: table delegation', () => {
  assert.match(pemasaranHtml, /getElementById\('pemasaran-list'\)\.addEventListener\('click'/);
  assert.match(pemasaranHtml, /data-action/);
});

// HTTP smoke against running server (if up)
const base = 'http://127.0.0.1:3010';

async function httpCheck(name, fn) {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failed++;
    console.error(`✘ ${name}: ${err.message}`);
  }
}

try {
  const health = await fetch(`${base}/health`);
  const healthJson = await health.json();
  await httpCheck('HTTP /health ok', async () => {
    assert.equal(health.status, 200);
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.checks.database.ok, true);
  });

  const healthDetail = await fetch(`${base}/health?detail=1`);
  const healthDetailJson = await healthDetail.json();
  await httpCheck('HTTP /health?detail=1 autonomy fields', async () => {
    assert.equal(healthDetail.status, 200);
    assert.ok('autonomy_mode' in healthDetailJson.checks);
    assert.ok('agent_runs_ready' in healthDetailJson.checks);
    assert.ok('autonomous_jobs' in healthDetailJson.checks);
    assert.equal(typeof healthDetailJson.checks.autonomy_mode, 'string');
    assert.equal(typeof healthDetailJson.checks.agent_runs_ready, 'boolean');
    assert.equal(typeof healthDetailJson.checks.autonomous_jobs.auto_plan_cron_interval_ms, 'number');
  });

  const loginGet = await fetch(`${base}/login`);
  await httpCheck('HTTP GET /login 200 + CSP', async () => {
    assert.equal(loginGet.status, 200);
    const csp = loginGet.headers.get('content-security-policy') || '';
    assert.match(csp, /script-src-attr 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
  });

  const asistenUnauth = await fetch(`${base}/asisten`, { redirect: 'manual' });
  await httpCheck('HTTP GET /asisten unauthenticated', async () => {
    assert.ok([302, 401].includes(asistenUnauth.status));
  });

  const apiNoOrigin = await fetch(`${base}/api/asisten`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'test' }),
  });
  await httpCheck('HTTP POST /api/asisten CSRF blocks missing Origin', async () => {
    assert.equal(apiNoOrigin.status, 403);
    const body = await apiNoOrigin.json();
    assert.match(body.error, /CSRF/i);
  });

  const apiWithOrigin = await fetch(`${base}/api/asisten`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:3010',
      Referer: 'http://127.0.0.1:3010/asisten',
    },
    body: JSON.stringify({ message: 'test' }),
  });
  await httpCheck('HTTP POST /api/asisten unauthenticated → 401 not 403', async () => {
    assert.equal(apiWithOrigin.status, 401);
  });
} catch (err) {
  failed++;
  console.error(`✘ HTTP smoke (server unreachable?): ${err.message}`);
}

console.log(failed ? `\nQA FAILED (${failed} checks)` : '\nQA PASSED (all checks)');
process.exit(failed ? 1 : 0);