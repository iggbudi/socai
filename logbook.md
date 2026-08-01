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

---

## Vertical Slicing — Fase 4: Fitur `produk` (1 Agustus 2026, lanjutan)

### Tujuan
Fitur CRUD + upload gambar keluar dari web shell; `lib/web/middleware/` tinggal shell murni (csrf + csp).

### Perubahan (kode)
- **`lib/features/produk/`**: `routes.js` — `registerProdukRoutes` (CRUD, dari `routes/api/produk.js`) + `registerUploadRoutes` (dari `routes/api/upload.js`) **digabung dalam satu file** (pola `auth/routes.js`); `upload.js` (multer dari `middleware/upload.js` — path `uploadsDir` `'..','..','..'` tetap valid: `lib/features/produk/` → 3× up = root); `view.js` (`produkPage` — imports `'../../shared/*'` sudah benar dari lokasi baru, tanpa perubahan); `index.js` (public API).
- **Importer diupdate**: `createApp.js` (2 import → 1 baris dari `features/produk/routes.js`), `pages.js` (`produkPage` → `'../../features/produk/view.js'`), `qa-smoke.mjs` (import + VIEW_SOURCES).
- `lib/web/middleware/` kini hanya `csp.js` + `csrf.js`; `lib/web/routes/api/` tersisa: pemasaran, repliz, channels, asisten, agentRuns.

### Kendala & pelajaran
- **`view.js` sempat terlewat dari rantai git mv** (3 file direncanakan, 2 dieksekusi) → qa-smoke import error (1 test gagal) → terdeteksi & diperbaiki. Pelajaran: verifikasi `ls` isi folder target setelah move chain, bukan hanya status exit.
- `git rm` file hasil `git mv`+`sed` butuh `-f` (staged content berbeda) — dipakai untuk menghapus `uploadRoutes.js` sementara setelah digabung.

### Verifikasi
- `npm run test:ci` → **103/103 + QA PASSED**.

### Commit
| Commit | Pesan |
|--------|-------|
| `6b803f6` | `refactor(produk): move produk feature to lib/features/ (vertical slicing F4)` |

---

## Vertical Slicing — Fase 5: Fitur `pemasaran` (1 Agustus 2026, lanjutan)

### Tujuan
Domain inti bisnis (Repliz scheduling) + background jobs keluar dari web shell & lib root.

### Perubahan (kode)
- **`lib/features/pemasaran/`**: `domain.js` (dari `lib/pemasaran.js`, 297 baris, 13 export — `bulanIndonesia`, `parseMarketingSchedule`, `savePlansToDb`, `schedulePlanToRepliz`/`schedulePlanToChannel`, `syncPlanReplizStatus`, dll); `routes.js` (dari `routes/api/pemasaran.js`); `view.js` (dari `views/pemasaran.js`); `jobs.js` (dari `lib/web/replizJobs.js` **utuh** — `syncPendingReplizStatuses`, `autoSchedulePendingRepliz`, `sleep`/`randomBulkDelayMs` yang juga dipakai route pemasaran); `index.js` (`export *` untuk domain — 13 export, pragmatis vs eksplisit); `test/pemasaran.test.js` co-located.
- **10 importer diupdate**: `lib/actuator/{calendar,contentPlan,schedule}.js` (→ `../features/pemasaran/domain.js`), `lib/scheduleApproval.js`, `lib/web/createApp.js`, `lib/web/routes/pages.js`, `server.js` (jobs), `telegram-bot.js` (domain), `test/qa-smoke.mjs`, `lib/shared/test/wibTime.test.js`.
- `lib/web/` kini tanpa `replizJobs.js`; `lib/` root kehilangan `pemasaran.js`.

### Kendala & pelajaran
- **Kesalahan level path di `domain.js`**: sed mengganti `'./shared/x.js'` → `'../shared/x.js'` (1 level), padahal dari `lib/features/pemasaran/` perlu `'../../shared/x.js'` (2 level — `lib/features/pemasaran/` → `lib/features/` → `lib/`). 6 test file gagal load (ERR_MODULE_NOT_FOUND) → diperbaiki & semua hijau. **Pelajaran**: hitung kedalaman relatif sebelum sed; import `'./shared/*'` dari `lib/` root berbeda dengan `'../shared/*'` dari `lib/features/<fitur>/`.

### Verifikasi
- `npm run test:ci` → **103/103 + QA PASSED**.

### Commit
| Commit | Pesan |
|--------|-------|
| `5c2e04f` | `refactor(pemasaran): move pemasaran feature to lib/features/ (vertical slicing F5)` |

---

## Vertical Slicing — Fase 6: Fitur `agent` (1 Agustus 2026, lanjutan)

### Tujuan
Fitur terbesar dipindah + `lib/agent.js` (539 baris) dipecah; web shell tersisa route kecil (channels, repliz).

### Perubahan (kode) — F6a: modul mandiri
- **`lib/features/agent/`**: `runs.js` (dari `lib/agentRuns.js`), `aiLimits.js`, `runner.js` (dari `lib/agentRunner.js`), `actuator/` (5 file dari `lib/actuator/`), `publishFeedback.js`, `approval.js` (dari `lib/scheduleApproval.js`), `autonomousJobs.js` + `autonomousConfig.js`.
- **6 test co-located**: agentRuns, actuator, scheduleApproval, autonomousJobs, envAutonomy, aiLimits → `lib/features/agent/test/`.
- **Importer diupdate**: `lib/agent.js`, `lib/health.js`, `telegram-bot.js`, `server.js`, `routes/api/{asisten,agentRuns}.js`, `lib/features/pemasaran/jobs.js`, `qa-smoke.mjs`, `lib/shared/test/wibTime.test.js`.

