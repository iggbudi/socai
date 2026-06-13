# CODEBASE WIKI — socai.my.id

Dokumentasi ini dibuat oleh sub-agent **Wiki** untuk project `/var/www/socai.my.id`.

## 1. Ringkasan

`socai.my.id` adalah aplikasi Node.js/Express untuk manajemen produk Batik Bakaran, perencanaan pemasaran Threads, AI marketing assistant, dan integrasi bot Telegram.

Karakter utama project:

- Entry point web: `server.js`
- Entry point Telegram bot: `telegram-bot.js`
- Modul AI/database bersama: `lib/agent.js`
- Frontend web: HTML/CSS/JS inline di `server.js`
- Database: PostgreSQL
- Runtime: Node.js `>=24`
- Tidak ada build step, TypeScript app, lint config, atau test suite formal

## 2. Cara Menjalankan

```bash
npm start        # node server.js
npm run bot      # node telegram-bot.js
npm run dev      # node server.js & node telegram-bot.js
```

Catatan:

- Port web default: `3010`, bisa diubah via `PORT`.
- Aplikasi web bind ke `127.0.0.1`.
- Untuk production di balik reverse proxy, pastikan `APP_URL` benar agar CSRF lolos.

## 3. Environment Variables

Wajib/utama:

| Variable | Keterangan |
|---|---|
| `DB_USER` | User PostgreSQL |
| `DB_PASSWORD` | Password PostgreSQL |
| `DB_NAME` | Nama DB, default `socai` |
| `DB_HOST` | Host DB, default `127.0.0.1` |
| `DB_PORT` | Port DB, default `5432` |

Opsional/penting:

| Variable | Keterangan |
|---|---|
| `SESSION_SECRET` | Secret session. Jika kosong akan auto-generate dan session hilang saat restart |
| `APP_URL` | Origin production untuk CSRF |
| `PORT` | Port web, default `3010` |
| `BRAVE_API_KEY` | Mengaktifkan tool web search AI |
| `TELEGRAM_BOT_TOKEN` | Wajib untuk `telegram-bot.js` |
| `TELEGRAM_SUPER_ADMIN_ID` | ID super admin Telegram, default dari kode |

## 4. Struktur File Penting

```text
.
├── AGENTS.md              # Instruksi project untuk coding agent
├── CODEBASE_WIKI.md       # Dokumentasi codebase ini
├── index.html             # Placeholder statis; Express menangani route utama
├── lib/
│   └── agent.js           # Pool PostgreSQL + setup AI agent + custom tools
├── package.json           # Script dan dependencies
├── public/
│   └── uploads/           # Upload gambar produk/konten
├── server.js              # Web app Express single-file
├── telegram-bot.js        # Bot Telegram Telegraf
└── telegram-users.json    # Daftar user Telegram yang diizinkan
```

## 5. Arsitektur Web (`server.js`)

`server.js` berisi semua logic web:

- Express app setup
- Session PostgreSQL store via `connect-pg-simple`
- CSRF middleware
- Login rate limiting
- Auth middleware `requireLogin`
- Upload image via `multer`
- CRUD produk
- CRUD rencana pemasaran
- SSE streaming chat AI
- Halaman HTML inline:
  - `loginPage`
  - `dashboardPage`
  - `produkPage`
  - `pemasaranPage`
  - `asistenPage`

### Security bawaan

- `app.disable('x-powered-by')`
- Session cookie:
  - `httpOnly: true`
  - `sameSite: 'strict'`
  - `secure: true` hanya saat `NODE_ENV=production`
  - `maxAge`: 4 jam
- Password menggunakan `bcryptjs`
- API mutating dilindungi CSRF origin/referer check
- Login rate limit: 5 gagal / 15 menit / IP
- Upload dibatasi 5 MB dan tipe gambar umum
- HTML escaping via `escapeHtml()`

## 6. Database

Database PostgreSQL dipakai oleh web, bot Telegram, dan AI tool.

Schema yang terlihat dari kode:

