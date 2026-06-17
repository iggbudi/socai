import crypto from 'crypto';

export function cspNonceMiddleware(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
}

export function helmetCspDirectives() {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
    styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
    imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
    connectSrc: ["'self'"],
  };
}