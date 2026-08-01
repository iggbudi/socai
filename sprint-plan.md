# Sprint Plan — Remediasi Hasil Audit (socai.my.id)

Dokumen ini adalah rencana kerja berbasis sprint untuk menindaklanjuti hasil audit proyek
(ringkasan temuan di bawah). Setiap sprint **wajib**: implementasi → test hijau → update docs
→ commit → push → CI/CD hijau (GitHub Actions).

---

## 1. Ringkasan Temuan Audit (baseline)

| ID | Severity | Temuan |
|----|----------|--------|
| A1 | P1 | `POST /login` tanpa Content-Type form → HTTP 500 (`req.body` undefined, tidak terhitung rate limiter) |
| A2 | P2 | Pesan rate-limit Telegram menampilkan "undefined" (`rate.retryAfterSec` tidak ada; seharusnya `retryAfterMs`) |
| A3 | P2 | `npm audit`: 6 high + 1 low — `undici@8.3.0` & `ws@8.20.1` via `@earendil-works/pi-coding-agent@0.79.6` |
| A4 | P2 | Timezone server `Asia/Shanghai (+8)` vs logika WIB (+7): parsing "5 Juni 2026 jam 19:00" salah 1 jam; slot kalender & deteksi slot terisi inkonsisten |
| A5 | P3 | XSS risiko rendah: `innerHTML` dengan error message dinamis di `asisten.js` & `evaluasi.js`; `p.stok` tanpa escape di `produk.js` |
| A6 | P3 | CSRF origin check menerima Host header & `X-Forwarded-Host/Proto` dari client; `trust proxy: true` terlalu luas |
| A7 | P3 | Tidak ada test route (bug A1 lolos dari suite); `agent_runs` 0 baris di prod → metrik M1–M7 masih nol |
| A8 | Info | Token bot Telegram = @DBSPresensiBot (konfirmasi disengaja?); rotasi DB password berpola lemah disarankan |
| A9 | P1 (CI) | `package-lock.json` berisi 123 URL `http://mirrors.tencentyun.com` (mirror lokal) → `npm ci` gagal di GitHub Actions (run pertama CI: failure) — diperbaiki di Sprint 0 |

---

## 2. Aturan Main (wajib untuk setiap sprint)

1. **Sync dulu**: `git pull` (jika ada perubahan remote).
2. **Implementasi** perubahan kode/test/docs sesuai task sprint.
3. **Validasi lokal**: `npm test` lalu `npm run test:ci` — semua hijau sebelum commit.
4. **Update docs**: minimal `logbook.md` + file relevan (`AGENTS.md`, `README.md`, `CODEBASE_WIKI.md`, `deploy/`).
5. **Commit scoped**: hanya file milik sprint; jangan campur perubahan tak terkait (mis. `CODEBASE_WIKI.md` yang sudah modified sebelumnya).
6. **Push** ke `main`.
7. **Verifikasi CI** di GitHub Actions hijau sebelum lanjut ke sprint berikutnya.
8. **DoD (Definition of Done)**: implementasi selesai + test hijau + docs ter-update + commit & push + CI hijau.

### Commit convention (mengikuti gaya repo)

- `fix(web): ...` · `fix(schedule): ...` · `fix(security): ...`
- `chore(deps): ...` · `test(web): ...` · `docs: ...` · `ops(deploy): ...`

---

## 3. CI/CD

- Workflow: `.github/workflows/ci.yml` — trigger `push`/`pull_request` ke `main`:
  `npm ci` → `npm run test:ci` (unit test `node --test` + QA smoke, tanpa HTTP).
- Lokal: `npm run test:ci` (script sudah menyetel `QA_SKIP_HTTP=1`).
- Status: https://github.com/iggbudi/socai/actions

---

## 4. Sprint 0 — Baseline & Dokumen Plan (docs)

**Tujuan**: baseline hijau; repo bersih; dokumen plan ter-commit.

**Tasks**
- [x] Review perubahan `CODEBASE_WIKI.md` yang belum di-commit (commit bila valid, revert bila tidak relevan) — terpisah dari commit plan ini (`c501af5`)
- [x] `npm run test:ci` → baseline hijau (77 unit test + QA smoke)
- [x] Buat file ini (`sprint-plan.md`) sebagai docs sprint
- [x] Fix CI blocker (A9): regenerate `package-lock.json` — ganti 123 URL `http://mirrors.tencentyun.com` → `https://registry.npmjs.org` (versi & integrity tidak berubah); commit terpisah
- [x] Commit: `docs: add audit sprint plan (S0 baseline)` (`6e10946`)
- [x] Push + verifikasi CI hijau — run pertama gagal (A9), setelah fix lockfile → hijau

