# Logbook — Sesi Pengembangan socai.my.id

**Tanggal:** 17 Juni 2026  
**Proyek:** socai.my.id — Batik Bakaran (Node.js + PostgreSQL + AI Agent + Repliz/Threads)  
**Konteks penelitian:** *Autonomous AI Agent untuk Otomasi Konten Media Sosial*

---

## Ringkasan Sesi

Sesi ini melanjutkan pekerjaan P2 (maintainability & fitur) setelah Sprint 1 selesai. Fokus utama: menyelesaikan Sprint 2, refactor arsitektur web (Sprint 3), hardening CSP, perbaikan bug interaktivitas UI, QA, dan evaluasi kesesuaian dengan judul penelitian.

---

## 1. Penyelesaian Sprint 2 P2

### Masalah yang ditemukan
Worker paralel menulis ulang `lib/telegramAccess.js` versi simplified yang **tidak kompatibel** dengan `telegram-bot.js` (API `getRole`, `listUsers`, role `operator`/`viewer` hilang).

### Perbaikan
- **`lib/telegramAccess.js`** — implementasi lengkap: role hierarchy `super_admin` > `operator` > `viewer`, migrasi `allowed_user_ids[]`, return shape `{ok, reason, ...}` untuk add/remove.
- **`test/telegramAccess.test.js`** — diperbarui untuk role `operator`/`viewer`.
- Verifikasi: **32 tests pass**, systemd `socai-node` & `socai-bot` active.

### Fitur Sprint 2 yang di-commit (`0d6e88c`)
| ID | Item | Status |
|----|------|--------|
| P2-7 | Logout POST + CSRF (`lib/csrfToken.js`) | ✅ |
| P2-5 | Telegram roles + `/removeuser` `/listusers` | ✅ |
| P2-4 | Automated tests (`npm test`, 7 file test) | ✅ |
| — | `AGENTS.md` diperbarui | ✅ |

---

## 2. Sprint 3 P2 — Refactor `server.js` + CSP Nonce

### Tujuan
Pecah monolit `server.js` (~2.690 baris) dan aktifkan Content-Security-Policy dengan nonce.

### Hasil (`fe7f302`)
- **`server.js`** → **~140 baris** (bootstrap + shutdown + Repliz background jobs).
- Struktur baru **`lib/web/`**: `createApp.js`, `middleware/`, `routes/`, `views/`, `replizJobs.js`.
- CSP: per-request nonce via `cspNonceMiddleware`; `<script>` dan `<style>` memakai atribut `nonce`.

---

## 3. CSP Hardening — Hapus `unsafe-inline` dari `style-src`

### Permintaan
Pindahkan inline styles ke CSS classes agar `style-src` tidak perlu `'unsafe-inline'`.

### Perubahan (`ba3df1b`)
- Kelas CSS baru di views: `.login-error`, `.value-online`, `.hidden`, `.table-status`, `.repliz-toolbar`, dll.
- Toggle preview upload memakai `classList` bukan `element.style.display`.
- `style-src` sekarang hanya `'self'` + nonce.

---

## 4. Audit `/asisten` — Bug CSP `script-src-attr`

### Temuan QA
- Backend `/api/asisten` dan AI agent berfungsi.
- **Bug kritis:** `script-src-attr 'none'` memblokir semua `onclick`/`onkeydown` di HTML → tombol kirim, chip saran, dan hamburger **tidak jalan**.

### Perbaikan (`64b242c`)
- Buat **`lib/web/views/pageInit.js`** — shared `HAMBURGER_BIND_JS`.
- Ganti semua inline handler dengan `addEventListener` + event delegation (`data-action`/`data-id`) di:
  - `asisten.js`, `dashboard.js`, `produk.js`, `pemasaran.js`
- Perbaiki race SSE di `api/asisten.js`: hapus timeout 500ms, tambah safety net 10 menit.

---

## 5. QA Check

### Automated
- `npm test` — **32/32 pass** (berkelanjutan sepanjang sesi).
- Dibuat **`test/qa-smoke.mjs`** — smoke test CSP, views, HTTP endpoints (`c673c40`).

### Manual / HTTP
| Cek | Hasil |
|-----|-------|
| `/health` (lokal & production) | OK, DB latency ~12–15ms |
| CSP header | `script-src-attr 'none'`, tanpa `unsafe-inline` |
| Auth `/asisten` tanpa login | 401 |
| CSRF `/api/asisten` tanpa Origin | 403 |
| AI streaming (xiaomi/mimo-v2.5-pro) | `text_delta` + `agent_end` OK |

