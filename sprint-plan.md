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
- [ ] Review perubahan `CODEBASE_WIKI.md` yang belum di-commit (commit bila valid, revert bila tidak relevan) — terpisah dari commit plan ini
- [ ] `npm run test:ci` → baseline hijau (77 unit test + QA smoke)
- [x] Buat file ini (`sprint-plan.md`) sebagai docs sprint
- [x] Fix CI blocker (A9): regenerate `package-lock.json` — ganti 123 URL `http://mirrors.tencentyun.com` → `https://registry.npmjs.org` (versi & integrity tidak berubah); commit terpisah
- [ ] Commit: `docs: add audit sprint plan (S0 baseline)`
- [x] Push + verifikasi CI hijau — run pertama gagal (A9), setelah fix lockfile → hijau

**DoD**: CI hijau; `sprint-plan.md` ada di `main`.

---

## 5. Sprint 1 — Fix Login 500 & Pesan Rate-Limit Telegram (A1, A2)

**Tujuan**: hilangkan HTTP 500 pada login tanpa body; perbaiki teks rate-limit Telegram.

**Tasks (kode)**
- [ ] `lib/web/routes/auth.js:31` → `const { username, password } = req.body || {};` dan tolak request non-form (`req.is('application/x-www-form-urlencoded')`) dengan respons 4xx/loginPage — jangan 500
- [ ] `telegram-bot.js:362` → gunakan `Math.ceil(rate.retryAfterMs / 1000)` (ganti `rate.retryAfterSec` yang tidak ada)
- [ ] Tambah test regresi (pattern test route ada di Sprint 6): `POST /login` body kosong / `Content-Type` non-form → **bukan 500**

**Docs**: `logbook.md` (entry sprint), `CODEBASE_WIKI.md` (changelog)

**Verifikasi**: `npm run test:ci`; curl reproduksi
`curl -X POST http://127.0.0.1:3010/login -H 'Content-Type: text/plain' -d 'x=1' -o /dev/null -w '%{http_code}'` → 4xx/200 (sebelumnya 500)

**Commit**: `fix(web): handle login POST without form body (no 500); fix telegram rate-limit retry text`

**DoD**: reproduksi lama → 500, sekarang bukan 500; CI hijau.

---

## 6. Sprint 2 — Upgrade Dependensi & Audit Fix (A3)

**Tujuan**: `npm audit --omit=dev` bersih (0 vulnerabilities).

**Tasks**
- [ ] `npm install @earendil-works/pi-coding-agent@latest` (target 0.83.0)
- [ ] `npm audit fix`; periksa sisa vuln (undici/ws) — tambah `overrides` di `package.json` bila perlu
- [ ] `npm run test:ci` full; verifikasi import agent, definisi tool, dan API `createAgentSession` tidak berubah
- [ ] Catat perubahan perilaku/breaking change (jika ada) di docs

**Docs**: `CODEBASE_WIKI.md` (bagian dependencies), `logbook.md`

**Risiko**: API pi-coding-agent berubah → rollback pin `0.79.6` (package-lock via git) dan laporkan

**Commit**: `chore(deps): bump @earendil-works/pi-coding-agent to 0.83.0; npm audit clean`

**DoD**: `npm audit --omit=dev` → 0 vuln; CI hijau.

---

## 7. Sprint 3 — Konsistensi Timezone WIB (+07:00) (A4)

**Tujuan**: parsing & generasi jadwal eksplisit WIB, tidak bergantung timezone server.

**Tasks (kode)**
- [ ] Buat helper WIB (mis. `lib/wibTime.js`): konstruksi Date dari komponen lokal WIB
  (`new Date(Date.UTC(y, m - 1, d, hh - 7, mm))`) dan ekstraksi komponen WIB
  (`Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', ... })`)
- [ ] `lib/pemasaran.js` → `parseMarketingSchedule`: teks Indonesia (jam/pukul) di-parse sebagai WIB eksplisit, bukan `new Date(y, m, d, hh, mm)` server-local
- [ ] `lib/actuator/calendar.js` → `getCalendarGaps`: slot & `slotKey` berbasis komponen WIB; `scheduled_at` konsisten dengan instant slot
- [ ] Tambah test: `parseMarketingSchedule("5 Juni 2026 jam 19:00")` → `2026-06-05T12:00:00.000Z`; slot 19:00 WIB → `19:00:00+07:00`