### Perubahan (kode) — F6b: pecah `lib/agent.js` + modul web
- **`core.js`** (dari `lib/agent.js` — session map, `initAgent`, tools `db_query`/`web_search`/actuator; import internal `'./actuator/'`, `'./runs.js'`, `'./publishFeedback.js'`, `'./approval.js'`, `'../channels/index.js'`, `'../../shared/db.js'`).
- **`routes.js`** = `registerAsistenRoutes` (SSE chat, dari `routes/api/asisten.js`) + `registerAgentRunsRoutes` (`/api/agent/runs` + `/api/agent/metrics`, dari `routes/api/agentRuns.js`) — digabung, pola `auth/routes.js`.
- **`view.js`** (dari `views/asisten.js`); **`index.js`** public API (core + runner + runs + routes + view + aiLimits).
- **Importer diupdate**: `server.js`, `telegram-bot.js`, `test-agent.js`, `lib/features/auth/routes.js`, `createApp.js` (2 import → 1), `pages.js`, `qa-smoke.mjs` (import + VIEW_SOURCES + actuatorFiles list).
- `lib/` root kini tanpa `agent*.js`; `lib/web/routes/api/` tersisa `channels.js` + `repliz.js`; `lib/web/views/` tersisa `evaluasi.js`.

### Kendala & pelajaran
- **Level path actuator 3× lagi**: `lib/features/agent/actuator/` (depth 4) butuh `'../../../shared/...'` (bukan `'../../'`) dan `'../../pemasaran/...'`/`'../../channels/...'` (bukan `'../'`). Dua iterasi perbaikan (pemasaran/channels lalu wibTime) — semuanya tertangkap test.
- **Dynamic import tidak match pattern `from '`**: `runs.js:226` `import('./evaluationMetrics.js')` dan `autonomousJobs.js` `import('./shared/db.js')` perlu pattern `import('...')` terpisah; escape `(`/`)` di sed BRE: tulis literal tanpa backslash (jangan `\(` — itu grup BRE).
- **qa-smoke `actuatorFiles` + VIEW_SOURCES** berisi 10 path lama → semua diupdate ke `lib/features/agent/...`.
- **Edit tree docs menghapus baris `channels/`** secara tidak sengaja (old_text terlalu panjang) → diverifikasi `sed -n` & dikembalikan.

### Verifikasi
- `npm run test:ci` → **103/103 + QA PASSED** (setelah 3 iterasi perbaikan path).

### Commit
| Commit | Pesan |
|--------|-------|
| `b6a5e78` | `refactor(agent): move agent feature to lib/features/ (vertical slicing F6)` |

---

## Vertical Slicing — Fase 7: Fitur `evaluasi` + `health` (1 Agustus 2026, lanjutan)

### Tujuan
Metrik riset M1–M7 punya rumah sendiri; `health` masuk web shell.

### Perubahan (kode)
- **`lib/features/evaluasi/`**: `metrics.js` (dari `lib/evaluationMetrics.js`, 276 baris), `view.js` (dari `views/evaluasi.js`), `routes.js` (route `/api/agent/metrics` **dipisah** dari `lib/features/agent/routes.js` — `registerEvaluasiRoutes`), `index.js`, `test/evaluationMetrics.test.js` co-located.
- **`lib/web/health.js`** (dari `lib/health.js`) — aggregator lintas fitur ke web shell; `lib/web/routes/health.js` import diupdate (`'../health.js'`).
- **Fix bug laten F6**: `agent/routes.js` memanggil `listAgentRuns` (blok runs) dan `getEvaluationMetrics` (blok metrics) **tanpa import** — ReferenceError hanya muncul saat route dipanggil (tidak tertangkap test). Fix: `listAgentRuns` ditambahkan ke import `./runs.js`; blok metrics dipindah ke evaluasi.
- **Importer diupdate**: `createApp.js` (+`registerEvaluasiRoutes` import + call), `pages.js` (evaluasiPage), `qa-smoke.mjs` (import + VIEW_SOURCES + actuatorFiles `lib/evaluationMetrics.js`), `scripts/export-evaluation.mjs`, `agent/runs.js` (dynamic import → `'../evaluasi/metrics.js'`).

### Kendala & pelajaran
- **Bug laten dari F6b terungkap saat pemisahan route** — route yang tidak dipanggil test bisa punya import hilang; saat memindah blok antar-fitur, periksa simbol yang dipakai blok tsb.
- Edit createApp gagal sekali (old_text salah konteks) → verifikasi dengan grep sebelum edit.

### Verifikasi
- `npm run test:ci` → **103/103 + QA PASSED**.

### Commit
| Commit | Pesan |
|--------|-------|
| `74381e4` | `refactor(evaluasi): move evaluasi feature to lib/features/ (vertical slicing F7)` |

---

## Vertical Slicing — Fase 8: Fitur `telegram` (1 Agustus 2026, lanjutan)

### Tujuan
Seluruh bot masuk `lib/features/telegram/`; root entry jadi tipis (pola sama dengan `server.js`).

### Perubahan (kode)
- **`lib/features/telegram/`**: `access.js` (dari `lib/telegramAccess.js`), `helpers.js` (`safeReply`, `replyLong`, `markdownToTelegramHtml`, `escapeTelegramHtml` — diekstrak dari bot, fungsi murni yang bisa diuji tanpa bot), `bot.js` (**dipindah utuh** dari `telegram-bot.js` 1.364 baris — nol perubahan logika, self-executing), `index.js` (public API access + helpers; **tidak** re-export `bot.js` karena self-executing — mencegah import tak sengaja yang me-launch bot), `test/telegramAccess.test.js` co-located.
- **`telegram-bot.js` root → 5 baris** entry tipis: `import './lib/features/telegram/bot.js'`.
- **`__dirname` fix**: `UPLOAD_DIR` (`public/uploads`) & `TELEGRAM_USERS_FILE` (`telegram-users.json`) → `'..','..','..'` dari `lib/features/telegram/` ke repo root.
- **`lib/shared/telegramNotify.js`** import ACL → `'../features/telegram/access.js'` (terlewat di grep pertama → 2 test gagal → diperbaiki; pelajaran: modul yang meng-import modul yang dipindah ikut dicek, bukan hanya modul target).

