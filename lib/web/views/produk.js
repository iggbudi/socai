import { escapeHtml } from '../html.js';
import { sidebarHTML } from './layout.js';
import { HAMBURGER_BIND_JS } from './pageInit.js';

export function produkPage(username, csrfToken, { nonce = '' } = {}) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Produk — Batik Bakaran</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --sidebar-w: 260px;
      --bg: #f1f5f9;
      --sidebar-bg: #1e293b;
      --sidebar-text: #cbd5e1;
      --sidebar-hover: #334155;
      --sidebar-active: #4f46e5;
      --content-bg: #fff;
    }
    html, body { height: 100%; }
    body {
      display: flex;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #172033;
      background: var(--bg);
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      height: 100vh;
      position: fixed;
      left: 0; top: 0; bottom: 0;
      z-index: 100;
      overflow-y: auto;
    }
    .sidebar-brand {
      padding: 24px 20px 20px;
      font-size: 20px; font-weight: 700;
      color: #fff;
      border-bottom: 1px solid rgba(255,255,255,.08);
      display: flex; align-items: center; gap: 10px;
    }
    .sidebar-brand span { font-size: 18px; }
    .sidebar-nav { flex: 1; padding: 12px 0; }
    .sidebar-nav a {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: var(--sidebar-text);
      text-decoration: none;
      font-size: 14px; font-weight: 500;
      transition: background .15s, color .15s;
      border-left: 3px solid transparent;
    }
    .sidebar-nav a:hover { background: var(--sidebar-hover); color: #fff; }
    .sidebar-nav a.active { background: rgba(79,70,229,.15); color: #fff; border-left-color: var(--sidebar-active); }
    .sidebar-nav a .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-footer { border-top: 1px solid rgba(255,255,255,.08); padding: 12px 0; }
    .sidebar-footer a {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: #ef4444; text-decoration: none;
      font-size: 14px; font-weight: 500;
      transition: background .15s, color .15s;
    }
    .sidebar-footer a:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .sidebar-footer a .icon { font-size: 18px; width: 24px; text-align: center; }
    .logout-form { margin: 0; width: 100%; }
    .logout-btn {
      width: 100%;
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: #ef4444;
      background: none; border: none;
      font-size: 14px; font-weight: 500;
      cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left; font-family: inherit;
    }
    .logout-btn:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .logout-btn .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-user {
      padding: 16px 20px;
      border-top: 1px solid rgba(255,255,255,.08);
      display: flex; align-items: center; gap: 10px;
      font-size: 13px;
    }
    .sidebar-user .avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: var(--sidebar-active); color: #fff;
      display: grid; place-items: center;
      font-weight: 700; font-size: 14px; flex-shrink: 0;
    }
    .sidebar-user .info .name { color: #fff; font-weight: 600; }
    .sidebar-user .info .role { color: #94a3b8; font-size: 12px; }

    /* Main */
    .main {
      flex: 1; margin-left: var(--sidebar-w);
      min-height: 100vh;
      display: flex; flex-direction: column;
    }
    .topbar {
      background: var(--content-bg);
      padding: 16px 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 50;
    }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .topbar .breadcrumb { color: #6b7280; font-size: 13px; }
    .content { flex: 1; padding: 28px; }

    /* Toolbar */
    .toolbar {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 20px; flex-wrap: wrap; gap: 12px;
    }
    .toolbar h3 { font-size: 18px; }
    .btn {
      padding: 9px 20px; border: none; border-radius: 8px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
      transition: background .15s;
    }
    .btn-primary { background: #4f46e5; color: #fff; }
    .btn-primary:hover { background: #4338ca; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-danger:hover { background: #dc2626; }
    .btn-sm { padding: 5px 12px; font-size: 12px; }
    .btn-ghost { background: #f1f5f9; color: #475569; }
    .btn-ghost:hover { background: #e2e8f0; }

    /* Table */
    .table-wrap {
      background: var(--content-bg);
      border-radius: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,.06);
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th {
      text-align: left; padding: 12px 16px;
      background: #f8fafc; color: #64748b;
      font-weight: 600; font-size: 12px; text-transform: uppercase;
      border-bottom: 1px solid #e2e8f0;
    }
    td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
    tr:hover td { background: #f8fafc; }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 20px;
      font-size: 12px; font-weight: 600;
    }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-danger { background: #fdecea; color: #991b1b; }

    /* Modal */
    .modal-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,.45); z-index: 200;
      justify-content: center; align-items: center;
    }
    .modal-overlay.show { display: flex; }
    .modal {
      background: var(--content-bg);
      border-radius: 12px; padding: 28px;
      width: 100%; max-width: 500px;
      box-shadow: 0 8px 32px rgba(0,0,0,.15);
      max-height: 90vh; overflow-y: auto;
    }
    .modal h3 { margin-bottom: 20px; font-size: 18px; }
    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; color: #374151; }
    .field input, .field textarea, .field select {
      width: 100%; padding: 9px 12px;
      border: 1px solid #d1d5db; border-radius: 7px;
      font-size: 14px; font-family: inherit;
    }
    .field input:focus, .field textarea:focus {
      outline: none; border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79,70,229,.12);
    }
    .field textarea { resize: vertical; min-height: 80px; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }

    /* Upload */
    .upload-zone {
      border: 2px dashed #d1d5db; border-radius: 8px;
      padding: 20px; text-align: center; cursor: pointer;
      transition: border-color .2s;
    }
    .upload-zone:hover { border-color: #4f46e5; }
    .upload-zone p { margin: 6px 0 2px; font-size: 13px; color: #6b7280; }
    .hidden { display: none !important; }
    .file-input-hidden { display: none; }
    .preview-img { max-width: 100%; max-height: 180px; border-radius: 6px; }
    .upload-icon { font-size: 32px; }
    .upload-hint { font-size: 11px; color: #94a3b8; }

    /* Toast */
    .toast {
      position: fixed; bottom: 28px; right: 28px; z-index: 300;
      padding: 14px 22px; border-radius: 8px;
      color: #fff; font-size: 14px; font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,.2);
      transform: translateY(100px); opacity: 0;
      transition: all .3s;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    .toast-success { background: #16a34a; }
    .toast-error { background: #dc2626; }

    /* Hamburger */
    .hamburger { display: none; background: none; border: none; font-size: 24px; cursor: pointer; color: #172033; padding: 4px; }

    /* Empty state */
    .empty { text-align: center; padding: 40px; color: #94a3b8; }

    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); transition: transform .25s; }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .hamburger { display: block; }
      .toolbar { flex-direction: column; align-items: flex-start; }
    }

    @media (prefers-color-scheme: dark) {
      :root { --bg: #0f172a; --content-bg: #1e293b; }
      body { color: #f2f5f8; }
      th { background: #1a2332; color: #94a3b8; border-bottom-color: #334155; }
      td { border-bottom-color: #1e293b; }
      tr:hover td { background: #1a2332; }
      .field input, .field textarea { background: #334155; border-color: #475569; color: #f2f5f8; }
      .field label { color: #cbd5e1; }
      .btn-ghost { background: #334155; color: #cbd5e1; }
      .btn-ghost:hover { background: #475569; }
      .topbar { box-shadow: 0 1px 3px rgba(0,0,0,.3); }
      .upload-zone { border-color: #475569; }
    }
  </style>
</head>
<body>

<!-- Sidebar -->
${sidebarHTML('produk', username, csrfToken)}

<!-- Main -->
<main class="main">
  <header class="topbar">
    <div>
      <h2>Produk</h2>
      <span class="breadcrumb">Home / Produk</span>
    </div>
    <button class="hamburger" type="button">☰</button>
  </header>

  <div class="content">
    <div class="toolbar">
      <h3>🛍️ Daftar Produk Batik Bakaran</h3>
      <button class="btn btn-primary" id="btn-tambah-produk" type="button">+ Tambah Produk</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Nama</th>
            <th>Harga</th>
            <th>Stok</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody id="produk-tbody">
          <tr><td colspan="5" class="empty">Memuat data...</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</main>

<!-- Modal Form -->
<div class="modal-overlay" id="modal">
  <div class="modal">
    <h3 id="modal-title">Tambah Produk</h3>
    <form id="produk-form">
      <input type="hidden" id="produk-id">
      <div class="field">
        <label for="nama">Nama Produk *</label>
        <input id="nama" required placeholder="Contoh: Batik Tulis Parang">
      </div>
      <div class="field">
        <label for="harga">Harga (Rp) *</label>
        <input id="harga" type="number" min="0" step="1" required placeholder="50000">
      </div>
      <div class="field">
        <label for="stok">Stok</label>
        <input id="stok" type="number" min="0" value="0">
      </div>
      <div class="field">
        <label for="gambar">Gambar Produk</label>
        <div class="upload-area" id="upload-area">
          <input type="file" id="gambar-file" class="file-input-hidden" accept="image/*">
          <input type="hidden" id="gambar" value="">
          <div class="upload-zone" id="upload-zone">
            <div id="preview-wrap" class="hidden">
              <img id="preview-img" class="preview-img" src="" alt="Preview">
            </div>
            <div id="upload-placeholder">
              <span class="upload-icon">📷</span>
              <p>Klik untuk unggah gambar</p>
              <span class="upload-hint">JPG, PNG, GIF, WebP — max 5MB</span>
            </div>
          </div>
        </div>
      </div>
      <div class="field">
        <label for="deskripsi">Deskripsi</label>
        <textarea id="deskripsi" placeholder="Deskripsi produk..."></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="btn-modal-batal">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan</button>
      </div>
    </form>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script nonce="${nonce}">
const API = '/api/produk';
let produkData = [];

// Fetch & render
async function loadProduk() {
  try {
    const res = await fetch(API);
    const data = await res.json();
    produkData = Array.isArray(data) ? data : [];
    const tbody = document.getElementById('produk-tbody');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">Belum ada produk. Klik "Tambah Produk" untuk menambah.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map((p, i) => {
      const harga = Number(p.harga).toLocaleString('id-ID');
      const stokBadge = Number(p.stok) > 0
        ? '<span class="badge badge-success">' + p.stok + '</span>'
        : '<span class="badge badge-danger">Habis</span>';
      return \`<tr>
        <td>\${i + 1}</td>
        <td>\${esc(p.nama)}</td>
        <td>Rp \${harga}</td>
        <td>\${stokBadge}</td>
        <td>
          <button class="btn btn-ghost btn-sm produk-action" data-action="edit" data-id="\${p.id}">✏️ Edit</button>
          <button class="btn btn-danger btn-sm produk-action" data-action="delete" data-id="\${p.id}">🗑 Hapus</button>
        </td>
      </tr>\`;
    }).join('');
  } catch(e) {
    document.getElementById('produk-tbody').innerHTML = '<tr><td colspan="5" class="empty">Gagal memuat data</td></tr>';
  }
}

function openModal(id) {
  document.getElementById('modal').classList.add('show');
  if (!id) {
    document.getElementById('modal-title').textContent = 'Tambah Produk';
    document.getElementById('produk-form').reset();
    document.getElementById('produk-id').value = '';
    document.getElementById('gambar').value = '';
    document.getElementById('gambar-file').value = '';
    showPreview('');
  }
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

function showPreview(src) {
  const wrap = document.getElementById('preview-wrap');
  const ph = document.getElementById('upload-placeholder');
  const img = document.getElementById('preview-img');
  if (src) {
    img.src = src;
    wrap.classList.remove('hidden');
    ph.classList.add('hidden');
  } else {
    wrap.classList.add('hidden');
    ph.classList.remove('hidden');
  }
}

async function uploadGambar(input) {
  const file = input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('gambar', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('gambar').value = data.url;
      showPreview(data.url);
      toast('Gambar berhasil diunggah', 'success');
    } else {
      toast(data.error || 'Gagal mengunggah gambar', 'error');
      input.value = '';
    }
  } catch(e) {
    toast('Gagal mengunggah gambar', 'error');
    input.value = '';
  }
}

async function editProduk(id) {
  const res = await fetch(API + '/' + id);
  const p = await res.json();
  document.getElementById('produk-id').value = p.id;
  document.getElementById('nama').value = p.nama;
  document.getElementById('harga').value = p.harga;
  document.getElementById('stok').value = p.stok;
  document.getElementById('gambar').value = p.gambar || '';
  document.getElementById('gambar-file').value = '';
  document.getElementById('deskripsi').value = p.deskripsi || '';
  document.getElementById('modal-title').textContent = 'Edit Produk';
  showPreview(p.gambar || '');
  document.getElementById('modal').classList.add('show');
}

async function saveProduk(e) {
  e.preventDefault();
  const id = document.getElementById('produk-id').value;
  const body = {
    nama: document.getElementById('nama').value,
    harga: parseInt(document.getElementById('harga').value, 10) || 0,
    stok: parseInt(document.getElementById('stok').value) || 0,
    gambar: document.getElementById('gambar').value,
    deskripsi: document.getElementById('deskripsi').value,
  };
  const url = id ? API + '/' + id : API;
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    toast(id ? 'Produk diperbarui' : 'Produk ditambahkan', 'success');
    closeModal();
    loadProduk();
  } else {
    const err = await res.json();
    toast(err.error || 'Gagal menyimpan', 'error');
  }
}

async function hapusProduk(id) {
  const produk = produkData.find(p => Number(p.id) === Number(id));
  const nama = produk && produk.nama ? produk.nama : 'ini';
  if (!confirm('Hapus produk "' + nama + '"?')) return;
  const res = await fetch(API + '/' + id, { method: 'DELETE' });
  if (res.ok) {
    toast('Produk dihapus', 'success');
    loadProduk();
  } else {
    toast('Gagal menghapus', 'error');
  }
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast-' + type + ' show';
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.remove('show'), 2500);
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Klik luar modal untuk close
document.getElementById('modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

document.getElementById('btn-tambah-produk').addEventListener('click', () => openModal());
document.getElementById('btn-modal-batal').addEventListener('click', closeModal);
document.getElementById('produk-form').addEventListener('submit', saveProduk);
document.getElementById('gambar-file').addEventListener('change', function() { uploadGambar(this); });
document.getElementById('upload-zone').addEventListener('click', () => document.getElementById('gambar-file').click());
document.getElementById('produk-tbody').addEventListener('click', (e) => {
  const btn = e.target.closest('.produk-action');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'edit') editProduk(id);
  else if (btn.dataset.action === 'delete') hapusProduk(id);
});
${HAMBURGER_BIND_JS}

// Init
loadProduk();
</script>

</body>
</html>`;
}