**DoD**: CI hijau; `sprint-plan.md` ada di `main`.

---

## 5. Sprint 1 — Fix Login 500 & Pesan Rate-Limit Telegram (A1, A2)

**Tujuan**: hilangkan HTTP 500 pada login tanpa body; perbaiki teks rate-limit Telegram.

**Tasks (kode)**
- [x] `lib/web/routes/auth.js:31` → `const { username, password } = req.body || {};` dan tolak request non-form (`req.is('application/x-www-form-urlencoded')`) dengan respons 4xx/loginPage — jangan 500
- [x] `telegram-bot.js:362` → gunakan `Math.ceil(rate.retryAfterMs / 1000)` (ganti `rate.retryAfterSec` yang tidak ada)
- [x] Tambah test regresi (pattern test route ada di Sprint 6): `POST /login` body kosong / `Content-Type` non-form → **bukan 500** (`test/routes.test.js`)

**Docs**: `logbook.md` (entry sprint), `CODEBASE_WIKI.md` (changelog)

**Verifikasi**: `npm run test:ci`; curl reproduksi
`curl -X POST http://127.0.0.1:3010/login -H 'Content-Type: text/plain' -d 'x=1' -o /dev/null -w '%{http_code}'` → 4xx/200 (sebelumnya 500)

**Commit**: `fix(web): handle login POST without form body (no 500); fix telegram rate-limit retry text`

**DoD**: reproduksi lama → 500, sekarang bukan 500; CI hijau.

---

## 6. Sprint 2 — Upgrade Dependensi & Audit Fix (A3)

**Tujuan**: `npm audit --omit=dev` bersih (0 vulnerabilities).

**Tasks**
- [x] `npm install @earendil-works/pi-coding-agent@latest` (target 0.83.0) — terpasang `0.83.0` (undici 8.5.0, ws 8.21.0 — keduanya keluar dari range vuln)
- [x] `npm audit fix`; periksa sisa vuln (undici/ws) — tambah `overrides` di `package.json` bila perlu → override `brace-expansion: 5.0.9` (sisa vuln nested minimatch; hoisted setelah bersihkan `node_modules/.package-lock.json`)
- [x] `npm run test:ci` full; verifikasi import agent, definisi tool, dan API `createAgentSession` tidak berubah → **breaking change ditemukan**: `AuthStorage`/`ModelRegistry` dihapus dari export → diadaptasi ke `ModelRuntime.create()` + `getModel()`; `initAgent` terverifikasi via smoke test
- [x] Catat perubahan perilaku/breaking change (jika ada) di docs → logbook + CODEBASE_WIKI

**Docs**: `CODEBASE_WIKI.md` (bagian dependencies), `logbook.md`

**Risiko**: API pi-coding-agent berubah → rollback pin `0.79.6` (package-lock via git) dan laporkan

**Commit**: `chore(deps): bump @earendil-works/pi-coding-agent to 0.83.0; npm audit clean`

**DoD**: `npm audit --omit=dev` → 0 vuln; CI hijau.

---

## 7. Sprint 3 — Konsistensi Timezone WIB (+07:00) (A4)

**Tujuan**: parsing & generasi jadwal eksplisit WIB, tidak bergantung timezone server.

**Tasks (kode)**
- [x] Buat helper WIB (`lib/wibTime.js`): `wibDate()` (konstruksi via `Date.UTC(y, m-1, d, hh-7, mm)`), `getWibParts()` (`Intl` timeZone `Asia/Jakarta`), `wibSlotKey()`, `formatWibScheduledAt()` (+07:00), `formatWibLabel()` (label Indonesia)
- [x] `lib/pemasaran.js` → `parseMarketingSchedule`: teks Indonesia (jam/pukul) di-parse sebagai WIB eksplisit (dua branch: ISO-like & teks Indonesia) — bukan server-local
- [x] `lib/actuator/calendar.js` → `getCalendarGaps`: slot & `slotKey` berbasis komponen WIB; `scheduled_at` = instant yang sama persis dengan slot (`date`)
- [x] Tambah test: `parseMarketingSchedule("5 Juni 2026 jam 19:00")` → `2026-06-05T12:00:00.000Z`; slot 19:00 WIB → `19:00:00+07:00`; occupied terdeteksi pada instant yang sama → `test/wibTime.test.js` + update `test/pemasaran.test.js`