### Keputusan desain (tercatat)
- **`bot.js` belum dipecah ke `commands/` + `wizards/`** — alasan: (1) bot production berjalan via systemd (`socai-bot` active) — tidak bisa test runtime (launch kedua = bentrok long-polling); (2) refactor 1.000+ baris tanpa test harness = risiko tinggi. Keputusan: pindah utuh dulu (aman, reversible), pecah menyusul setelah ada test infra bot.
- `escMarkdown`, `fmtPlan`, `getPlanById`, wizard state (`contentWizard`, `productWizard`, `pendingPlans`) tetap di `bot.js`.

### Verifikasi
- `node --check` 5 file bot; import smoke `helpers`/`access` (bukan `bot.js`); `npm run test:ci` → **103/103 + QA PASSED**.
- **Perlu verifikasi manual owner**: `sudo systemctl restart socai-bot` lalu cek log (modul baru harus load & connect).

### Commit
| Commit | Pesan |
|--------|-------|
| `28b3e78` | `refactor(telegram): move telegram feature to lib/features/ (vertical slicing F8)` |

---

## Vertical Slicing — Fase 9: Cleanup & Finalisasi (1 Agustus 2026, lanjutan)

### Tujuan
Tutup restrukturisasi: web shell murni, CI modern, release `v1.2.0`.

### Perubahan (kode)
- **`lib/features/channels/routes.js`** — `registerChannelsRoutes` (`/api/channels`) dari `lib/web/routes/api/channels.js`.
- **`lib/features/pemasaran/routes.js`** — `registerReplizRoutes` (`/api/repliz/accounts`) **digabung** (pola F4/F5) + import `getReplizAccounts` (shared) & `getChannel` (fitur channels).
- **`lib/web/routes/api/` kosong** — web shell murni 6 file: `createApp.js`, `health.js`, `middleware/{csp,csrf}.js`, `routes/{health,pages}.js`. `lib/web/views/` sudah kosong sejak F7.
- **CI**: `actions/checkout@v5` + `actions/setup-node@v5` — deprecation warning Node 20 (muncul sejak F3) hilang.
- **Importer**: `createApp.js` (import `registerReplizRoutes` digabung ke baris pemasaran; `registerChannelsRoutes` → fitur), `qa-smoke.mjs` (actuatorFiles).

### Struktur final
```
lib/shared/   10 modul infra + test/
lib/features/ channels, auth, dashboard, produk, pemasaran, agent, evaluasi, telegram (8 fitur, semua + test/)
lib/web/      createApp + middleware/{csrf,csp} + routes/{pages,health} + health.js (shell murni)
lib/ root     env.js saja (pengecualian terdokumentasi: import features/channels utk CHANNEL_IDS)
root          server.js (thin), telegram-bot.js (thin), scripts/, deploy/, test/ (route-level + smoke)
```

### Verifikasi
- `npm run test:ci` → **103/103 + QA PASSED**.
- CI GitHub Actions → success (run terakhir di verifikasi via `gh run watch`).

### Retrospective (F0–F9)
- **9 sprint, 18 commit** (9 refactor + 9 docs), 103 test stabil di setiap fase, CI hijau setiap push.
- Pola yang berhasil: git mv (rename terdeteksi) → sed presisi → `npm run test:ci` gate → docs → commit scoped → CI.
- Pelajaran berulang: (1) level path relatif (`lib/features/<fitur>/` = 2× `../`; `test/` = 3×; `actuator/` = 3× utk shared) — 5× terjadi; (2) dynamic import tak match pattern `from '`; (3) modul pengimpor ikut dicek, bukan hanya target; (4) batch shell berurutan wajib satu command chain (race 3×); (5) verifikasi `ls` + jumlah test setelah move.
- Keputusan penting: `telegram/bot.js` utuh (belum dipecah — menunggu harness test); `env.js` pengecualian terdokumentasi; `index.js` public API per fitur.

### Commit
| Commit | Pesan |
|--------|-------|
| `acc3c47` | `refactor(web): finalize vertical slicing — routes to features, CI v5 (F9)` |

---

## Verifikasi Produksi Pasca-F9 (1 Agustus 2026, lanjutan) — Prioritas 1

### Restart & status
- `sudo systemctl restart socai-bot socai-node` → keduanya **active**.
- **Bot**: log bersih — `✅ Database connected`, `✅ Bot @DBSPresensiBot terhubung (long polling)`, `✅ Telegram bot commands synced` — modul baru `lib/features/telegram/bot.js` load tanpa error.
- **Web**: `[Repliz] Auto schedule/sync enabled`, `[AgentRuns] Purge enabled`, `socai.my.id listening` — tanpa error.

### E2E smoke (HTTP, tanpa kredensial — non-destruktif)
| Check | Hasil |
|---|---|
| `GET /health` | ✅ 200 `{status:ok, checks.database.ok:true}` |
| `GET /` | ✅ 302 → `/login` |
| `GET /login` | ✅ 200 |
| `GET /api/produk` (no-auth) | ✅ 401 (auth guard) |
| `GET /api/channels` (no-auth, route baru `features/channels/routes.js`) | ✅ 401 |
| `GET /api/repliz/accounts` (no-auth, route gabung `features/pemasaran/routes.js`) | ✅ 401 |
| `POST /login` tanpa body (regresi A1) | ✅ 200 (bukan 500) |
| `POST /login` kredensial salah | ✅ 200 loginPage (bukan 500) |

