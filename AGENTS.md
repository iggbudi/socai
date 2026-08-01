# AGENTS.md

## Overview

Node.js ESM app for **Batik Bakaran** product & marketing management:

- **Web app** (`server.js` bootstrap + `lib/web/`) — Express 5, session auth, inline HTML pages, REST API, AI chat (SSE)
- **Telegram bot** (`telegram-bot.js` entry tipis + `lib/features/telegram/`) — Telegraf, content wizards, Repliz scheduling, shared AI agent
- **Shared `lib/` modules** — DB pools (`lib/shared/db.js`), AI agent, rate limits, image/URL validation, Repliz client, env validation
- **PostgreSQL** — `produk`, `pemasaran`, `users`, `user_sessions`
- **Repliz** — optional multi-channel content scheduling/sync (Threads + Instagram via `lib/features/channels/`)
- **Cloudinary** — optional image upload from Telegram marketing wizard

> Audit & rencana remediasi sprint: `sprint-plan.md` · catatan sesi: `logbook.md` ·
> template deploy: `deploy/` · pengaturan WIB: `lib/shared/wibTime.js` (jadwal selalu +07:00 eksplisit).

No build step, no TypeScript. Node **>=24**. Tests: `npm test` (Node built-in `node:test`)
— termasuk unit tests per modul (`test/*.test.js`) dan route-level tests (`test/routes.test.js`:
login body guard, health shape, auth guard, CSRF e2e) yang berjalan tanpa database.

## Run

```bash
npm start          # web — port 3010, binds 127.0.0.1
npm run bot        # telegram bot (long-polling)
npm run dev        # both in background (server.js & telegram-bot.js)
npm test           # automated tests in test/
npm run test:ci    # unit tests + qa-smoke (no HTTP; used by GitHub Actions)
npm run test:coverage  # unit tests + coverage report (node --test --experimental-test-coverage)
npm run lint       # ESLint 9 (flat config, `eslint.config.js`) — dijalankan di CI
npm run format     # Prettier write (opsional; bukan gate CI)
npm run eval:export  # export metrik penelitian M1–M7 (JSON)
```

**systemd** (production): `socai-node.service` (web), `socai-bot.service` (bot)

> Template unit systemd + runbook ada di `deploy/`. Wajib set `TZ=Asia/Jakarta` di unit
> (logika jadwal WIB sudah eksplisit via `lib/shared/wibTime.js` — lihat Sprint 3/A4 di `logbook.md`).

Copy `.env.example` → `.env` before running. Web validates env on startup via `validateWebEnvironment()`; bot via `validateBotEnvironment()`.

## Environment

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` enables secure cookies, stricter env checks |
| `APP_URL` | Production origin for CSRF checks (e.g. `https://socai.my.id`) |
| `SESSION_SECRET` | Express session secret; required in production |
| `TELEGRAM_SUPER_ADMIN_ID` | Telegram user ID with full bot access + `/adduser` |
| `ALLOWED_IMAGE_HOSTS` | Comma-separated HTTPS hosts for external image URLs (default `res.cloudinary.com`); local `/uploads/...` always allowed |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST`, `DB_PORT` | Main PostgreSQL pool (`lib/shared/db.js` → `pool`) |
| `DB_AI_READ_USER`, `DB_AI_READ_PASSWORD` | Read-only pool for AI `db_query` (falls back to `DB_USER` with warning if unset) |
| `AI_MESSAGE_MAX_LENGTH` | Max chars per AI message (default `4000`) |
| `WEB_AI_RATE_LIMIT`, `WEB_AI_RATE_WINDOW_MS` | Web `/api/asisten` rate limit (default 10/min) |
| `TELEGRAM_AI_RATE_LIMIT`, `TELEGRAM_AI_RATE_WINDOW_MS` | Telegram free-text AI rate limit (default 10/min) |
| `ENABLED_CHANNELS` | Comma-separated social channels: `threads`, `instagram` (default `threads`) |
| `REPLIZ_API_KEY`, `REPLIZ_SECRET`, `REPLIZ_ACCOUNT_ID` | Repliz API credentials (Threads) |
| `REPLIZ_INSTAGRAM_ACCOUNT_ID` | Repliz Instagram account id (when `instagram` enabled) |
| `REPLIZ_BASE_URL` | Repliz API base (default `https://api.repliz.com`) |
| `REPLIZ_SYNC_INTERVAL_MS` | Background Repliz status sync interval (default 300000) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Optional Telegram image upload to Cloudinary |
| `AI_MODEL`, `AI_MODEL_FALLBACKS` | Web AI model refs (`provider/model-id`, comma-separated fallbacks) |
| `TELEGRAM_AI_MODEL`, `TELEGRAM_AI_MODEL_FALLBACKS` | Telegram-specific model override |
| `XIAOMI_API_KEY` | Required when Xiaomi MiMo models are configured |
| `XIAOMI_TOKEN_PLAN_CN_API_KEY`, `XIAOMI_TOKEN_PLAN_AMS_API_KEY`, `XIAOMI_TOKEN_PLAN_SGP_API_KEY` | Alternate Xiaomi provider keys |
| `BRAVE_API_KEY` | Enables AI `web_search` tool |
| `AUTONOMY_MODE` | Global bounded autonomy: `assistive` (default), `supervised`, `bounded` |
| `WEB_AUTONOMY_MODE`, `TELEGRAM_AUTONOMY_MODE` | Per-channel override of `AUTONOMY_MODE` |
| `REQUIRE_APPROVAL` | If `true`, blocks agent `schedule_content`; sends Telegram approve/reject inline keyboard |
| `AUTO_PLAN_CRON_INTERVAL_MS` | Weekly plan cron interval (`0` = disabled) |
| `AUTO_PLAN_MIN_GAPS` | Min calendar gaps before cron triggers agent (default `3`) |
| `AUTO_PLAN_CRON_AUTONOMY_MODE` | Autonomy mode for cron agent (default `supervised`) |
| `AGENT_RUNS_PURGE_INTERVAL_MS` | Interval to purge old `agent_runs` rows (default `86400000`) |
| `TELEGRAM_APPROVAL_NOTIFY_ROLES` | Min role for approval notifications (default `operator`) |
| `MAX_AGENT_SAVES_PER_RUN` | Cap plans saved per agent response (default `7`) |
| `MAX_AGENT_SCHEDULES_PER_DAY` | Daily cap for agent-driven Repliz schedules (default `10`) |
| `AGENT_RUNS_RETAIN_DAYS` | Retention hint for `agent_runs` log purge (P2, default `90`) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather (aliases: `BOT_TOKEN`, `TELEGRAM_TOKEN`) |
| `PORT` | Web server port (default `3010`) |