```sql
-- users
-- id, username, password

-- produk
-- id, nama, harga, stok, gambar, deskripsi, created_at, updated_at

-- pemasaran
-- id, judul, strategi, target_audiens, kanal, jadwal,
-- copywriting, produk_terkait, gambar, status, created_at

-- user_sessions
-- dibuat otomatis oleh connect-pg-simple jika belum ada
```

## 7. Routes Web

| Method | Path | Auth | Fungsi |
|---|---:|---:|---|
| GET | `/` | Tidak | Redirect ke `/login` |
| GET | `/login` | Tidak | Halaman login |
| POST | `/login` | Tidak | Autentikasi user |
| GET | `/logout` | Tidak | Destroy session dan abort AI session terkait |
| GET | `/dashboard` | Ya | Dashboard |
| GET | `/produk` | Ya | Halaman produk |
| GET | `/pemasaran` | Ya | Halaman pemasaran |
| GET | `/asisten` | Ya | Halaman AI assistant |
| GET | `/health` | Tidak | Healthcheck JSON |

## 8. API Web

### Produk

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/produk` | List produk |
| GET | `/api/produk/:id` | Detail produk |
| POST | `/api/produk` | Tambah produk |
| PUT | `/api/produk/:id` | Update produk |
| DELETE | `/api/produk/:id` | Hapus produk |

Validasi produk:

- `nama` wajib
- `harga` wajib, numeric, >= 0
- `stok` numeric integer, default 0 jika invalid/negatif
- `gambar` dan `deskripsi` default string kosong

### Upload

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/upload` | Upload file field `gambar` |

Ketentuan:

- Max 5 MB
- Ekstensi/mimetype: jpg, jpeg, png, gif, webp
- Tersimpan di `public/uploads`
- URL hasil: `/uploads/<filename>`

### Pemasaran

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/pemasaran` | List rencana pemasaran, di-sort berdasarkan jadwal bila bisa diparse |
| POST | `/api/pemasaran` | Simpan satu/banyak rencana pemasaran |
| DELETE | `/api/pemasaran/:id` | Hapus rencana |

Normalisasi input pemasaran menerima beberapa bentuk:

- Array langsung
- `rencana_mingguan`
- `rencana`
- `plans`
- Object tunggal

`kanal` selalu dipaksa menjadi `threads`.

Proteksi jadwal:

- Mencegah duplikasi jadwal dalam request yang sama
- Mencegah duplikasi jadwal `threads` yang sudah tersimpan

### AI Assistant

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/asisten` | Chat AI dengan SSE streaming |

Perilaku:

- Wajib login
- Body: `{ "message": "..." }`
- Jika AI session belum ada, init lazy dan kirim progress SSE
- Session key memakai `req.sessionID` atau user id
- Saat client close, agent di-abort

## 9. Modul AI (`lib/agent.js`)

`lib/agent.js` mengekspor:

- `pool`: PostgreSQL pool
- `agentSessions`: Map session AI aktif
- `agentSessionLastUsed`: Map timestamp last used
- `agentSessionPromises`: Map init promise agar tidak double-init
- `touchAgentSession(sessionKey)`
- `initAgent(sessionKey)`

AI agent:

- Framework: `@earendil-works/pi-coding-agent`
- Model: `opencode/deepseek-v4-flash-free`
- Session: `SessionManager.inMemory()`
- TTL idle session: 4 jam
- Cleanup idle tiap 15 menit

### Custom tool AI

#### `db_query`

Fungsi: membaca database produk/pemasaran.

Batasan keamanan:

