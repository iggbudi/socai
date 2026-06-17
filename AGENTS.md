# AGENTS.md

## Overview

Node.js ESM app for **Batik Bakaran** product & marketing management:

- **Web app** (`server.js`) — Express 5, session auth, inline HTML pages, REST API, AI chat (SSE)
- **Telegram bot** (`telegram-bot.js`) — Telegraf, content wizards, Repliz scheduling, shared AI agent
- **Shared `lib/` modules** — DB pools, AI agent, rate limits, image/URL validation, Repliz client, env validation
- **PostgreSQL** — `produk`, `pemasaran`, `users`, `user_sessions`
- **Repliz** — optional Threads content scheduling/sync (web + bot)
- **Cloudinary** — optional image upload from Telegram marketing wizard

No build step, no TypeScript, no test/lint scripts. Node **>=24**.

## Run

```bash
npm start          # web — port 3010, binds 127.0.0.1
npm run bot        # telegram bot (long-polling)
npm run dev        # both in background (server.js & telegram-bot.js)
```

**systemd** (production): `socai-node.service` (web), `socai-bot.service` (bot)

Copy `.env.example` → `.env` before running. Web validates env on startup via `validateWebEnvironment()`; bot via `validateBotEnvironment()`.

## Environment

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` enables secure cookies, stricter env checks |
| `APP_URL` | Production origin for CSRF checks (e.g. `https://socai.my.id`) |
| `SESSION_SECRET` | Express session secret; required in production |
| `TELEGRAM_SUPER_ADMIN_ID` | Telegram user ID with full bot access + `/adduser` |
| `ALLOWED_IMAGE_HOSTS` | Comma-separated HTTPS hosts for external image URLs (default `res.cloudinary.com`); local `/uploads/...` always allowed |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST`, `DB_PORT` | Main PostgreSQL pool (`lib/agent.js` → `pool`) |
| `DB_AI_READ_USER`, `DB_AI_READ_PASSWORD` | Read-only pool for AI `db_query` (falls back to `DB_USER` with warning if unset) |
| `AI_MESSAGE_MAX_LENGTH` | Max chars per AI message (default `4000`) |
| `WEB_AI_RATE_LIMIT`, `WEB_AI_RATE_WINDOW_MS` | Web `/api/asisten` rate limit (default 10/min) |
| `TELEGRAM_AI_RATE_LIMIT`, `TELEGRAM_AI_RATE_WINDOW_MS` | Telegram free-text AI rate limit (default 10/min) |
| `REPLIZ_API_KEY`, `REPLIZ_SECRET`, `REPLIZ_ACCOUNT_ID` | Repliz API credentials |
| `REPLIZ_BASE_URL` | Repliz API base (default `https://api.repliz.com`) |
| `REPLIZ_SYNC_INTERVAL_MS` | Background Repliz status sync interval (default 300000) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Optional Telegram image upload to Cloudinary |
| `AI_MODEL`, `AI_MODEL_FALLBACKS` | Web AI model refs (`provider/model-id`, comma-separated fallbacks) |
| `TELEGRAM_AI_MODEL`, `TELEGRAM_AI_MODEL_FALLBACKS` | Telegram-specific model override |
| `XIAOMI_API_KEY` | Required when Xiaomi MiMo models are configured |
| `XIAOMI_TOKEN_PLAN_CN_API_KEY`, `XIAOMI_TOKEN_PLAN_AMS_API_KEY`, `XIAOMI_TOKEN_PLAN_SGP_API_KEY` | Alternate Xiaomi provider keys |
| `BRAVE_API_KEY` | Enables AI `web_search` tool |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather (aliases: `BOT_TOKEN`, `TELEGRAM_TOKEN`) |
| `PORT` | Web server port (default `3010`) |

## Architecture

| Module | Role |
|--------|------|
| `lib/agent.js` | AI agent (`@earendil-works/pi-coding-agent`), `pool` + `aiReadPool`, session map, `initAgent()`, tools `db_query` (SELECT-only, table whitelist) & `web_search`, `closeAgentPools()` |
| `lib/pemasaran.js` | Shared pemasaran/Repliz logic: `savePlansToDb`, `schedulePlanToRepliz`, `syncPlanReplizStatus`, `parseMarketingSchedule` |
| `lib/mediaUrl.js` | `sanitizeImageUrl()` — HTTPS whitelist, blocks `javascript:`/`data:`/`http://`, allows `/uploads/...` |
| `lib/imageFile.js` | Magic-byte detection (`jpeg`/`png`/`gif`/`webp`), `assertValidImageBuffer()` |
| `lib/rateLimit.js` | `createRateLimiter()` — Express middleware + standalone check/consume |
| `lib/aiLimits.js` | `normalizeAiMessage()`, `AiMessageError`, `AI_MESSAGE_MAX_LENGTH` |
| `lib/env.js` | Startup validation for web/bot (DB, session, CSRF, models, Xiaomi keys) |
| `lib/repliz.js` | Repliz HTTP client, `createThreadsSchedule()`, `getReplizSchedule()`, `isReplizConfigured()` |

**Entry points:** `server.js` (all web HTML as template literals in-file), `telegram-bot.js` (access control via `telegram-users.json`, wizards, Repliz commands).

| `lib/health.js` | `collectHealthStatus()` — DB ping + optional config flags (`?detail=1`) |

## Security (P0+P1 summary)