### Belum diuji (butuh login manual)
- E2E browser: kirim pesan di `/asisten`, CRUD produk, aksi Repliz di UI.

---

## 6. Konfigurasi Read-Only & Model AI

### Database read-only (`db_query`)
| Item | Nilai |
|------|-------|
| User | `socai_ai_read` |
| Status | Aktif (`dbReadOnlyConfigured: true`) |
| Akses | SELECT hanya `produk` & `pemasaran` |

### Model AI (web & Telegram — identik di `.env`)
| Prioritas | Model |
|-----------|-------|
| Primary | `xiaomi/mimo-v2.5-pro` |
| Fallback 1 | `xiaomi/mimo-v2.5` |
| Fallback 2 | `opencode/deepseek-v4-flash-free` |

**Seleksi:** Web memakai `AI_MODEL*`; Telegram mencoba `TELEGRAM_AI_MODEL*` dulu, lalu chain web.

---

## 7. Evaluasi Kesesuaian Judul Penelitian

**Judul:** *Autonomous AI Agent untuk Otomasi Konten Media Sosial*

### Kesimpulan (~60–70% sesuai)
| Aspek | Penilaian |
|-------|-----------|
| AI Agent (tool-based, Threads, copywriting) | ✅ Kuat |
| Autonomous end-to-end | ⚠️ Lemah — human-in-the-loop di simpan/jadwal/publish |
| Otomasi konten | ⚠️ Menengah — auto-schedule Repliz ada, agent tidak act langsung |
| Media sosial (jamak) | ⚠️ Scope: Threads via Repliz saja |
| Read-only DB | ✅ Tepat sebagai governance layer |

### Rekomendasi penelitian
1. Definisikan **tingkat autonomi** (assistive → supervised → bounded autonomous).
2. Pertahankan read-only; tambah **actuator terkontrol** + logging evaluasi.
3. Instrumentasi: log `agent_runs`, metrik keberhasilan jadwal/konten.
4. Opsional: mode `AUTONOMY_MODE`, cron rencana mingguan, perluas kanal.

---

## 8. Operasional

- **Subagent/worker:** Semua task worker selesai; tidak ada subagent aktif di akhir sesi.
- **Proses sisa:** Beberapa `node -e` QA background dihentikan (SIGTERM) — bukan subagent.
- **Layanan:** `socai-node` & `socai-bot` active sepanjang sesi setelah restart.

---

## Commit pada Sesi Ini

| Commit | Pesan |
|--------|-------|
| `0d6e88c` | Sprint 2 P2: logout CSRF, Telegram roles, automated tests |
| `fe7f302` | Sprint 3 P2: refactor server.js into lib/web/ and enable CSP nonce |
| `ba3df1b` | Remove style-src unsafe-inline; move inline styles to CSS classes |
| `64b242c` | fix(web): replace inline event handlers for CSP script-src-attr |
| `c673c40` | test: add QA smoke checks for CSP, views, and HTTP endpoints |

---

## Backlog / Lanjutan

| Prioritas | Item |
|-----------|------|
| P1 | Smoke test manual pasca-login (`/asisten`, produk, pemasaran) |
| P1 | Instrumentasi penelitian (`agent_runs`, metrik evaluasi) |
| P2 | Naikkan autonomi: tool/pipeline save→schedule terkendali |
| P2 | Cron generate rencana mingguan + notifikasi approve Telegram |
| P3 | Refactor `telegram-bot.js` dengan pola `lib/web/` |
| P3 | CI pipeline untuk `npm test` + `qa-smoke.mjs` |

---

## Catatan

- Log error historis `ensureSessionCsrfToken` di journal (~16:03) sudah resolved sebelum sesi berlangsung.
- `saveBtn.onclick = ...` di asisten.js **CSP-safe** (JS property, bukan atribut HTML).
- Framing judul alternatif yang lebih presisi: *"AI Agent Terkendali untuk Perencanaan dan Orkestrasi Konten Threads pada UMKM"*.

---

# Logbook — Sesi 1 Agustus 2026 (Audit & Sprint Remediasi)