- Hanya query yang diawali `SELECT`
- Multi-statement ditolak
- Keyword berbahaya ditolak: `DROP`, `DELETE`, `INSERT`, `UPDATE`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`
- Hanya tabel `produk` dan `pemasaran`
- JOIN tidak diizinkan
- Panjang query max 1000 karakter
- Output dibatasi 50 row

#### `web_search`

Fungsi: riset internet via Brave Search API.

- Aktif hanya jika `BRAVE_API_KEY` tersedia
- Mengambil maksimal 8 hasil
- Berguna untuk tren batik, strategi marketing, harga pasar, dsb.

### System prompt AI

AI diarahkan sebagai asisten automation Batik Bakaran dengan fokus:

- Perencanaan konten pemasaran
- Riset tren
- Copywriting
- Analisis prioritas produk
- Kanal default: **Threads**
- Untuk rencana umum: output 7 hari / 1 minggu
- Untuk wizard Telegram tertentu: output tepat 1 konten
- Saat membuat rencana, wajib cek jadwal pemasaran yang sudah ada dulu
- Akhiri rencana pemasaran dengan blok JSON valid untuk auto-save

## 10. Bot Telegram (`telegram-bot.js`)

Bot memakai Telegraf dan berbagi `pool` + AI session dari `lib/agent.js`.

### Access control

- `TELEGRAM_SUPER_ADMIN_ID` menjadi super admin
- `telegram-users.json` menyimpan daftar user yang diizinkan
- `/start`, `/help`, `/whoami` tetap terbuka agar user bisa meminta akses
- Command lain ditolak jika user belum terdaftar

### Command Telegram

| Command | Fungsi |
|---|---|
| `/start` | Intro bot |
| `/help` | Bantuan |
| `/whoami` | Lihat user id/chat id |
| `/status` | Status DB dan AI session |
| `/listproduk` | List produk |
| `/buatkonten` | Wizard konten marketing |
| `/tambahproduk` | Wizard tambah produk |
| `/batal` | Batalkan wizard |
| `/adduser <id>` | Super admin: tambah user |

### Fitur bot

- Chat bebas ke AI assistant
- Simpan rencana pemasaran dari JSON AI ke database
- Wizard konten marketing
- Wizard tambah produk
- Upload/download foto Telegram
- Penyimpanan gambar lokal dan opsi Cloudinary dari bagian kode terkait
- Callback action seperti `save_produk`, `cancel_produk`, `save_plan`

## 11. Frontend Web

Tidak ada frontend build. Semua HTML/CSS/JS berada di `server.js`.

Halaman utama:

- Login: form username/password
- Dashboard: ringkasan/navigasi
- Produk: CRUD produk + upload gambar
- Pemasaran: daftar/simpan/hapus rencana pemasaran
- Asisten: chat AI dengan SSE stream

Implikasi maintenance:

- Perubahan UI dilakukan langsung di template literal `server.js`
- Hati-hati XSS; gunakan `escapeHtml()` untuk data yang masuk ke HTML
- Tidak ada bundler/minifier

## 12. Gotcha Penting

- Node harus `>=24` sesuai `package.json`.
- AI init lazy: request pertama `/api/asisten` bisa lambat.
- Jika `SESSION_SECRET` tidak diset, session hilang saat restart.
- `APP_URL` wajib benar di production untuk CSRF.
- `index.html` bukan entry point utama web app.
- Upload file berada di filesystem lokal; pastikan direktori persistent saat deployment.
- Bot Telegram butuh `TELEGRAM_BOT_TOKEN`; tanpa itu process bot exit.
- `npm run dev` menjalankan dua process dengan shell background, bukan dev server terkelola.
- Tidak ada test suite; verifikasi minimal pakai `node --check server.js`, `node --check telegram-bot.js`, dan smoke test manual.

## 13. Checklist Operasional Singkat

Sebelum production:

- Set `NODE_ENV=production`
- Set `SESSION_SECRET` kuat dan stabil
- Set `APP_URL=https://domain`
- Pastikan reverse proxy meneruskan host/proto yang benar
- Pastikan PostgreSQL reachable dan credential valid
- Pastikan `public/uploads` persistent dan permission benar
- Pastikan process manager menjalankan `npm start` dan `npm run bot` jika bot dipakai
- Monitor `/health`
- Backup database PostgreSQL rutin
- Backup `telegram-users.json` jika bot dipakai

## 14. Checklist Security Singkat

- Jangan commit `.env`.
- Pastikan upload hanya image dan direktori upload tidak mengeksekusi script.
- Review semua output user-generated di HTML inline.
- Pertahankan parameterized query `$1`, `$2`, dst.
- Pertahankan pembatasan `db_query` SELECT-only.
- Rate limit login sudah ada, tapi pertimbangkan persistence/Redis jika multi-instance.
- Gunakan HTTPS di production agar cookie `secure` efektif.

