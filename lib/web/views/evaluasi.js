import { sidebarHTML } from '../../shared/layout.js';
import { HAMBURGER_BIND_JS } from '../../shared/pageInit.js';

export function evaluasiPage(username, csrfToken, { nonce = '' } = {}) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Evaluasi Penelitian — socai.my.id</title>
  <style nonce="${nonce}">
    :root {
      --bg: #f8fafc;
      --content-bg: #ffffff;
      --text: #172033;
      --muted: #6b7280;
      --border: #e2e8f0;
      --accent: #4f46e5;
      --sidebar-w: 260px;
      --sidebar-bg: #1e293b;
      --sidebar-text: #cbd5e1;
      --sidebar-hover: #334155;
      --sidebar-active: #4f46e5;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; }
    .sidebar { width: var(--sidebar-w); background: var(--sidebar-bg); color: var(--sidebar-text); display: flex; flex-direction: column; position: fixed; top: 0; left: 0; height: 100vh; z-index: 100; }
    .sidebar-brand { padding: 20px; font-size: 16px; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; gap: 10px; }
    .sidebar-nav { flex: 1; padding: 12px 0; }
    .sidebar-nav a { display: flex; align-items: center; gap: 12px; padding: 12px 20px; color: var(--sidebar-text); text-decoration: none; font-size: 14px; border-left: 3px solid transparent; }
    .sidebar-nav a:hover { background: var(--sidebar-hover); color: #fff; }
    .sidebar-nav a.active { background: rgba(79,70,229,.15); color: #fff; border-left-color: var(--sidebar-active); }
    .sidebar-nav a .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-footer { border-top: 1px solid rgba(255,255,255,.08); padding: 12px 0; }
    .logout-form { margin: 0; width: 100%; }
    .logout-btn { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 20px; color: #ef4444; background: none; border: none; font-size: 14px; cursor: pointer; text-align: left; font-family: inherit; }
    .sidebar-user { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; gap: 12px; }
    .sidebar-user .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--sidebar-active); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; }
    .sidebar-user .info .name { color: #fff; font-weight: 600; font-size: 13px; }
    .sidebar-user .info .role { color: #94a3b8; font-size: 12px; }
    .main { flex: 1; margin-left: var(--sidebar-w); display: flex; flex-direction: column; min-height: 100vh; }
    .topbar { background: var(--content-bg); padding: 16px 28px; box-shadow: 0 1px 3px rgba(0,0,0,.06); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50; }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .topbar .breadcrumb { color: var(--muted); font-size: 13px; }
    .hamburger { display: none; background: none; border: none; font-size: 24px; cursor: pointer; }
    .content { padding: 24px 28px; flex: 1; }
    .toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; }
    .toolbar label { font-size: 13px; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
    .toolbar select, .toolbar input { padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; min-width: 140px; }
    .btn { padding: 8px 16px; border-radius: 8px; border: none; background: var(--accent); color: #fff; font-size: 14px; font-weight: 500; cursor: pointer; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .metric-card { background: var(--content-bg); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
    .metric-card .label { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; margin-bottom: 8px; }
    .metric-card .value { font-size: 28px; font-weight: 700; color: var(--text); }
    .metric-card .hint { font-size: 12px; color: var(--muted); margin-top: 6px; line-height: 1.5; }
    .panel { background: var(--content-bg); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .panel h3 { font-size: 16px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 10px 12px; background: #f8fafc; color: var(--muted); font-size: 12px; text-transform: uppercase; border-bottom: 1px solid var(--border); }
    td { padding: 12px; border-bottom: 1px solid var(--border); }
    .status { padding: 40px; text-align: center; color: var(--muted); }
    .status--error { color: #dc2626; }
    .meta { font-size: 13px; color: var(--muted); margin-bottom: 16px; }
    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); transition: transform .25s; }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .hamburger { display: block; }
    }
  </style>
</head>
<body>

${sidebarHTML('evaluasi', username, csrfToken)}

<main class="main">
  <header class="topbar">
    <div>
      <h2>📈 Evaluasi Penelitian</h2>
      <span class="breadcrumb">Home / Evaluasi — Metrik M1–M7</span>
    </div>
    <button class="hamburger" type="button">☰</button>
  </header>

  <div class="content">
    <div class="toolbar">
      <label>Periode (hari)
        <select id="filter-days">
          <option value="7">7 hari</option>
          <option value="30" selected>30 hari</option>
          <option value="90">90 hari</option>
        </select>
      </label>
      <label>Mode autonomi
        <select id="filter-mode">
          <option value="">Semua</option>
          <option value="assistive">assistive</option>
          <option value="supervised">supervised</option>
          <option value="bounded">bounded</option>
        </select>
      </label>
      <label>Sumber
        <select id="filter-source">
          <option value="">Semua</option>
          <option value="web">web</option>
          <option value="telegram">telegram</option>
          <option value="cron">cron</option>
        </select>
      </label>
      <label>Kanal
        <select id="filter-channel">
          <option value="">Semua aktif</option>
          <option value="threads">threads</option>
          <option value="instagram">instagram</option>
        </select>
      </label>
      <button class="btn" id="btn-refresh" type="button">Muat ulang</button>
    </div>

    <p class="meta" id="metrics-meta">Memuat metrik...</p>

    <div class="metrics-grid" id="metrics-grid">
      <div class="status">Memuat...</div>
    </div>

    <div class="panel">
      <h3>Per mode autonomi</h3>
      <div id="table-mode"><div class="status">Memuat...</div></div>
    </div>

    <div class="panel">
      <h3>Per sumber trigger</h3>
      <div id="table-source"><div class="status">Memuat...</div></div>
    </div>
  </div>
</main>

<script nonce="${nonce}">
${HAMBURGER_BIND_JS}

function pct(value) {
  if (value === null || value === undefined) return '—';
  return (value * 100).toFixed(1) + '%';
}

function num(value) {
  if (value === null || value === undefined) return '—';
  return String(value);
}

function msToHours(ms) {
  if (ms === null || ms === undefined) return '—';
  const hours = ms / 3600000;
  return hours < 24 ? hours.toFixed(1) + ' jam' : (hours / 24).toFixed(1) + ' hari';
}

function renderMetricCards(data) {
  const cards = [
    { id: 'M1', label: 'M1 Planning success', value: pct(data.M1_planning_success_rate), hint: 'save_content_plan sukses / percobaan' },
    { id: 'M2', label: 'M2 Schedule success', value: pct(data.M2_schedule_success_rate), hint: 'schedule_content sukses / percobaan' },
    { id: 'M3', label: 'M3 Human intervention', value: num(data.M3_human_intervention_count), hint: 'simpan + jadwal manual (proxy)' },
    { id: 'M4', label: 'M4 Time-to-publish', value: msToHours(data.M4_time_to_publish_median_ms), hint: 'median publish − agent run start' },
    { id: 'M5', label: 'M5 Tool error rate', value: pct(data.M5_tool_error_rate), hint: 'run error / total run' },
    { id: 'M6', label: 'M6 Calendar coverage', value: pct(data.M6_calendar_coverage_rate), hint: 'hari terisi / 7 hari ke depan' },
    { id: 'M7', label: 'M7 Publish success', value: pct(data.M7_publish_success_rate), hint: 'posted / terjadwal Repliz' },
  ];
  return cards.map((card) => (
    '<article class="metric-card">' +
      '<div class="label">' + card.label + '</div>' +
      '<div class="value">' + card.value + '</div>' +
      '<div class="hint">' + card.hint + '</div>' +
    '</article>'
  )).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function renderTable(rows, columns) {
  if (!rows || rows.length === 0) {
    return '<div class="status">Belum ada data pada periode ini.</div>';
  }
  const head = columns.map((col) => '<th>' + col.label + '</th>').join('');
  const body = rows.map((row) => (
    '<tr>' + columns.map((col) => '<td>' + esc(row[col.key] ?? '—') + '</td>').join('') + '</tr>'
  )).join('');
  return '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

async function loadMetrics() {
  const grid = document.getElementById('metrics-grid');
  const meta = document.getElementById('metrics-meta');
  const days = document.getElementById('filter-days').value;
  const mode = document.getElementById('filter-mode').value;
  const source = document.getElementById('filter-source').value;
  const channel = document.getElementById('filter-channel').value;
  const params = new URLSearchParams({ days });
  if (mode) params.set('autonomy_mode', mode);
  if (source) params.set('source', source);
  if (channel) params.set('channel', channel);

  grid.innerHTML = '<div class="status">Memuat...</div>';
  try {
    const res = await fetch('/api/agent/metrics?' + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal memuat metrik');
    meta.textContent = 'Periode sejak ' + new Date(data.period.since).toLocaleString('id-ID') +
      ' · total run: ' + (data.totals.total_runs ?? 0) +
      ' · rencana tersimpan: ' + (data.totals.total_plans_saved ?? 0);
    grid.innerHTML = renderMetricCards(data);
    document.getElementById('table-mode').innerHTML = renderTable(data.by_autonomy_mode, [
      { key: 'autonomy_mode', label: 'Mode' },
      { key: 'runs', label: 'Runs' },
      { key: 'plans_saved', label: 'Saved' },
      { key: 'plans_scheduled', label: 'Scheduled' },
      { key: 'errors', label: 'Errors' },
    ]);
    document.getElementById('table-source').innerHTML = renderTable(data.by_source, [
      { key: 'source', label: 'Sumber' },
      { key: 'runs', label: 'Runs' },
      { key: 'plans_saved', label: 'Saved' },
      { key: 'plans_scheduled', label: 'Scheduled' },
      { key: 'errors', label: 'Errors' },
    ]);
  } catch (err) {
    // A5 (audit): bangun node error dengan textContent — err.message dari API
    // tidak boleh masuk ke innerHTML (potensi XSS via pesan yang memuat konten user).
    const errBox = document.createElement('div');
    errBox.className = 'status status--error';
    errBox.textContent = err.message;
    grid.replaceChildren(errBox);
    meta.textContent = 'Gagal memuat metrik.';
  }
}

document.getElementById('btn-refresh').addEventListener('click', loadMetrics);
document.getElementById('filter-days').addEventListener('change', loadMetrics);
document.getElementById('filter-mode').addEventListener('change', loadMetrics);
document.getElementById('filter-source').addEventListener('change', loadMetrics);
document.getElementById('filter-channel').addEventListener('change', loadMetrics);
loadMetrics();
</script>
</body>
</html>`;
}