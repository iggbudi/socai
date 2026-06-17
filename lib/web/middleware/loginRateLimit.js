import { loginPage } from '../views/login.js';

const LOGIN_RATE_LIMIT = 5; // max attempts
const LOGIN_RATE_WINDOW = 15 * 60 * 1000; // 15 minutes

const loginAttempts = new Map();

function cleanupLoginAttempts() {
  const now = Date.now();
  for (const [ip, data] of loginAttempts) {
    if (now - data.firstAttempt > LOGIN_RATE_WINDOW) {
      loginAttempts.delete(ip);
    }
  }
}

export function createLoginRateLimiter(trackInterval) {
  trackInterval(cleanupLoginAttempts, 5 * 60 * 1000);

  return {
    increment(ip) {
      const now = Date.now();
      const existing = loginAttempts.get(ip);
      if (!existing || now - existing.firstAttempt > LOGIN_RATE_WINDOW) {
        loginAttempts.set(ip, { count: 1, firstAttempt: now });
      } else {
        existing.count++;
      }
    },
    reset(ip) {
      loginAttempts.delete(ip);
    },
    middleware(req, res, next) {
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const attempts = loginAttempts.get(ip);

      // Middleware hanya mengecek limit. Counter dinaikkan hanya saat login gagal.
      if (!attempts) return next();

      if (now - attempts.firstAttempt > LOGIN_RATE_WINDOW) {
        loginAttempts.delete(ip);
        return next();
      }

      if (attempts.count >= LOGIN_RATE_LIMIT) {
        const timeLeft = Math.ceil((LOGIN_RATE_WINDOW - (now - attempts.firstAttempt)) / 60000);
        return res.status(429).type('html').send(loginPage(
          `Terlalu banyak percobaan login. Coba lagi dalam ${timeLeft} menit.`,
          { nonce: res.locals.cspNonce },
        ));
      }

      next();
    },
  };
}