**Tasks (ops/docs)**
- [x] Buat `deploy/socai-node.service` & `deploy/socai-bot.service` (template unit systemd + `Environment=TZ=Asia/Jakarta`) + `deploy/README.md` (runbook deploy + contoh vhost Apache dengan `RequestHeader unset X-Forwarded-Host`)
- [x] Update `AGENTS.md` (catatan env TZ), `README.md` (bagian deployment), `logbook.md`

**Verifikasi**: unit test timezone baru; setelah deploy: parsing & slot benar di server TZ apa pun

**Commit**: `fix(schedule): explicit WIB (+07:00) parsing and calendar slots; add deploy units`

**DoD**: test timezone hijau; deploy template & docs ter-commit; CI hijau.

---

## 8. Sprint 4 — Hardening XSS di Views (A5)

**Tujuan**: tidak ada `innerHTML` dengan data dinamis yang tidak di-escape.

**Tasks**
- [x] `lib/web/views/asisten.js:407` → `saveBtn.textContent = '❌ ' + err.message` (dan `title` via property, bukan `innerHTML`) — juga `savedText` & label tombol statis → textContent
- [x] `lib/web/views/evaluasi.js:223` → bangun node error dengan `textContent` (`replaceChildren`); `renderTable` kini memakai `esc()` (defense-in-depth)
- [x] `lib/web/views/produk.js:358` → escape `p.stok` (defensif, walau numerik)
- [x] Sweep `grep -rn 'innerHTML' lib/web/views/` → sisa hanya string statis / nilai yang sudah di-`esc()`
- [x] Tambah cek pattern di `test/qa-smoke.mjs` (6 view files: tidak ada `innerHTML` concat dinamis / `.message`)

**Docs**: `logbook.md`, `CODEBASE_WIKI.md` (security section)

**Commit**: `fix(web): escape dynamic error text in asisten/evaluasi/produk views`

**DoD**: qa-smoke pattern baru lolos; CI hijau.

---

## 9. Sprint 5 — Hardening CSRF & Trust Proxy (A6)

**Tujuan**: origin check hanya dari sumber tepercaya; `trust proxy` dibatasi.

**Tasks**
- [x] `lib/web/middleware/csrf.js` → allowed origins: `APP_URL` + localhost saja (hapus `requestBaseUrl` dari Host header & `forwardedBaseUrl` dari X-Forwarded-Host/Proto yang bisa dispoof client)
- [x] `lib/web/createApp.js` → `app.set('trust proxy', 'loopback')` (1 hop Apache; X-Forwarded-For/Proto dari luar tidak dipercaya)
- [x] Docs ops: contoh vhost Apache di `deploy/` dengan `RequestHeader unset X-Forwarded-Host` (sudah dari Sprint 3)
- [x] Test middleware CSRF: spoof `X-Forwarded-Host`/Host → 403; `APP_URL` asli → diteruskan → `test/csrfMiddleware.test.js` (8 test)

**Docs**: `logbook.md`, `CODEBASE_WIKI.md`, `deploy/`

**Verifikasi**: test CSRF baru; curl manual POST `/api/produk` dengan Origin asing → 403

**Commit**: `fix(security): tighten CSRF origin check and trust proxy to loopback`

**DoD**: CI hijau; spoofing origin → 403.

---

## 10. Sprint 6 — Test Route Level (A7)

**Tujuan**: cakupan test untuk routes web (regresi A1 tidak terulang).

**Tasks**
- [x] `test/routes.test.js` (node:test + `app.listen(0)` + fetch):
  - [x] `POST /login` tanpa body / Content-Type non-form → **bukan 500** (dari Sprint 1)
  - [x] `GET /health` → shape JSON (`status`, `checks.database`) — terima 200/503
  - [x] `GET /api/produk` tanpa session → 401
  - [x] `POST /logout` tanpa session → 401 (bukan 500)
  - [x] CSRF e2e: `POST /api/produk` tanpa Origin / Origin asing → 403
  - [x] `GET /` → 302 redirect `/login`; `GET /login` → 200
- [x] Sesuaikan `test/qa-smoke.mjs` bila perlu — tidak perlu perubahan
- [x] Jalankan penuh: `npm run test:ci` → **103/103 + QA PASSED**

**Docs**: `AGENTS.md` (bagian test), `logbook.md`

**Commit**: `test(web): add route-level tests (login body guard, health, auth guard)`

