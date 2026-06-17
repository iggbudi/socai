import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { validateWebEnvironment } from './lib/env.js';
import { sanitizeImageUrl } from './lib/mediaUrl.js';
import { pool, agentSessions, agentSessionLastUsed, agentSessionPromises, touchAgentSession, initAgent, closeAgentPools } from './lib/agent.js';
import { getThreadsAccounts, isReplizConfigured } from './lib/repliz.js';
import {
  bulanIndonesia,
  parseMarketingSchedule,
  savePlansToDb,
  schedulePlanToRepliz,
  syncPlanReplizStatus,
} from './lib/pemasaran.js';
import { createRateLimiter } from './lib/rateLimit.js';
import { normalizeAiMessage, AiMessageError } from './lib/aiLimits.js';
import { assertValidImageBuffer, detectImageType, extForImageType } from './lib/imageFile.js';
import { collectHealthStatus, getHealthHttpStatus } from './lib/health.js';
import { ensureSessionCsrfToken, validateCsrfToken } from './lib/csrfToken.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// HTML escape function to prevent XSS
function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Run config validation on startup before binding the server.
validateWebEnvironment();

async function initPemasaranReplizSchema() {
  await pool.query(`
    ALTER TABLE IF EXISTS pemasaran
      ADD COLUMN IF NOT EXISTS gambar text,
      ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
      ADD COLUMN IF NOT EXISTS published_at timestamptz,
      ADD COLUMN IF NOT EXISTS external_post_id text,
      ADD COLUMN IF NOT EXISTS external_status text,
      ADD COLUMN IF NOT EXISTS last_error text,
      ADD COLUMN IF NOT EXISTS repliz_schedule_id text,
      ADD COLUMN IF NOT EXISTS repliz_status text,
      ADD COLUMN IF NOT EXISTS repliz_scheduled_at timestamptz,
      ADD COLUMN IF NOT EXISTS repliz_last_error text,
      ADD COLUMN IF NOT EXISTS repliz_synced_at timestamptz,
      ADD COLUMN IF NOT EXISTS repliz_attempts integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS auto_schedule_enabled boolean DEFAULT true
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pemasaran_repliz_schedule_id_uq
      ON pemasaran (repliz_schedule_id)
      WHERE repliz_schedule_id IS NOT NULL
  `);
}

const app = express();
const port = Number(process.env.PORT || 3010);
const replizSyncIntervalMs = Number(process.env.REPLIZ_SYNC_INTERVAL_MS || 5 * 60 * 1000);
const replizAutoScheduleIntervalMs = Number(process.env.REPLIZ_AUTO_SCHEDULE_INTERVAL_MS || 10 * 60 * 1000);
const replizAutoScheduleLimit = Number(process.env.REPLIZ_AUTO_SCHEDULE_LIMIT || 3);
const replizAutoScheduleLeadMs = Number(process.env.REPLIZ_AUTO_SCHEDULE_LEAD_MS || 15 * 60 * 1000);

const intervalHandles = [];
function trackInterval(fn, ms) {
  const id = setInterval(fn, ms);
  intervalHandles.push(id);
  return id;
}

let httpServer;
let shuttingDown = false;

app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(helmet({
  // The app currently renders inline scripts/styles from server.js, so enable
  // the other Helmet protections while leaving CSP for a later template refactor.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Body parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files (uploaded images)
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Multer config for image upload
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'public', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'produk-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) &&
               allowed.test(file.mimetype);
    cb(null, ok);
  },
});

// Generate secure session secret if not provided
import crypto from 'crypto';
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PgSessionStore = connectPgSimple(session);
const sessionStore = new PgSessionStore({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: true,
});

// Session middleware
app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true in production with HTTPS
    httpOnly: true,
    sameSite: 'strict', // CSRF protection
    maxAge: 1000 * 60 * 60 * 4, // 4 jam
  },
}));

// CSRF Protection Middleware
function csrfProtection(req, res, next) {
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
}

// Apply CSRF protection to API routes
app.use('/api', csrfProtection);

// Rate Limiting for Login
const loginAttempts = new Map();
const LOGIN_RATE_LIMIT = 5; // max attempts
const LOGIN_RATE_WINDOW = 15 * 60 * 1000; // 15 minutes

function cleanupLoginAttempts() {
  const now = Date.now();
  for (const [ip, data] of loginAttempts) {
    if (now - data.firstAttempt > LOGIN_RATE_WINDOW) {
      loginAttempts.delete(ip);
    }
  }
}
trackInterval(cleanupLoginAttempts, 5 * 60 * 1000);

const loginRateLimiter = {
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
        `Terlalu banyak percobaan login. Coba lagi dalam ${timeLeft} menit.`
      ));
    }

    next();
  },
};

// Apply rate limiter to login POST
app.post('/login', loginRateLimiter.middleware);

// Rate limiting for AI chat
const chatRateLimiter = createRateLimiter({
  limit: Number(process.env.WEB_AI_RATE_LIMIT) || 10,
  windowMs: Number(process.env.WEB_AI_RATE_WINDOW_MS) || 60000,
  keyFn: (req) => req.sessionID || String(req.session?.user?.id || req.ip),
}).middleware;



// ---------- Middleware autentikasi ----------
function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.path.startsWith('/api/') || req.xhr || req.accepts('json')) {
    return res.status(401).json({ error: 'Sesi login habis. Silakan login ulang.' });
  }
  res.redirect('/login');
}

// ---------- Halaman login ----------
app.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  res.type('html').send(loginPage(''));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    const ip = req.ip || req.connection.remoteAddress;
    loginRateLimiter.increment(ip);
    return res.type('html').send(loginPage('Username dan password wajib diisi.'));
  }

  try {
    const result = await pool.query(
      'SELECT id, username, password FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      const ip = req.ip || req.connection.remoteAddress;
      loginRateLimiter.increment(ip);
      return res.type('html').send(loginPage('Username atau password salah.'));
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      const ip = req.ip || req.connection.remoteAddress;
      loginRateLimiter.increment(ip);
      return res.type('html').send(loginPage('Username atau password salah.'));
    }

    // Successful login — reset rate limit counter
    loginRateLimiter.reset(req.ip || req.connection.remoteAddress);

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err.message);
        return res.type('html').send(loginPage('Terjadi kesalahan server. Silakan coba lagi.'));
      }
      req.session.user = { id: user.id, username: user.username };
      ensureSessionCsrfToken(req.session);
      return res.redirect('/dashboard');
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.type('html').send(loginPage('Terjadi kesalahan server. Silakan coba lagi.'));
  }
});

// ---------- Dashboard (terproteksi) ----------
app.get('/dashboard', requireLogin, (req, res) => {
  const csrfToken = ensureSessionCsrfToken(req.session);
  res.type('html').send(dashboardPage(req.session.user.username, csrfToken));
});

// ---------- Upload Gambar ----------
app.post('/api/upload', requireLogin, upload.single('gambar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'File tidak valid. Gunakan JPG, PNG, GIF, atau WebP (max 5MB).' });
  }
  try {
    const head = fs.readFileSync(req.file.path).subarray(0, 16);
    assertValidImageBuffer(head);
    const detected = detectImageType(head);
    const correctExt = extForImageType(detected);
    const currentExt = path.extname(req.file.filename).toLowerCase();
    if (correctExt && currentExt !== correctExt) {
      const newFilename = req.file.filename.replace(/\.[^.]+$/, '') + correctExt;
      const newPath = path.join(path.dirname(req.file.path), newFilename);
      fs.renameSync(req.file.path, newPath);
      req.file.filename = newFilename;
      req.file.path = newPath;
    }
    res.json({ filename: req.file.filename, url: '/uploads/' + req.file.filename });
  } catch {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'File bukan gambar valid' });
  }
});

// ---------- API Produk (CRUD) ----------

// List semua produk
app.get('/api/produk', requireLogin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produk ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/produk error:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data produk' });
  }
});

// Get satu produk
app.get('/api/produk/:id', requireLogin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produk WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil produk' });
  }
});