## Architecture

| Module | Role |
|--------|------|
| `lib/shared/db.js` | PostgreSQL pools (shared infra): `pool` (write), `aiReadPool` (read-only untuk AI `db_query`), `closeAgentPools()` — tanpa import dari `lib/features/` |
| `lib/shared/` | Shared infra per fitur (F0/F1): `db.js`, `wibTime.js`, `rateLimit.js`, `mediaUrl.js`, `imageFile.js`, `html.js`, `repliz.js`, `telegramNotify.js` + co-located test di `lib/shared/test/` |
| `lib/features/agent/core.js` | AI agent (`@earendil-works/pi-coding-agent`), session map, `initAgent()`, tools `db_query` (SELECT-only), `web_search`, actuator tools (`get_calendar_gaps`, `save_content_plan`, `schedule_content`, `sync_content_status`), active run context exports |
| `lib/features/agent/runs.js` | Research audit log: `initAgentRunsSchema`, `createAgentRun`, `logToolCall`, `completeAgentRun`, `getAgentRunMetrics`, `listAgentRuns` |
| `lib/features/agent/routes.js` | SSE `/api/asisten` + `/api/agent/runs`; route registration menerima optional `deps` untuk fake pool/session/auth/limiter pada test |
| `lib/features/evaluasi/` | Metrik penelitian M1–M7: `metrics.js` (`getEvaluationMetrics()`, `resolveEvaluationPeriod()`), `routes.js` (`/api/agent/metrics`), `view.js` (`evaluasiPage`) |
| `lib/features/agent/actuator/` | Bounded autonomy layer: `resolveAutonomyMode`, policy checks, wrappers around `lib/features/pemasaran/` write paths |
| `lib/features/channels/` | Multi-channel adapter: `registry.js`, `threads.js`, `instagram.js`, `getChannel()`, `listChannels()`, `buildChannelsPromptSection()` |
| `lib/features/` | Vertical slicing selesai (F2–F8): `channels`, `auth`, `dashboard`, `produk`, `pemasaran`, `agent`, `evaluasi`, `telegram` — domain/API/view/test co-located per fitur |
| `lib/features/pemasaran/` | Shared pemasaran/Repliz logic (web + bot + agent): `domain.js` (`savePlansToDb`, `schedulePlanToChannel` alias `schedulePlanToRepliz`, `syncPlanReplizStatus`, `parseMarketingSchedule`), `routes.js`, `jobs.js` (background Repliz sync/auto-schedule), `view.js` |
| `lib/shared/mediaUrl.js` | `sanitizeImageUrl()` — HTTPS whitelist, blocks `javascript:`/`data:`/`http://`, allows `/uploads/...` |
| `lib/shared/imageFile.js` | Magic-byte detection (`jpeg`/`png`/`gif`/`webp`), `assertValidImageBuffer()` |
| `lib/shared/rateLimit.js` | `createRateLimiter()` — Express middleware + standalone check/consume |
| `lib/features/agent/aiLimits.js` | `normalizeAiMessage()`, `AiMessageError`, `AI_MESSAGE_MAX_LENGTH` |
| `lib/env.js` | Startup validation for web/bot (DB, session, CSRF, models, Xiaomi keys) |
| `lib/shared/repliz.js` | Repliz HTTP client, `createThreadsSchedule()`, `getReplizSchedule()`, `isReplizConfigured()` |
| `lib/features/auth/` | Login/logout, session CSRF, login rate limit: `requireLogin`, `csrfToken` (`generateCsrfToken`, `ensureSessionCsrfToken`, `validateCsrfToken`), `loginRateLimit`, `routes` (login/logout), `view` (`loginPage`) + co-located test |
| `lib/features/dashboard/` | Halaman dashboard (`dashboardPage`) |
| `lib/features/produk/` | CRUD produk + upload gambar: `routes.js` (`registerProdukRoutes` + `registerUploadRoutes`), `upload.js` (multer 5MB + magic-byte), `view.js` (`produkPage`) |
| `lib/features/telegram/access.js` | `createTelegramAccess()` — role-based ACL (`super_admin` > `operator` > `viewer`), migrates legacy `allowed_user_ids[]` |
| `lib/features/telegram/` | Fitur bot (F8): `bot.js` (self-executing — Telegraf, wizards, Repliz commands, startBot), `helpers.js` (`safeReply`, `replyLong`, `markdownToTelegramHtml`), `access.js`, `test/` |
| `lib/web/health.js` | `collectHealthStatus()` — DB ping + optional config flags (`?detail=1`) |
| `lib/features/agent/runs.js` | `agent_runs` audit log: create/log/complete runs, metrics, purge |
| `lib/features/agent/actuator/` | Bounded actuator tools + `AUTONOMY_MODE` policy |
| `lib/features/agent/runner.js` | `runAgentTask()` — programmatic agent prompt (cron/chat) |
| `lib/features/agent/autonomousJobs.js` | Weekly plan cron, publish feedback refresh, agent_runs purge |
| `lib/features/agent/approval.js` | `REQUIRE_APPROVAL` flow + Telegram approve/reject |
| `lib/features/agent/publishFeedback.js` | Publish outcome cache injected into agent system prompt |
| `lib/web/` | Web app shell murni: `createApp.js` (Express factory), `middleware/` (CSRF, CSP nonce), `routes/` (pages, health), `health.js` |

