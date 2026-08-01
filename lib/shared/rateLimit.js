/**
 * Map-based rate limiter factory (extracted from server.js pattern).
 * Supports Express middleware and standalone check/consume for Telegram.
 */
export function createRateLimiter({ limit, windowMs, keyFn, onCleanupIntervalMs = 60000 }) {
  const store = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [key, data] of store) {
      if (now - data.firstAttempt > windowMs) {
        store.delete(key);
      }
    }
  }

  const interval = setInterval(cleanup, onCleanupIntervalMs);
  if (typeof interval.unref === 'function') interval.unref();

  function resolveKey(reqOrKey) {
    if (typeof reqOrKey === 'string') return reqOrKey;
    if (keyFn) return keyFn(reqOrKey);
    return reqOrKey.ip || reqOrKey.connection?.remoteAddress || 'unknown';
  }

  function getEntry(key) {
    const now = Date.now();
    const existing = store.get(key);
    if (!existing || now - existing.firstAttempt > windowMs) {
      return null;
    }
    return existing;
  }

  function buildResult(allowed, entry, now = Date.now()) {
    if (!entry) {
      return { allowed: true, remaining: limit, retryAfterMs: 0 };
    }
    if (!allowed) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, windowMs - (now - entry.firstAttempt)),
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - entry.count),
      retryAfterMs: 0,
    };
  }

  function check(key) {
    const resolvedKey = resolveKey(key);
    const now = Date.now();
    const entry = getEntry(resolvedKey);
    if (!entry) return buildResult(true, null, now);
    if (entry.count >= limit) return buildResult(false, entry, now);
    return buildResult(true, entry, now);
  }

  function consume(key) {
    const resolvedKey = resolveKey(key);
    const now = Date.now();
    let entry = store.get(resolvedKey);

    if (!entry || now - entry.firstAttempt > windowMs) {
      entry = { count: 1, firstAttempt: now };
      store.set(resolvedKey, entry);
      return buildResult(true, entry, now);
    }

    if (entry.count >= limit) {
      return buildResult(false, entry, now);
    }

    entry.count++;
    return buildResult(true, entry, now);
  }

  function reset(key) {
    store.delete(resolveKey(key));
  }

  function middleware(req, res, next) {
    const result = consume(req);
    if (!result.allowed) {
      const retryAfter = Math.ceil(result.retryAfterMs / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Terlalu banyak request. Coba lagi dalam ${retryAfter} detik.`,
      });
    }
    next();
  }

  return { middleware, check, consume, reset, cleanup, stop: () => clearInterval(interval) };
}