## 15. Integrasi Repliz Schedule

Status: **P1–P4 implemented / web scheduling basic ready** — helper Repliz, tracking schema DB, endpoint schedule/retry, dan tombol UI di halaman pemasaran sudah tersedia. User sudah mengisi env Repliz dan akun Threads `batikbakarannusantara` connected.

### P0 Prasyarat Repliz — hasil cek 2026-06-04

Checklist Worker P0 tanpa menampilkan secret:

- `.env`: sudah memiliki placeholder aman untuk `REPLIZ_API_KEY`, `REPLIZ_SECRET`, `REPLIZ_ACCOUNT_ID`, `REPLIZ_BASE_URL`.
- `REPLIZ_API_KEY`: variable ada; credential perlu diisi user jika kosong.
- `REPLIZ_SECRET`: variable ada; credential perlu diisi user jika kosong.
- `REPLIZ_ACCOUNT_ID`: variable ada; credential perlu diisi user jika kosong.
- `REPLIZ_BASE_URL`: variable ada dengan default `https://api.repliz.com`.
- `APP_URL`: set/non-empty; penting untuk membentuk URL gambar publik dari `/uploads/...`.
- `.env.example`: sudah ditambahkan placeholder aman untuk `REPLIZ_API_KEY`, `REPLIZ_SECRET`, `REPLIZ_ACCOUNT_ID`, `REPLIZ_BASE_URL`.
- Dokumentasi OpenAPI Repliz `https://api.repliz.com/public-json`: bisa diakses.
- Endpoint akun untuk validasi credential: `GET /public/account?page=1&limit=20&type=threads`, auth HTTP Basic.
- Validasi credential live ke Repliz: dilewati karena credential belum tersedia; perlu user mengisi env.
- `public/uploads`: ada, owner/group `ubuntu:ubuntu`, permission dasar `drwxrwxr-x+`.
- Status git: direktori kerja ini tidak terdeteksi sebagai repository git, sehingga perubahan belum commit tidak bisa dinilai via `git status`.
- Operasional: sebelum P1/implementasi DB, lakukan backup PostgreSQL manual; Worker tidak melakukan backup otomatis.


Tujuan integrasi: menghubungkan rencana konten pemasaran kanal **Threads** di tabel `pemasaran` ke Repliz API Schedule agar konten dapat dijadwalkan/publish lewat akun Threads yang sudah terkoneksi di Repliz.

### Endpoint Repliz yang dianalisis

Dokumentasi publik OpenAPI Repliz (`https://api.repliz.com/public-json`) menunjukkan:

- Auth: HTTP Basic Auth (`securitySchemes.basic`). Asumsi implementasi: username = `REPLIZ_API_KEY`, password = `REPLIZ_SECRET` sampai dikonfirmasi oleh dashboard/dokumentasi Repliz.
- List account: `GET https://api.repliz.com/public/account?page=1&limit=20&type=threads`
- Create schedule: `POST https://api.repliz.com/public/schedule`
- Get/list schedule: `GET /public/schedule`
- Retry failed schedule: `PUT /public/schedule/{scheduleId}/retry`
- Delete schedule: `DELETE /public/schedule/{scheduleId}`

Payload minimal create schedule untuk Threads text post:

```json
{
  "title": "",
  "description": "Caption/copywriting Threads",
  "topic": "Batik Bakaran",
  "type": "text",
  "medias": [],
  "meta": { "title": "", "description": "", "url": "" },
  "additionalInfo": {
    "isAiGenerated": true,
    "isDraft": false,
    "collaborators": [],
    "music": { "id": "", "artist": "", "name": "", "thumbnail": "" },
    "products": [],
    "tags": [],
    "mentions": []
  },
  "replies": [],
  "accountId": "<REPLIZ_THREADS_ACCOUNT_ID>",
  "scheduleAt": "2026-06-04T05:17:53.948Z"
}
```

Catatan konfirmasi sebelum implementasi:

