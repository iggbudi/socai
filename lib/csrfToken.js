import crypto from 'crypto';

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function validateCsrfToken(token, expected) {
  if (!token || !expected) return false;
  if (typeof token !== 'string' || typeof expected !== 'string') return false;

  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (tokenBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(tokenBuf, expectedBuf);
}