**Tanggal:** 1 Agustus 2026
**Konteks:** Audit menyeluruh proyek → penyusunan `sprint-plan.md` (Sprint 0–7) → eksekusi Sprint 0 & Sprint 1.
**Aturan sprint:** implementasi → test hijau → update docs → commit scoped → push → CI/CD hijau.

---

## Sprint 0 — Baseline, Plan & Fix CI Blocker (A9)

### Hasil
- **`sprint-plan.md`** dibuat (238 baris): temuan audit A1–A9, aturan main, CI/CD, Sprint 0–7, timeline, risiko.
- **Baseline**: `npm run test:ci` hijau (77 test + QA smoke).

### CI Blocker ditemukan (A9)
- Run CI pertama di GitHub Actions **failure** pada step `npm ci`.
- Root cause: `package-lock.json` berisi **123 URL `http://mirrors.tencentyun.com`** (registry mirror lokal di `~/.npmrc`) — tidak bisa diakses dari GitHub runner.
- Perbaikan (`cd43a3a`): semua URL diganti ke `https://registry.npmjs.org` (versi & integrity hash tidak berubah) → **CI hijau**.

### Commit Sprint 0
| Commit | Pesan |
|--------|-------|
| `6e10946` | docs: add audit sprint plan (S0 baseline) |
| `cd43a3a` | fix(ci): regenerate package-lock against registry.npmjs.org; document A9 in sprint plan |

---

## Sprint 1 — Fix Login 500 & Rate-Limit Telegram (A1, A2)

### Temuan Audit
- **A1 (P1)**: `POST /login` tanpa Content-Type form → HTTP 500 (`TypeError: req.body undefined`), terkonfirmasi di journal produksi.
- **A2 (P2)**: Pesan rate-limit Telegram menampilkan "undefined" (`rate.retryAfterSec` tidak ada; yang benar `retryAfterMs`).

### Perbaikan
- **`lib/web/routes/auth.js`** — `const { username, password } = req.body || {};` → request non-form/tanpa body jatuh ke validasi biasa (200 loginPage), bukan 500.
- **`telegram-bot.js`** — `Math.ceil(rate.retryAfterMs / 1000)` untuk teks "Coba lagi dalam N detik".
- **`lib/agent.js`** — interval cleanup sesi agent di-`unref()` agar tidak menahan proses hidup (perlu untuk test route tanpa hang).
- **`test/routes.test.js`** (baru) — test route level pertama: `POST /login` non-form & tanpa body → bukan 500.

### Verifikasi
- `npm test`: **79/79 pass** (sebelumnya 77) · `npm run test:ci`: hijau.
- Curl reproduksi vs server temp: `text/plain` & tanpa body → **HTTP 200** (sebelumnya 500).

### Commit
| Commit | Pesan |
|--------|-------|
| `167c35b` | fix(web): handle login POST without form body (no 500); fix telegram rate-limit retry text |

---

## Sprint 2 — Upgrade Dependensi & Audit Fix (A3)

### Hasil
- **`@earendil-works/pi-coding-agent` 0.79.6 → 0.83.0**: `undici` 8.3.0→8.5.0 & `ws` 8.20.1→8.21.0 (keduanya keluar dari range vuln).
- **`npm audit fix`**: `express` → 5.2.1, `multer` → 2.2.0, `body-parser` → 2.3.0 (semua fix).
- **Sisa 1 high (brace-expansion 5.0.7 nested via minimatch)**: diselesaikan dengan `overrides: { "brace-expansion": "5.0.9" }` di package.json.
- **Kendala unik**: override tidak efektif selama `node_modules/.package-lock.json` (hidden lockfile) masih mencatat 5.0.7 — dibersihkan + regenerate lockfile → **`npm audit --omit=dev`: 0 vulnerabilities**.
- Lockfile baru bersih dari URL mirror Tencent (0 refs).

### Breaking change API (0.83.0) & Adaptasi
- `AuthStorage` & `ModelRegistry` **tidak lagi diexport** dari `@earendil-works/pi-coding-agent`; `createAgentSession` options mengganti `authStorage`/`modelRegistry` dengan `modelRuntime`.
- Adaptasi `lib/agent.js`:
  - `ModelRuntime.create({ allowModelNetwork: false })` menggantikan `AuthStorage.create()` + `ModelRegistry.create(authStorage)`.
  - `modelRuntime.getModel(provider, modelId)` menggantikan `modelRegistry.find(...)`.
  - `createAgentSession({ ..., modelRuntime, ... })`.