- Pastikan format Basic Auth Repliz benar untuk API key + secret.
- Pastikan `scheduleAt` harus UTC ISO-8601 dan batas minimal waktu scheduling.
- Pastikan field media untuk Threads image: OpenAPI schema menampilkan `type` number enum `0/1`, tetapi contoh memakai string `"image"/"video"`; perlu uji smoke dengan akun Repliz.
- Pastikan gambar lokal `/uploads/...` bisa diakses publik via `APP_URL`; Repliz membutuhkan URL publik untuk media.

### Implementasi P1/P2

Environment Repliz yang digunakan:

| Variable | Fungsi |
|---|---|
| `REPLIZ_API_KEY` | API key Repliz untuk Basic Auth |
| `REPLIZ_SECRET` | Secret Repliz untuk Basic Auth |
| `REPLIZ_ACCOUNT_ID` | Account ID Threads target dari Repliz |
| `REPLIZ_BASE_URL` | Default `https://api.repliz.com` |
| `REPLIZ_DEFAULT_TOPIC` | Opsional; default payload `Batik Bakaran` |
| `REPLIZ_SYNC_INTERVAL_MS` | Opsional; interval polling status Repliz, default `300000`, set `0` untuk disable |

Helper baru: `lib/repliz.js`.

Export yang tersedia:

- `isReplizConfigured()` — true jika API key, secret, dan account ID tersedia.
- `replizFetch(path, options)` — wrapper `fetch` native Node 24 dengan HTTP Basic Auth, timeout default 30 detik, parsing JSON aman, dan error message tanpa secret.
- `getThreadsAccounts({ page, limit })` — `GET /public/account?...&type=threads`.
- `buildThreadsSchedulePayload(plan, options)` — membuat payload schedule Threads:
  - `type: "text"` jika tanpa gambar; `type: "image"` jika ada URL gambar valid.
  - `title` dari `judul`/`title`.
  - `description` dari `copywriting`, fallback `strategi`/`description`.
  - `topic` default `Batik Bakaran`.
  - `accountId` dari env atau `options.accountId`.
  - `scheduleAt` dari `options.scheduleAt`, `plan.scheduled_at`, atau `plan.repliz_scheduled_at`; throw error jelas jika invalid.
  - menyertakan `meta`, `additionalInfo`, dan `replies` sesuai struktur OpenAPI Repliz.
- `createThreadsSchedule(plan, options)` — `POST /public/schedule` menggunakan payload helper.

Schema DB Repliz diinisialisasi aman saat startup `server.js` via `ALTER TABLE IF EXISTS` dan `CREATE UNIQUE INDEX IF NOT EXISTS`; tidak menghapus data lama.

```sql
ALTER TABLE IF EXISTS pemasaran
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS repliz_schedule_id text,
  ADD COLUMN IF NOT EXISTS repliz_status text,
  ADD COLUMN IF NOT EXISTS repliz_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS repliz_last_error text,
  ADD COLUMN IF NOT EXISTS repliz_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS repliz_attempts integer DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS pemasaran_repliz_schedule_id_uq
  ON pemasaran (repliz_schedule_id)
  WHERE repliz_schedule_id IS NOT NULL;
```

### Implementasi P3/P4

Endpoint web/API yang sudah ada di `server.js`:

- `POST /api/pemasaran/repliz/schedule` — bulk schedule beberapa rencana sekaligus, body `{ "ids": [1, 2, 3] }`, maksimal 20 id.
- `POST /api/pemasaran/:id/repliz/schedule` — menjadwalkan satu rencana pemasaran ke Repliz.
- `POST /api/pemasaran/:id/repliz/retry` — mencoba ulang rencana dengan status error.
- `POST /api/pemasaran/:id/repliz/sync` — mengambil status terbaru dari `GET /public/schedule/{scheduleId}` dan memperbarui status lokal.

Endpoint tersebut:

- wajib login (`requireLogin`);
- dilindungi CSRF karena berada di `/api`;
- memakai helper `createThreadsSchedule()` dari `lib/repliz.js`;
- validasi Repliz env lengkap, kanal `threads`, caption/copywriting tidak kosong, jadwal bisa diparse, dan double schedule dicegah jika `repliz_schedule_id` sudah ada;
- menyimpan `repliz_status`, `repliz_schedule_id`, `repliz_scheduled_at`, `repliz_synced_at`, `repliz_last_error`, `repliz_attempts`, serta status lokal `scheduled`/`error`.