// Tambah produk
app.post('/api/produk', requireLogin, async (req, res) => {
  const { nama, harga, stok, gambar, deskripsi } = req.body;
  const parsedHarga = Number(harga);
  const parsedStok = Number.parseInt(stok, 10);
  if (!nama || harga === undefined || harga === '' || !Number.isFinite(parsedHarga) || parsedHarga < 0) {
    return res.status(400).json({ error: 'Nama dan harga valid wajib diisi' });
  }
  let sanitizedGambar = '';
  try {
    sanitizedGambar = sanitizeImageUrl(gambar, { allowEmpty: true });
  } catch {
    return res.status(400).json({ error: 'URL gambar tidak valid' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO produk (nama, harga, stok, gambar, deskripsi) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [nama, parsedHarga, Number.isFinite(parsedStok) && parsedStok >= 0 ? parsedStok : 0, sanitizedGambar, deskripsi || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/produk error:', err.message);
    res.status(500).json({ error: 'Gagal menambah produk' });
  }
});

// Update produk
app.put('/api/produk/:id', requireLogin, async (req, res) => {
  const { nama, harga, stok, gambar, deskripsi } = req.body;
  const parsedHarga = Number(harga);
  const parsedStok = Number.parseInt(stok, 10);
  if (!nama || harga === undefined || harga === '' || !Number.isFinite(parsedHarga) || parsedHarga < 0) {
    return res.status(400).json({ error: 'Nama dan harga valid wajib diisi' });
  }
  let sanitizedGambar = '';
  try {
    sanitizedGambar = sanitizeImageUrl(gambar, { allowEmpty: true });
  } catch {
    return res.status(400).json({ error: 'URL gambar tidak valid' });
  }
  try {
    const result = await pool.query(
      'UPDATE produk SET nama=$1, harga=$2, stok=$3, gambar=$4, deskripsi=$5, updated_at=NOW() WHERE id=$6 RETURNING *',
      [nama, parsedHarga, Number.isFinite(parsedStok) && parsedStok >= 0 ? parsedStok : 0, sanitizedGambar, deskripsi || '', req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/produk error:', err.message);
    res.status(500).json({ error: 'Gagal mengupdate produk' });
  }
});

// Hapus produk
app.delete('/api/produk/:id', requireLogin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM produk WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    res.json({ message: 'Produk berhasil dihapus' });
  } catch (err) {
    console.error('DELETE /api/produk error:', err.message);
    res.status(500).json({ error: 'Gagal menghapus produk' });
  }
});

// ---------- API Repliz ----------
app.get('/api/repliz/accounts', requireLogin, async (req, res) => {
  try {
    const data = await getThreadsAccounts({
      page: Number(req.query.page || 1),
      limit: Math.min(Number(req.query.limit || 20), 50),
    });
    const docs = Array.isArray(data?.docs) ? data.docs : Array.isArray(data) ? data : [];
    res.json({
      docs: docs.map((account) => ({
        id: account.id || account._id,
        username: account.username,
        name: account.name,
        type: account.type,
        isConnected: account.isConnected,
      })),
      totalDocs: data?.totalDocs,
      page: data?.page,
      totalPages: data?.totalPages,
    });
  } catch (err) {
    console.error('GET /api/repliz/accounts error:', err.message);
    res.status(500).json({ error: err.message || 'Gagal mengambil akun Repliz' });
  }
});

// ---------- API Pemasaran ----------
async function syncPendingReplizStatuses({ limit = 20 } = {}) {
  if (!isReplizConfigured()) return { skipped: true, reason: 'repliz_not_configured', synced: 0, failed: 0 };
  const result = await pool.query(
    `SELECT id FROM pemasaran
     WHERE repliz_schedule_id IS NOT NULL
       AND lower(coalesce(repliz_status, 'pending')) IN ('pending', 'process', 'scheduled', 'syncing')
     ORDER BY coalesce(repliz_synced_at, created_at) ASC
     LIMIT $1`,
    [limit]
  );
  let synced = 0;
  let failed = 0;
  for (const row of result.rows) {
    try {
      await syncPlanReplizStatus(row.id, pool);
      synced++;
    } catch (err) {
      failed++;
      console.error('[Repliz] Auto sync failed for pemasaran', row.id, err.message);
    }
  }
  return { skipped: false, synced, failed };
}

async function autoSchedulePendingRepliz({ limit = replizAutoScheduleLimit } = {}) {
  if (!isReplizConfigured()) return { skipped: true, reason: 'repliz_not_configured', scheduled: 0, failed: 0 };

  const candidateLimit = Math.max(Number(limit) * 10, 20);
  const candidates = await pool.query(
    `SELECT * FROM pemasaran
     WHERE repliz_schedule_id IS NULL
       AND coalesce(auto_schedule_enabled, true) = true
       AND lower(coalesce(kanal, '')) = 'threads'
       AND nullif(trim(coalesce(nullif(copywriting, ''), nullif(strategi, ''), '')), '') IS NOT NULL
       AND lower(coalesce(repliz_status, '')) NOT IN ('syncing')
       AND lower(coalesce(status, 'draft')) NOT IN ('published', 'posted', 'cancelled', 'canceled')
     ORDER BY coalesce(scheduled_at, created_at) ASC, id ASC
     LIMIT $1`,
    [candidateLimit]
  );

  const now = Date.now();
  const ready = candidates.rows
    .map((plan) => ({ plan, scheduledAt: parseMarketingSchedule(plan) }))
    .filter(({ scheduledAt }) => scheduledAt && scheduledAt.getTime() > now + replizAutoScheduleLeadMs)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .slice(0, Math.max(Number(limit) || 0, 0));

  let scheduled = 0;
  let failed = 0;
  for (const [index, item] of ready.entries()) {
    try {
      await schedulePlanToRepliz(item.plan.id, pool, { force: false });
      scheduled++;
      console.log(`[Repliz] Auto scheduled pemasaran ${item.plan.id} at ${item.scheduledAt.toISOString()}`);
    } catch (err) {
      failed++;
      console.error('[Repliz] Auto schedule failed for pemasaran', item.plan.id, err.message);
    }

    if (index < ready.length - 1) {
      const delayMs = randomBulkDelayMs();
      console.log(`[Repliz] Auto schedule delay ${delayMs}ms before next item`);
      await sleep(delayMs);
    }
  }

  return { skipped: false, scheduled, failed, candidates: candidates.rows.length, ready: ready.length };
}

// Ambil semua rencana pemasaran
app.get('/api/pemasaran', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, judul, target_audiens, kanal, jadwal, created_at,
             gambar, status, scheduled_at, published_at, external_status,
             repliz_schedule_id, repliz_status, repliz_scheduled_at,
             repliz_last_error, repliz_synced_at
      FROM pemasaran
      ORDER BY COALESCE(scheduled_at, created_at) DESC, id DESC
      LIMIT 200
    `);
    const bulanMap = bulanIndonesia;
    const parseJadwal = (jadwal) => {
      const text = String(jadwal || '').toLowerCase();
      const dateMatch = text.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
      if (!dateMatch) return Number.MAX_SAFE_INTEGER;
      const day = Number(dateMatch[1]);
      const month = bulanMap[dateMatch[2]];
      const year = Number(dateMatch[3]);
      if (!Number.isFinite(day) || month === undefined || !Number.isFinite(year)) return Number.MAX_SAFE_INTEGER;
      const timeMatch = text.match(/(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?/i);
      const hour = timeMatch ? Number(timeMatch[1]) : 0;
      const minute = timeMatch && timeMatch[2] ? Number(timeMatch[2]) : 0;
      return new Date(year, month, day, hour, minute).getTime();
    };
    const rows = result.rows.sort((a, b) => {
      const diff = parseJadwal(a.jadwal) - parseJadwal(b.jadwal);
      if (diff !== 0) return diff;
      return a.id - b.id;
    });
    res.json(rows);
  } catch (err) {
    console.error('GET /api/pemasaran error:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data pemasaran' });
  }
});

// Ambil detail satu rencana pemasaran (kolom besar dimuat saat modal dibuka)
app.get('/api/pemasaran/:id', requireLogin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pemasaran WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rencana pemasaran tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/pemasaran/:id error:', err.message);
    res.status(500).json({ error: 'Gagal mengambil detail pemasaran' });
  }
});

// Simpan rencana pemasaran baru
app.post('/api/pemasaran', requireLogin, async (req, res) => {
  try {
    const saved = await savePlansToDb(req.body, pool);
    res.status(201).json(saved.length === 1 ? saved[0] : { count: saved.length, rows: saved });
  } catch (err) {
    if (err.message === 'URL gambar tidak valid') {
      return res.status(400).json({ error: 'URL gambar tidak valid' });
    }
    if (err.message?.startsWith('Data rencana tidak valid')) {
      return res.status(400).json({ error: 'Setiap rencana wajib memiliki judul dan strategi.' });
    }
    console.error('POST /api/pemasaran error:', err.message);
    res.status(500).json({ error: 'Gagal menyimpan rencana pemasaran: ' + err.message });
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBulkDelayMs = () => 3000 + Math.floor(Math.random() * 2001); // 3-5 detik

// Bulk jadwalkan beberapa rencana pemasaran ke Repliz
app.post('/api/pemasaran/repliz/schedule', requireLogin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => /^\d+$/.test(String(id))) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'Pilih minimal satu rencana pemasaran.' });
  if (ids.length > 20) return res.status(400).json({ error: 'Maksimal 20 rencana per bulk schedule.' });

  const results = [];
  for (const [index, id] of ids.entries()) {
    try {
      const result = await schedulePlanToRepliz(id, pool, { force: false });
      results.push({ id, ok: true, repliz_schedule_id: result.plan.repliz_schedule_id });
    } catch (err) {
      results.push({ id, ok: false, error: err.message || 'Gagal menjadwalkan' });
    }

    // Jeda antar request agar bulk schedule tidak menembak API Repliz terlalu rapat.
    if (index < ids.length - 1) {
      const delayMs = randomBulkDelayMs();
      console.log(`[Repliz] Bulk schedule delay ${delayMs}ms before next item`);
      await sleep(delayMs);
    }
  }

  const success = results.filter((item) => item.ok).length;
  res.status(success > 0 ? 207 : 400).json({ success, failed: results.length - success, results });
});

// Jadwalkan rencana pemasaran ke Repliz
app.post('/api/pemasaran/:id/repliz/schedule', requireLogin, async (req, res) => {
  try {
    const result = await schedulePlanToRepliz(req.params.id, pool, { force: false });
    res.json({ message: 'Rencana berhasil dijadwalkan ke Repliz', plan: result.plan, repliz: result.repliz });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error('POST /api/pemasaran/:id/repliz/schedule error:', err.message);
    res.status(status).json({ error: err.message || 'Gagal menjadwalkan ke Repliz' });
  }
});

// Retry jadwal Repliz untuk rencana yang gagal
app.post('/api/pemasaran/:id/repliz/retry', requireLogin, async (req, res) => {
  try {
    const result = await schedulePlanToRepliz(req.params.id, pool, { force: true });
    res.json({ message: 'Retry Repliz berhasil', plan: result.plan, repliz: result.repliz });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error('POST /api/pemasaran/:id/repliz/retry error:', err.message);
    res.status(status).json({ error: err.message || 'Gagal retry Repliz' });
  }
});

// Sync status jadwal Repliz
app.post('/api/pemasaran/:id/repliz/sync', requireLogin, async (req, res) => {
  try {
    const result = await syncPlanReplizStatus(req.params.id, pool);
    res.json({ message: 'Status Repliz berhasil disinkronkan', plan: result.plan, repliz: result.repliz });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error('POST /api/pemasaran/:id/repliz/sync error:', err.message);
    res.status(status).json({ error: err.message || 'Gagal sync status Repliz' });
  }
});

// Hapus rencana pemasaran
app.delete('/api/pemasaran/:id', requireLogin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM pemasaran WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rencana tidak ditemukan' });
    res.json({ message: 'Rencana berhasil dihapus' });
  } catch (err) {
    console.error('DELETE /api/pemasaran error:', err.message);
    res.status(500).json({ error: 'Gagal menghapus rencana' });
  }
});

// ---------- Halaman Produk ----------
app.get('/produk', requireLogin, (req, res) => {
  const csrfToken = ensureSessionCsrfToken(req.session);
  res.type('html').send(produkPage(req.session.user.username, csrfToken));
});

// ---------- Halaman Pemasaran ----------
app.get('/pemasaran', requireLogin, (req, res) => {
  const csrfToken = ensureSessionCsrfToken(req.session);
  res.type('html').send(pemasaranPage(req.session.user.username, csrfToken));
});

// ---------- Halaman Asisten ----------
app.get('/asisten', requireLogin, (req, res) => {
  const csrfToken = ensureSessionCsrfToken(req.session);
  res.type('html').send(asistenPage(req.session.user.username, csrfToken));
});

// ---------- Chat API (SSE streaming) ----------
app.post('/api/asisten', requireLogin, chatRateLimiter, async (req, res) => {
  let message;
  try {
    message = normalizeAiMessage(req.body?.message);
  } catch (e) {
    if (e instanceof AiMessageError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const sessionKey = req.sessionID || String(req.session.user.id);
  let agentSession = agentSessions.get(sessionKey);
  if (agentSession) touchAgentSession(sessionKey);
  console.log('[Chat] Request, agentReady:', Boolean(agentSession), 'session:', sessionKey);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Init agent untuk session user saat ini jika belum ada
  if (!agentSession) {
    console.log('[Chat] Initializing agent for session:', sessionKey);
    res.write(`data: ${JSON.stringify({ type: 'text', text: '⏳ Menyiapkan AI agent...\n' })}\n\n`);
    try {
      agentSession = await initAgent(sessionKey);
      console.log('[Chat] Agent initialized for session:', sessionKey);
      res.write(`data: ${JSON.stringify({ type: 'text', text: '✅ Agent siap!\n\n' })}\n\n`);
    } catch (err) {
      console.error('[Chat] Init error:', err.message);
      res.write(`data: ${JSON.stringify({ type: 'error', text: 'Gagal inisialisasi AI: ' + err.message })}\n\n`);
      return res.end();
    }
  }

  let done = false;
  const finish = () => {
    if (!done) { done = true; res.end(); }
  };

  const unsubscribe = agentSession.subscribe((event) => {
    try {
      if (event.type === 'message_update') {
        if (event.assistantMessageEvent.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ type: 'text', text: event.assistantMessageEvent.delta })}\n\n`);
        }
      } else if (event.type === 'agent_end') {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        unsubscribe();
        finish();
      }
    } catch (e) {
      // response might be closed
    }
  });

  req.on('close', () => {
    unsubscribe();
    if (!done) agentSession.abort().catch(() => {});
    finish();
  });

  try {
    await agentSession.prompt(message);
    // Ensure done if agent_end didn't fire
    setTimeout(() => {
      if (!done) {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        finish();
      }
    }, 500);
  } catch (err) {
    if (!done) {
      res.write(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`);
      finish();
    }
  }
});

// ---------- Logout ----------
function cleanupAgentSession(sessionKey) {
  const agentSession = agentSessions.get(sessionKey);
  if (agentSession) {
    agentSession.abort().catch(() => {});
    agentSessions.delete(sessionKey);
    agentSessionLastUsed.delete(sessionKey);
    agentSessionPromises.delete(sessionKey);
  }
}

app.post('/logout', requireLogin, (req, res) => {
  if (!validateCsrfToken(req.session, req.body._csrf)) {
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

// ---------- Health check ----------
app.get('/health', async (req, res) => {
  const detail = req.query.detail === '1' || req.query.detail === 'true';
  const result = await collectHealthStatus({ pool, detail });
  res.status(getHealthHttpStatus(result)).json(result);
});

// ---------- Root redirect ----------
app.get('/', (req, res) => {
  res.redirect('/login');
});

// ---------- Global error handler ----------
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);

  const isApi = req.path.startsWith('/api/');
  const message = err?.code === 'LIMIT_FILE_SIZE'
    ? 'File terlalu besar. Maksimal 5MB.'
    : 'Terjadi kesalahan server.';

  if (isApi) return res.status(500).json({ error: message });
  return res.status(500).type('html').send(loginPage(message));
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received, shutting down gracefully...`);

  for (const id of intervalHandles) {
    clearInterval(id);
  }

  for (const [sessionKey, session] of agentSessions) {
    if (!sessionKey.startsWith('telegram:')) {
      session.abort().catch(() => {});
      agentSessions.delete(sessionKey);
      agentSessionLastUsed.delete(sessionKey);
      agentSessionPromises.delete(sessionKey);
    }
  }

  const forceExit = setTimeout(() => {
    console.error('[Server] Force exit after timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref?.();

  const finishShutdown = () => {
    closeAgentPools()
      .then(() => {
        console.log('[Server] Shutdown complete');
        process.exit(0);
      })
      .catch((err) => {
        console.error('[Server] closeAgentPools error:', err.message);
        process.exit(1);
      });
  };

  if (!httpServer) {
    finishShutdown();
    return;
  }

  httpServer.close(() => {
    finishShutdown();
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// ---------- Start server ----------
initPemasaranReplizSchema()
  .then(() => {
    httpServer = app.listen(port, '127.0.0.1', () => {
      console.log(`socai.my.id listening on http://127.0.0.1:${port}`);
    });
    if (Number.isFinite(replizAutoScheduleIntervalMs) && replizAutoScheduleIntervalMs > 0) {
      let autoScheduleRunning = false;
      const runAutoSchedule = async () => {
        if (autoScheduleRunning) return;
        autoScheduleRunning = true;
        try {
          const result = await autoSchedulePendingRepliz();
          if (!result.skipped && (result.scheduled > 0 || result.failed > 0)) {
            console.log(`[Repliz] Auto schedule done: scheduled=${result.scheduled}, failed=${result.failed}`);
          }
        } catch (err) {
          console.error('[Repliz] Auto schedule error:', err.message);
        } finally {
          autoScheduleRunning = false;
        }
      };
      setTimeout(runAutoSchedule, 30_000);
      trackInterval(runAutoSchedule, replizAutoScheduleIntervalMs);
      console.log(`[Repliz] Auto schedule enabled every ${Math.round(replizAutoScheduleIntervalMs / 1000)}s, limit=${replizAutoScheduleLimit}, lead=${Math.round(replizAutoScheduleLeadMs / 60000)}m`);
    } else {
      console.log('[Repliz] Auto schedule disabled (REPLIZ_AUTO_SCHEDULE_INTERVAL_MS <= 0)');
    }

    if (Number.isFinite(replizSyncIntervalMs) && replizSyncIntervalMs > 0) {
      trackInterval(() => {
        syncPendingReplizStatuses().catch((err) => console.error('[Repliz] Auto sync error:', err.message));
      }, replizSyncIntervalMs);
      console.log(`[Repliz] Auto sync enabled every ${Math.round(replizSyncIntervalMs / 1000)}s`);
    } else {
      console.log('[Repliz] Auto sync disabled (REPLIZ_SYNC_INTERVAL_MS <= 0)');
    }
  })
  .catch((err) => {
    console.error('Failed to initialize Repliz database schema:', err.message);
    process.exit(1);
  });

// ========== Halaman HTML ==========

function loginPage(error) {
  const errHtml = error
    ? `<div style="background:#fdecea;color:#b71c1c;padding:12px 16px;border-radius:6px;margin-bottom:20px;font-size:14px;">${error}</div>`
    : '';

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login — socai.my.id</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #e8edf5 0%, #dce3ee 100%);
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #172033;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,.08);
      padding: 40px 36px;
      width: 100%;
      max-width: 400px;
    }
    .card h1 {
      font-size: 24px;
      text-align: center;
      margin-bottom: 8px;
    }
    .card .sub {
      text-align: center;
      color: #6b7280;
      font-size: 14px;
      margin-bottom: 28px;
    }
    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 6px;
      color: #374151;
    }
    input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 15px;
      margin-bottom: 18px;
      transition: border-color .2s;
    }
    input:focus {
      outline: none;
      border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79,70,229,.15);
    }
    button {
      width: 100%;
      padding: 12px;
      background: #4f46e5;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background .2s;
    }
    button:hover { background: #4338ca; }
    @media (prefers-color-scheme: dark) {
      body { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f2f5f8; }
      .card { background: #1e293b; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
      input { background: #334155; border-color: #475569; color: #f2f5f8; }
      input:focus { border-color: #818cf8; }
      label { color: #cbd5e1; }
      .card .sub { color: #94a3b8; }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 Login</h1>
    <p class="sub">socai.my.id</p>
    ${errHtml}
    <form method="POST" action="/login">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" placeholder="Username" required autocomplete="username">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" placeholder="Password" required autocomplete="current-password">
      <button type="submit">Masuk</button>
    </form>
  </div>
</body>
</html>`;
}

function sidebarHTML(activePage, username, csrfToken) {
  const menu = [
    { id: 'dashboard', href: '/dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'produk', href: '/produk', icon: '🛍️', label: 'Produk' },
    { id: 'pemasaran', href: '/pemasaran', icon: '📋', label: 'Pemasaran' },
    { id: 'asisten', href: '/asisten', icon: '🤖', label: 'Asisten AI' },
  ];

  const navItems = menu.map(item => {
    const active = item.id === activePage ? ' class="active"' : '';
    return `        <a href="${item.href}"${active}><span class="icon">${item.icon}</span> ${item.label}</a>`;
  }).join('\n');

  return `    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand"><span>🔐</span> socai.my.id</div>
      <nav class="sidebar-nav">
${navItems}
      </nav>
      <div class="sidebar-footer">
        <form method="POST" action="/logout" class="logout-form">
          <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
          <button type="submit" class="logout-btn"><span class="icon">🚪</span> Logout</button>
        </form>
      </div>
      <div class="sidebar-user">
        <div class="avatar">${escapeHtml(username.charAt(0).toUpperCase())}</div>
        <div class="info">
          <div class="name">${escapeHtml(username)}</div>
          <div class="role">Administrator</div>
        </div>
      </div>
    </aside>`;
}

function dashboardPage(username, csrfToken) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard — socai.my.id</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --sidebar-w: 260px;
      --bg: #f1f5f9;
      --sidebar-bg: #1e293b;
      --sidebar-text: #cbd5e1;
      --sidebar-hover: #334155;
      --sidebar-active: #4f46e5;
      --accent: #4f46e5;
      --content-bg: #fff;
    }
    html, body { height: 100%; }
    body {
      display: flex;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #172033;
      background: var(--bg);
    }

    /* ---------- Sidebar ---------- */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      height: 100vh;
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      z-index: 100;
      overflow-y: auto;
    }
    .sidebar-brand {
      padding: 24px 20px 20px;
      font-size: 20px;
      font-weight: 700;
      color: #fff;
      border-bottom: 1px solid rgba(255,255,255,.08);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .sidebar-brand span { font-size: 18px; }

    .sidebar-nav {
      flex: 1;
      padding: 12px 0;
    }
    .sidebar-nav a {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      color: var(--sidebar-text);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: background .15s, color .15s;
      border-left: 3px solid transparent;
    }
    .sidebar-nav a:hover {
      background: var(--sidebar-hover);
      color: #fff;
    }
    .sidebar-nav a.active {
      background: rgba(79,70,229,.15);
      color: #fff;
      border-left-color: var(--sidebar-active);
    }
    .sidebar-nav a .icon { font-size: 18px; width: 24px; text-align: center; }

    .sidebar-footer {
      border-top: 1px solid rgba(255,255,255,.08);
      padding: 12px 0;
    }
    .sidebar-footer a {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      color: #ef4444;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: background .15s, color .15s;
    }
    .sidebar-footer a:hover {
      background: rgba(239,68,68,.1);
      color: #f87171;
    }
    .sidebar-footer a .icon { font-size: 18px; width: 24px; text-align: center; }
    .logout-form { margin: 0; width: 100%; }
    .logout-btn {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      color: #ef4444;
      background: none;
      border: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left;
      font-family: inherit;
    }
    .logout-btn:hover {
      background: rgba(239,68,68,.1);
      color: #f87171;
    }
    .logout-btn .icon { font-size: 18px; width: 24px; text-align: center; }

    .sidebar-user {
      padding: 16px 20px;
      border-top: 1px solid rgba(255,255,255,.08);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .sidebar-user .avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: var(--sidebar-active);
      color: #fff;
      display: grid;
      place-items: center;
      font-weight: 700;
      font-size: 14px;
      flex-shrink: 0;
    }
    .sidebar-user .info .name {
      color: #fff;
      font-weight: 600;
    }
    .sidebar-user .info .role {
      color: #94a3b8;
      font-size: 12px;
    }

    /* ---------- Main Content ---------- */
    .main {
      flex: 1;
      margin-left: var(--sidebar-w);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      background: var(--content-bg);
      padding: 16px 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .topbar .breadcrumb { color: #6b7280; font-size: 13px; }

    .content {
      flex: 1;
      padding: 28px;
    }

    /* Card di konten */
    .card {
      background: var(--content-bg);
      border-radius: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,.06);
      padding: 28px;
    }
    .card h3 { font-size: 18px; margin-bottom: 8px; }
    .card p { color: #6b7280; font-size: 14px; line-height: 1.7; }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--content-bg);
      border-radius: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,.06);
      padding: 20px 24px;
    }
    .stat-card .label { font-size: 13px; color: #6b7280; margin-bottom: 4px; }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #172033; }

    /* Mobile hamburger */
    .hamburger {
      display: none;
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #172033;
      padding: 4px;
    }

    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        transition: transform .25s;
      }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .hamburger { display: block; }
    }

    /* Dark mode */
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --content-bg: #1e293b;
      }
      body { color: #f2f5f8; }
      .card, .stat-card { box-shadow: 0 1px 4px rgba(0,0,0,.3); }
      .card p { color: #94a3b8; }
      .stat-card .value { color: #f2f5f8; }
      .topbar { box-shadow: 0 1px 3px rgba(0,0,0,.3); }
    }
  </style>
</head>
<body>

  <!-- Sidebar -->
  ${sidebarHTML('dashboard', username, csrfToken)}

  <!-- Main -->
  <main class="main">
    <header class="topbar">
      <div>
        <h2>Dashboard</h2>
        <span class="breadcrumb">Home / Dashboard</span>
      </div>
      <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
    </header>

    <div class="content">
      <div class="stats">
        <div class="stat-card">
          <div class="label">Total Pengguna</div>
          <div class="value">1</div>
        </div>
        <div class="stat-card">
          <div class="label">Halaman Aktif</div>
          <div class="value">3</div>
        </div>
        <div class="stat-card">
          <div class="label">Server Status</div>
          <div class="value" style="color:#22c55e;">Online</div>
        </div>
      </div>

      <div class="card">
        <h3>✅ Selamat datang, ${escapeHtml(username)}!</h3>
        <p>
          Kamu berhasil login ke dashboard <strong>socai.my.id</strong>.
          Gunakan menu di sidebar untuk navigasi antar halaman.
        </p>
      </div>
    </div>
  </main>

</body>
</html>`;
}

function produkPage(username, csrfToken) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Produk — Batik Bakaran</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --sidebar-w: 260px;
      --bg: #f1f5f9;
      --sidebar-bg: #1e293b;
      --sidebar-text: #cbd5e1;
      --sidebar-hover: #334155;
      --sidebar-active: #4f46e5;
      --content-bg: #fff;
    }
    html, body { height: 100%; }
    body {
      display: flex;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #172033;
      background: var(--bg);
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      height: 100vh;
      position: fixed;
      left: 0; top: 0; bottom: 0;
      z-index: 100;
      overflow-y: auto;
    }
    .sidebar-brand {
      padding: 24px 20px 20px;
      font-size: 20px; font-weight: 700;
      color: #fff;
      border-bottom: 1px solid rgba(255,255,255,.08);
      display: flex; align-items: center; gap: 10px;
    }
    .sidebar-brand span { font-size: 18px; }
    .sidebar-nav { flex: 1; padding: 12px 0; }
    .sidebar-nav a {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: var(--sidebar-text);
      text-decoration: none;
      font-size: 14px; font-weight: 500;
      transition: background .15s, color .15s;
      border-left: 3px solid transparent;
    }
    .sidebar-nav a:hover { background: var(--sidebar-hover); color: #fff; }
    .sidebar-nav a.active { background: rgba(79,70,229,.15); color: #fff; border-left-color: var(--sidebar-active); }
    .sidebar-nav a .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-footer { border-top: 1px solid rgba(255,255,255,.08); padding: 12px 0; }
    .sidebar-footer a {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: #ef4444; text-decoration: none;
      font-size: 14px; font-weight: 500;
      transition: background .15s, color .15s;
    }
    .sidebar-footer a:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .sidebar-footer a .icon { font-size: 18px; width: 24px; text-align: center; }
    .logout-form { margin: 0; width: 100%; }
    .logout-btn {
      width: 100%;
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: #ef4444;
      background: none; border: none;
      font-size: 14px; font-weight: 500;
      cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left; font-family: inherit;
    }
    .logout-btn:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .logout-btn .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-user {
      padding: 16px 20px;
      border-top: 1px solid rgba(255,255,255,.08);
      display: flex; align-items: center; gap: 10px;
      font-size: 13px;
    }
    .sidebar-user .avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: var(--sidebar-active); color: #fff;
      display: grid; place-items: center;
      font-weight: 700; font-size: 14px; flex-shrink: 0;
    }
    .sidebar-user .info .name { color: #fff; font-weight: 600; }
    .sidebar-user .info .role { color: #94a3b8; font-size: 12px; }

    /* Main */
    .main {
      flex: 1; margin-left: var(--sidebar-w);
      min-height: 100vh;
      display: flex; flex-direction: column;
    }
    .topbar {
      background: var(--content-bg);
      padding: 16px 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 50;
    }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .topbar .breadcrumb { color: #6b7280; font-size: 13px; }
    .content { flex: 1; padding: 28px; }

    /* Toolbar */
    .toolbar {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 20px; flex-wrap: wrap; gap: 12px;
    }
    .toolbar h3 { font-size: 18px; }
    .btn {
      padding: 9px 20px; border: none; border-radius: 8px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
      transition: background .15s;
    }
    .btn-primary { background: #4f46e5; color: #fff; }
    .btn-primary:hover { background: #4338ca; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-danger:hover { background: #dc2626; }
    .btn-sm { padding: 5px 12px; font-size: 12px; }
    .btn-ghost { background: #f1f5f9; color: #475569; }
    .btn-ghost:hover { background: #e2e8f0; }

    /* Table */
    .table-wrap {
      background: var(--content-bg);
      border-radius: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,.06);
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th {
      text-align: left; padding: 12px 16px;
      background: #f8fafc; color: #64748b;
      font-weight: 600; font-size: 12px; text-transform: uppercase;
      border-bottom: 1px solid #e2e8f0;
    }
    td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
    tr:hover td { background: #f8fafc; }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 20px;
      font-size: 12px; font-weight: 600;
    }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-danger { background: #fdecea; color: #991b1b; }

    /* Modal */
    .modal-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,.45); z-index: 200;
      justify-content: center; align-items: center;
    }
    .modal-overlay.show { display: flex; }
    .modal {
      background: var(--content-bg);
      border-radius: 12px; padding: 28px;
      width: 100%; max-width: 500px;
      box-shadow: 0 8px 32px rgba(0,0,0,.15);
      max-height: 90vh; overflow-y: auto;
    }
    .modal h3 { margin-bottom: 20px; font-size: 18px; }
    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; color: #374151; }
    .field input, .field textarea, .field select {
      width: 100%; padding: 9px 12px;
      border: 1px solid #d1d5db; border-radius: 7px;
      font-size: 14px; font-family: inherit;
    }
    .field input:focus, .field textarea:focus {
      outline: none; border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79,70,229,.12);
    }
    .field textarea { resize: vertical; min-height: 80px; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }

    /* Upload */
    .upload-zone {
      border: 2px dashed #d1d5db; border-radius: 8px;
      padding: 20px; text-align: center; cursor: pointer;
      transition: border-color .2s;
    }
    .upload-zone:hover { border-color: #4f46e5; }
    .upload-zone p { margin: 6px 0 2px; font-size: 13px; color: #6b7280; }

    /* Toast */
    .toast {
      position: fixed; bottom: 28px; right: 28px; z-index: 300;
      padding: 14px 22px; border-radius: 8px;
      color: #fff; font-size: 14px; font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,.2);
      transform: translateY(100px); opacity: 0;
      transition: all .3s;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    .toast-success { background: #16a34a; }
    .toast-error { background: #dc2626; }

    /* Hamburger */
    .hamburger { display: none; background: none; border: none; font-size: 24px; cursor: pointer; color: #172033; padding: 4px; }

    /* Empty state */
    .empty { text-align: center; padding: 40px; color: #94a3b8; }

    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); transition: transform .25s; }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .hamburger { display: block; }
      .toolbar { flex-direction: column; align-items: flex-start; }
    }

    @media (prefers-color-scheme: dark) {
      :root { --bg: #0f172a; --content-bg: #1e293b; }
      body { color: #f2f5f8; }
      th { background: #1a2332; color: #94a3b8; border-bottom-color: #334155; }
      td { border-bottom-color: #1e293b; }
      tr:hover td { background: #1a2332; }
      .field input, .field textarea { background: #334155; border-color: #475569; color: #f2f5f8; }
      .field label { color: #cbd5e1; }
      .btn-ghost { background: #334155; color: #cbd5e1; }
      .btn-ghost:hover { background: #475569; }
      .topbar { box-shadow: 0 1px 3px rgba(0,0,0,.3); }
      .upload-zone { border-color: #475569; }
    }
  </style>
</head>
<body>

<!-- Sidebar -->
${sidebarHTML('produk', username, csrfToken)}

<!-- Main -->
<main class="main">
  <header class="topbar">
    <div>
      <h2>Produk</h2>
      <span class="breadcrumb">Home / Produk</span>
    </div>
    <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
  </header>

  <div class="content">
    <div class="toolbar">
      <h3>🛍️ Daftar Produk Batik Bakaran</h3>
      <button class="btn btn-primary" onclick="openModal()">+ Tambah Produk</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Nama</th>
            <th>Harga</th>
            <th>Stok</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody id="produk-tbody">
          <tr><td colspan="5" class="empty">Memuat data...</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</main>

<!-- Modal Form -->
<div class="modal-overlay" id="modal">
  <div class="modal">
    <h3 id="modal-title">Tambah Produk</h3>
    <form id="produk-form" onsubmit="saveProduk(event)">
      <input type="hidden" id="produk-id">
      <div class="field">
        <label for="nama">Nama Produk *</label>
        <input id="nama" required placeholder="Contoh: Batik Tulis Parang">
      </div>
      <div class="field">
        <label for="harga">Harga (Rp) *</label>
        <input id="harga" type="number" min="0" step="1" required placeholder="50000">
      </div>
      <div class="field">
        <label for="stok">Stok</label>
        <input id="stok" type="number" min="0" value="0">
      </div>
      <div class="field">
        <label for="gambar">Gambar Produk</label>
        <div class="upload-area" id="upload-area">
          <input type="file" id="gambar-file" accept="image/*" onchange="uploadGambar(this)" style="display:none">
          <input type="hidden" id="gambar" value="">
          <div class="upload-zone" onclick="document.getElementById('gambar-file').click()">
            <div id="preview-wrap" style="display:none">
              <img id="preview-img" src="" alt="Preview" style="max-width:100%;max-height:180px;border-radius:6px">
            </div>
            <div id="upload-placeholder">
              <span style="font-size:32px">📷</span>
              <p>Klik untuk unggah gambar</p>
              <span style="font-size:11px;color:#94a3b8">JPG, PNG, GIF, WebP — max 5MB</span>
            </div>
          </div>
        </div>
      </div>
      <div class="field">
        <label for="deskripsi">Deskripsi</label>
        <textarea id="deskripsi" placeholder="Deskripsi produk..."></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button>
        <button type="submit" class="btn btn-primary">Simpan</button>
      </div>
    </form>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
const API = '/api/produk';
let produkData = [];

// Fetch & render
async function loadProduk() {
  try {
    const res = await fetch(API);
    const data = await res.json();
    produkData = Array.isArray(data) ? data : [];
    const tbody = document.getElementById('produk-tbody');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">Belum ada produk. Klik "Tambah Produk" untuk menambah.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map((p, i) => {
      const harga = Number(p.harga).toLocaleString('id-ID');
      const stokBadge = Number(p.stok) > 0
        ? '<span class="badge badge-success">' + p.stok + '</span>'
        : '<span class="badge badge-danger">Habis</span>';
      return \`<tr>
        <td>\${i + 1}</td>
        <td>\${esc(p.nama)}</td>
        <td>Rp \${harga}</td>
        <td>\${stokBadge}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="editProduk(\${p.id})">✏️ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="hapusProduk(\${p.id})">🗑 Hapus</button>
        </td>
      </tr>\`;
    }).join('');
  } catch(e) {
    document.getElementById('produk-tbody').innerHTML = '<tr><td colspan="5" class="empty">Gagal memuat data</td></tr>';
  }
}

function openModal(id) {
  document.getElementById('modal').classList.add('show');
  if (!id) {
    document.getElementById('modal-title').textContent = 'Tambah Produk';
    document.getElementById('produk-form').reset();
    document.getElementById('produk-id').value = '';
    document.getElementById('gambar').value = '';
    document.getElementById('gambar-file').value = '';
    showPreview('');
  }
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

function showPreview(src) {
  const wrap = document.getElementById('preview-wrap');
  const ph = document.getElementById('upload-placeholder');
  const img = document.getElementById('preview-img');
  if (src) {
    img.src = src;
    wrap.style.display = 'block';
    ph.style.display = 'none';
  } else {
    wrap.style.display = 'none';
    ph.style.display = 'block';
  }
}

async function uploadGambar(input) {
  const file = input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('gambar', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('gambar').value = data.url;
      showPreview(data.url);
      toast('Gambar berhasil diunggah', 'success');
    } else {
      toast(data.error || 'Gagal mengunggah gambar', 'error');
      input.value = '';
    }
  } catch(e) {
    toast('Gagal mengunggah gambar', 'error');
    input.value = '';
  }
}

async function editProduk(id) {
  const res = await fetch(API + '/' + id);
  const p = await res.json();
  document.getElementById('produk-id').value = p.id;
  document.getElementById('nama').value = p.nama;
  document.getElementById('harga').value = p.harga;
  document.getElementById('stok').value = p.stok;
  document.getElementById('gambar').value = p.gambar || '';
  document.getElementById('gambar-file').value = '';
  document.getElementById('deskripsi').value = p.deskripsi || '';
  document.getElementById('modal-title').textContent = 'Edit Produk';
  showPreview(p.gambar || '');
  document.getElementById('modal').classList.add('show');
}

async function saveProduk(e) {
  e.preventDefault();
  const id = document.getElementById('produk-id').value;
  const body = {
    nama: document.getElementById('nama').value,
    harga: parseInt(document.getElementById('harga').value, 10) || 0,
    stok: parseInt(document.getElementById('stok').value) || 0,
    gambar: document.getElementById('gambar').value,
    deskripsi: document.getElementById('deskripsi').value,
  };
  const url = id ? API + '/' + id : API;
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    toast(id ? 'Produk diperbarui' : 'Produk ditambahkan', 'success');
    closeModal();
    loadProduk();
  } else {
    const err = await res.json();
    toast(err.error || 'Gagal menyimpan', 'error');
  }
}

async function hapusProduk(id) {
  const produk = produkData.find(p => Number(p.id) === Number(id));
  const nama = produk && produk.nama ? produk.nama : 'ini';
  if (!confirm('Hapus produk "' + nama + '"?')) return;
  const res = await fetch(API + '/' + id, { method: 'DELETE' });
  if (res.ok) {
    toast('Produk dihapus', 'success');
    loadProduk();
  } else {
    toast('Gagal menghapus', 'error');
  }
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast-' + type + ' show';
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.remove('show'), 2500);
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Klik luar modal untuk close
document.getElementById('modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// Init
loadProduk();
</script>

</body>
</html>`;
}

function pemasaranPage(username, csrfToken) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rencana Pemasaran — socai.my.id</title>
  <style>
    :root {
      --bg: #f8fafc;
      --content-bg: #ffffff;
      --text: #172033;
      --muted: #6b7280;
      --border: #e2e8f0;
      --accent: #4f46e5;
      --danger: #ef4444;
      --success: #10b981;
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0f172a; --content-bg: #1e293b; --text: #f2f5f8; --muted: #94a3b8; --border: #334155; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; }

    /* Sidebar */
    :root { --sidebar-w: 260px; --sidebar-bg: #1e293b; --sidebar-text: #cbd5e1; --sidebar-hover: #334155; --sidebar-active: #4f46e5; }
    .sidebar { width: var(--sidebar-w); background: var(--sidebar-bg); color: var(--sidebar-text); display: flex; flex-direction: column; position: fixed; top: 0; left: 0; height: 100vh; z-index: 100; }
    .sidebar-brand { padding: 20px; font-size: 16px; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; gap: 10px; }
    .sidebar-brand span { font-size: 18px; }
    .sidebar-nav { flex: 1; padding: 12px 0; }
    .sidebar-nav a { display: flex; align-items: center; gap: 12px; padding: 12px 20px; color: var(--sidebar-text); text-decoration: none; font-size: 14px; border-left: 3px solid transparent; transition: all .15s; }
    .sidebar-nav a:hover { background: var(--sidebar-hover); color: #fff; }
    .sidebar-nav a.active { background: rgba(79,70,229,.15); color: #fff; border-left-color: var(--sidebar-active); }
    .sidebar-nav a .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-footer { border-top: 1px solid rgba(255,255,255,.08); padding: 12px 0; }
    .sidebar-footer a { display: flex; align-items: center; gap: 12px; padding: 12px 20px; color: var(--sidebar-text); text-decoration: none; font-size: 14px; transition: all .15s; }
    .sidebar-footer a:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .sidebar-footer a .icon { font-size: 18px; width: 24px; text-align: center; }
    .logout-form { margin: 0; width: 100%; }
    .logout-btn {
      width: 100%;
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: var(--sidebar-text);
      background: none; border: none;
      font-size: 14px; font-weight: 500;
      cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left; font-family: inherit;
    }
    .logout-btn:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .logout-btn .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-user { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; gap: 12px; }
    .sidebar-user .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--sidebar-active); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; }
    .sidebar-user .info .name { color: #fff; font-weight: 600; font-size: 13px; }
    .sidebar-user .info .role { color: #94a3b8; font-size: 12px; }

    .main { flex: 1; margin-left: var(--sidebar-w); display: flex; flex-direction: column; min-height: 100vh; }
    .topbar { background: var(--content-bg); padding: 16px 28px; box-shadow: 0 1px 3px rgba(0,0,0,.06); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50; }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .topbar .breadcrumb { color: var(--muted); font-size: 13px; }
    .hamburger { display: none; background: none; border: none; font-size: 24px; cursor: pointer; color: var(--text); padding: 4px; }

    .content { padding: 24px 28px; flex: 1; }

    /* Table */
    .table-wrap { background: var(--content-bg); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8fafc; padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid var(--border); }
    td { padding: 14px 16px; border-bottom: 1px solid var(--border); font-size: 14px; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; }

    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
    .badge-aktif { background: #d1fae5; color: #065f46; }
    .badge-selesai { background: #dbeafe; color: #1e40af; }
    .badge-arsip { background: #f3f4f6; color: #374151; }

    .btn { padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; border: none; cursor: pointer; transition: all .15s; }
    .btn-danger { background: #fee2e2; color: #dc2626; }
    .btn-danger:hover { background: #fecaca; }
    .btn-detail { background: #e0e7ff; color: #4338ca; }
    .btn-detail:hover { background: #c7d2fe; }

    .empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
    .empty-state h3 { font-size: 18px; margin-bottom: 8px; color: var(--text); }

    /* Modal */
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 200; align-items: center; justify-content: center; }
    .modal-overlay.show { display: flex; }
    .modal { background: var(--content-bg); border-radius: 12px; padding: 24px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal h3 { font-size: 16px; margin-bottom: 16px; }
    .modal-field { margin-bottom: 12px; }
    .modal-field label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; }
    .modal-field p { font-size: 14px; line-height: 1.6; }
    .modal-close { margin-top: 16px; text-align: right; }
    .modal-close button { padding: 8px 20px; border-radius: 8px; border: 1px solid var(--border); background: var(--content-bg); cursor: pointer; font-size: 14px; }

    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); transition: transform .25s; }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .hamburger { display: block; }
      table { font-size: 13px; }
      td, th { padding: 10px 12px; }
    }
  </style>
</head>
<body>

${sidebarHTML('pemasaran', username, csrfToken)}

<main class="main">
  <header class="topbar">
    <div>
      <h2>📋 Rencana Pemasaran</h2>
      <span class="breadcrumb">Home / Pemasaran</span>
    </div>
    <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
  </header>

  <div class="content">
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-detail" onclick="checkReplizAccounts()">Cek Akun Repliz</button>
      <button class="btn btn-detail" onclick="bulkScheduleRepliz()">Bulk Jadwalkan Repliz</button>
      <span id="repliz-account-info" style="font-size:13px;color:var(--muted);"></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" id="select-all-plans" onchange="toggleAllPlans(this.checked)"></th>
            <th>Judul</th>
            <th>Kanal</th>
            <th>Jadwal Posting</th>
            <th>Target</th>
            <th>Status</th>
            <th>Repliz</th>
            <th>Dibuat</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody id="pemasaran-list">
          <tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted);">Memuat data...</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</main>

<!-- Detail Modal -->
<div class="modal-overlay" id="detail-modal">
  <div class="modal">
    <h3 id="modal-judul">Detail Rencana</h3>
    <div class="modal-field"><label>Strategi</label><p id="modal-strategi"></p></div>
    <div class="modal-field"><label>Target Audiens</label><p id="modal-target"></p></div>
    <div class="modal-field"><label>Kanal</label><p id="modal-kanal"></p></div>
    <div class="modal-field"><label>Jadwal</label><p id="modal-jadwal"></p></div>
    <div class="modal-field"><label>Copywriting</label><p id="modal-copy"></p></div>
    <div class="modal-field"><label>Produk Terkait</label><p id="modal-produk"></p></div>
    <div class="modal-field"><label>Repliz</label><p id="modal-repliz"></p></div>
    <div class="modal-field"><label>Gambar</label><p id="modal-gambar"></p></div>
    <div class="modal-close"><button onclick="closeModal()">Tutup</button></div>
  </div>
</div>

<script>
let plans = [];

async function checkReplizAccounts() {
  const el = document.getElementById('repliz-account-info');
  el.textContent = 'Mengecek akun Repliz...';
  try {
    const res = await fetch('/api/repliz/accounts');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal mengambil akun Repliz');
    const connected = (data.docs || []).filter(a => a.isConnected !== false);
    if (connected.length === 0) {
      el.textContent = 'Tidak ada akun Threads Repliz connected.';
      return;
    }
    el.textContent = 'Akun Threads: ' + connected.map(a => (a.name || a.username || a.id) + ' (' + a.id + ')').join(', ');
  } catch (e) {
    el.textContent = e.message;
  }
}

async function loadPlans() {
  try {
    const res = await fetch('/api/pemasaran', { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) throw new Error(data?.error || 'Gagal mengambil data pemasaran');
    if (!Array.isArray(data)) throw new Error('Format data pemasaran tidak valid');
    plans = data;
    renderPlans();
  } catch (e) {
    document.getElementById('pemasaran-list').innerHTML =
      '<tr><td colspan="9" style="text-align:center;padding:40px;color:#ef4444;">Gagal memuat data: ' + esc(e.message || 'Terjadi kesalahan') + '</td></tr>';
  }
}

function renderPlans() {
  const tbody = document.getElementById('pemasaran-list');
  if (plans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted);">Belum ada rencana pemasaran.<br>Buat rencana melalui Asisten AI.</td></tr>';
    return;
  }
  tbody.innerHTML = plans.map(p => {
    const date = new Date(p.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const daysSince = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000);
    const badgeClass = daysSince <= 7 ? 'badge-aktif' : daysSince <= 30 ? 'badge-selesai' : 'badge-arsip';
    const badgeLabel = daysSince <= 7 ? 'Aktif' : daysSince <= 30 ? 'Selesai' : 'Arsip';
    return '<tr>' +
      '<td><input type="checkbox" class="plan-select" value="' + p.id + '" ' + (p.repliz_schedule_id ? 'disabled' : '') + '></td>' +
      '<td><strong>' + esc(p.judul) + '</strong></td>' +
      '<td>' + esc(p.kanal || '-') + '</td>' +
      '<td><strong>' + esc(p.jadwal || '-') + '</strong></td>' +
      '<td>' + esc(p.target_audiens || '-') + '</td>' +
      '<td><span class="badge ' + badgeClass + '">' + badgeLabel + '</span></td>' +
      '<td>' + replizBadge(p) + '</td>' +
      '<td>' + date + '</td>' +
      '<td>' +
        '<button class="btn btn-detail" onclick="showDetail(' + p.id + ')">Detail</button> ' +
        replizActionButton(p) + ' ' +
        '<button class="btn btn-danger" onclick="deletePlan(' + p.id + ')">Hapus</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function toggleAllPlans(checked) {
  document.querySelectorAll('.plan-select:not(:disabled)').forEach(cb => { cb.checked = checked; });
}

function getSelectedPlanIds() {
  return Array.from(document.querySelectorAll('.plan-select:checked')).map(cb => cb.value);
}

async function bulkScheduleRepliz() {
  const ids = getSelectedPlanIds();
  if (ids.length === 0) return alert('Pilih minimal satu rencana yang belum dijadwalkan.');
  if (!confirm('Jadwalkan ' + ids.length + ' rencana ke Repliz?')) return;
  try {
    const res = await fetch('/api/pemasaran/repliz/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.results) throw new Error(data.error || 'Bulk schedule gagal');
    await loadPlans();
    alert('Bulk selesai. Sukses: ' + (data.success || 0) + ', gagal: ' + (data.failed || 0));
  } catch (e) {
    alert(e.message);
  }
}

function fmtDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function replizBadge(p) {
  const status = p.repliz_status || (p.repliz_schedule_id ? 'pending' : 'not_scheduled');
  if (p.repliz_schedule_id) {
    const cls = status === 'success' ? 'badge-aktif' : status === 'error' ? 'badge-arsip' : 'badge-selesai';
    const title = 'Schedule ID: ' + p.repliz_schedule_id + '\\nScheduled: ' + fmtDateTime(p.repliz_scheduled_at) + '\\nLast sync: ' + fmtDateTime(p.repliz_synced_at);
    return '<span class="badge ' + cls + '" title="' + esc(title) + '">Repliz: ' + esc(status) + '</span>' +
      '<div style="font-size:11px;color:var(--muted);margin-top:4px;">' + esc(fmtDateTime(p.repliz_scheduled_at)) + '</div>';
  }
  if (status === 'error') return '<span class="badge badge-arsip" title="' + esc(p.repliz_last_error || '') + '">Repliz: error</span>';
  if (status === 'syncing') return '<span class="badge badge-selesai">Repliz: syncing</span>';
  return '<span class="badge badge-arsip">Belum</span>';
}

function replizActionButton(p) {
  if (p.repliz_schedule_id) return '<button class="btn btn-detail" onclick="syncRepliz(' + p.id + ')">Sync Status</button>';
  if (p.repliz_status === 'error') return '<button class="btn btn-detail" onclick="retryRepliz(' + p.id + ')">Retry Repliz</button>';
  return '<button class="btn btn-detail" onclick="scheduleRepliz(' + p.id + ')">Jadwalkan Repliz</button>';
}

async function showDetail(id) {
  let p = plans.find(x => x.id === id);
  if (!p) return;
  if (p.copywriting === undefined || p.strategi === undefined) {
    try {
      const res = await fetch('/api/pemasaran/' + id);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal memuat detail');
      p = data;
      plans = plans.map(x => x.id === id ? { ...x, ...data } : x);
    } catch (e) {
      alert(e.message);
      return;
    }
  }
  document.getElementById('modal-judul').textContent = p.judul;
  document.getElementById('modal-strategi').textContent = p.strategi || '-';
  document.getElementById('modal-target').textContent = p.target_audiens || '-';
  document.getElementById('modal-kanal').textContent = p.kanal || '-';
  document.getElementById('modal-jadwal').textContent = p.jadwal || '-';
  document.getElementById('modal-copy').textContent = p.copywriting || '-';
  document.getElementById('modal-produk').textContent = p.produk_terkait || '-';
  document.getElementById('modal-repliz').textContent = p.repliz_schedule_id
    ? 'Schedule ID: ' + p.repliz_schedule_id + ' | Status: ' + (p.repliz_status || 'pending') + ' | Scheduled: ' + fmtDateTime(p.repliz_scheduled_at) + ' | Last sync: ' + fmtDateTime(p.repliz_synced_at)
    : (p.repliz_status === 'error' ? 'Error: ' + (p.repliz_last_error || '-') : 'Belum dijadwalkan');
  const gambarEl = document.getElementById('modal-gambar');
  if (p.gambar) {
    gambarEl.innerHTML = '<a href="' + esc(p.gambar) + '" target="_blank" rel="noopener">Lihat gambar</a><br><img src="' + esc(p.gambar) + '" alt="Gambar konten" style="max-width:100%;margin-top:8px;border-radius:8px">';
  } else {
    gambarEl.textContent = '-';
  }
  document.getElementById('detail-modal').classList.add('show');
}

function closeModal() {
  document.getElementById('detail-modal').classList.remove('show');
}

async function scheduleRepliz(id) {
  if (!confirm('Jadwalkan rencana ini ke Repliz Threads?')) return;
  try {
    const res = await fetch('/api/pemasaran/' + id + '/repliz/schedule', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal menjadwalkan ke Repliz');
    await loadPlans();
    alert('Berhasil dijadwalkan ke Repliz');
  } catch (e) {
    alert(e.message);
  }
}

async function retryRepliz(id) {
  if (!confirm('Coba ulang jadwal Repliz untuk rencana ini?')) return;
  try {
    const res = await fetch('/api/pemasaran/' + id + '/repliz/retry', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal retry Repliz');
    await loadPlans();
    alert('Retry Repliz berhasil');
  } catch (e) {
    alert(e.message);
  }
}

async function syncRepliz(id) {
  try {
    const res = await fetch('/api/pemasaran/' + id + '/repliz/sync', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal sync status Repliz');
    await loadPlans();
    alert('Status Repliz berhasil disinkronkan');
  } catch (e) {
    alert(e.message);
  }
}

async function deletePlan(id) {
  if (!confirm('Yakin ingin menghapus rencana ini?')) return;
  try {
    const res = await fetch('/api/pemasaran/' + id, { method: 'DELETE' });
    if (res.ok) {
      plans = plans.filter(p => p.id !== id);
      renderPlans();
    } else {
      alert('Gagal menghapus rencana');
    }
  } catch (e) {
    alert('Gagal menghapus rencana');
  }
}

document.getElementById('detail-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

loadPlans();
</script>

</body>
</html>`;
}

function asistenPage(username, csrfToken) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Asisten Automation — Batik Bakaran</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --sidebar-w: 260px;
      --bg: #f1f5f9;
      --sidebar-bg: #1e293b;
      --sidebar-text: #cbd5e1;
      --sidebar-hover: #334155;
      --sidebar-active: #4f46e5;
      --content-bg: #fff;
    }
    html, body { height: 100%; }
    body {
      display: flex;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #172033;
      background: var(--bg);
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      display: flex; flex-direction: column; flex-shrink: 0;
      height: 100vh;
      position: fixed; left: 0; top: 0; bottom: 0;
      z-index: 100; overflow-y: auto;
    }
    .sidebar-brand {
      padding: 24px 20px 20px;
      font-size: 20px; font-weight: 700; color: #fff;
      border-bottom: 1px solid rgba(255,255,255,.08);
      display: flex; align-items: center; gap: 10px;
    }
    .sidebar-brand span { font-size: 18px; }
    .sidebar-nav { flex: 1; padding: 12px 0; }
    .sidebar-nav a {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px; color: var(--sidebar-text);
      text-decoration: none; font-size: 14px; font-weight: 500;
      transition: background .15s, color .15s;
      border-left: 3px solid transparent;
    }
    .sidebar-nav a:hover { background: var(--sidebar-hover); color: #fff; }
    .sidebar-nav a.active { background: rgba(79,70,229,.15); color: #fff; border-left-color: var(--sidebar-active); }
    .sidebar-nav a .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-footer { border-top: 1px solid rgba(255,255,255,.08); padding: 12px 0; }
    .sidebar-footer a {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px; color: #ef4444;
      text-decoration: none; font-size: 14px; font-weight: 500;
      transition: background .15s, color .15s;
    }
    .sidebar-footer a:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .logout-form { margin: 0; width: 100%; }
    .logout-btn {
      width: 100%;
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: #ef4444;
      background: none; border: none;
      font-size: 14px; font-weight: 500;
      cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left; font-family: inherit;
    }
    .logout-btn:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .logout-btn .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-user {
      padding: 16px 20px;
      border-top: 1px solid rgba(255,255,255,.08);
      display: flex; align-items: center; gap: 10px; font-size: 13px;
    }
    .sidebar-user .avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: var(--sidebar-active); color: #fff;
      display: grid; place-items: center;
      font-weight: 700; font-size: 14px; flex-shrink: 0;
    }
    .sidebar-user .info .name { color: #fff; font-weight: 600; }
    .sidebar-user .info .role { color: #94a3b8; font-size: 12px; }

    /* Main */
    .main {
      flex: 1; margin-left: var(--sidebar-w);
      min-height: 100vh; display: flex; flex-direction: column;
    }
    .topbar {
      background: var(--content-bg);
      padding: 16px 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 50;
    }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .topbar .breadcrumb { color: #6b7280; font-size: 13px; }

    /* Chat area */
    .content {
      flex: 1; display: flex; flex-direction: column;
      padding: 0; overflow: hidden;
    }
    .chat-messages {
      flex: 1; overflow-y: auto; padding: 24px 28px;
      display: flex; flex-direction: column; gap: 16px;
    }
    .chat-bubble {
      max-width: 80%; padding: 14px 18px;
      border-radius: 14px; font-size: 14px; line-height: 1.6;
      white-space: pre-wrap; word-break: break-word;
    }
    .chat-bubble.user {
      align-self: flex-end;
      background: #4f46e5; color: #fff;
      border-bottom-right-radius: 4px;
    }
    .chat-bubble.assistant {
      align-self: flex-start;
      background: var(--content-bg); color: #172033;
      border: 1px solid #e2e8f0;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,.04);
    }
    .chat-typing {
      align-self: flex-start;
      padding: 14px 18px; font-size: 14px; color: #6b7280;
      display: flex; gap: 4px;
    }
    .chat-typing span {
      width: 8px; height: 8px; border-radius: 50%;
      background: #94a3b8; animation: bounce 1.4s infinite;
    }
    .chat-typing span:nth-child(2) { animation-delay: .2s; }
    .chat-typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-8px); }
    }

    /* Chat input */
    .chat-input-area {
      padding: 16px 28px 24px;
      background: var(--content-bg);
      border-top: 1px solid #e2e8f0;
    }
    .chat-input-wrap {
      display: flex; gap: 10px;
      background: #f1f5f9; border-radius: 12px;
      padding: 8px 8px 8px 16px; align-items: flex-end;
      border: 1px solid #e2e8f0; transition: border-color .2s;
    }
    .chat-input-wrap:focus-within { border-color: #4f46e5; }
    .chat-input-wrap textarea {
      flex: 1; border: none; background: transparent;
      font-size: 14px; font-family: inherit; resize: none;
      outline: none; min-height: 24px; max-height: 120px;
      padding: 4px 0;
    }
    .chat-input-wrap button {
      width: 40px; height: 40px; border-radius: 10px;
      background: #4f46e5; color: #fff; border: none;
      font-size: 18px; cursor: pointer; flex-shrink: 0;
      transition: background .15s;
    }
    .chat-input-wrap button:hover { background: #4338ca; }
    .chat-input-wrap button:disabled { background: #94a3b8; cursor: not-allowed; }

    /* Welcome message */
    .welcome {
      text-align: center; padding: 40px 20px; color: #6b7280;
    }
    .welcome h3 { font-size: 20px; margin-bottom: 8px; color: #172033; }
    .suggestions {
      display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 16px;
    }
    .suggestion-chip {
      padding: 8px 16px; border-radius: 20px;
      background: #f1f5f9; border: 1px solid #e2e8f0;
      font-size: 13px; cursor: pointer; color: #374151;
      transition: background .15s;
    }
    .suggestion-chip:hover { background: #e2e8f0; }

    .hamburger { display: none; background: none; border: none; font-size: 24px; cursor: pointer; color: #172033; padding: 4px; }

    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); transition: transform .25s; }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .hamburger { display: block; }
      .chat-bubble { max-width: 92%; }
    }

    @media (prefers-color-scheme: dark) {
      :root { --bg: #0f172a; --content-bg: #1e293b; }
      body { color: #f2f5f8; }
      .chat-bubble.assistant { color: #f2f5f8; border-color: #334155; }
      .chat-input-area { border-top-color: #334155; }
      .chat-input-wrap { background: #0f172a; border-color: #334155; }
      .chat-input-wrap textarea { color: #f2f5f8; }
      .suggestion-chip { background: #1a2332; border-color: #334155; color: #cbd5e1; }
      .suggestion-chip:hover { background: #334155; }
      .welcome h3 { color: #f2f5f8; }
      .topbar { box-shadow: 0 1px 3px rgba(0,0,0,.3); }
    }

    /* Save plan button */
    .save-plan-btn {
      display: inline-flex; align-items: center; gap: 6px;
      margin-top: 10px; padding: 8px 16px;
      background: #10b981; color: #fff; border: none;
      border-radius: 8px; font-size: 13px; font-weight: 500;
      cursor: pointer; transition: background .15s;
    }
    .save-plan-btn:hover { background: #059669; }
    .save-plan-btn:disabled { background: #94a3b8; cursor: not-allowed; }
    .save-plan-btn.saved { background: #6b7280; cursor: default; }
  </style>
</head>
<body>

${sidebarHTML('asisten', username, csrfToken)}

<main class="main">
  <header class="topbar">
    <div>
      <h2>🤖 Asisten Automation</h2>
      <span class="breadcrumb">Home / Asisten AI</span>
    </div>
    <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
  </header>

  <div class="content">
    <div class="chat-messages" id="chat-messages">
      <div class="welcome">
        <h3>🤖 Asisten Pemasaran Batik Bakaran</h3>
        <p>Aku bisa bantu kamu merencanakan konten pemasaran berdasarkan data produk.</p>
        <div class="suggestions">
          <span class="suggestion-chip" onclick="sendSuggestion(this.textContent)">Tampilkan semua produk</span>
          <span class="suggestion-chip" onclick="sendSuggestion(this.textContent)">Buat konten Threads untuk 3 produk terlaris</span>
          <span class="suggestion-chip" onclick="sendSuggestion(this.textContent)">Buat rencana konten Threads 1 minggu lanjutan, cek jadwal pemasaran dulu</span>
          <span class="suggestion-chip" onclick="sendSuggestion(this.textContent)">Analisis stok dan rekomendasi promosi</span>
        </div>
      </div>
    </div>

    <div class="chat-input-area">
      <div class="chat-input-wrap">
        <textarea id="chat-input" rows="1" placeholder="Ketik pesan..." onkeydown="handleKey(event)"></textarea>
        <button id="send-btn" onclick="sendMessage()">➤</button>
      </div>
    </div>
  </div>
</main>

<script>
let streaming = false;

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function sendSuggestion(text) {
  document.getElementById('chat-input').value = text;
  sendMessage();
}

async function sendMessage() {
  if (streaming) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const container = document.getElementById('chat-messages');

  // Hapus welcome message jika masih ada
  const welcome = container.querySelector('.welcome');
  if (welcome) welcome.remove();

  // Tambah bubble user
  const userBubble = document.createElement('div');
  userBubble.className = 'chat-bubble user';
  userBubble.textContent = text;
  container.appendChild(userBubble);

  // Typing indicator
  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  typing.id = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  container.appendChild(typing);

  // Scroll
  container.scrollTop = container.scrollHeight;

  input.value = '';
  input.style.height = 'auto';
  streaming = true;
  document.getElementById('send-btn').disabled = true;

  // Buat bubble assistant
  const assistantBubble = document.createElement('div');
  assistantBubble.className = 'chat-bubble assistant';
  assistantBubble.textContent = '';

  try {
    const res = await fetch('/api/asisten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });

    if (!res.ok) {
      let errMsg = 'Gagal menghubungi AI (HTTP ' + res.status + ')';
      const errText = await res.text();
      if (errText) {
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error || errJson.message || errMsg;
        } catch (_) {
          errMsg = errText.slice(0, 200);
        }
      }
      throw new Error(errMsg);
    }

    if (!res.body) {
      throw new Error('Response stream tidak tersedia.');
    }

    // Hapus typing
    typing.remove();
    container.appendChild(assistantBubble);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
              assistantBubble.textContent += data.text;
            } else if (data.type === 'done') {
              // Parse JSON rencana dari response
              const fullText = assistantBubble.textContent;
              const marker = '\`\`\`json';
              const startIdx = fullText.lastIndexOf(marker);
              if (startIdx !== -1) {
                const afterMarker = fullText.slice(startIdx + marker.length);
                const endIdx = afterMarker.indexOf('\`\`\`');
                if (endIdx !== -1) {
                  const jsonStr = afterMarker.slice(0, endIdx).trim();
                  try {
                    const planData = JSON.parse(jsonStr);
                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'save-plan-btn';
                    saveBtn.innerHTML = '📋 Simpan Rencana';
                    saveBtn.onclick = async () => {
                      saveBtn.disabled = true;
                      saveBtn.textContent = '⏳ Menyimpan...';
                      try {
                        const res = await fetch('/api/pemasaran', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(planData),
                        });
                          if (res.ok) {
                          let savedText = '✅ Tersimpan';
                          try {
                            const savedData = await res.json();
                            if (savedData.count) savedText = '✅ ' + savedData.count + ' rencana tersimpan';
                          } catch (_) {}
                          saveBtn.innerHTML = savedText;
                          saveBtn.classList.add('saved');
                        } else {
                          let errMsg = 'Gagal menyimpan';
                          try {
                            const errData = await res.json();
                            errMsg = errData.error || errMsg;
                          } catch (_) {}
                          throw new Error(errMsg);
                        }
                      } catch (err) {
                        saveBtn.innerHTML = '❌ ' + err.message;
                        saveBtn.title = err.message;
                        saveBtn.disabled = false;
                      }
                    };
                    assistantBubble.appendChild(saveBtn);
                  } catch (e) {}
                }
              }
            } else if (data.type === 'error') {
              assistantBubble.textContent += '\\n❌ ' + data.text;
            }
          } catch(e) {}
        }
      }
      container.scrollTop = container.scrollHeight;
    }
  } catch(e) {
    typing.remove();
    const errBubble = document.createElement('div');
    errBubble.className = 'chat-bubble assistant';
    errBubble.textContent = '❌ Gagal menghubungi AI: ' + e.message;
    container.appendChild(errBubble);
  }

  streaming = false;
  document.getElementById('send-btn').disabled = false;
  container.scrollTop = container.scrollHeight;
}

// Auto-resize textarea
document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});
</script>

</body>
</html>`;
}