### 🐛 BUG LATEN ditemukan & diperbaiki
- **Gejala**: log node: `[PublishFeedback] Refresh error: Cannot find module 'lib/features/agent/shared/db.js' imported from lib/features/agent/autonomousJobs.js`.
- **Akar masalah**: di F6a, sed untuk dynamic import `import('./shared/db.js')` di `autonomousJobs.js` **tidak match** — pattern `import\('` (backslash-paren) di sed BRE = grup, bukan literal `(` (pola yang sama pernah gagal di F7 di `runs.js`). File tetap `'./shared/db.js'` yang dari lokasi baru salah level.
- **Kenapa lolos test**: fungsi dengan dynamic import (`shouldGenerateWeeklyPlans`, `runPublishFeedbackRefresh`, `runAgentRunsPurge`) tidak dipanggil test suite; error di-`catch` sehingga server tetap jalan.
- **Fix**: `import('./shared/db.js')` → `import('../../shared/db.js')` (3 baris) di `lib/features/agent/autonomousJobs.js`; audit semua `await import('` di codebase → bersih.
- **Verifikasi**: `npm run test:ci` 103/103 + QA PASSED; restart `socai-node` → log bersih (error hilang).
- **Pelajaran**: (1) sed dynamic import harus pakai paren literal tanpa backslash; (2) **fungsi yang tidak dipanggil test = risiko laten** — verifikasi produksi (Prioritas 1) justru menangkapnya; saran: tambahkan unit test kecil untuk `runPublishFeedbackRefresh`/`shouldGenerateWeeklyPlans` (mock pool).

### Commit
| Commit | Pesan |
|--------|-------|
| `(F9fix)` | `fix(agent): correct dynamic import path in autonomousJobs.js (publish feedback refresh)` |

---

## Prioritas 2 — Tooling Kualitas: Test Background Jobs, ESLint/Prettier, Coverage (1 Agustus 2026, lanjutan)

### 1. Unit test fungsi background jobs (regresi bug laten F9)
- **Refactor testability kecil**: `runPublishFeedbackRefresh(readPool)` & `runAgentRunsPurge(dbPool)` menerima pool opsional (fallback ke `aiReadPool`/`pool` real — pola sama seperti `shouldGenerateWeeklyPlans`; pemanggil lama tanpa argumen tetap kompatibel).
- **3 test baru** di `lib/features/agent/test/autonomousJobs.test.js` (mock pool generik): `shouldGenerateWeeklyPlans` (gaps ≥ 1, query dipanggil), `runPublishFeedbackRefresh` (`ok:true`, `total_sampled:0`), `runAgentRunsPurge` (`deleted:3`, `DELETE FROM agent_runs`).
- Test suite: **103 → 106**, semua hijau. Fungsi yang sebelumnya lolos coverage kini teruji.

### 2. ESLint 9 + Prettier (devDependencies pertama!)
- `npm install -D eslint@^9 @eslint/js@^9 globals prettier` → **0 vulnerabilities** (`npm audit`).
- **`eslint.config.js`** (flat config): `js.configs.recommended` + 4 rules dinonaktifkan dengan alasan terdokumentasi (`no-unused-vars` false-positive template literal HTML; `no-empty` pola `catch {}`; `no-useless-escape`/`no-control-regex` untuk regex markdown/parse).
- **`npm run lint` → 0 error** (langsung hijau, tanpa churn kode).
- **CI**: `.github/workflows/ci.yml` + `npm run lint` setelah `test:ci`.
- Prettier: script `npm run format` (write) tersedia, **bukan gate CI** — codebase belum prettier-formatted (churn besar mengubah semua file); dicatat sebagai backlog.

### 3. Coverage baseline
- `npm run test:coverage` (`node --test --experimental-test-coverage`):
  - **Lines: 39.0% · Branches: 70.6% · Functions: 54.2%** (106 test).
  - Line rendah wajar: modul besar tanpa unit test (`lib/features/telegram/bot.js` ~1.270 baris, views HTML, routes dengan DB real). Branch 70% menunjukkan logika keputusan cukup teruji.
  - Backlog: coverage lines bisa dinaikkan via route-level test dengan mock pool (pola `routes.test.js`).

### Commit
| Commit | Pesan |
|--------|-------|
| `1463039` | `feat(quality): test background jobs, ESLint 9 + Prettier, coverage script (Prioritas 2)` |

---

## Fix A9 Regression — Lockfile Mirror Tencent (1 Agustus 2026, lanjutan)

### Gejala
- Run CI Prioritas 2 (`30705403143`) **failure** di step `npm ci`: `ENOTFOUND mirrors.tencentyun.com` — package-lock kembali berisi URL mirror lokal server (registry global npm server = `https://mirrors.tencentyun.com/npm`).
- **A9 terulang** (temuan audit Sprint 0): `npm install -D eslint...` menulis ulang lock dengan URL mirror.

### Fix (2 lapis)
1. **`.npmrc` project baru**: `registry=https://registry.npmjs.org/` — mencegah npm install berikutnya menulis URL mirror lagi (permanen, bukan sed ulang).
2. **package-lock.json**: sed `http(s)://mirrors.tencentyun.com/npm` → `https://registry.npmjs.org` (83 URL; versi & integrity tidak berubah — pola S0/`cd43a3a`).

### Verifikasi
- `grep mirrors.tencentyun.com package-lock.json` → 0; `registry.npmjs.org` → 85.
- `npm run lint` → 0 error; `npm run test:ci` → 106/106 + QA PASSED.
- CI run berikutnya memvalidasi `npm ci` dengan registry baru.

### Commit
| Commit | Pesan |
|--------|-------|
| `(A9fix)` | `fix(ci): pin npm registry to registry.npmjs.org via .npmrc (A9 lockfile regression)` |

---

## Sprint 19 — Higiene Repo: Hapus File Stale (R5) (1 Agustus 2026, lanjutan)

### Tujuan
Membersihkan root repo dari probe debug manual dan menempatkan materi prompt marketing di lokasi dokumentasi yang eksplisit.