**DoD**: jumlah test bertambah; CI hijau.

---

## 11. Sprint 7 — Finalisasi Docs, Ops & Release (A8 + penutup)

**Tujuan**: dokumentasi lengkap & siap deploy; semua temuan tertutup/terdokumentasi.

**Tasks**
- [x] Update `AGENTS.md` (env, deploy, test), `README.md` (ops notes, TZ), `CODEBASE_WIKI.md` (changelog S1–S6)
- [x] `logbook.md`: retrospective ringkas
- [x] Konfirmasi A8 — token bot @DBSPresensiBot: **dikonfirmasi sengaja** oleh owner (1 Agustus 2026); tidak perlu diganti
- [x] Rotasi `DB_PASSWORD` (ops) — **diputuskan tidak perlu** oleh owner (1 Agustus 2026); password dibiarkan
- [x] Regression penuh: `npm run test:ci` + smoke curl (login, health, /produk, /pemasaran)
- [x] Tag release (opsional, setelah persetujuan): `git tag v1.1.0 && git push --tags`

**Commit**: `docs: finalize sprint docs and release notes v1.1.0`

**DoD**: semua DoD Sprint 1–6 terpenuhi; CI hijau; release notes siap.

---

## 12. Estimasi Timeline

| Sprint | Estimasi | Catatan |
|--------|----------|---------|
| S0 | 0.5 hari | Baseline & plan |
| S1 | 0.5 hari | Fix kecil, cepat |
| S2 | 0.5–1 hari | Risiko breaking change pi-coding-agent |
| S3 | 1–1.5 hari | Helper WIB + test + deploy units |
| S4 | 0.5 hari | Escape views + qa-smoke |
| S5 | 0.5–1 hari | CSRF + trust proxy + test |
| S6 | 1 hari | Test route level |
| S7 | 0.5 hari | Docs final + release |
| S8 | 0.5 hari | Vertical slicing F0: `pool`/`aiReadPool` → `lib/shared/db.js` |
| S9 | 0.5–1 hari | Vertical slicing F1: 7 modul shared → `lib/shared/` + co-located test |
| S10 | 0.5 hari | Vertical slicing F2: fitur `channels` → `lib/features/channels/` + co-located test |
| S11 | 0.5–1 hari | Vertical slicing F3: fitur `auth` + `dashboard` → `lib/features/`; `layout`/`pageInit` → `lib/shared/` |
| S12 | 0.5 hari | Vertical slicing F4: fitur `produk` (CRUD + upload) → `lib/features/produk/` |
| **Total** | **±5–7 hari kerja** | |

---

## 13. Risiko & Rollback

- **S2**: upgrade `pi-coding-agent` dapat mengubah API tools/agent → cek release notes; rollback: pin kembali `0.79.6` (package-lock via git).
- **S3**: parsing tanggal baru tidak mengubah `scheduled_at` tersimpan (ISO instant); hanya parsing teks & slot baru yang berubah — diverifikasi lewat unit test.
- **S5**: `trust proxy: loopback` — jika ada proxy lain (bukan localhost), `req.ip` bisa salah; verifikasi `X-Forwarded-For` dari Apache setelah deploy.
- **Deploy**: restart systemd = downtime < 5 detik (graceful shutdown); lakukan di jam sepi, verifikasi `GET /health`.

---

## 14. Catatan

- Semua artefak ops (unit systemd, contoh vhost Apache) di-version di `deploy/` agar terdokumentasi dan bisa di-audit.
- Setiap sprint boleh dipecah menjadi commit lebih kecil selama seluruh DoD terpenuhi.
- Checklist `- [ ]` di dokumen ini di-update statusnya di akhir setiap sprint (dan hasilnya dicatat di `logbook.md`).

---

## 15. Sprint 8 — Vertical Slicing F0: Ekstraksi DB Pools (1 Agustus 2026)

**Tujuan**: potong coupling terbesar — `lib/agent.js` (AI agent) tidak lagi memegang PostgreSQL pools; mulai struktur per fitur (`lib/shared/`).

**Tasks (kode)**
- [x] Buat `lib/shared/db.js` — `pool`, `aiReadPool`, `resolveAiReadPoolCredentials()` (fallback + warning), `closeAgentPools()`
- [x] `lib/agent.js` — hapus definisi pools & import `pg`; import dari `./shared/db.js`
- [x] Update 11 importer: `server.js`, `telegram-bot.js`, `lib/agentRunner.js`, `lib/web/createApp.js`, `lib/web/replizJobs.js`, `lib/web/routes/{auth,health}.js`, `lib/web/routes/api/{produk,pemasaran,agentRuns,asisten}.js`, `lib/autonomousJobs.js` (3 dynamic import)
- [x] Verifikasi `npm run test:ci` → 103/103 unit + QA PASSED

