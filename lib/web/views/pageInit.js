/**
 * Shared browser-side init snippets for web views.
 * These are JS source strings embedded in nonce <script> blocks —
 * NOT executed in Node. CSP `script-src-attr 'none'` blocks inline HTML
 * event handlers (onclick, onchange, etc.); use addEventListener instead.
 */
export const HAMBURGER_BIND_JS = `
document.querySelectorAll('.hamburger').forEach((btn) => {
  btn.addEventListener('click', () => document.getElementById('sidebar')?.classList.toggle('open'));
});
`;