Parser jadwal server mendukung minimal:

- `2026-06-05 19:00`
- `5 Juni 2026 jam 19:00`
- `5 Juni 2026 pukul 19:00`

UI halaman `/pemasaran` yang sudah ada:

- kolom badge Repliz (`Belum`, `syncing`, `pending`, `error`, `success` jika sudah tersinkron);
- checkbox pilihan rencana dan tombol `Bulk Jadwalkan Repliz` untuk menjadwalkan beberapa rencana sekaligus;
- tombol `Jadwalkan Repliz` untuk rencana yang belum dijadwalkan;
- tombol `Retry Repliz` jika status error;
- tombol `Sync Status` jika sudah punya `repliz_schedule_id`;
- badge dan detail modal menampilkan schedule id/status Repliz, `repliz_scheduled_at`, `repliz_synced_at`, atau error ringkas.

Batasan saat ini: bulk schedule web dasar sudah tersedia, tetapi belum ada bulk retry/cancel. Endpoint/UI list account Repliz dasar tersedia di halaman `/pemasaran` via tombol `Cek Akun Repliz`. Handler Telegram dasar sudah tersedia untuk schedule/retry/cek status. Polling otomatis status Repliz sudah aktif di web server untuk schedule pending/process/scheduled/syncing; interval dikonfigurasi via `REPLIZ_SYNC_INTERVAL_MS` (default 300000 ms, set `0` untuk disable).

Rencana perubahan Telegram bot:

- `telegram-bot.js` sudah mengimpor helper Repliz dan mendaftarkan menu command `/jadwalkan`, `/postnow`, `/retrypost`, tetapi hasil pembacaan kode menunjukkan handler command tersebut belum ada.
- Handler yang perlu dibuat: jadwalkan satu rencana ke Repliz, post now, retry failed post/schedule, dan callback dari rencana tersimpan.
- Tetap pakai helper `lib/repliz.js` agar logic tidak duplikat.

Error handling, retry, logging:

- Klasifikasi error: env missing, jadwal invalid, account not found, Repliz 4xx, Repliz 5xx/network timeout.
- Untuk 4xx: jangan auto-retry kecuali setelah data diperbaiki.
- Untuk 5xx/timeout: izinkan retry manual; simpan `repliz_attempts`, `repliz_last_error`, `repliz_synced_at`.
- Logging server hanya metadata non-secret: pemasaran id, schedule id, status code, error message ringkas.
- Jangan log Authorization header, API key, secret, atau full payload jika mengandung data sensitif.

Security handling:

- Jangan membaca/menampilkan nilai `.env` di log/UI.
- Validasi URL media agar tidak menjadi SSRF helper; untuk tahap awal hanya izinkan URL dari `APP_URL` atau `https://` trusted.
- Pertahankan session auth dan CSRF middleware untuk semua mutasi.
- Batasi endpoint akun Repliz hanya admin/login; jangan expose secret ke frontend.

Acceptance criteria:

- Jika env Repliz kosong, UI/API memberi pesan konfigurasi belum lengkap tanpa crash.
- Admin bisa menjadwalkan rencana Threads text ke Repliz dan DB menyimpan `repliz_schedule_id` + status.
- Double-click/two requests untuk rencana yang sama tidak membuat dua schedule.
- Jadwal invalid/past menghasilkan error validasi yang jelas.
- Error Repliz tersimpan di DB dan tombol retry tersedia.
- Secret tidak muncul di stdout, response API, HTML, atau log.

Smoke test manual:

1. `node --check server.js`, `node --check telegram-bot.js`, dan jika ada file baru `node --check lib/repliz.js`.
2. Login web, buka `/pemasaran`, buat rencana Threads dengan jadwal masa depan.
3. Klik `Jadwalkan ke Repliz`; pastikan response sukses dan badge berubah pending/scheduled.
4. Cek dashboard Repliz atau `GET /public/schedule` bahwa schedule muncul untuk account Threads yang benar.
5. Klik tombol lagi; pastikan tidak ada schedule duplikat.
6. Uji env missing/dry-run di staging; pastikan error aman dan app tetap berjalan.
7. Jika memakai gambar, pastikan URL media dapat diakses publik oleh Repliz.

