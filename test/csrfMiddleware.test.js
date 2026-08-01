/**
 * Sprint 5 (A6) — CSRF origin check:
 * hanya menerima APP_URL + localhost; spoofing Host/X-Forwarded-Host harus ditolak.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCsrfProtection } from '../lib/web/middleware/csrf.js';

const PORT = 3010;
const APP_URL = 'https://socai.my.id';
const originalAppUrl = process.env.APP_URL;

function mockContext({ method = 'POST', origin = null, referer = null, extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (origin) headers.origin = origin;
  if (referer) headers.referer = referer;

  const req = {
    method,
    headers,
    protocol: 'https',
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
  let statusCode = null;
  let body = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
    },
  };
  let calledNext = false;
  const next = () => {
    calledNext = true;
  };
  return { req, res, next, statusCode: () => statusCode, body: () => body, calledNext: () => calledNext };
}

describe('createCsrfProtection (A6)', () => {
  beforeEach(() => {
    process.env.APP_URL = APP_URL;
  });

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  });

  it('accepts POST with Origin = APP_URL', () => {
    const ctx = mockContext({ origin: APP_URL });
    createCsrfProtection(PORT)(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.calledNext(), true);
    assert.equal(ctx.statusCode(), null);
  });

  it('accepts POST with Origin = http://127.0.0.1:PORT', () => {
    const ctx = mockContext({ origin: `http://127.0.0.1:${PORT}` });
    createCsrfProtection(PORT)(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.calledNext(), true);
    assert.equal(ctx.statusCode(), null);
  });

  it('rejects POST with foreign Origin', () => {
    const ctx = mockContext({ origin: 'https://evil.example' });
    createCsrfProtection(PORT)(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.statusCode(), 403);
    assert.match(ctx.body().error, /CSRF/i);
  });

  it('rejects spoofed X-Forwarded-Host even when Origin is foreign (A6)', () => {
    // Sebelum fix: forwardedBaseUrl = APP_URL masuk allowedOrigins → LOLOS (vuln).
    // Sekarang: forwarded header tidak lagi dipercaya → harus 403.
    const ctx = mockContext({
      origin: 'https://evil.example',
      extraHeaders: { 'x-forwarded-host': APP_URL, 'x-forwarded-proto': 'https' },
    });
    createCsrfProtection(PORT)(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.statusCode(), 403);
  });

  it('rejects spoofed Host header (requestBaseUrl) even when Origin is foreign (A6)', () => {
    const ctx = mockContext({
      origin: 'https://evil.example',
      extraHeaders: { host: 'socai.my.id' },
    });
    createCsrfProtection(PORT)(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.statusCode(), 403);
  });

  it('rejects POST without Origin/Referer', () => {
    const ctx = mockContext({});
    createCsrfProtection(PORT)(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.statusCode(), 403);
    assert.match(ctx.body().error, /Origin\/Referer/i);
  });

  it('skips validation for safe methods (GET)', () => {
    const ctx = mockContext({ method: 'GET' });
    createCsrfProtection(PORT)(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.calledNext(), true);
    assert.equal(ctx.statusCode(), null);
  });

  it('accepts Referer as fallback source', () => {
    const ctx = mockContext({ referer: `${APP_URL}/asisten` });
    createCsrfProtection(PORT)(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.calledNext(), true);
    assert.equal(ctx.statusCode(), null);
  });
});