- **CSRF** — `csrfProtection` on all `/api/*` mutating routes; validates `Origin`/`Referer` against `APP_URL`, localhost, and request host
- **Image URL whitelist** — `sanitizeImageUrl()` on produk/pemasaran/Repliz image fields
- **Upload validation** — multer extension/mime filter + magic-byte check; renames extension to match detected type; deletes invalid files
- **AI limits** — `normalizeAiMessage()` length cap; `WEB_AI_RATE_LIMIT` on web, `TELEGRAM_AI_RATE_LIMIT` on bot free text
- **DB read-only pool** — AI `db_query` uses `aiReadPool` (dedicated `DB_AI_READ_*` creds recommended in production)
- **AI `db_query` sandbox** — SELECT only, no multi-statement, keyword blocklist, single-table reads (`produk`/`pemasaran`), no JOIN, 1000-char & 50-row caps
- **Graceful shutdown** — `server.js` handles `SIGINT`/`SIGTERM`: stops intervals, aborts web agent sessions, closes HTTP server, `closeAgentPools()`
- **Helmet** — enabled (CSP disabled due to inline scripts)
- **Login rate limit** — 5 attempts / 15 min per IP
- **Telegram ACL** — super admin + `telegram-users.json` allowlist; `/start`, `/help`, `/whoami` open to all

## Database Schema

```sql
-- users: id, username, password (bcrypt)
-- produk: id, nama, harga, stok, gambar, deskripsi, created_at, updated_at
-- pemasaran (base + Repliz columns, migrated via initPemasaranReplizSchema):
--   id, judul, strategi, target_audiens, kanal, jadwal, copywriting, produk_terkait, created_at
--   gambar, status (default 'draft'), scheduled_at, published_at
--   external_post_id, external_status, last_error
--   repliz_schedule_id (unique index when not null), repliz_status, repliz_scheduled_at
--   repliz_last_error, repliz_synced_at, repliz_attempts (default 0)
--   auto_schedule_enabled (default true)
-- user_sessions: managed by connect-pg-simple
```

## Routes

### Web pages

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | No | Redirect → `/login` |
| GET/POST | `/login` | No | Login (POST rate-limited) |
| GET | `/dashboard` | Yes | Dashboard |
| GET | `/produk` | Yes | Product UI |
| GET | `/pemasaran` | Yes | Marketing plans UI |
| GET | `/asisten` | Yes | AI chat UI |
| GET | `/logout` | Yes | Destroy session + agent |
| GET | `/health` | No | `{ status: 'ok', ... }` |

### Web API (`/api/*` — CSRF on POST/PUT/DELETE)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/upload` | Image upload (5MB, magic-byte validated) |
| GET/POST/PUT/DELETE | `/api/produk[/:id]` | Product CRUD |
| GET/POST/DELETE | `/api/pemasaran[/:id]` | Marketing plan CRUD |
| GET | `/api/repliz/accounts` | List Repliz Threads accounts |
| POST | `/api/pemasaran/repliz/schedule` | Bulk schedule to Repliz |
| POST | `/api/pemasaran/:id/repliz/schedule` | Schedule one plan |
| POST | `/api/pemasaran/:id/repliz/retry` | Retry failed Repliz post |
| POST | `/api/pemasaran/:id/repliz/sync` | Sync Repliz status |
| POST | `/api/asisten` | AI chat SSE stream (rate-limited) |

### Telegram commands (summary)

| Command | Access | Purpose |
|---------|--------|---------|
| `/start`, `/help`, `/whoami` | All | Onboarding, help, show user/chat IDs |
| `/status` | Allowed | DB + AI session status |
| `/listproduk`, `/tambahproduk` | Allowed | List products; product wizard |
| `/buatkonten` | Allowed | Marketing content wizard |
| `/jadwalkonten`, `/statuskonten`, `/ubahstatuskonten`, `/hapuskonten` | Allowed | Content calendar & status management |
| `/jadwalkan`, `/postnow`, `/retrypost`, `/cekpost` | Allowed | Repliz schedule/post/sync |
| `/batal` | Allowed | Cancel active wizard |
| `/adduser` | Super admin only | Add Telegram user to allowlist |
| *(free text)* | Allowed | AI chat (rate-limited; wizards intercept first) |
| *(photo)* | Allowed | Image step in content wizard (Cloudinary or local) |

## Key Gotchas

- **Bind address** — web listens on `127.0.0.1` only; reverse proxy required in production
- **`APP_URL` + CSRF** — unset in production → API mutations return 403
- **`SESSION_SECRET`** — auto-random if missing; sessions lost on restart
- **AI agent lazy init** — first `/api/asisten` or Telegram message triggers `initAgent()`; expect delay
- **Separate AI sessions** — web uses `sessionID`; Telegram uses `telegram:{chatId}`; Telegram can use `TELEGRAM_AI_MODEL*`
- **AI DB writes** — agent is SELECT-only; product/content creation via web UI or bot wizards (`/tambahproduk`, `/buatkonten`)
- **`DB_AI_READ_*`** — without dedicated read-only user, `db_query` runs as `DB_USER` (warned at startup)
- **Repliz optional** — scheduling commands no-op/error if `REPLIZ_*` unset; background sync/auto-schedule in `server.js` when configured
- **Cloudinary optional** — Telegram wizard falls back to local `public/uploads/` if unset
- **No frontend build** — all UI HTML lives in `server.js` functions (`loginPage`, `dashboardPage`, etc.)
- **`index.html`** at repo root is a static placeholder; Express handles routing