- Verifikasi: smoke test `initAgent` sukses — memilih `xiaomi/mimo-v2.5-pro` (auth dari env `XIAOMI_API_KEY` terbaca), AgentSession ter-create.

### Verifikasi
- `npm test`: **79/79 pass** · `npm run test:ci`: hijau.
- `npm audit --omit=dev`: **0 vulnerabilities**.

### Commit
| Commit | Pesan |
|--------|-------|
| `ee2c981` | chore(deps): bump @earendil-works/pi-coding-agent to 0.83.0; npm audit clean |

---

## Sprint 3 — Konsistensi Timezone WIB (+07:00) (A4)

### Temuan Audit
- Server produksi memakai `Asia/Shanghai (+8)`, sementara logika app mengasumsikan WIB (+7):
  - `parseMarketingSchedule("5 Juni 2026 jam 19:00")` menghasilkan **18:00 WIB** (salah 1 jam).
  - Slot `getCalendarGaps` tidak konsisten antara label/scheduled_at vs instant slot → deteksi slot terisi bisa miss (duplikat jadwal).

### Perbaikan
- **`lib/wibTime.js`** (baru) — helper WIB eksplisit:
  - `wibDate(y, m, d, hh, mm)` → `Date.UTC(..., hh-7, ...)` (bulan 1-based).
  - `getWibParts(date)` → komponen WIB via `Intl` `timeZone: 'Asia/Jakarta'`.
  - `wibSlotKey(date)`, `formatWibScheduledAt(date)` (`+07:00`), `formatWibLabel(date)`.
- **`lib/pemasaran.js`** — `parseMarketingSchedule`: kedua branch teks (ISO-like & Indonesia) memakai `wibDate` (catatan: `bulanIndonesia` 0-based → +1).
- **`lib/actuator/calendar.js`** — `getCalendarGaps`: slot dibangun dari komponen WIB (`wibDate(nowWib..., +i, preferredHour)`), `slotKey` = `wibSlotKey` (zona sama untuk parsing & slot), `rangeEnd`/`startToday` berbasis WIB.
- **Test**: `test/wibTime.test.js` (baru, 9 test) + update `test/pemasaran.test.js` (3 test WIB eksplisit) — total +9.

### Ops / Docs
- **`deploy/socai-node.service` & `deploy/socai-bot.service`** — template unit systemd dengan `Environment=TZ=Asia/Jakarta`.
- **`deploy/README.md`** — runbook deploy/update/rollback + contoh vhost Apache (termasuk `RequestHeader unset X-Forwarded-Host` untuk Sprint 5).
- `AGENTS.md`, `README.md` — catatan TZ & deploy.

### Verifikasi
- `node --test test/wibTime.test.js test/pemasaran.test.js`: **16/16 pass**.
- Parsing konsisten di TZ server apa pun (test memakai instant UTC absolut).

### Commit
| Commit | Pesan |
|--------|-------|
| `edc5bb1` | fix(schedule): explicit WIB (+07:00) parsing and calendar slots; add deploy units |

---

## Sprint 4 — Hardening XSS di Views (A5)

### Temuan Audit
- `asisten.js:407` — `saveBtn.innerHTML = '❌ ' + err.message` → `err.message` dari `POST /api/pemasaran` bisa memuat konten AI/user (mis. pesan duplikat jadwal menyertakan `plan.jadwal`) → stored/self-XSS.
- `evaluasi.js:223` — `grid.innerHTML = ... + err.message` (risiko serupa, lebih rendah).
- `produk.js:358` — `p.stok` tanpa escape (risiko minimal, numerik).

### Perbaikan
- **`asisten.js`** — semua teks dinamis pindah ke `textContent`: error message, `savedText`, label tombol.
- **`evaluasi.js`** — node error dibangun dengan `createElement` + `textContent` + `replaceChildren`; `renderTable` kini memakai `esc()` (nilai dari server seperti `autonomy_mode` di-escape).
- **`produk.js`** — `esc(p.stok)`.
- **`qa-smoke.mjs`** — 6 pattern check baru (A5): setiap view source tidak boleh punya `innerHTML` concat dinamis atau `.message` di `innerHTML` → mencegah regresi.

### Verifikasi
- `npm test`: **88/88 pass**; `npm run test:ci`: QA PASSED termasuk 6 cek A5 baru.
- Sweep `grep`: tidak ada `innerHTML = '...' + expr` tersisa; sisa hanya string statis / nilai ter-escape.

