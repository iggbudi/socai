import { escapeHtml } from '../html.js';

export function sidebarHTML(activePage, username, csrfToken) {
  const menu = [
    { id: 'dashboard', href: '/dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'produk', href: '/produk', icon: '🛍️', label: 'Produk' },
    { id: 'pemasaran', href: '/pemasaran', icon: '📋', label: 'Pemasaran' },
    { id: 'asisten', href: '/asisten', icon: '🤖', label: 'Asisten AI' },
  ];

  const navItems = menu.map(item => {
    const active = item.id === activePage ? ' class="active"' : '';
    return `        <a href="${item.href}"${active}><span class="icon">${item.icon}</span> ${item.label}</a>`;
  }).join('\n');

  return `    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand"><span>🔐</span> socai.my.id</div>
      <nav class="sidebar-nav">
${navItems}
      </nav>
      <div class="sidebar-footer">
        <form method="POST" action="/logout" class="logout-form">
          <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
          <button type="submit" class="logout-btn"><span class="icon">🚪</span> Logout</button>
        </form>
      </div>
      <div class="sidebar-user">
        <div class="avatar">${escapeHtml(username.charAt(0).toUpperCase())}</div>
        <div class="info">
          <div class="name">${escapeHtml(username)}</div>
          <div class="role">Administrator</div>
        </div>
      </div>
    </aside>`;
}
