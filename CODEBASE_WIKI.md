# CODEBASE WIKI — socai.my.id

Dokumentasi codebase untuk project `/var/www/socai.my.id` (Batik Bakaran — produk, pemasaran Threads, AI assistant, bot Telegram).

**Terakhir diperbarui:** 17 Juni 2026  
**Repo:** https://github.com/iggbudi/socai.git

Dokumen terkait: `AGENTS.md` (instruksi coding agent), `README.md` (arsitektur + UML/DAD), `logbook.md` (catatan sesi pengembangan).

---

## 1. Ringkasan

`socai.my.id` adalah aplikasi Node.js ESM untuk manajemen produk Batik Bakaran, perencanaan konten pemasaran Threads, AI marketing assistant, integrasi Repliz, dan bot Telegram.

| Aspek | Detail |
|---|---|
| Runtime | Node.js `>=24`, tanpa build step / TypeScript |
| Web | Express 5 — `server.js` (bootstrap) + `lib/web/` |
| Bot | Telegraf — `telegram-bot.js` |
| Database | PostgreSQL (`produk`, `pemasaran`, `users`, `user_sessions`) |
| AI | `@earendil-works/pi-coding-agent` — `db_query` (read-only) + `web_search` |
| Tests | `npm test` — 32 test (`node:test`); smoke QA: `node test/qa-smoke.mjs` |
| Production | systemd: `socai-node.service` (web), `socai-bot.service` (bot) |

---

## 2. Changelog

Riwayat perubahan utama berdasarkan commit Git (`main`).

### 2026-06-17 — Dokumentasi & QA

| Commit | Ringkasan |
|---|---|
| `e77b406` | **README** — overview sistem, tech stack, keamanan, setup, diagram Mermaid (use case, activity, sequence, class, component, deployment, state, DAD level 0–1) |
| `047abdb` | **logbook.md** — ringkasan Sprint 2/3, CSP fixes, QA, konfigurasi AI model, evaluasi penelitian |
| `c673c40` | **QA smoke** — `test/qa-smoke.mjs`: cek CSP (no inline handlers), nonce tags, health/auth/CSRF HTTP |

### 2026-06-17 — CSP hardening

| Commit | Ringkasan |
|---|---|
| `64b242c` | Ganti semua `onclick`/`onchange` dengan `addEventListener` + nonce script; shared `HAMBURGER_BIND_JS` di `pageInit.js`; fix race SSE di `/api/asisten` |
| `ba3df1b` | Hapus `style-src 'unsafe-inline'` — inline `style=` diganti CSS classes; preview upload via `classList` |

### 2026-06-17 — Sprint 3 P2: refactor web

| Commit | Ringkasan |
|---|---|
| `fe7f302` | Pecah `server.js` monolit (~2690 baris) → `lib/web/` (`createApp`, middleware, routes, views, `replizJobs`); Helmet CSP dengan per-request nonce; `server.js` jadi thin bootstrap (~140 baris) |

### 2026-06-17 — Sprint 2 P2: CSRF logout, Telegram roles, tests

| Commit | Ringkasan |
|---|---|
| `0d6e88c` | `lib/csrfToken.js` + `POST /logout` (CSRF); `lib/telegramAccess.js` (roles `super_admin` > `operator` > `viewer`); `/removeuser`, `/listusers`; `npm test` 32 suite |

### 2026-06 — Sprint 1 P2 & keamanan

| Commit | Ringkasan |
|---|---|
| `e66a580` | `lib/pemasaran.js` (shared save/schedule/sync Repliz); `lib/health.js`; Telegram scheduling unified dengan web |
| `5d6b45b` | **P1 hardening** — AI message limits, rate limiter shared, magic-byte upload validation, graceful shutdown, `aiReadPool` (DB read-only AI) |
| `b11f9a9` | **P0 hardening** — `lib/mediaUrl.js` (whitelist gambar), env validation web/bot terpisah, sanitize gambar di API/Repliz |
| `6e2ccd0` | Hardening config & HTTP security awal |
| `d110a21` | Initial commit |

---

## 3. Cara Menjalankan

```bash
cp .env.example .env    # isi credential sebelum run
npm start               # web — port 3010, bind 127.0.0.1
npm run bot             # telegram bot (long-polling)
npm run dev             # kedua process di background
npm test                # 32 automated tests
node test/qa-smoke.mjs  # smoke QA (butuh server jalan untuk HTTP checks)
```

Catatan operasional:

- Port web: `PORT` (default `3010`).
- Web hanya listen `127.0.0.1` — wajib reverse proxy di production.
- `APP_URL` harus benar agar CSRF lolos di production.
- Startup memvalidasi env via `validateWebEnvironment()` / `validateBotEnvironment()`.