### Commit
| Commit | Pesan |
|--------|-------|
| `66b24ce` | fix(web): escape dynamic error text in asisten/evaluasi/produk views |

---
## Sprint 5 — Hardening CSRF & Trust Proxy (A6)

### Temuan Audit
- `createCsrfProtection` memasukkan `requestBaseUrl` (dari Host header) dan `forwardedBaseUrl` (dari `X-Forwarded-Host/Proto` yang dikirim client — Apache hanya `set X-Forwarded-Proto`, tidak menghapus header masuk) ke allowed origins → origin asing bisa lolos CSRF check.
- `app.set('trust proxy', true)` mempercayai semua proxy (X-Forwarded-For/Proto dari luar).

### Perbaikan
- **`lib/web/middleware/csrf.js`** — allowed origins hanya `http://localhost:<port>`, `http://127.0.0.1:<port>`, dan `APP_URL`. Header `Host`/`X-Forwarded-*` tidak lagi dipercaya.
- **`lib/web/createApp.js`** — `trust proxy: 'loopback'` (hanya percaya proxy di 127.0.0.1).
- **`test/csrfMiddleware.test.js`** (baru, 8 test) — termasuk regresi: spoof `X-Forwarded-Host` & `Host` dengan Origin asing → 403; tanpa Origin → 403; `APP_URL`/localhost → diteruskan; GET → skip.
- Contoh vhost Apache di `deploy/README.md` sudah memuat `RequestHeader unset X-Forwarded-Host` (Sprint 3).

### Verifikasi
- `node --test test/csrfMiddleware.test.js`: **8/8 pass**; `npm run test:ci`: **96/96 + QA PASSED**.
- Live (server temp):
  - Origin `https://evil.example` → **403**
  - Origin evil + `X-Forwarded-Host: https://socai.my.id` → **403** (sebelum fix: CSRF lolos → 401)
  - Origin `http://127.0.0.1:3111` → 401 (CSRF lolos, belum login — benar)
  - Tanpa Origin → **403**

### Commit
| Commit | Pesan |
|--------|-------|
| `10d8f8d` | fix(security): tighten CSRF origin check and trust proxy to loopback |

---

## Sprint 6 — Test Route Level (A7)

### Temuan Audit
- Bug A1 (login 500) lolos dari suite karena belum ada test level route; cakupan test hanya unit modul + QA smoke.

### Perbaikan
- **`test/routes.test.js`** diperluas dari 2 → 9 test (node:test + `app.listen(0)` + fetch, tanpa database):
  - Regresi A1: `POST /login` non-form & tanpa body → bukan 500.
  - `GET /health` → shape JSON (`status`, `checks.database`) — menerima 200/503 (503 saat DB down).
  - `GET /api/produk` tanpa session → 401 JSON.
  - `POST /logout` tanpa session → 401 (bukan 500).
  - CSRF e2e: `POST /api/produk` tanpa Origin → 403; Origin asing → 403.
  - `GET /` → 302 redirect `/login`; `GET /login` → 200 halaman login.
- `test/qa-smoke.mjs` tidak perlu perubahan (A5/A6 checks sudah ada).

### Verifikasi
- `node --test test/routes.test.js`: **9/9 pass**; `npm run test:ci`: **103/103 + QA PASSED**.

### Commit
| Commit | Pesan |
|--------|-------|
| `543cd32` | test(web): add route-level tests (login body guard, health, auth guard) |

---

## Sprint 7 — Finalisasi Docs, Regression & Release

### Regression penuh
- `npm run test:ci`: **103/103 + QA PASSED**.
- Smoke curl vs server temp (dengan `.env` + DB lokal): health `database ok`, login POST → 200, CSRF spoof → 403, `/produk` & `/pemasaran` → 401 tanpa session.

### A8 — Ops (update 1 Agustus 2026)
- **Token bot Telegram @DBSPresensiBot** — ✅ **dikonfirmasi sengaja** oleh owner (1 Agustus 2026); tidak perlu diganti (`.env` → `TELEGRAM_BOT_TOKEN` dibiarkan).
- **Rotasi `DB_PASSWORD`** — ✅ **diputuskan tidak perlu** oleh owner (1 Agustus 2026); password dibiarkan apa adanya.

