# AGENTS.md

## Overview

Single-file Express.js app (`server.js`) for Batik Bakaran product management with an AI marketing assistant. No build step, no TypeScript, no test suite, no lint config.

## Run

```bash
npm start        # node server.js — port 3010 (configurable via PORT env)
```

No `dev`, `test`, `lint`, or `typecheck` scripts exist. The app binds to `127.0.0.1` by default.

## Environment

Copy `.env.example` to `.env`. Required vars:

- `DB_USER`, `DB_PASSWORD` — PostgreSQL credentials
- `DB_NAME` defaults to `socai`, `DB_HOST` to `127.0.0.1`, `DB_PORT` to `5432`

Optional:
- `BRAVE_API_KEY` — enables AI web search tool
- `SESSION_SECRET` — auto-generated if missing (sessions lost on restart)
- `APP_URL` — needed in production for CSRF origin checks
- `PORT` — defaults to `3010`

## Architecture

- **Entry point:** `server.js` (ESM, `"type": "module"`)
- **All HTML** is inline template literals in `server.js` — no separate view files or templates
- **Database:** PostgreSQL with tables `produk`, `pemasaran`, `users`
- **Auth:** session-based login via bcrypt, `requireLogin` middleware, 4-hour session expiry
- **AI Agent:** `@earendil-works/pi-coding-agent` using `opencode/deepseek-v4-flash-free` model, lazily initialized on first `/api/asisten` request
- **Uploads:** multer to `public/uploads/`, max 5MB, image types only

## Key Gotchas

- **Node >=24 required** (`engines` field in package.json)
- **AI agent init is async and lazy** — first chat request triggers init; expect a delay on first message
- **DB query tool is SELECT-only** — the AI agent's `db_query` tool rejects non-SELECT statements
- **CSRF check** uses Origin/Referer header against `APP_URL` + localhost — must set `APP_URL` in production or API POST/PUT/DELETE will fail with 403
- **Rate limiting** on `/login`: 5 attempts per 15 minutes per IP
- **No separate frontend build** — all UI is server-rendered HTML in `server.js` functions (`loginPage`, `dashboardPage`, `produkPage`, `pemasaranPage`, `asistenPage`)
- **`index.html`** at root is a static placeholder — the Express app handles all routes via `server.js`

## Database Schema (from code)

```sql
-- users: id, username, password (bcrypt hash)
-- produk: id, nama, harga, stok, gambar, deskripsi, created_at, updated_at
-- pemasaran: id, judul, strategi, target_audiens, kanal, jadwal, copywriting, produk_terkait, created_at
```

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/login` | No | Login page |
| POST | `/login` | No | Authenticate (rate-limited) |
| GET | `/dashboard` | Yes | Dashboard |
| GET | `/produk` | Yes | Product list page |
| GET | `/pemasaran` | Yes | Marketing plans page |
| GET | `/asisten` | Yes | AI chat page |
| GET/POST/PUT/DELETE | `/api/produk[/:id]` | Yes | Product CRUD |
| POST | `/api/upload` | Yes | Image upload |
| GET/POST/DELETE | `/api/pemasaran[/:id]` | Yes | Marketing plan CRUD |
| POST | `/api/asisten` | Yes | AI chat (SSE stream) |
| GET | `/health` | No | Health check |