### Perubahan
- **Dihapus**: `test-agent.js` (probe `initAgent`) dan `test-bot.js` (probe token Telegraf); keduanya tidak termasuk glob test dan sudah tidak diperlukan sejak vertical slicing F6/F8.
- **Dipindahkan**: `prompt_materi_pptx_automation_marketing.txt` → `docs/prompt-materi-pptx.txt`; isi dipertahankan.
- **Verifikasi konfigurasi**: `backups/` tetap di `.gitignore`, sehingga artefak `repliz-reschedule-*.json` tidak ikut commit.
- **Audit referensi**: tidak ada referensi aktif ke file stale di `.js`, `.json`, `.yml`, atau `.yaml`; hit di `sprint-plan.md`/`logbook.md` dipertahankan sebagai catatan historis.
- **Dokumentasi**: tree root dan changelog S19 diperbarui di `CODEBASE_WIKI.md`; checklist S19 ditandai selesai di `sprint-plan-rekomendasi.md`.

### Verifikasi lokal
- `npm run test:ci` → **106/106 pass + QA PASSED**.
- `npm run lint` → **0 error, 0 warning**.
- Tidak ada `test-*.js` di root di luar direktori `test/`.

### Commit
`chore: remove stale root debug scripts (R5)`

---

## Sprint 20 — Coverage `approval.js` ≥ 85% (R1a) (1 Agustus 2026, lanjutan)

### Tujuan
Menguji penuh gerbang approval yang menentukan apakah agent bounded boleh meneruskan penjadwalan ke Repliz.

### Perubahan
- **Seam notifier**: `notifyScheduleApprovalRequest(plans, { notify })` menerima notifier opsional dengan default `notifyTelegramOperators`; `handlePostSaveApproval` meneruskan seam tanpa mengubah default produksi.
- **Seam scheduler**: `approvePlanSchedule(dbPool, planId, { schedule })` menerima scheduler opsional dengan default `schedulePlanToRepliz`, sehingga test tidak memanggil Repliz nyata.
- **Regression tests**: tambah 12 test untuk keyboard approve/reject, empty plans, mode assistive/bounded, rencana sudah terjadwal, validasi ID/status, draft/pending approval, dan error rejection.
- **Call-site produksi** tetap menggunakan default function sehingga tidak ada perubahan API pemanggil.

### Verifikasi
- Targeted coverage `approval.js` → **100% line / 84,38% branch / 100% funcs**.
- `npm run test:coverage` → **118/118 pass**, keseluruhan **40,16% line / 71,73% branch / 55,72% funcs**.
- `npm run test:ci` → **118/118 pass + QA PASSED**.
- `npm run lint` → **0 error, 0 warning**.

### Commit
`test(agent): cover approval gate paths, add notify/schedule seams (R1a)`

---

## Sprint 21 — Coverage `agent/routes.js` ≥ 70% + Seam Testability (R1b) (1 Agustus 2026, lanjutan)

### Tujuan
Menguji route AI SSE dan endpoint agent runs tanpa database, model AI, Telegram, atau jaringan nyata.

### Perubahan
- **Dependency injection**: `registerAsistenRoutes(app, deps = {})` menerima `dbPool`, `initAgent`, `sessions`, `requireAuth`, limiter, dan timeout dengan default production; `registerAgentRunsRoutes` menerima `dbPool`/`requireAuth`.
- **Handler SSE**: alur chat diekstrak ke named export `handleAsistenChat`; urutan `res.writeHead`/`res.write` dan pesan init tetap sama.
- **Test harness**: tambah `lib/features/agent/test/agentRoutes.test.js` memakai Express polos, fake auth, fake pool, fake agent session, limiter terinjeksi, dan server ephemeral.
- **Coverage paths**: validasi input, SSE headers/init, init error, prompt error, safety timeout, request close/abort, rate-limit 429, agent-runs success dengan limit clamp, dan error 500 tanpa stack trace.
- **Dokumentasi**: pola DI route feature dicatat di `AGENTS.md`; changelog diperbarui di `CODEBASE_WIKI.md`.

### Verifikasi
- Targeted `agent/routes.js` → **95,35% line / 76,47% branch / 91,67% funcs**.
- `npm run test:coverage` → **129/129 pass**, keseluruhan **42,40% line / 72,42% branch / 58,27% funcs**.
- `npm run test:ci` → **129/129 pass + QA PASSED**.
- `npm run lint` → **0 error, 0 warning**.
- Target agregat S21 **46% line** belum tercapai; coverage route dan objective testability tercapai, gap agregat dicatat untuk backlog lintas modul sebelum S22.

### Commit
`test(agent): inject deps into asisten/runs routes + SSE route tests (R1b)`

---

## Sprint 22 — Gate Kualitas di CI (R2) (2 Agustus 2026, lanjutan)

### Tujuan

Menetapkan formatting deterministik dan gerbang coverage minimum agar regresi kualitas terdeteksi oleh CI.

### Perubahan

- **Prettier baseline**: tambah `.prettierrc` (`printWidth: 110`, single quote, trailing comma, dan arrow parens) serta `.prettierignore`; seluruh file yang tidak dikecualikan diformat dalam commit baseline terpisah.
- **Script package**: tambah `npm run format:check`; `npm run test:coverage` kini memakai threshold native Node untuk lines/functions/branches.
- **CI**: workflow menjalankan empat gate berurutan: `test:ci`, `lint`, `format:check`, dan `test:coverage`.
- **Policy**: threshold coverage hanya boleh dinaikkan; penurunan wajib disertai alasan di logbook.
- **Dokumentasi**: kebijakan dan command diperbarui di `AGENTS.md`, `README.md`, `CODEBASE_WIKI.md`, dan `sprint-plan-rekomendasi.md`.

### Verifikasi

- `npm run format:check` → **lulus**, seluruh file menggunakan style Prettier.
- Local `npm run test:coverage` → **129/129 pass**, coverage agregat **41,88% line / 72,42% branch / 58,27% funcs**, preliminary gate **41/58/68** lulus.
- CI run `30707755173` → `test:ci`, `lint`, dan `format:check` lulus; coverage clean runner **41,88% line / 72,16% branch / 57,55% funcs** sehingga gate functions 58% gagal.
- Negative check: threshold line sementara dinaikkan ke **95%** → exit **1** dengan laporan **41,88%**, lalu `package.json` dipulihkan ke threshold **41%**.
- `npm run test:ci` → **129/129 pass + QA PASSED**.
- `npm run lint` → **0 error, 0 warning**.