### Retrospective (S0–S7)
- **Positif**: CI/CD sekarang benar-benar hijau & melindungi regresi (A1/A5/A6 punya test permanen); `npm audit` 0 vuln; jadwal WIB akurat di TZ server apa pun; docs (`sprint-plan.md`, `logbook.md`, `deploy/`) lengkap.
- **Kendala yang tercatat**: lockfile mirror Tencent (A9) & hidden lockfile npm (S2) — keduanya kini terdokumentasi untuk proyek lain; breaking change `pi-coding-agent` 0.83.0 ditangani via `ModelRuntime`.
- **Backlog jangka panjang**: deploy produksi (restart systemd + verifikasi), A8 ops di atas, tag release berikutnya, evaluasi metrik penelitian M1–M7 setelah AI dipakai di prod.


---

## Deploy Produksi & E2E Verification (lanjutan 1 Agustus 2026)

### Deploy
- Server produksi = `VM-13-18-ubuntu` (repo `/var/www/socai.my.id`, Apache reverse proxy → `127.0.0.1:3010`).
- Kode di server: `e0bc5e3` (semua fix audit S1–S6 + docs). Unit systemd `/etc/systemd/system/socai-*.service` **identik** dengan template `deploy/`.
- `socai-node` & `socai-bot` active; log bersih; bot @DBSPresensiBot terhubung (long polling), commands synced.
- Restart `socai-node` (graceful, <5 dtk) dilakukan untuk memuat fix baru (lihat E2E di bawah).

### E2E (user test sementara, dihapus otomatis setelah selesai)
- Diuji via HTTPS publik `https://socai.my.id` (cookie session `Secure` di production — pengujian lewat `http://127.0.0.1` akan gagal 401; ini perilaku benar).
- Hasil: **semua jalur hijau** — login 302, 5 halaman autentikasi 200 dengan 0 inline handler (CSP), produk CRUD (GET/POST 201/PUT/GET/DELETE), upload PNG magic-byte valid + file tersaji 200, pemasaran POST/DELETE, `/api/channels`, `/api/agent/runs`, `/api/agent/metrics`, SSE `/api/asisten` (agent init → `text_delta` → `done`), `agent_runs.status=completed`, logout + `_csrf` → 302.
- Sisa data E2E = 0 (users/produk/pemasaran/agent_runs/file upload).

### Temuan & Fix (E2E)
- **Bug P3 (fixed)**: `POST /logout` dengan session tapi tanpa `Content-Type` form → `req.body` undefined → **HTTP 500** (pola sama dengan A1). Fix: guard `req.body?._csrf` di `lib/web/routes/auth.js:84` → kini 302 (tanpa destroy session). Catatan: `res.status(403).redirect()` menimpa status menjadi 302 — keamanan tetap terjaga (session tidak di-destroy); tidak ada test route untuk kasus ini karena harness `routes.test.js` tanpa DB/session.
- Observasi: `GET /dashboard` setelah logout → 401 JSON untuk klien non-browser (`req.accepts('json')`); browser tetap dapat redirect `/login`.

### Commit
| Commit | Pesan |
|--------|-------|
| `c7c27c2` | docs: record A8 decision (bot token intentional); update sprint checklists S0/S7 |
| `e0bc5e3` | docs: record A8 decision - DB password rotation not needed (owner, 1 Aug 2026) |
| (berikutnya) | fix(web): guard logout CSRF body (no 500); docs: deploy & E2E verification |

---

## Vertical Slicing — Fase 0: Ekstraksi DB Pools (1 Agustus 2026, lanjutan)

### Tujuan
Mulai restrukturisasi per fitur (vertical slicing): potong coupling terbesar — `lib/agent.js` (AI agent) tidak lagi memegang PostgreSQL pools.

### Perubahan (kode)
- **`lib/shared/db.js` (baru)** — `pool`, `aiReadPool`, `resolveAiReadPoolCredentials()` (fallback `DB_USER` + warning), `closeAgentPools()`. Aturan: shared infra, **tidak boleh import dari `lib/features/`**.
- **`lib/agent.js`** — hapus definisi pools (import `pg` ikut dihapus); kini import `{ pool, aiReadPool }` dari `./shared/db.js`.
- **11 importer diupdate**: `server.js`, `telegram-bot.js`, `lib/agentRunner.js`, `lib/web/createApp.js`, `lib/web/replizJobs.js`, `lib/web/routes/auth.js`, `lib/web/routes/health.js`, `lib/web/routes/api/{produk,pemasaran,agentRuns,asisten}.js`, `lib/autonomousJobs.js` (3 dynamic import).

