import { escapeHtml } from '../html.js';
import { sidebarHTML } from './layout.js';

export function pemasaranPage(username, csrfToken, { nonce = '' } = {}) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rencana Pemasaran — socai.my.id</title>
  <style nonce="${nonce}">
    :root {
      --bg: #f8fafc;
      --content-bg: #ffffff;
      --text: #172033;
      --muted: #6b7280;
      --border: #e2e8f0;
      --accent: #4f46e5;
      --danger: #ef4444;
      --success: #10b981;
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0f172a; --content-bg: #1e293b; --text: #f2f5f8; --muted: #94a3b8; --border: #334155; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; }

    /* Sidebar */
    :root { --sidebar-w: 260px; --sidebar-bg: #1e293b; --sidebar-text: #cbd5e1; --sidebar-hover: #334155; --sidebar-active: #4f46e5; }
    .sidebar { width: var(--sidebar-w); background: var(--sidebar-bg); color: var(--sidebar-text); display: flex; flex-direction: column; position: fixed; top: 0; left: 0; height: 100vh; z-index: 100; }
    .sidebar-brand { padding: 20px; font-size: 16px; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; gap: 10px; }
    .sidebar-brand span { font-size: 18px; }
    .sidebar-nav { flex: 1; padding: 12px 0; }
    .sidebar-nav a { display: flex; align-items: center; gap: 12px; padding: 12px 20px; color: var(--sidebar-text); text-decoration: none; font-size: 14px; border-left: 3px solid transparent; transition: all .15s; }
    .sidebar-nav a:hover { background: var(--sidebar-hover); color: #fff; }
    .sidebar-nav a.active { background: rgba(79,70,229,.15); color: #fff; border-left-color: var(--sidebar-active); }
    .sidebar-nav a .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-footer { border-top: 1px solid rgba(255,255,255,.08); padding: 12px 0; }
    .sidebar-footer a { display: flex; align-items: center; gap: 12px; padding: 12px 20px; color: var(--sidebar-text); text-decoration: none; font-size: 14px; transition: all .15s; }
    .sidebar-footer a:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .sidebar-footer a .icon { font-size: 18px; width: 24px; text-align: center; }
    .logout-form { margin: 0; width: 100%; }
    .logout-btn {
      width: 100%;
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: var(--sidebar-text);
      background: none; border: none;
      font-size: 14px; font-weight: 500;
      cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left; font-family: inherit;
    }
    .logout-btn:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .logout-btn .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-user { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; gap: 12px; }
    .sidebar-user .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--sidebar-active); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; }
    .sidebar-user .info .name { color: #fff; font-weight: 600; font-size: 13px; }
    .sidebar-user .info .role { color: #94a3b8; font-size: 12px; }

    .main { flex: 1; margin-left: var(--sidebar-w); display: flex; flex-direction: column; min-height: 100vh; }
    .topbar { background: var(--content-bg); padding: 16px 28px; box-shadow: 0 1px 3px rgba(0,0,0,.06); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50; }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .topbar .breadcrumb { color: var(--muted); font-size: 13px; }
    .hamburger { display: none; background: none; border: none; font-size: 24px; cursor: pointer; color: var(--text); padding: 4px; }

    .content { padding: 24px 28px; flex: 1; }

    /* Table */
    .table-wrap { background: var(--content-bg); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8fafc; padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid var(--border); }
    td { padding: 14px 16px; border-bottom: 1px solid var(--border); font-size: 14px; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; }

    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
    .badge-aktif { background: #d1fae5; color: #065f46; }
    .badge-selesai { background: #dbeafe; color: #1e40af; }
    .badge-arsip { background: #f3f4f6; color: #374151; }

    .btn { padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; border: none; cursor: pointer; transition: all .15s; }
    .btn-danger { background: #fee2e2; color: #dc2626; }
    .btn-danger:hover { background: #fecaca; }
    .btn-detail { background: #e0e7ff; color: #4338ca; }
    .btn-detail:hover { background: #c7d2fe; }

    .empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
    .empty-state h3 { font-size: 18px; margin-bottom: 8px; color: var(--text); }

    /* Modal */
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 200; align-items: center; justify-content: center; }
    .modal-overlay.show { display: flex; }
    .modal { background: var(--content-bg); border-radius: 12px; padding: 24px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal h3 { font-size: 16px; margin-bottom: 16px; }
    .modal-field { margin-bottom: 12px; }
    .modal-field label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; }
    .modal-field p { font-size: 14px; line-height: 1.6; }
    .modal-close { margin-top: 16px; text-align: right; }
    .modal-close button { padding: 8px 20px; border-radius: 8px; border: 1px solid var(--border); background: var(--content-bg); cursor: pointer; font-size: 14px; }

    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); transition: transform .25s; }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .hamburger { display: block; }
      table { font-size: 13px; }
      td, th { padding: 10px 12px; }
    }
  </style>
</head>
<body>

${sidebarHTML('pemasaran', username, csrfToken)}

<main class="main">
  <header class="topbar">
    <div>
      <h2>📋 Rencana Pemasaran</h2>
      <span class="breadcrumb">Home / Pemasaran</span>
    </div>
    <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
  </header>

  <div class="content">
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-detail" onclick="checkReplizAccounts()">Cek Akun Repliz</button>
      <button class="btn btn-detail" onclick="bulkScheduleRepliz()">Bulk Jadwalkan Repliz</button>
      <span id="repliz-account-info" style="font-size:13px;color:var(--muted);"></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" id="select-all-plans" onchange="toggleAllPlans(this.checked)"></th>
            <th>Judul</th>
            <th>Kanal</th>
            <th>Jadwal Posting</th>
            <th>Target</th>
            <th>Status</th>
            <th>Repliz</th>
            <th>Dibuat</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody id="pemasaran-list">
          <tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted);">Memuat data...</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</main>

<!-- Detail Modal -->
<div class="modal-overlay" id="detail-modal">
  <div class="modal">
    <h3 id="modal-judul">Detail Rencana</h3>
    <div class="modal-field"><label>Strategi</label><p id="modal-strategi"></p></div>
    <div class="modal-field"><label>Target Audiens</label><p id="modal-target"></p></div>
    <div class="modal-field"><label>Kanal</label><p id="modal-kanal"></p></div>
    <div class="modal-field"><label>Jadwal</label><p id="modal-jadwal"></p></div>
    <div class="modal-field"><label>Copywriting</label><p id="modal-copy"></p></div>
    <div class="modal-field"><label>Produk Terkait</label><p id="modal-produk"></p></div>
    <div class="modal-field"><label>Repliz</label><p id="modal-repliz"></p></div>
    <div class="modal-field"><label>Gambar</label><p id="modal-gambar"></p></div>
    <div class="modal-close"><button onclick="closeModal()">Tutup</button></div>
  </div>
</div>

<script nonce="${nonce}">
let plans = [];

async function checkReplizAccounts() {
  const el = document.getElementById('repliz-account-info');
  el.textContent = 'Mengecek akun Repliz...';
  try {
    const res = await fetch('/api/repliz/accounts');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal mengambil akun Repliz');
    const connected = (data.docs || []).filter(a => a.isConnected !== false);
    if (connected.length === 0) {
      el.textContent = 'Tidak ada akun Threads Repliz connected.';
      return;
    }
    el.textContent = 'Akun Threads: ' + connected.map(a => (a.name || a.username || a.id) + ' (' + a.id + ')').join(', ');
  } catch (e) {
    el.textContent = e.message;
  }
}

async function loadPlans() {
  try {
    const res = await fetch('/api/pemasaran', { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) throw new Error(data?.error || 'Gagal mengambil data pemasaran');
    if (!Array.isArray(data)) throw new Error('Format data pemasaran tidak valid');
    plans = data;
    renderPlans();
  } catch (e) {
    document.getElementById('pemasaran-list').innerHTML =
      '<tr><td colspan="9" style="text-align:center;padding:40px;color:#ef4444;">Gagal memuat data: ' + esc(e.message || 'Terjadi kesalahan') + '</td></tr>';
  }
}

function renderPlans() {
  const tbody = document.getElementById('pemasaran-list');
  if (plans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted);">Belum ada rencana pemasaran.<br>Buat rencana melalui Asisten AI.</td></tr>';
    return;
  }
  tbody.innerHTML = plans.map(p => {
    const date = new Date(p.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const daysSince = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000);
    const badgeClass = daysSince <= 7 ? 'badge-aktif' : daysSince <= 30 ? 'badge-selesai' : 'badge-arsip';
    const badgeLabel = daysSince <= 7 ? 'Aktif' : daysSince <= 30 ? 'Selesai' : 'Arsip';
    return '<tr>' +
      '<td><input type="checkbox" class="plan-select" value="' + p.id + '" ' + (p.repliz_schedule_id ? 'disabled' : '') + '></td>' +
      '<td><strong>' + esc(p.judul) + '</strong></td>' +
      '<td>' + esc(p.kanal || '-') + '</td>' +
      '<td><strong>' + esc(p.jadwal || '-') + '</strong></td>' +
      '<td>' + esc(p.target_audiens || '-') + '</td>' +
      '<td><span class="badge ' + badgeClass + '">' + badgeLabel + '</span></td>' +
      '<td>' + replizBadge(p) + '</td>' +
      '<td>' + date + '</td>' +
      '<td>' +
        '<button class="btn btn-detail" onclick="showDetail(' + p.id + ')">Detail</button> ' +
        replizActionButton(p) + ' ' +
        '<button class="btn btn-danger" onclick="deletePlan(' + p.id + ')">Hapus</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function toggleAllPlans(checked) {
  document.querySelectorAll('.plan-select:not(:disabled)').forEach(cb => { cb.checked = checked; });
}

function getSelectedPlanIds() {
  return Array.from(document.querySelectorAll('.plan-select:checked')).map(cb => cb.value);
}

async function bulkScheduleRepliz() {
  const ids = getSelectedPlanIds();
  if (ids.length === 0) return alert('Pilih minimal satu rencana yang belum dijadwalkan.');
  if (!confirm('Jadwalkan ' + ids.length + ' rencana ke Repliz?')) return;
  try {
    const res = await fetch('/api/pemasaran/repliz/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.results) throw new Error(data.error || 'Bulk schedule gagal');
    await loadPlans();
    alert('Bulk selesai. Sukses: ' + (data.success || 0) + ', gagal: ' + (data.failed || 0));
  } catch (e) {
    alert(e.message);
  }
}

function fmtDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function replizBadge(p) {
  const status = p.repliz_status || (p.repliz_schedule_id ? 'pending' : 'not_scheduled');
  if (p.repliz_schedule_id) {
    const cls = status === 'success' ? 'badge-aktif' : status === 'error' ? 'badge-arsip' : 'badge-selesai';
    const title = 'Schedule ID: ' + p.repliz_schedule_id + '\\nScheduled: ' + fmtDateTime(p.repliz_scheduled_at) + '\\nLast sync: ' + fmtDateTime(p.repliz_synced_at);
    return '<span class="badge ' + cls + '" title="' + esc(title) + '">Repliz: ' + esc(status) + '</span>' +
      '<div style="font-size:11px;color:var(--muted);margin-top:4px;">' + esc(fmtDateTime(p.repliz_scheduled_at)) + '</div>';
  }
  if (status === 'error') return '<span class="badge badge-arsip" title="' + esc(p.repliz_last_error || '') + '">Repliz: error</span>';
  if (status === 'syncing') return '<span class="badge badge-selesai">Repliz: syncing</span>';
  return '<span class="badge badge-arsip">Belum</span>';
}

function replizActionButton(p) {
  if (p.repliz_schedule_id) return '<button class="btn btn-detail" onclick="syncRepliz(' + p.id + ')">Sync Status</button>';
  if (p.repliz_status === 'error') return '<button class="btn btn-detail" onclick="retryRepliz(' + p.id + ')">Retry Repliz</button>';
  return '<button class="btn btn-detail" onclick="scheduleRepliz(' + p.id + ')">Jadwalkan Repliz</button>';
}

async function showDetail(id) {
  let p = plans.find(x => x.id === id);
  if (!p) return;
  if (p.copywriting === undefined || p.strategi === undefined) {
    try {
      const res = await fetch('/api/pemasaran/' + id);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal memuat detail');
      p = data;
      plans = plans.map(x => x.id === id ? { ...x, ...data } : x);
    } catch (e) {
      alert(e.message);
      return;
    }
  }
  document.getElementById('modal-judul').textContent = p.judul;
  document.getElementById('modal-strategi').textContent = p.strategi || '-';
  document.getElementById('modal-target').textContent = p.target_audiens || '-';
  document.getElementById('modal-kanal').textContent = p.kanal || '-';
  document.getElementById('modal-jadwal').textContent = p.jadwal || '-';
  document.getElementById('modal-copy').textContent = p.copywriting || '-';
  document.getElementById('modal-produk').textContent = p.produk_terkait || '-';
  document.getElementById('modal-repliz').textContent = p.repliz_schedule_id
    ? 'Schedule ID: ' + p.repliz_schedule_id + ' | Status: ' + (p.repliz_status || 'pending') + ' | Scheduled: ' + fmtDateTime(p.repliz_scheduled_at) + ' | Last sync: ' + fmtDateTime(p.repliz_synced_at)
    : (p.repliz_status === 'error' ? 'Error: ' + (p.repliz_last_error || '-') : 'Belum dijadwalkan');
  const gambarEl = document.getElementById('modal-gambar');
  if (p.gambar) {
    gambarEl.innerHTML = '<a href="' + esc(p.gambar) + '" target="_blank" rel="noopener">Lihat gambar</a><br><img src="' + esc(p.gambar) + '" alt="Gambar konten" style="max-width:100%;margin-top:8px;border-radius:8px">';
  } else {
    gambarEl.textContent = '-';
  }
  document.getElementById('detail-modal').classList.add('show');
}

function closeModal() {
  document.getElementById('detail-modal').classList.remove('show');
}

async function scheduleRepliz(id) {
  if (!confirm('Jadwalkan rencana ini ke Repliz Threads?')) return;
  try {
    const res = await fetch('/api/pemasaran/' + id + '/repliz/schedule', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal menjadwalkan ke Repliz');
    await loadPlans();
    alert('Berhasil dijadwalkan ke Repliz');
  } catch (e) {
    alert(e.message);
  }
}

async function retryRepliz(id) {
  if (!confirm('Coba ulang jadwal Repliz untuk rencana ini?')) return;
  try {
    const res = await fetch('/api/pemasaran/' + id + '/repliz/retry', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal retry Repliz');
    await loadPlans();
    alert('Retry Repliz berhasil');
  } catch (e) {
    alert(e.message);
  }
}

async function syncRepliz(id) {
  try {
    const res = await fetch('/api/pemasaran/' + id + '/repliz/sync', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal sync status Repliz');
    await loadPlans();
    alert('Status Repliz berhasil disinkronkan');
  } catch (e) {
    alert(e.message);
  }
}

async function deletePlan(id) {
  if (!confirm('Yakin ingin menghapus rencana ini?')) return;
  try {
    const res = await fetch('/api/pemasaran/' + id, { method: 'DELETE' });
    if (res.ok) {
      plans = plans.filter(p => p.id !== id);
      renderPlans();
    } else {
      alert('Gagal menghapus rencana');
    }
  } catch (e) {
    alert('Gagal menghapus rencana');
  }
}

document.getElementById('detail-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

loadPlans();
</script>

</body>
</html>`;
}