**Docs**: `AGENTS.md`, `README.md`, `CODEBASE_WIKI.md`, `logbook.md`

**Commit**: `refactor(db): extract pool/aiReadPool to lib/shared/db.js (vertical slicing F0)`

**DoD**: semua importer pool mengarah ke `lib/shared/db.js`; test hijau; CI hijau.

**Fase berikutnya (rencana F1)**: pindahkan shared murni (`wibTime`, `rateLimit`, `mediaUrl`, `imageFile`, `html`, `repliz`, `telegramNotify`) ke `lib/shared/`; mulai co-located test.

---

## 16. Sprint 9 — Vertical Slicing F1: Shared Infra Murni (1 Agustus 2026)

**Tujuan**: pindahkan modul shared murni (tanpa ketergantungan fitur) ke `lib/shared/`; mulai co-located test.

**Tasks (kode)**
- [x] Pindah 7 modul → `lib/shared/`: `wibTime`, `rateLimit`, `mediaUrl`, `imageFile`, `html` (dari `lib/web/`), `repliz`, `telegramNotify`
- [x] Update ±20 importer (views → `../../shared/html.js`; routes API → `../../../shared/*.js`; `telegram-bot.js` → `./lib/shared/*.js`; `lib/` root → `./shared/*.js`; test tersisa → `../lib/shared/*.js`)
- [x] `lib/shared/telegramNotify.js` → import `'../telegramAccess.js'` (ACL pindah di F8)
- [x] Co-located test: `test/wibTime.test.js` & `test/mediaUrl.test.js` → `lib/shared/test/`; glob `npm test` diupdate (`node --test "test/**/*.test.js" "lib/shared/**/*.test.js"`)
- [x] `test/qa-smoke.mjs` path check `lib/telegramNotify.js` → `lib/shared/telegramNotify.js`
- [x] Verifikasi `npm run test:ci` → 103/103 + QA PASSED

**Docs**: `AGENTS.md`, `README.md`, `CODEBASE_WIKI.md`, `logbook.md`

**Commit**: `refactor(shared): move pure shared modules to lib/shared/ (vertical slicing F1)`

**DoD**: tidak ada import path lama tersisa; test hijau; CI hijau.

**Fase berikutnya (rencana F2)**: pindahkan fitur `channels` (5 file, self-contained) ke `lib/features/channels/`; `env.js` (import `CHANNEL_IDS`) jadi pengecualian terdokumentasi atau pindahkan `CHANNEL_IDS` ke fitur.

---

## 17. Sprint 10 — Vertical Slicing F2: Fitur `channels` (1 Agustus 2026)

**Tujuan**: fitur pertama masuk pola `lib/features/` — membuktikan pola vertical slicing (domain + test co-located).

**Tasks (kode)**
- [x] Pindah 5 file → `lib/features/channels/`: `index.js`, `registry.js`, `threads.js`, `instagram.js`, `prompt.js`
- [x] Import internal: `threads.js`/`instagram.js` → `'../../shared/repliz.js'`
- [x] Update 11 importer: `lib/agent.js`, `lib/env.js`, `lib/evaluationMetrics.js`, `lib/health.js`, `lib/pemasaran.js`, `lib/publishFeedback.js`, `lib/actuator/calendar.js`, `lib/web/replizJobs.js`, `lib/web/routes/api/{channels,repliz}.js`
- [x] `env.js` (import `CHANNEL_IDS`): pengecualian terdokumentasi — bootstrap validator, import `lib/features/channels/index.js` tanpa duplikasi konstanta
- [x] Co-located test: `test/channels.test.js` → `lib/features/channels/test/`; glob `npm test` + `lib/features/**/*.test.js`; `qa-smoke.mjs` path list diupdate
- [x] Verifikasi `npm run test:ci` → 103/103 + QA PASSED

**Docs**: `AGENTS.md`, `CODEBASE_WIKI.md`, `logbook.md`

**Commit**: `refactor(channels): move channels feature to lib/features/ (vertical slicing F2)`

**DoD**: tidak ada import `lib/channels/` tersisa; test hijau; CI hijau.

