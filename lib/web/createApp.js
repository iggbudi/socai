import crypto from 'crypto';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../agent.js';
import { createCsrfProtection } from './middleware/csrf.js';
import { cspNonceMiddleware, helmetCspDirectives } from './middleware/csp.js';
import { createLoginRateLimiter } from './middleware/loginRateLimit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPageRoutes } from './routes/pages.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerUploadRoutes } from './routes/api/upload.js';
import { registerProdukRoutes } from './routes/api/produk.js';
import { registerPemasaranRoutes } from './routes/api/pemasaran.js';
import { registerReplizRoutes } from './routes/api/repliz.js';
import { registerAsistenRoutes } from './routes/api/asisten.js';
import { registerAgentRunsRoutes } from './routes/api/agentRuns.js';
import { loginPage } from './views/login.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebApp() {
  const app = express();
  const port = Number(process.env.PORT || 3010);
  const replizSyncIntervalMs = Number(process.env.REPLIZ_SYNC_INTERVAL_MS || 5 * 60 * 1000);
  const replizAutoScheduleIntervalMs = Number(process.env.REPLIZ_AUTO_SCHEDULE_INTERVAL_MS || 10 * 60 * 1000);

  const intervalHandles = [];
  function trackInterval(fn, ms) {
    const id = setInterval(fn, ms);
    intervalHandles.push(id);
    return id;
  }

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(cspNonceMiddleware);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: helmetCspDirectives(),
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use('/uploads', express.static(path.join(__dirname, '..', '..', 'public', 'uploads')));

  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const PgSessionStore = connectPgSimple(session);
  const sessionStore = new PgSessionStore({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  });

  app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 1000 * 60 * 60 * 4,
    },
  }));

  const csrfProtection = createCsrfProtection(port);
  app.use('/api', csrfProtection);

  const loginRateLimiter = createLoginRateLimiter(trackInterval);

  registerAuthRoutes(app, { loginRateLimiter });
  registerUploadRoutes(app);
  registerProdukRoutes(app);
  registerReplizRoutes(app);
  registerPemasaranRoutes(app);
  registerPageRoutes(app);
  registerAsistenRoutes(app);
  registerAgentRunsRoutes(app);
  registerHealthRoutes(app);

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);

    const isApi = req.path.startsWith('/api/');
    const message = err?.code === 'LIMIT_FILE_SIZE'
      ? 'File terlalu besar. Maksimal 5MB.'
      : 'Terjadi kesalahan server.';

    if (isApi) return res.status(500).json({ error: message });
    return res.status(500).type('html').send(loginPage(message, { nonce: res.locals.cspNonce }));
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return {
    app,
    port,
    trackInterval,
    intervalHandles,
    replizSyncIntervalMs,
    replizAutoScheduleIntervalMs,
  };
}