**Entry points:** `server.js` (thin bootstrap: env validation, schema init, `createWebApp()`, listen, shutdown), `telegram-bot.js` (thin entry → `lib/features/telegram/bot.js`: access control via `access.js` + `telegram-users.json`, wizards, Repliz commands).

**Route testability convention (S21):** feature route registration yang memakai global pool/agent dependency wajib menyediakan optional `deps` dengan default production yang identik; handler SSE/API yang beralur kompleks diekspor sebagai fungsi bernama agar dapat diuji memakai fake pool/session tanpa database, model, atau jaringan.

## Security (P0+P1 summary)

- **CSRF** — `csrfProtection` on all `/api/*` mutating routes; validates `Origin`/`Referer` against `APP_URL`, localhost, and request host
- **Image URL whitelist** — `sanitizeImageUrl()` on produk/pemasaran/Repliz image fields
- **Upload validation** — multer extension/mime filter + magic-byte check; renames extension to match detected type; deletes invalid files
- **AI limits** — `normalizeAiMessage()` length cap; `WEB_AI_RATE_LIMIT` on web, `TELEGRAM_AI_RATE_LIMIT` on bot free text
- **DB read-only pool** — AI `db_query` uses `aiReadPool` (`lib/shared/db.js`; dedicated `DB_AI_READ_*` creds recommended in production)
- **AI `db_query` sandbox** — SELECT only, no multi-statement, keyword blocklist, single-table reads (`produk`/`pemasaran`), no JOIN, 1000-char & 50-row caps
- **Graceful shutdown** — `server.js` handles `SIGINT`/`SIGTERM`: stops intervals, aborts web agent sessions, closes HTTP server, `closeAgentPools()`
- **Helmet + CSP** — enabled with per-request nonce (`lib/web/middleware/csp.js`); inline `<script>`/`<style>` in views use `nonce` attribute; no `style-src 'unsafe-inline'` (styles via CSS classes); `script-src-attr 'none'` — views must use `addEventListener` in nonce scripts (shared `HAMBURGER_BIND_JS` in `lib/shared/pageInit.js`), never HTML `onclick`/`onchange` attributes
- **Login rate limit** — 5 attempts / 15 min per IP
- **Logout CSRF** — `POST /logout` with session `_csrf` token; `GET /logout` redirects to `/dashboard` (no session destroy)
- **Telegram ACL** — roles via `lib/features/telegram/access.js`: `super_admin` (full + user mgmt), `operator` (AI, wizards, Repliz), `viewer` (read-only commands); `/start`, `/help`, `/whoami` open to all

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
-- agent_runs: id, run_id, session_key, source, autonomy_mode, trigger_type, user_prompt,
--   status, model_ref, tools_called (jsonb), plans_saved, plans_scheduled, pemasaran_ids,
--   error_message, started_at, ended_at, duration_ms
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
| GET | `/evaluasi` | Yes | Research metrics dashboard (M1–M7) |
| POST | `/logout` | Yes | Destroy session + agent (CSRF `_csrf` required) |
| GET | `/logout` | No | Redirect → `/dashboard` (legacy bookmark) |
| GET | `/health` | No | `{ status: 'ok', ... }` |

