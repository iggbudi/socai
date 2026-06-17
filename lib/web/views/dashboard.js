import { escapeHtml } from '../html.js';
import { sidebarHTML } from './layout.js';

export function dashboardPage(username, csrfToken, { nonce = '' } = {}) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard — socai.my.id</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --sidebar-w: 260px;
      --bg: #f1f5f9;
      --sidebar-bg: #1e293b;
      --sidebar-text: #cbd5e1;
      --sidebar-hover: #334155;
      --sidebar-active: #4f46e5;
      --accent: #4f46e5;
      --content-bg: #fff;
    }
    html, body { height: 100%; }
    body {
      display: flex;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #172033;
      background: var(--bg);
    }

    /* ---------- Sidebar ---------- */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      height: 100vh;
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      z-index: 100;
      overflow-y: auto;
    }
    .sidebar-brand {
      padding: 24px 20px 20px;
      font-size: 20px;
      font-weight: 700;
      color: #fff;
      border-bottom: 1px solid rgba(255,255,255,.08);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .sidebar-brand span { font-size: 18px; }

    .sidebar-nav {
      flex: 1;
      padding: 12px 0;
    }
    .sidebar-nav a {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      color: var(--sidebar-text);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: background .15s, color .15s;
      border-left: 3px solid transparent;
    }
    .sidebar-nav a:hover {
      background: var(--sidebar-hover);
      color: #fff;
    }
    .sidebar-nav a.active {
      background: rgba(79,70,229,.15);
      color: #fff;
      border-left-color: var(--sidebar-active);
    }
    .sidebar-nav a .icon { font-size: 18px; width: 24px; text-align: center; }

    .sidebar-footer {
      border-top: 1px solid rgba(255,255,255,.08);
      padding: 12px 0;
    }
    .sidebar-footer a {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      color: #ef4444;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: background .15s, color .15s;
    }
    .sidebar-footer a:hover {
      background: rgba(239,68,68,.1);
      color: #f87171;
    }
    .sidebar-footer a .icon { font-size: 18px; width: 24px; text-align: center; }
    .logout-form { margin: 0; width: 100%; }
    .logout-btn {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      color: #ef4444;
      background: none;
      border: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left;
      font-family: inherit;
    }
    .logout-btn:hover {
      background: rgba(239,68,68,.1);
      color: #f87171;
    }
    .logout-btn .icon { font-size: 18px; width: 24px; text-align: center; }

    .sidebar-user {
      padding: 16px 20px;
      border-top: 1px solid rgba(255,255,255,.08);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .sidebar-user .avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: var(--sidebar-active);
      color: #fff;
      display: grid;
      place-items: center;
      font-weight: 700;
      font-size: 14px;
      flex-shrink: 0;
    }
    .sidebar-user .info .name {
      color: #fff;
      font-weight: 600;
    }
    .sidebar-user .info .role {
      color: #94a3b8;
      font-size: 12px;
    }

    /* ---------- Main Content ---------- */
    .main {
      flex: 1;
      margin-left: var(--sidebar-w);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      background: var(--content-bg);
      padding: 16px 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .topbar .breadcrumb { color: #6b7280; font-size: 13px; }

    .content {
      flex: 1;
      padding: 28px;
    }

    /* Card di konten */
    .card {
      background: var(--content-bg);
      border-radius: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,.06);
      padding: 28px;
    }
    .card h3 { font-size: 18px; margin-bottom: 8px; }
    .card p { color: #6b7280; font-size: 14px; line-height: 1.7; }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--content-bg);
      border-radius: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,.06);
      padding: 20px 24px;
    }
    .stat-card .label { font-size: 13px; color: #6b7280; margin-bottom: 4px; }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #172033; }
    .stat-card .value-online { color: #22c55e; }

    /* Mobile hamburger */
    .hamburger {
      display: none;
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #172033;
      padding: 4px;
    }

    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        transition: transform .25s;
      }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .hamburger { display: block; }
    }

    /* Dark mode */
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --content-bg: #1e293b;
      }
      body { color: #f2f5f8; }
      .card, .stat-card { box-shadow: 0 1px 4px rgba(0,0,0,.3); }
      .card p { color: #94a3b8; }
      .stat-card .value { color: #f2f5f8; }
      .topbar { box-shadow: 0 1px 3px rgba(0,0,0,.3); }
    }
  </style>
</head>
<body>

  <!-- Sidebar -->
  ${sidebarHTML('dashboard', username, csrfToken)}

  <!-- Main -->
  <main class="main">
    <header class="topbar">
      <div>
        <h2>Dashboard</h2>
        <span class="breadcrumb">Home / Dashboard</span>
      </div>
      <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
    </header>

    <div class="content">
      <div class="stats">
        <div class="stat-card">
          <div class="label">Total Pengguna</div>
          <div class="value">1</div>
        </div>
        <div class="stat-card">
          <div class="label">Halaman Aktif</div>
          <div class="value">3</div>
        </div>
        <div class="stat-card">
          <div class="label">Server Status</div>
          <div class="value value-online">Online</div>
        </div>
      </div>

      <div class="card">
        <h3>✅ Selamat datang, ${escapeHtml(username)}!</h3>
        <p>
          Kamu berhasil login ke dashboard <strong>socai.my.id</strong>.
          Gunakan menu di sidebar untuk navigasi antar halaman.
        </p>
      </div>
    </div>
  </main>

</body>
</html>`;
}