---

## 4. Struktur File Penting

```text
.
├── AGENTS.md                 # Instruksi project untuk coding agent
├── CODEBASE_WIKI.md          # Dokumentasi codebase ini
├── README.md                 # Arsitektur, UML, DAD
├── logbook.md                # Catatan sesi pengembangan
├── server.js                 # Thin bootstrap (~140 baris)
├── telegram-bot.js           # Bot Telegram Telegraf
├── telegram-users.json       # Allowlist user Telegram (roles)
├── index.html                # Placeholder statis; Express menangani routing
├── lib/
│   ├── agent.js              # AI agent, pool + aiReadPool, session map
│   ├── pemasaran.js          # Shared marketing/Repliz logic
│   ├── repliz.js             # Repliz HTTP client
│   ├── telegramAccess.js     # Role-based ACL
│   ├── csrfToken.js          # Session CSRF token
│   ├── mediaUrl.js           # Image URL whitelist
│   ├── imageFile.js          # Magic-byte image validation
│   ├── rateLimit.js          # Shared rate limiter
│   ├── aiLimits.js           # AI message length cap
│   ├── env.js                # Startup env validation
│   ├── health.js             # Health check collector
│   └── web/
│       ├── createApp.js      # Express factory
│       ├── replizJobs.js     # Background Repliz sync + auto-schedule
│       ├── middleware/       # auth, CSRF, CSP nonce, login rate limit, upload
│       ├── routes/           # pages, auth, health, API
│       └── views/            # HTML templates (login, dashboard, produk, pemasaran, asisten)
├── public/uploads/           # Upload gambar lokal
└── test/                     # node:test suites + qa-smoke.mjs
```

---

## 5. Arsitektur Web

### Bootstrap (`server.js`)

- Validasi env (`validateWebEnvironment`)
- Inisialisasi schema Repliz/pemasaran (`initPemasaranReplizSchema`)
- `createWebApp()` dari `lib/web/createApp.js`
- Background jobs Repliz: sync status + auto-schedule (`lib/web/replizJobs.js`)
- Graceful shutdown (`SIGINT`/`SIGTERM`): stop intervals, abort agent sessions, tutup HTTP server, `closeAgentPools()`

### Modul web (`lib/web/`)

| Modul | Peran |
|---|---|
| `createApp.js` | Factory Express: session PG store, Helmet+CSP, mount routes |
| `middleware/auth.js` | `requireLogin` |
| `middleware/csrf.js` | Origin/Referer CSRF untuk `/api/*` mutating |
| `middleware/csp.js` | Per-request nonce untuk inline script/style |
| `middleware/loginRateLimit.js` | 5 gagal / 15 menit / IP |
| `middleware/upload.js` | Multer 5MB + filter mime |
| `routes/pages.js` | Halaman HTML |
| `routes/auth.js` | Login + logout |
| `routes/health.js` | `/health` |
| `routes/api/*` | Produk, pemasaran, Repliz, upload, asisten (SSE) |
| `views/*.js` | Template HTML inline (tanpa bundler) |
| `replizJobs.js` | Polling status Repliz + auto-schedule rencana pending |

### Keamanan web

- Helmet + CSP nonce; `script-src-attr 'none'` — tidak ada `onclick`/`onchange` di HTML
- Session cookie: `httpOnly`, `sameSite: strict`, `secure` di production
- Password: `bcryptjs`
- Upload: extension/mime filter + magic-byte check; rename ekstensi sesuai tipe terdeteksi
- Image URL: `sanitizeImageUrl()` — whitelist HTTPS + `/uploads/...`
- Logout: `POST /logout` dengan token `_csrf` di session; `GET /logout` hanya redirect ke `/dashboard`
- AI: rate limit web (`WEB_AI_RATE_LIMIT`), panjang pesan (`AI_MESSAGE_MAX_LENGTH`)

---

## 6. Environment Variables

Lihat `AGENTS.md` dan `.env.example` untuk daftar lengkap. Ringkasan:

| Kategori | Variable utama |
|---|---|
| Core | `NODE_ENV`, `PORT`, `APP_URL`, `SESSION_SECRET` |
| Database | `DB_*`, `DB_AI_READ_*` (read-only pool untuk AI `db_query`) |
| AI | `AI_MODEL`, `AI_MODEL_FALLBACKS`, `TELEGRAM_AI_MODEL*`, `BRAVE_API_KEY`, `XIAOMI_API_KEY` |
| Rate limits | `WEB_AI_RATE_LIMIT`, `TELEGRAM_AI_RATE_LIMIT`, `*_RATE_WINDOW_MS` |
| Repliz | `REPLIZ_API_KEY`, `REPLIZ_SECRET`, `REPLIZ_ACCOUNT_ID`, `REPLIZ_SYNC_INTERVAL_MS` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SUPER_ADMIN_ID` |
| Media | `ALLOWED_IMAGE_HOSTS`, `CLOUDINARY_*` |

---

## 7. Database

PostgreSQL dipakai web, bot, dan AI tool (`pool` write; `aiReadPool` read-only untuk `db_query`).

```sql
-- users: id, username, password (bcrypt)

