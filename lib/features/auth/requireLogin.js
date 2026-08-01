export function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.path.startsWith('/api/') || req.xhr || req.accepts('json')) {
    return res.status(401).json({ error: 'Sesi login habis. Silakan login ulang.' });
  }
  res.redirect('/login');
}