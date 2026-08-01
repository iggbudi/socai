import { ensureSessionCsrfToken } from '../../features/auth/csrfToken.js';
import { requireLogin } from '../../features/auth/requireLogin.js';
import { dashboardPage } from '../../features/dashboard/view.js';
import { produkPage } from '../../features/produk/view.js';
import { pemasaranPage } from '../../features/pemasaran/view.js';
import { asistenPage } from '../../features/agent/view.js';
import { evaluasiPage } from '../../features/evaluasi/view.js';

export function registerPageRoutes(app) {
  app.get('/dashboard', requireLogin, (req, res) => {
    const csrfToken = ensureSessionCsrfToken(req.session);
    res.type('html').send(dashboardPage(req.session.user.username, csrfToken, { nonce: res.locals.cspNonce }));
  });

  app.get('/produk', requireLogin, (req, res) => {
    const csrfToken = ensureSessionCsrfToken(req.session);
    res.type('html').send(produkPage(req.session.user.username, csrfToken, { nonce: res.locals.cspNonce }));
  });

  app.get('/pemasaran', requireLogin, (req, res) => {
    const csrfToken = ensureSessionCsrfToken(req.session);
    res.type('html').send(pemasaranPage(req.session.user.username, csrfToken, { nonce: res.locals.cspNonce }));
  });

  app.get('/asisten', requireLogin, (req, res) => {
    const csrfToken = ensureSessionCsrfToken(req.session);
    res.type('html').send(asistenPage(req.session.user.username, csrfToken, { nonce: res.locals.cspNonce }));
  });

  app.get('/evaluasi', requireLogin, (req, res) => {
    const csrfToken = ensureSessionCsrfToken(req.session);
    res.type('html').send(evaluasiPage(req.session.user.username, csrfToken, { nonce: res.locals.cspNonce }));
  });

  app.get('/', (req, res) => {
    res.redirect('/login');
  });
}