-- produk: id, nama, harga, stok, gambar, deskripsi, created_at, updated_at

-- pemasaran:
--   id, judul, strategi, target_audiens, kanal, jadwal, copywriting, produk_terkait, created_at
--   gambar, status (default 'draft'), scheduled_at, published_at
--   external_post_id, external_status, last_error
--   repliz_schedule_id (unique index when not null), repliz_status, repliz_scheduled_at
--   repliz_last_error, repliz_synced_at, repliz_attempts (default 0)
--   auto_schedule_enabled (default true)

-- user_sessions: managed by connect-pg-simple
```

---

## 8. Routes Web

### Halaman

| Method | Path | Auth | Fungsi |
|---|---:|---:|---|
| GET | `/` | Tidak | Redirect → `/login` |
| GET/POST | `/login` | Tidak | Login (POST rate-limited) |
| GET | `/dashboard` | Ya | Dashboard |
| GET | `/produk` | Ya | CRUD produk |
| GET | `/pemasaran` | Ya | Rencana pemasaran + Repliz UI |
| GET | `/asisten` | Ya | Chat AI (SSE) |
| POST | `/logout` | Ya | Destroy session + agent (CSRF `_csrf`) |
| GET | `/logout` | Tidak | Redirect → `/dashboard` (bookmark legacy) |
| GET | `/health` | Tidak | Healthcheck JSON (`?detail=1` opsional) |

### API (`/api/*` — CSRF pada POST/PUT/DELETE)

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/upload` | Upload gambar (5MB, magic-byte) |
| GET/POST/PUT/DELETE | `/api/produk[/:id]` | CRUD produk |
| GET/POST/DELETE | `/api/pemasaran[/:id]` | CRUD rencana pemasaran |
| GET | `/api/repliz/accounts` | List akun Threads Repliz |
| POST | `/api/pemasaran/repliz/schedule` | Bulk schedule ke Repliz |
| POST | `/api/pemasaran/:id/repliz/schedule` | Schedule satu rencana |
| POST | `/api/pemasaran/:id/repliz/retry` | Retry gagal |
| POST | `/api/pemasaran/:id/repliz/sync` | Sync status dari Repliz |
| POST | `/api/asisten` | Chat AI SSE (rate-limited) |

---

## 9. Modul AI (`lib/agent.js`)

Ekspor utama: `pool`, `aiReadPool`, `agentSessions`, `initAgent()`, `closeAgentPools()`.

- Framework: `@earendil-works/pi-coding-agent`
- Model: dari env `AI_MODEL` / `TELEGRAM_AI_MODEL` (fallback chain)
- Session web: `req.sessionID`; Telegram: `telegram:{chatId}`
- TTL idle: 4 jam; cleanup tiap 15 menit
- Init lazy — request pertama bisa lambat

### Tools

**`db_query`** — SELECT-only ke `produk`/`pemasaran` via `aiReadPool`; no JOIN; max 1000 char query, 50 rows.

**`web_search`** — Brave Search API jika `BRAVE_API_KEY` tersedia.

---

## 10. Bot Telegram (`telegram-bot.js`)

Telegraf; berbagi `pool` + AI agent dengan web. Access control via `lib/telegramAccess.js`.

### Role hierarchy

`super_admin` > `operator` > `viewer`

| Role | Kemampuan |
|---|---|
| `super_admin` | Semua command + `/adduser`, `/removeuser`, `/listusers`, `/ubahstatuskonten`, `/hapuskonten` |
| `operator` | AI chat, wizards, Repliz schedule/post/sync |
| `viewer` | Read-only: `/status`, `/listproduk`, `/jadwalkonten`, `/statuskonten` |
| Semua | `/start`, `/help`, `/whoami` |

### Command utama

| Command | Min role | Fungsi |
|---|---|---|
| `/tambahproduk`, `/buatkonten` | operator | Wizard produk/konten |
| `/jadwalkan`, `/postnow`, `/retrypost`, `/cekpost` | operator | Repliz scheduling |
| `/jadwalkonten`, `/statuskonten` | viewer | Kalender & status konten |
| `/adduser`, `/removeuser`, `/listusers` | super_admin | Kelola allowlist |
| `/batal` | allowed | Batalkan wizard aktif |
| *(free text)* | operator | AI chat (rate-limited) |
| *(photo)* | operator | Upload gambar di wizard (Cloudinary atau lokal) |

Logic pemasaran/Repliz shared dengan web lewat `lib/pemasaran.js` dan `lib/repliz.js`.

---

## 11. Frontend Web

Tidak ada frontend build. Template HTML di `lib/web/views/`:

- `login.js`, `dashboard.js`, `produk.js`, `pemasaran.js`, `asisten.js`
- `layout.js` — shell + CSS classes
- `pageInit.js` — `HAMBURGER_BIND_JS` dan binding event shared

Interaksi UI hanya via `addEventListener` di script ber-nonce — tidak boleh inline event handler (CSP `script-src-attr 'none'`).

---

## 12. Integrasi Repliz

Status: **implemented** — web UI, API, bot commands, background sync, auto-schedule.

| Komponen | Lokasi |
|---|---|
| HTTP client | `lib/repliz.js` |
| Business logic | `lib/pemasaran.js` (`schedulePlanToRepliz`, `syncPlanReplizStatus`, dll.) |
| Background jobs | `lib/web/replizJobs.js` — sync interval (`REPLIZ_SYNC_INTERVAL_MS`) + auto-schedule |
| Web API | `lib/web/routes/api/repliz.js`, `pemasaran.js` |
| Bot | Handler `/jadwalkan`, `/postnow`, `/retrypost`, `/cekpost` |

Fitur:

- Schedule text/image Threads ke Repliz
- Bulk schedule web (max 20 id)
- Retry manual + sync status
- Polling otomatis status pending/process
- Auto-schedule rencana dengan `auto_schedule_enabled=true`
- Double-schedule dicegah via `repliz_schedule_id` unique index

Jika env Repliz kosong, UI/API menampilkan pesan konfigurasi tanpa crash.

---

## 13. Testing

```bash
npm test                  # 32 tests — lib modules
node test/qa-smoke.mjs    # CSP/views/HTTP smoke (server harus jalan untuk bagian HTTP)
node --check server.js
node --check telegram-bot.js
```

Suite `test/`:

- `mediaUrl.test.js`, `imageFile.test.js`, `aiLimits.test.js`, `rateLimit.test.js`
- `pemasaran.test.js`, `csrfToken.test.js`, `telegramAccess.test.js`
- `qa-smoke.mjs` — inline handler absence, nonce, live endpoints

---

## 14. Gotcha Penting

- Node `>=24` wajib.
- Web bind `127.0.0.1` — reverse proxy di production.
- `APP_URL` unset di production → mutasi API 403.
- `SESSION_SECRET` kosong → auto-random, session hilang saat restart.
- AI init lazy; session terpisah web vs Telegram.
- AI tidak menulis DB — create/update via UI atau bot wizards.
- `DB_AI_READ_*` disarankan di production; tanpa itu `db_query` pakai `DB_USER` (warning startup).
- Repliz & Cloudinary opsional.
- `index.html` bukan entry point web.

---

## 15. Checklist Operasional

Sebelum production:

- [ ] `NODE_ENV=production`, `SESSION_SECRET` stabil, `APP_URL=https://domain`
- [ ] Reverse proxy + HTTPS
- [ ] PostgreSQL reachable; backup rutin
- [ ] `public/uploads` persistent
- [ ] `DB_AI_READ_*` user read-only untuk AI
- [ ] systemd: `socai-node`, `socai-bot`
- [ ] Monitor `/health`
- [ ] Backup `telegram-users.json`

---

## 16. Checklist Security

- Jangan commit `.env`
- CSRF pada semua mutasi `/api/*` + `POST /logout`
- `sanitizeImageUrl()` pada field gambar
- Upload: magic-byte validation
- `db_query`: SELECT-only sandbox
- CSP: nonce scripts, no inline handlers/styles
- Rate limit: login + AI (web & Telegram)
- HTTPS di production untuk cookie `secure`

---

## 17. Alur Kerja Sub-agent Project

Ekstensi project-local: `.pi/extensions/subagents.ts`

| Command | Fungsi |
|---|---|
| `/wiki` | Dokumentasi codebase |
| `/analis` | Analisis/rencana/bug |
| `/worker` | Implementasi |
| `/qa` | Review hasil |
| `/security` | Audit keamanan |
| `/ops` | Deployment/operasional |

```text
Fitur baru:     /analis -> /worker -> /qa
Bug:            /analis -> /worker -> /qa
Dokumentasi:    /wiki
Audit security: /security -> /worker -> /qa
Deployment:     /ops
```