import crypto from 'crypto';

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function ensureSessionCsrfToken(session) {
  if (!session._csrf) {
    session._csrf = generateCsrfToken();
  }
  return session._csrf;
}

function compareCsrfTokens(token, expected) {
  if (!token || !expected) return false;
  if (typeof token !== 'string' || typeof expected !== 'string') return false;

  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (tokenBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(tokenBuf, expectedBuf);
}

export function validateCsrfToken(sessionOrToken, expected) {
  if (sessionOrToken && typeof sessionOrToken === 'object' && '_csrf' in sessionOrToken) {
    return compareCsrfTokens(sessionOrToken._csrf, expected);
  }
  return compareCsrfTokens(sessionOrToken, expected);
}