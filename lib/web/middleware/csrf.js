export function createCsrfProtection(port) {
  return function csrfProtection(req, res, next) {
    // Skip for GET, HEAD, OPTIONS (safe methods)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    const source = req.headers.origin || req.headers.referer;
    if (!source) {
      return res.status(403).json({ error: 'CSRF validation failed: missing Origin/Referer header' });
    }

    const requestBaseUrl = `${req.protocol}://${req.get('host')}`;
    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
    const forwardedBaseUrl = forwardedProto && forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;

    const allowedOrigins = [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      process.env.APP_URL,
      requestBaseUrl,
      forwardedBaseUrl,
    ].filter(Boolean).map((allowed) => {
      try { return new URL(allowed).origin; } catch { return null; }
    }).filter(Boolean);

    let requestOrigin;
    try {
      requestOrigin = new URL(source).origin;
    } catch {
      return res.status(403).json({ error: 'CSRF validation failed: invalid Origin/Referer header' });
    }

    if (!allowedOrigins.includes(requestOrigin)) {
      return res.status(403).json({ error: 'CSRF validation failed' });
    }

    next();
  };
}