**Tasks (ops/docs)**
- [ ] Buat `deploy/socai-node.service` & `deploy/socai-bot.service` (template unit systemd + `Environment=TZ=Asia/Jakarta`) + `deploy/README.md` (runbook deploy)
- [ ] Update `AGENTS.md` (catatan env TZ), `README.md` (bagian deployment), `logbook.md`

**Verifikasi**: unit test timezone baru; setelah deploy: parsing & slot benar di server TZ apa pun

**Commit**: `fix(schedule): explicit WIB (+07:00) parsing and calendar slots; add deploy units`

**DoD**: test timezone hijau; deploy template & docs ter-commit; CI hijau.

---

## 8. Sprint 4 — Hardening XSS di Views (A5)

**Tujuan**: tidak ada `innerHTML` dengan data dinamis yang tidak di-escape.

**Tasks**
- [ ] `lib/web/views/asisten.js:407` → `saveBtn.textContent = '❌ ' + err.message` (dan `title` via property, bukan `innerHTML`)
- [ ] `lib/web/views/evaluasi.js:223` → bangun node error dengan `textContent`
- [ ] `lib/web/views/produk.js:358` → escape `p.stok` (defensif, walau numerik)
- [ ] Sweep `grep -rn 'innerHTML' lib/web/views/` → pastikan sisanya hanya string statis
- [ ] Tambah cek pattern di `test/qa-smoke.mjs` (tidak ada `innerHTML` + ekspresi dinamis)

**Docs**: `logbook.md`, `CODEBASE_WIKI.md` (security section)

**Commit**: `fix(web): escape dynamic error text in asisten/evaluasi/produk views`

**DoD**: qa-smoke pattern baru lolos; CI hijau.

---

## 9. Sprint 5 — Hardening CSRF & Trust Proxy (A6)

**Tujuan**: origin check hanya dari sumber tepercaya; `trust proxy` dibatasi.

**Tasks**
- [ ] `lib/web/middleware/csrf.js` → allowed origins: `APP_URL` + localhost saja (hapus/limit `requestBaseUrl` & `forwardedBaseUrl`; atau hanya di non-produksi)
- [ ] `lib/web/createApp.js` → `app.set('trust proxy', 'loopback')` (1 hop Apache); verifikasi `req.ip` & rate limit tetap benar
- [ ] Docs ops: contoh vhost Apache di `deploy/` dengan `RequestHeader unset X-Forwarded-Host`
- [ ] Test middleware CSRF: spoof `X-Forwarded-Host`/Host → 403; `APP_URL` asli → diteruskan

**Docs**: `logbook.md`, `CODEBASE_WIKI.md`, `deploy/`

**Verifikasi**: test CSRF baru; curl manual POST `/api/produk` dengan Origin asing → 403

**Commit**: `fix(security): tighten CSRF origin check and trust proxy to loopback`

**DoD**: CI hijau; spoofing origin → 403.

---

## 10. Sprint 6 — Test Route Level (A7)

**Tujuan**: cakupan test untuk routes web (regresi A1 tidak terulang).

**Tasks**
- [ ] `test/routes.test.js` (node:test + `app.listen(0)` + fetch):
  - `POST /login` tanpa body / Content-Type non-form → **bukan 500**
  - `GET /health` → shape JSON (`status`, `checks.database`)
  - `GET /api/produk` tanpa session → 401
  - `POST /logout` tanpa session → 401/redirect (bukan 500)
- [ ] Sesuaikan `test/qa-smoke.mjs` bila perlu
- [ ] Jalankan penuh: `npm run test:ci`

**Docs**: `AGENTS.md` (bagian test), `logbook.md`

**Commit**: `test(web): add route-level tests (login body guard, health, auth guard)`

**DoD**: jumlah test bertambah; CI hijau.

---

## 11. Sprint 7 — Finalisasi Docs, Ops & Release (A8 + penutup)

**Tujuan**: dokumentasi lengkap & siap deploy; semua temuan tertutup/terdokumentasi.

**Tasks**
- [ ] Update `AGENTS.md` (env, deploy, test), `README.md` (ops notes, TZ), `CODEBASE_WIKI.md` (changelog S1–S6)
- [ ] `logbook.md`: retrospective ringkas
- [ ] Konfirmasi A8: token bot @DBSPresensiBot (disengaja?) & rotasi DB password (ops)
- [ ] Regression penuh: `npm run test:ci` + smoke curl (login, health, /produk, /pemasaran)
- [ ] Tag release (opsional, setelah persetujuan): `git tag v1.1.0 && git push --tags`

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