## 16. Dokumentasi Pekerjaan Worker Setelah Lolos QA

Bagian ini mencatat status pekerjaan implementasi worker yang sudah direview/lolos QA dokumentasi pada pembaruan Wiki ini.

### Worker Repliz P1/P2 — foundation helper + schema tracking

Status hasil QA: **lolos pemeriksaan statis dasar**.

Yang sudah ada di codebase:

- `lib/repliz.js` berisi helper Repliz terpusat:
  - konfigurasi dari `REPLIZ_API_KEY`, `REPLIZ_SECRET`, `REPLIZ_ACCOUNT_ID`/`REPLIZ_THREADS_ACCOUNT_ID`, `REPLIZ_BASE_URL`;
  - Basic Auth tanpa mengekspos secret;
  - timeout request default 30 detik;
  - parser response JSON/text;
  - `getThreadsAccounts()`;
  - `buildThreadsSchedulePayload()`;
  - `createThreadsSchedule()`.
- `server.js` menjalankan `initPemasaranReplizSchema()` saat startup untuk menambah kolom tracking Repliz pada tabel `pemasaran` dan unique partial index `pemasaran_repliz_schedule_id_uq`.
- `telegram-bot.js` juga memastikan kolom marketing tambahan tersedia melalui `ensureMarketingSchema()` saat bot start.
- `.env.example` sudah memiliki placeholder Repliz dan Cloudinary.

Verifikasi QA statis yang dilakukan:

```bash
node --check server.js
node --check telegram-bot.js
node --check lib/repliz.js
```

Hasil: command selesai tanpa output error.

Catatan batasan setelah QA P3/P4:

- Belum ada worker/background job otomatis yang mengambil rencana `pemasaran` dan menjadwalkannya ke Repliz tanpa klik user.
- Belum ada bulk schedule.
- Belum ada endpoint UI untuk memilih/list account Repliz; account id masih dari env.
- Belum ada sinkronisasi status final `success/posted` dari Repliz setelah schedule berjalan.
- Menu command Telegram untuk `/jadwalkan`, `/postnow`, `/retrypost`, `/cekpost`, `/jadwalkonten`, `/statuskonten`, `/ubahstatuskonten`, `/hapuskonten` sudah tercantum/tersedia. Handler dasar Repliz Telegram memakai helper yang sama dengan web.
- QA live create schedule Repliz sudah dilakukan pada 2026-06-04 untuk `pemasaran.id=15`; Repliz mengembalikan schedule id `6a21298a59582c0656b65e0a` dengan status lokal `pending`.

Rekomendasi pekerjaan worker berikutnya:

1. Verifikasi schedule id `6a21298a59582c0656b65e0a` muncul di dashboard Repliz akun Threads `batikbakarannusantara`.
2. Smoke test Telegram command `/jadwalkan <id>`, `/retrypost <id>`, dan `/cekpost <id>` dari user allowlisted. Bot sudah direstart pada 2026-06-04 dan command menu berhasil disinkronkan.
3. Monitor polling otomatis status Repliz di log server; interval sudah bisa diatur via `REPLIZ_SYNC_INTERVAL_MS`.
4. Tambahkan endpoint/list account opsional untuk admin jika nanti perlu memilih akun Repliz dari UI.
5. Tambahkan worker otomatis hanya setelah flow approval manual stabil.

## 17. Alur Kerja Sub-agent Project

Ekstensi project-local berada di `.pi/extensions/subagents.ts`.

Command sub-agent:

- `/wiki` — dokumentasi codebase
- `/analis` — analisis/rencana/bug analysis
- `/worker` — implementasi
- `/qa` — review hasil
- `/security` — audit keamanan
- `/ops` — deployment/operasional

Workflow rekomendasi:

```text
Fitur baru:     /analis -> /worker -> /qa
Bug:            /analis -> /worker -> /qa
Dokumentasi:    /wiki
Audit security: /security -> /worker -> /qa
Deployment:     /ops
```