### Verifikasi
- `npm run test:ci` → **103/103 unit + QA PASSED**.
- Satu kali gagal di tengah: `lib/web/routes/api/asisten.js` masih import `pool` dari `agent.js` (import multi-line terlewat) → `SyntaxError: does not provide an export named 'pool'` → diperbaiki.
- `grep` final: tidak ada sisa `import ... pool ... from '...agent.js'`; sisa import `agent.js` hanya export session/agent (`agentSessions`, `initAgent`, dll) — sudah benar.

### Docs
- `AGENTS.md` (tabel arsitektur + env `DB_*`), `README.md` (tree `lib/shared/` + prinsip shared core), `CODEBASE_WIKI.md` (tree, prinsip §4, §7, changelog), `sprint-plan.md` (Sprint 8 checklist + timeline).

### Commit
| Commit | Pesan |
|--------|-------|
| `ea6f555` | `refactor(db): extract pool/aiReadPool to lib/shared/db.js (vertical slicing F0)` |

### Catatan untuk fase berikutnya
- F1: pindahkan shared murni ke `lib/shared/` (`wibTime`, `rateLimit`, `mediaUrl`, `imageFile`, `html`, `repliz`, `telegramNotify`) + co-located test.
- `telegramNotify.js` wajib ke `shared/` (dipakai agent + telegram — mencegah cycle di fase telegram).

---

## Vertical Slicing — Fase 1: Shared Infra Murni (1 Agustus 2026, lanjutan)

### Tujuan
Pindahkan modul shared murni (tanpa ketergantungan fitur) ke `lib/shared/`; mulai co-located test.

### Perubahan (kode)
- **7 modul pindah ke `lib/shared/`**: `wibTime.js`, `rateLimit.js`, `mediaUrl.js`, `imageFile.js`, `html.js` (dari `lib/web/`), `repliz.js`, `telegramNotify.js`.
- **±20 importer diupdate** (views → `../../shared/html.js`; routes API → `../../../shared/*.js`; `telegram-bot.js` → `./lib/shared/*.js`; `lib/` root → `./shared/*.js`; test tersisa → `../lib/shared/*.js`).
- `lib/shared/telegramNotify.js` kini import `'../telegramAccess.js'` (ACL tetap di `lib/` sampai F8).
- **Co-located test**: `lib/shared/test/wibTime.test.js` (import `../wibTime.js`, `../../pemasaran.js`, `../../actuator/calendar.js`) & `lib/shared/test/mediaUrl.test.js` (import `../mediaUrl.js`); `package.json` test glob → `node --test "test/**/*.test.js" "lib/shared/**/*.test.js"`.
- `test/qa-smoke.mjs` path check `lib/telegramNotify.js` → `lib/shared/telegramNotify.js`.

### Kendala & pelajaran
- **`html.js` bukan di `lib/` tapi `lib/web/`** — import view harus `../../shared/html.js` (bukan `../shared/html.js`); dikoreksi setelah grep verifikasi.
- **Race condition antar-perintah paralel**: `git mv` + `sed` + `grep` di batch yang sama saling menimpa (sed/grep jalan sebelum move selesai; `lib/shared/test/` belum dibuat → rantai `git mv` gagal). Pelajaran: operasi file berurutan (mv → sed → verifikasi) wajib satu command chain.

### Verifikasi
- `npm run test:ci` → **103/103 + QA PASSED** (satu kali gagal: qa-smoke path `lib/telegramNotify.js` → diperbaiki).

### Commit
| Commit | Pesan |
|--------|-------|
| `dd6f002` | `refactor(shared): move pure shared modules to lib/shared/ (vertical slicing F1)` |

---

## Vertical Slicing — Fase 2: Fitur `channels` (1 Agustus 2026, lanjutan)

### Tujuan
Fitur pertama masuk pola `lib/features/` — membuktikan vertical slicing (domain + test co-located).