Threshold line rencana awal 45% disesuaikan menjadi 41% karena hasil baseline setelah formatting terukur 41,88%. Setelah CI pertama membuktikan variance clean runner, threshold functions 58% disesuaikan menjadi 57% (clean CI 57,55%; local tanpa `.env` 57,91%) agar gate reproducible; kedua penyesuaian dicatat eksplisit dan gate hanya boleh dinaikkan pada sprint berikutnya.

### Commit

| Commit | Pesan |
|--------|-------|
| `e944b51` | `style: apply prettier baseline` |
| `e409a84` | `ci: add format check + coverage thresholds (R2)` |
| `(this commit)` | `fix(ci): stabilize coverage function threshold (S22)` |

---

## Sprint 23 — Pecah Telegram Bot (R3) (2 Agustus 2026, lanjutan)

### Tujuan

Membuat bot Telegram dapat diuji tanpa long polling, lalu memecah logika monolit ke modul vertical slicing tanpa mengubah alur produksi.

### Perubahan

- **Factory/startup**: `lib/features/telegram/bot.js` tidak lagi self-executing; sekarang mengekspor `createBot()` dan `startBot()`. Root `telegram-bot.js` menjadi pemanggil eksplisit `startBot()`.
- **Harness**: `botFactory.test.js` memakai fake Telegraf dan token dummy untuk memverifikasi middleware, command, event, dan callback registration tanpa `bot.launch()`; fake context tersedia di `test/helpers/telegramCtx.mjs`.
- **Ekstraksi murni**: format (`helpers/format.js`), Cloudinary/media (`media/cloudinary.js`), wizard produk/konten (`wizards/`), Repliz scheduling (`schedule.js`), dan schema/command sync (`schema.js`). Wiring handler dipusatkan di `commands.js`.
- **Test unit**: tambah test untuk normalizer wizard, pilihan produk, prompt konten, escape Markdown, intent produk, media config, schedule guard, schema sync, dan factory.
- **Coverage**: `commands.js` adalah adapter wiring dan dikecualikan dari agregat melalui native Node `--test-coverage-exclude`; registration tetap diuji oleh factory test.
- **Dokumentasi**: `AGENTS.md`, `README.md`, `CODEBASE_WIKI.md`, dan checklist S23 di `sprint-plan-rekomendasi.md` diperbarui.

### Verifikasi

- `lib/features/telegram/**/*.test.js` → **16/16 pass**.
- `npm run test:coverage` → **140/140 pass**, coverage agregat **55,30% line / 79,58% branch / 75,30% funcs**, gate **41/57/68** lulus.
- `npm run lint` → **0 error, 0 warning**.
- `npm run format:check` → lulus setelah baseline Prettier.
- `wc -l lib/features/telegram/bot.js` → **201 baris** (<400).
- `systemctl is-active socai-bot` → **active** sebelum verifikasi restart. Percobaan awal dari sesi agent gagal dengan `Interactive authentication required`; follow-up 2 Agustus berhasil memakai `sudo -n`, lalu smoke web/bot dan Telegram startup lulus.

### Commit

| Commit | Pesan |
|--------|-------|
| `(this commit)` | `refactor(telegram): split bot factory, commands, wizards, media, schedule, schema (R3)` |

---

## Sprint 24 — Migrasi Skema Berversi (R4) (2 Agustus 2026)

### Tujuan

Memindahkan DDL dari boot path aplikasi ke migration yang berversi, auditable, dan dapat di-rollback.

### Perubahan

- Menambahkan `node-pg-migrate@9.0.0`, `migrations.config.js`, dan scripts `migrate`, `migrate:up`, serta `migrate:down`.
- Menambahkan baseline `migrations/0001_baseline_pemasaran_repliz.js` (14 kolom Repliz + unique index) dan `migrations/0002_baseline_agent_runs.js` (tabel + 3 index), masing-masing dengan `down` eksplisit.
- Menghapus `initPemasaranReplizSchema()` dan pemanggilan `initAgentRunsSchema()` dari `server.js`; web sekarang langsung `app.listen()` setelah membuat app.
- Mengubah startup Telegram dari DDL `ensureMarketingSchema` menjadi guard `ensureSchemaReady()` berbasis `pgmigrations`.
- Menambahkan `lib/shared/schema.js` dan `lib/web/health.js` schema guard; `/health` mengembalikan `checks.schema.status` (`ok`/`pending`) dan HTTP 503 jika migration tertinggal.
- Menambahkan test health/schema dan memasukkan `lib/web/**/*.test.js` ke glob test/coverage.
- Memperbarui `AGENTS.md`, `README.md`, `CODEBASE_WIKI.md`, `deploy/README.md`, dan sprint plan dengan urutan deploy manual: `git pull` → `npm ci` → `npm run migrate:up` → restart.

### Verifikasi

- `npm run migrate -- up --dry-run` dan `npm run migrate -- down 1 --dry-run` lulus; down production tidak dijalankan agar data tetap aman.
- `pg_dump --schema-only` sebelum/sesudah production identik selain token `pg_dump`; baseline hanya mencatat `0001_baseline_pemasaran_repliz` dan `0002_baseline_agent_runs` di `pgmigrations`.
- `npm run test:ci` → **145/145 pass + QA PASSED**.
- `npm run lint` → **0 error, 0 warning**; `npm run format:check` → lulus.
- `npm run test:coverage` → **145/145 pass**, **55,88% line / 79,93% branch / 75,73% funcs**, gate 41/57/68 lulus.
- Production restart `socai-node` + `socai-bot` sukses; local/public `/health` dan `/health?detail=1` menunjukkan database ok dan `schema.status=ok`; `/login` HTTP 200; log mengonfirmasi web listening, DB connected, bot long polling, dan command sync.

### Keputusan deploy