**Fase berikutnya (rencana F3)**: fitur `auth` + `dashboard` — `requireLogin`, `csrfToken`, `loginRateLimit`, routes login/logout, `loginPage` → `lib/features/auth/`; `dashboardPage` → `lib/features/dashboard/`; hapus `lib/web/routes/auth.js` & `lib/web/views/login.js` dari web shell (pakai shim re-export bila perlu).

---

## 18. Sprint 11 — Vertical Slicing F3: Fitur `auth` + `dashboard` (1 Agustus 2026)

**Tujuan**: fondasi keamanan (login/logout/CSRF/rate limit) masuk pola fitur; dashboard ikut sekalian.

**Tasks (kode)**
- [x] `lib/features/auth/`: `requireLogin.js` (dari `lib/web/middleware/auth.js`), `csrfToken.js` (dari `lib/csrfToken.js`), `loginRateLimit.js`, `routes.js` (login/logout), `view.js` (`loginPage`) + `index.js` (public API) + `test/csrfToken.test.js`
- [x] `lib/features/dashboard/`: `view.js` (`dashboardPage`) + `index.js`
- [x] `layout.js` + `pageInit.js` → `lib/shared/` (UI infra lintas fitur — mencegah feature→web-shell import; penyimpangan dari rencana awal, dicatat di logbook)
- [x] Update importer: `createApp.js` (3), `pages.js` (3), 7 route API (`requireLogin`), `qa-smoke.mjs` (import + VIEW_SOURCES), 4 views (layout/pageInit → shared)
- [x] Co-located test: `test/csrfToken.test.js` → `lib/features/auth/test/`
- [x] Verifikasi `npm run test:ci` → 103/103 + QA PASSED

**Docs**: `AGENTS.md`, `README.md`, `CODEBASE_WIKI.md`, `logbook.md`

**Commit**: `refactor(auth): move auth + dashboard features to lib/features/ (vertical slicing F3)`

**DoD**: tidak ada import `middleware/auth.js`, `routes/auth.js`, `views/{login,dashboard,layout,pageInit}.js` tersisa; test hijau; CI hijau.

**Fase berikutnya (rencana F4)**: fitur `produk` — `lib/web/routes/api/produk.js`, `lib/web/views/produk.js`, `lib/web/middleware/upload.js` → `lib/features/produk/`; `qa-smoke.mjs` VIEW_SOURCES diupdate; co-located test `test/produk` (jika ada).

---

## 19. Sprint 12 — Vertical Slicing F4: Fitur `produk` (1 Agustus 2026)

**Tujuan**: fitur CRUD + upload gambar keluar dari web shell; `lib/web/middleware/` tinggal shell murni (csrf + csp).

**Tasks (kode)**
- [x] `lib/features/produk/`: `routes.js` (`registerProdukRoutes` + `registerUploadRoutes` — **digabung** dari `routes/api/produk.js` + `routes/api/upload.js`), `upload.js` (multer dari `middleware/upload.js`, path uploadsDir tetap valid 3× `..`), `view.js` (`produkPage`, imports `../../shared/*` sudah benar dari lokasi baru) + `index.js`
- [x] Update importer: `createApp.js` (2 import → 1: `registerProdukRoutes, registerUploadRoutes` dari `features/produk/routes.js`), `pages.js` (`produkPage`), `qa-smoke.mjs` (import + VIEW_SOURCES)
- [x] Verifikasi `npm run test:ci` → 103/103 + QA PASSED (satu kali gagal: `view.js` belum dipindah → import error → diperbaiki)

**Docs**: `AGENTS.md`, `README.md`, `CODEBASE_WIKI.md`, `logbook.md`

**Commit**: `refactor(produk): move produk feature to lib/features/ (vertical slicing F4)`

**DoD**: tidak ada import `routes/api/{produk,upload}.js`, `middleware/upload.js`, `views/produk.js` tersisa; test hijau; CI hijau.

**Fase berikutnya (rencana F5)**: fitur `pemasaran` (terbesar setelah agent) — `lib/pemasaran.js` (domain: savePlansToDb, parseMarketingSchedule, schedulePlanToChannel, syncPlanReplizStatus) → `lib/features/pemasaran/domain.js`; `lib/web/routes/api/pemasaran.js` → `routes.js`; `lib/web/views/pemasaran.js` → `view.js`; `lib/web/replizJobs.js` (background jobs) → `jobs.js`; importer: agent.js (tools), scheduleApproval, replizJobs, telegram-bot.js, autonomousJobs; co-located test `test/pemasaran.test.js`.