### Perubahan (kode)
- **5 file → `lib/features/channels/`**: `index.js`, `registry.js`, `threads.js`, `instagram.js`, `prompt.js`.
- Import internal: `threads.js`/`instagram.js` → `'../../shared/repliz.js'` (relatif baru di `lib/features/channels/`).
- **11 importer diupdate**: `lib/agent.js`, `lib/env.js`, `lib/evaluationMetrics.js`, `lib/health.js`, `lib/pemasaran.js`, `lib/publishFeedback.js`, `lib/actuator/calendar.js`, `lib/web/replizJobs.js`, `lib/web/routes/api/{channels,repliz}.js`.
- **`env.js` + `CHANNEL_IDS`**: pengecualian terdokumentasi — `env.js` (bootstrap validator, bukan `lib/shared/`) import dari `lib/features/channels/index.js`; konstanta `CHANNEL_IDS` tetap satu sumber di fitur (tanpa duplikasi).
- **Co-located test**: `test/channels.test.js` → `lib/features/channels/test/channels.test.js` (import `../index.js`, `../prompt.js`, `../../../env.js`); glob `npm test` + `"lib/features/**/*.test.js"`; `qa-smoke.mjs` path list → `lib/features/channels/*`.
- **Test count turun 103 → 90** saat glob belum diupdate (test channels tidak dijalankan) → glob diupdate → **103/103**.

### Kendala & pelajaran
- **Race condition paralel terulang** (git mv vs sed berjalan bersamaan) — pola sama dengan F1; dieksekusi ulang sekuensial. Pelajaran ditegaskan: batch shell yang saling bergantung (mv → sed → verifikasi) **wajib satu command chain**, jangan diparalelkan.
- **Test count menurun tanpa disadari** jika glob test tidak mengikuti pemindahan test — selalu bandingkan jumlah test sebelum/sesudah.

### Verifikasi
- `npm run test:ci` → **103/103 + QA PASSED**.

### Commit
| Commit | Pesan |
|--------|-------|
| `4c1b516` | `refactor(channels): move channels feature to lib/features/ (vertical slicing F2)` |

---

## Vertical Slicing — Fase 3: Fitur `auth` + `dashboard` (1 Agustus 2026, lanjutan)

### Tujuan
Fondasi keamanan (login/logout/CSRF/rate limit) masuk pola fitur; dashboard ikut sekalian.

### Perubahan (kode)
- **`lib/features/auth/`**: `requireLogin.js` (dari `lib/web/middleware/auth.js`), `csrfToken.js` (dari `lib/csrfToken.js`), `loginRateLimit.js`, `routes.js` (GET/POST `/login`, POST/GET `/logout`), `view.js` (`loginPage`), `index.js` (public API), `test/csrfToken.test.js` (co-located).
- **`lib/features/dashboard/`**: `view.js` (`dashboardPage`) + `index.js`.
- **`lib/shared/layout.js` + `lib/shared/pageInit.js`** — UI infra lintas fitur (sidebar + hamburger bind). **Penyimpangan dari rencana awal** (rencana: tetap di web shell): dashboard view butuh `sidebarHTML`/`HAMBURGER_BIND_JS`, dan aturan arah dependency melarang feature → web-shell — solusi: pindah ke `lib/shared/` (semua 4 view lain diupdate ke `'../../shared/{layout,pageInit}.js'`).
- **Importer diupdate**: `createApp.js` (loginRateLimiter, registerAuthRoutes, loginPage), `pages.js` (csrfToken, requireLogin, dashboardPage), 7 route API (`requireLogin` → `'../../../features/auth/requireLogin.js'`), `qa-smoke.mjs` (import + VIEW_SOURCES paths), 4 views (`produk`, `pemasaran`, `asisten`, `evaluasi`).
- Test count stabil: 103/103 (csrfToken.test pindah, glob features sudah mencakup).

### Kendala & pelajaran
- **Race condition paralel ke-3 kalinya** (git mv vs sed) — pola sama; dieksekusi ulang sekuensial. Sudah dicatat sebagai aturan main wajib.
- **Edit docs keliru**: sekali edit menghapus baris `env.js` di tree CODEBASE_WIKI (harusnya hapus `csrfToken.js`) — terdeteksi lewat `sed -n` verifikasi, diperbaiki. Pelajaran: verifikasi hasil edit tree setelah batch.

### Verifikasi
- `npm run test:ci` → **103/103 + QA PASSED**.
- `grep` final: tidak ada sisa import `middleware/auth.js`, `routes/auth.js`, `views/{login,dashboard,layout,pageInit}.js`.

### Commit
| Commit | Pesan |
|--------|-------|
| `318a3be` | `refactor(auth): move auth + dashboard features to lib/features/ (vertical slicing F3)` |