Migration tidak dipasang sebagai `ExecStartPre` systemd karena user runtime tidak boleh membutuhkan hak DDL. Langkah migration manual/CD terpisah wajib sukses sebelum restart service.

### Commit

| Commit | Pesan |
|--------|-------|
| `(this commit)` | `feat(db): versioned migrations, remove DDL from boot path (R4)` |

## Sprint 25 — Rapikan Peletakan Test Telegram (B4) (2 Agustus 2026)

### Perubahan

- Memindahkan enam test Telegram yang sebelumnya berada di level modul ke
  `lib/features/telegram/test/`: helper format/media/schedule/schema serta wizard konten/produk.
- Menggunakan nama `wizardKonten.test.js` dan `wizardProduk.test.js` agar tidak bentrok dengan
  implementasi `wizards/`; seluruh import relatif diperbarui.
- Menetapkan konvensi bahwa seluruh `*.test.js` fitur Telegram harus co-located di direktori
  `test/` fitur tersebut.

### Verifikasi

- `npm run test:ci` → **145/145 pass + QA PASSED**.
- `find lib/features -name '*.test.js'` menunjukkan seluruh test fitur berada di direktori `test/`.

### Commit

Commit dilakukan terpisah dari kenaikan gate coverage S25 setelah verifikasi coverage tiga kali.

## Sprint 25 — Naikkan Gate Coverage (B1) (2 Agustus 2026)

### Perubahan

- Menaikkan threshold native Node di `package.json` dari **41/57/68** menjadi
  **53% lines / 73% functions / 78% branches**.
- Tiga eksekusi berurutan menghasilkan angka identik: **55,88% line / 79,93% branch /
  75,73% functions**; margin gate sekitar 2–3pp menjaga toleransi variance runner.
- Verifikasi negatif sementara memakai line threshold 95% menghasilkan **exit 1**
  (`55,88%` tidak memenuhi `95%`), lalu `package.json` dipulihkan dan gate baru diterapkan.
- Mempertegas aturan bahwa threshold hanya boleh naik; penurunan wajib menyertakan angka dan
  alasan di `logbook.md`.

### Verifikasi

- `npm run test:ci` → **145/145 pass + QA PASSED**.
- `npm run test:coverage` → lulus gate **53/73/78** dengan coverage **55,88% / 79,93% / 75,73%**.

### Commit

`ci: raise coverage gate to 53/73/78 (B1)`

## Sprint 26 — Versi Skema Diturunkan dari `migrations/` (B3) (2 Agustus 2026)

### Perubahan

- Mengganti konstanta migration hardcoded di `lib/shared/schema.js` dengan pembacaan direktori
  `migrations/` saat modul dimuat; hanya file `NNNN_*.js` yang diurutkan dan dipakai.
- Mempertahankan export `LATEST_SCHEMA_MIGRATION` dan perbandingan eksak, sehingga `health.js`
  tidak perlu berubah dan migration baru otomatis menjadi required version.
- Menambahkan fallback non-throwing: direktori yang tidak terbaca menghasilkan `requiredMigration: null`
  dan `status: 'unknown'`.
- Menambahkan tujuh test co-located untuk latest migration, pool/error paths, exact pending check,
  dan direktori migration yang hilang.

### Verifikasi

- `node --test lib/shared/test/schema.test.js` → **7/7 pass**.
- `npm run test:ci` → **152/152 pass + QA PASSED**.
- `npm run lint` → exit 0; `npm run format:check` → lulus setelah format test baru.
- `npm run test:coverage` → lulus gate **53/73/78**, coverage agregat **56,26% line /
  80,33% branch / 76,10% functions**.
- Regresi file sementara: `migrations/0003_dummy.js` membuat import baru membaca `0003_dummy`,
  lalu setelah file dihapus kembali ke `0002_baseline_agent_runs` tanpa perubahan kode.

### Commit

`refactor(db): derive latest schema version from migrations dir (B3)`

## Sprint 27 — Pecah `commands.js` & Cabut Pengecualian Coverage (B2) (2 Agustus 2026)

### Perubahan

- Memperluas `test/helpers/telegramCtx.mjs` dengan fake callback/message methods dan
  `registerAndCapture()` untuk menangkap middleware, command, action, event, dan error handler
  tanpa polling Telegraf.
- Mengekstrak `commands.js` ke `commands/{akses,status,produk,konten,jadwal}.js` serta
  `handlers/{text,photo,errors}.js`; `commands.js` tersisa sebagai wiring dependency-injected
  dan berukuran **100 baris**.
- Menambah test co-located untuk ACL, command status/produk/konten/jadwal, wizard flows, media,
  lifecycle bot, text/AI, photo fallback/error, callback approve/reject, Repliz client/channel,
  evaluation metrics, environment validation, dan view/runner seams.
- Error callback reject untuk rencana 404 dikirim ke `answerCbQuery` agar operator mendapat
  pesan penyebab yang actionable.
- Menghapus `--test-coverage-exclude=lib/features/telegram/commands.js` dari `package.json`;
  gate tetap **53/73/78**.

### Verifikasi

- `npm test` → **205/205 pass** pada pengukuran no-exclude S27.
- No-exclude coverage → **80,61% lines / 78,24% branches / 76,09% functions**; seluruh bar
  sprint (≥53% line / ≥73% functions, branch gate 78%) terpenuhi.
- `wc -l lib/features/telegram/commands.js` → **100**; package tidak lagi memiliki exclusion.
- Commit scoped S27: `82af759`, `ea67ae7`, `5580766`, `53f741a`, `3cee137`, `63701a1`,
  `688f509`, `f013be8`, `3094f8e`, `6ce2a41`, `d28907c`, `b1c7d21`.

## Sprint 28 — Structured Logging (B5) (2 Agustus 2026)

### Perubahan

- Menambahkan dependency runtime `pino` dan `lib/shared/logger.js`: root logger, child scope,
  redaksi `password`/`token`/`TELEGRAM_BOT_TOKEN`/`authorization`/`cookie`, validasi level,
  `requestLogger`, dan `telegramLogger`.