### Web API (`/api/*` — CSRF on POST/PUT/DELETE)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/upload` | Image upload (5MB, magic-byte validated) |
| GET/POST/PUT/DELETE | `/api/produk[/:id]` | Product CRUD |
| GET/POST/DELETE | `/api/pemasaran[/:id]` | Marketing plan CRUD |
| GET | `/api/channels` | List enabled/configured social channels |
| GET | `/api/repliz/accounts` | List Repliz accounts (`?type=` or `?channel=` — `threads`, `instagram`) |
| POST | `/api/pemasaran/repliz/schedule` | Bulk schedule to Repliz |
| POST | `/api/pemasaran/:id/repliz/schedule` | Schedule one plan |
| POST | `/api/pemasaran/:id/repliz/retry` | Retry failed Repliz post |
| POST | `/api/pemasaran/:id/repliz/sync` | Sync Repliz status |
| POST | `/api/asisten` | AI chat SSE stream (rate-limited) |
| GET | `/api/agent/runs` | List recent `agent_runs` audit rows (`?limit=`, default 50) |
| GET | `/api/agent/metrics` | Evaluation metrics M1–M7 (`?days=`, `?since=`, `?channel=`, `?autonomy_mode=`, `?source=`) |

### Telegram commands (summary)

| Command | Min role | Purpose |
|---------|----------|---------|
| `/start`, `/help`, `/whoami` | All | Onboarding, help, show user/chat IDs |
| `/status`, `/listproduk`, `/jadwalkonten`, `/statuskonten` | viewer | Status, list products, content calendar |
| `/tambahproduk`, `/buatkonten`, `/jadwalkan`, `/postnow`, `/retrypost`, `/cekpost` | operator | Wizards, Repliz schedule/post/sync |
| `/ubahstatuskonten`, `/hapuskonten` | super_admin | Mutate/delete content plans |
| `/adduser`, `/removeuser`, `/listusers` | super_admin | Manage allowlist (`operator` or `viewer`) |
| `/batal` | Allowed | Cancel active wizard |
| *(free text)* | operator | AI chat (rate-limited; wizards intercept first) |
| *(photo)* | operator | Image step in content wizard (Cloudinary or local) |

## Key Gotchas

- **Bind address** — web listens on `127.0.0.1` only; reverse proxy required in production
- **`APP_URL` + CSRF** — unset in production → API mutations return 403
- **`SESSION_SECRET`** — auto-random if missing; sessions lost on restart
- **AI agent lazy init** — first `/api/asisten` or Telegram message triggers `initAgent()`; expect delay
- **Separate AI sessions** — web uses `sessionID`; Telegram uses `telegram:{chatId}`; Telegram can use `TELEGRAM_AI_MODEL*`
- **AI DB writes** — `db_query` remains SELECT-only; bounded writes via actuator tools (`save_content_plan`, `schedule_content`) gated by `AUTONOMY_MODE`; manual paths still available via web UI or bot wizards
- **`AUTONOMY_MODE`** — default `assistive` (safe); set `supervised`/`bounded` for research scenarios; see `autonomous.md`
- **`DB_AI_READ_*`** — without dedicated read-only user, `db_query` runs as `DB_USER` (warned at startup)
- **Repliz optional** — scheduling commands no-op/error if `REPLIZ_*` unset; background sync/auto-schedule in `server.js` when configured
- **`ENABLED_CHANNELS`** — default `threads`; enable `instagram` only when `REPLIZ_INSTAGRAM_ACCOUNT_ID` is set
- **Cloudinary optional** — Telegram wizard falls back to local `public/uploads/` if unset
- **No frontend build** — UI HTML lives in `lib/web/views/` (`loginPage`, `dashboardPage`, etc.)
- **`index.html`** at repo root is a static placeholder; Express handles routing
