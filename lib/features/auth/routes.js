import bcrypt from 'bcryptjs';
import { pool } from '../../shared/db.js';
import { ensureSessionCsrfToken, validateCsrfToken } from './csrfToken.js';
import { agentSessions, agentSessionLastUsed, agentSessionPromises } from '../../features/agent/core.js';
import { requireLogin } from './requireLogin.js';
import { loginPage } from './view.js';

function cleanupAgentSession(sessionKey) {
  const agentSession = agentSessions.get(sessionKey);
  if (agentSession) {
    agentSession.abort().catch(() => {});
    agentSessions.delete(sessionKey);
    agentSessionLastUsed.delete(sessionKey);
    agentSessionPromises.delete(sessionKey);
  }
}

export function registerAuthRoutes(app, { loginRateLimiter }) {
  app.get('/login', (req, res) => {
    if (req.session && req.session.user) {
      return res.redirect('/dashboard');
    }
    res.type('html').send(loginPage('', { nonce: res.locals.cspNonce }));
  });

  app.post('/login', loginRateLimiter.middleware, async (req, res) => {
    // A1 (audit): req.body bisa undefined bila Content-Type bukan form-urlencoded
    // (mis. text/plain) atau tidak ada body sama sekali — jangan sampai memicu 500.
    const { username, password } = req.body || {};
    const nonce = { nonce: res.locals.cspNonce };

    if (!username || !password) {
      const ip = req.ip || req.connection.remoteAddress;
      loginRateLimiter.increment(ip);
      return res.type('html').send(loginPage('Username dan password wajib diisi.', nonce));
    }

    try {
      const result = await pool.query('SELECT id, username, password FROM users WHERE username = $1', [
        username,
      ]);

      if (result.rows.length === 0) {
        const ip = req.ip || req.connection.remoteAddress;
        loginRateLimiter.increment(ip);
        return res.type('html').send(loginPage('Username atau password salah.', nonce));
      }

      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);

      if (!match) {
        const ip = req.ip || req.connection.remoteAddress;
        loginRateLimiter.increment(ip);
        return res.type('html').send(loginPage('Username atau password salah.', nonce));
      }

      // Successful login — reset rate limit counter
      loginRateLimiter.reset(req.ip || req.connection.remoteAddress);

      // Regenerate session to prevent session fixation
      req.session.regenerate((err) => {
        if (err) {
          console.error('Session regenerate error:', err.message);
          return res.type('html').send(loginPage('Terjadi kesalahan server. Silakan coba lagi.', nonce));
        }
        req.session.user = { id: user.id, username: user.username };
        ensureSessionCsrfToken(req.session);
        return res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('Login error:', err.message);
      return res.type('html').send(loginPage('Terjadi kesalahan server. Silakan coba lagi.', nonce));
    }
  });

  app.post('/logout', requireLogin, (req, res) => {
    // Guard body (pola A1): POST /logout tanpa Content-Type form → req.body undefined.
    if (!validateCsrfToken(req.session, req.body?._csrf)) {
      return res.status(403).redirect('/dashboard');
    }

    const sessionKey = req.sessionID;
    cleanupAgentSession(sessionKey);
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });

  app.get('/logout', (req, res) => {
    res.redirect('/dashboard');
  });
}