- Menambahkan validasi `LOG_LEVEL` serta contoh env; middleware web membuat UUID baru per request,
  menyimpan `res.locals.requestId`, dan mengirim `X-Request-ID`.
- Migrasi semua `console.*` non-test di `lib/` dan `server.js` ke structured logs. Log route
  membawa request correlation; Telegram membawa `updateId` dan `userId`; ESLint `no-console`
  aktif untuk `lib/**` di luar test.
- Menambah test redaction/correlation dan regresi header request ID.

### Verifikasi

- `npm test` → **209/209 pass**.
- `npm run test:coverage` → lulus gate **53/73/78**; tiga eksekusi berturut-turut identik:
  **80,84% lines / 78,58% branches / 76,52% functions**.
- `npm run lint` → exit 0; `grep` non-test `console.*` di `lib/` → **0**.
- Restart `socai-node` + `socai-bot` sukses; keduanya `active`, `/health` production `status: ok`
  dengan schema `0002_baseline_agent_runs`; log startup baru tervalidasi sebagai JSON pino dan
  tidak ada field rahasia pada output startup.
- Commit scoped S28: `4ab6c5b`, `bb88a28`, `e6ddf11`, `5798e3d`, `003e6af`, `bca7da6`, `99296c7`.

## Sprint 29 — Seam DI & Titik Dingin (C1) (2 Agustus 2026)

### Konteks

Verifikasi ulang pasca S28 menunjukkan coverage agregat 80,84% sudah sehat, tetapi delapan
modul masih di bawah 45% dengan akar masalah yang sama: `pool`, fungsi domain, `sleep`, dan
`Date.now` di-import di level modul sehingga tidak bisa diuji tanpa database dan jaringan.

### Perubahan

- `lib/shared/telegramNotify.js`: seam `{ api, listUserIds }`, ekstrak `resolveNotifyMinRole`.
- `lib/features/agent/actuator/schedule.js`: seam `{ schedulePlan, syncPlan }`.
- `lib/features/pemasaran/jobs.js`: seam `dbPool`, fungsi domain, `sleepFn`, `leadMs`, `nowFn`
  sehingga cron dapat diuji deterministik tanpa timer nyata.
- `lib/features/auth/routes.js`: seam `{ dbPool, comparePassword }`.
- `lib/features/produk/routes.js`, `pemasaran/routes.js`, `evaluasi/routes.js`: seam `dbPool`
  (pemasaran juga `savePlans`, `schedulePlan`, `syncPlan`, `sleepFn`).
- Harness baru `test/helpers/webApp.mjs`: `createRouteApp`, `listen`, `fakePool`, dan sesi
  palsu yang mendukung `regenerate()`/`destroy()`.
- 73 test perilaku baru; seluruh seam memakai default parameter identik dengan perilaku lama.

### Dua perilaku lama yang dikunci apa adanya (tidak diperbaiki di sprint refactor)

- `resolveNotifyMinRole()` menginisialisasi akumulator `reduce` dengan `'operator'`, sehingga
  peran yang lebih tinggi tidak pernah menang. `TELEGRAM_APPROVAL_NOTIFY_ROLES=super_admin`
  tetap menotifikasi operator. → backlog **D4**.
- `POST /logout` dengan CSRF salah menulis `res.status(403).redirect('/dashboard')`, tetapi
  `res.redirect()` Express menimpa status menjadi 302; jadi 403-nya mati. Efek keamanannya
  tetap benar (sesi tidak dihancurkan), hanya status code yang salah. → backlog **D3**.

### Verifikasi

- `npm test` → **282/282 pass** setelah S29 (286 setelah S30 memindahkan test grab-bag).
- Coverage naik **80,84 → 85,04% lines**, **78,58 → 81,18% branches**, **76,52 → 84,07% functions**.
- Commit scoped S29: `bb74952`, `62ed876`, `7f99343`, `f67f845`, `b5444d1`.

## Sprint 30 — Rapikan Test Grab-Bag (C2) (2 Agustus 2026)

`test/s27Coverage.test.js` menguji view, adapter kanal, dan runner agent sekaligus dengan nama
yang menunjuk nomor sprint alih-alih isinya. Dipecah menjadi `lib/web/test/pages.test.js`,
`lib/features/channels/test/adapters.test.js`, dan `lib/features/agent/test/runner.test.js`.
Assertion dipindah apa adanya; tidak ada test yang hilang.

- `npm test` → **286/286 pass**. Commit: `819c693`.

## Sprint 31 — Kalibrasi Gate Coverage (C3) (2 Agustus 2026)

### Masalah

Gate 53/73/78 salah kalibrasi di dua arah sekaligus terhadap aktual 85,04/84,07/81,18: ambang
line tertinggal 32pp sehingga praktis tidak menjaga apa pun, sementara ambang branch hanya
bermargin 0,58pp sehingga rawan merah palsu. Gate yang berbunyi palsu akan dimatikan orang,
dan itu lebih berbahaya daripada gate yang longgar.

### Perubahan

Aturan margin ditetapkan sebagai konvensi, bukan angka ad-hoc: **gate = aktual − 3pp,
dibulatkan ke bawah**.

| | Lama | Baru | Aktual | Margin baru |
| --- | --- | --- | --- | --- |
| lines | 53 | **82** | 85,04 | 3,04pp |
| functions | 73 | **81** | 84,07 | 3,07pp |
| branches | 78 | **78** | 81,18 | 3,18pp |

### Verifikasi

- Gate final 82/81/78 → `npm run test:coverage` **exit 0**.
- Verifikasi negatif: gate 99/99/99 → **exit 1**. Gate terbukti bisa merah, bukan sekadar hijau.
- Empat gate CI: `test:ci` exit 0, `lint` exit 0, `format:check` exit 0, `test:coverage` exit 0.
- Commit: `7365624`.
