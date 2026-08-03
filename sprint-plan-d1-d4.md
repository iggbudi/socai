# Sprint Plan — Backlog D1–D4 (socai.my.id)

Lanjutan dari `sprint-plan-kalibrasi.md` (S29–S31 selesai, skor proyeksi 9,2/10, gate
coverage `82/81/78` dikunci pada 2 Agustus 2026). Dokumen ini menindaklanjuti **4 item
backlog** yang secara eksplisit ditunda dari S29–S31 karena berada di luar cakupan
refactor murni atau butuh keputusan produk/keamanan sebelum dikerjakan.

Aturan main, konvensi commit, dan DoD **mengikuti `sprint-plan.md` §2**.
Ringkas: implementasi → 4 gate hijau (`test:ci`, `lint`, `format:check`, `test:coverage`)
→ update docs → commit scoped → push → CI hijau.

---

## 1. Baseline (2 Agustus 2026, commit `7365624`)

| Metrik | Nilai |
|---|---|
| Test | 286 pass / 0 fail |
| Coverage | 85,04% lines / 81,18% branches / 84,07% functions |
| Gate CI | 82/81/78 (margin ≥3pp) |
| `console.*` non-test di `lib/` | 0 |

---

## 2. Peta Backlog → Sprint

| ID | Temuan | Sprint | Nilai | Risiko |
|----|---|---|---|---|
| D3 | `POST /logout` CSRF salah → balas 302, bukan 403 | **S32** | Rendah | Rendah |
| D4 | `resolveNotifyMinRole()` tidak pernah memilih peran di atas `operator` | **S32** | Sedang | Rendah |
| D2 | `server.js` & `telegram-bot.js` tidak pernah masuk laporan coverage (bootstrap/shutdown) | **S33** | Sedang | Sedang |
| D1 | `agent/core.js` (565 baris, 9,20% line) — permukaan tak-teruji terbesar | **S34** | Tinggi | **Tinggi** |

### Urutan dan dependensi

1. **S32 duluan** — dua bug kecil, independen, murni perbaikan perilaku + regresi test. Tidak
   menyentuh struktur, jadi aman dikerjakan sebelum sprint besar.
2. **S33 sebelum S34** — harness bootstrap (`server.js`/`telegram-bot.js`) yang dibangun di S33
   sebagian dipakai ulang untuk menguji siklus hidup sesi di S34 (start/stop proses).
3. **S34 paling berat** — butuh fake SDK `pi-coding-agent`; ditunda ke akhir supaya gate
   coverage dari S31 sudah stabil sebagai jaring pengaman sebelum menyentuh modul terbesar.

**Dependensi:** S32 ⟵ (tidak ada) · S33 ⟵ (tidak ada) · S34 ⟵ S33 (pakai harness proses)

---

## 3. Sprint 32 — Perbaiki Dua Bug Perilaku Terkunci (D3, D4)

**Tujuan**: dua penyimpangan perilaku yang sengaja dikunci apa adanya di S29 (lihat
`logbook.md`, entri Sprint 29) sekarang diperbaiki dengan sengaja, masing-masing sebagai
perubahan perilaku eksplisit — bukan lagi "dikunci sebagai perilaku lama".

### D3 — Status code logout salah

**Konteks**: `lib/features/auth/routes.js:81-92`. Saat CSRF token salah, kode menulis
`res.status(403).redirect('/dashboard')` — tapi `res.redirect()` Express menimpa status
menjadi 302. Efek keamanan tetap benar (sesi tidak dihancurkan), hanya status code yang
salah. Sudah dikunci di test S29 sebagai perilaku lama (302).

**Tasks**
- [x] Cek pemakai frontend: `grep -rn "logout" lib/features/*/view.js lib/shared/*.js` —
      tombol logout (`lib/shared/layout.js`) adalah form HTML biasa (`method="POST"`) dengan
      token `_csrf` disematkan dari sesi; jalur sukses (`redirect('/login')`) tidak diubah dan
      token nyaris selalu valid untuk pengguna yang login normal. Jalur CSRF-gagal hanya
      tersentuh saat sesi rusak/kadaluarsa atau upaya spoof — sebelumnya browser diam-diam
      diarahkan ke `/dashboard` (302), sekarang menampilkan body JSON 403 (respons mentah,
      bukan halaman) karena form navigasi biasa mengikuti apa pun yang dikembalikan server;
      diterima sebagai trade-off karena jalur ini adalah kondisi error/keamanan, bukan alur
      normal, dan status code yang jujur lebih penting
- [x] `lib/features/auth/routes.js` → CSRF gagal balas `res.status(403).json({ error: 'CSRF validation failed' })`
      (bukan redirect) — pola konsisten dengan route API lain (`csrf.js` middleware sudah balas
      403 JSON untuk request API)
- [x] Update test yang mengunci perilaku lama di S29 (`lib/features/auth/test/authRoutes.test.js`)
      → assert 403 JSON, bukan 302
- [x] `CODEBASE_WIKI.md` / `logbook.md` — catat sebagai perbaikan bug, referensi D3

### D4 — `resolveNotifyMinRole()` salah pilih peran

**Konteks**: `lib/shared/telegramNotify.js:23-32`. Akumulator `reduce` diinisialisasi
`'operator'` (rank 2) dan memilih peran dengan rank **terendah**, jadi `super_admin` (rank 3)
tidak pernah menang melawan default. `TELEGRAM_APPROVAL_NOTIFY_ROLES=super_admin` tetap
menotifikasi operator — cakupan notifikasi lebih luas dari yang dikonfigurasi administrator.

**Tasks**
- [x] `resolveNotifyMinRole()` → dihitung tanpa akumulator hardcoded: ambil rank minimum dari
      daftar peran yang benar-benar dikonfigurasi (`Math.min` atas rank tiap peran), lalu petakan
      balik ke nama peran; bila daftar kosong (env unset/string kosong), fallback eksplisit ke
      `'operator'` (perilaku default tidak berubah)
- [x] Peran tak dikenal dalam daftar tetap diperlakukan sebagai `operator` (rank 2) — pertahankan
      fallback `ROLE_NOTIFY_RANK[role] || ROLE_NOTIFY_RANK.operator` yang setara dengan sebelumnya
- [x] Test baru (`lib/shared/test/telegramNotify.test.js`): `'super_admin'` → hasil
      `resolveNotifyMinRole` adalah `super_admin` (bukan lagi `operator`); `'viewer'` → `viewer`
      (semua peran dinotifikasi); kombinasi & fallback yang sudah ada sebelumnya (`super_admin,operator`
      → `operator`, `viewer,super_admin` → `viewer`, string kosong/`undefined`/peran tak dikenal
      → `operator`) tetap diverifikasi sebagai regresi
- [x] `logbook.md`, `CODEBASE_WIKI.md` — catat sebagai perbaikan bug, referensi D4; jelaskan
      dampak: sebelum fix, admin yang mengira sudah membatasi notifikasi ke `super_admin` diam-diam
      tetap membocorkannya ke operator

**Verifikasi**
```bash
npm run test:ci && npm run lint && npm run format:check && npm run test:coverage
```
Manual (opsional, oleh owner): set `TELEGRAM_APPROVAL_NOTIFY_ROLES=super_admin` di staging,
picu satu notifikasi approval, pastikan hanya super admin yang menerima pesan.

**Docs**: `logbook.md`, `CODEBASE_WIKI.md`

**Commit**: `fix(auth): return 403 (not 302) on invalid logout CSRF token (D3)` lalu
`fix(telegram): resolveNotifyMinRole honors configured role instead of defaulting to operator (D4)`

**DoD**: kedua bug punya test regresi yang gagal pada kode lama dan lulus pada kode baru; 4 gate
CI hijau; tidak ada regresi pada test S29 yang sudah ada (selain assertion yang sengaja diubah).

**Risiko/Rollback**: rendah — masing-masing perubahan satu file + test, `git revert` per commit
jika ada regresi produksi (notifikasi hilang total, atau logout gagal untuk client lama yang
mengandalkan redirect).

---

## 4. Sprint 33 — Coverage Bootstrap: `server.js` & `telegram-bot.js` (D2)

**Tujuan**: jalur start/shutdown yang selama ini tidak pernah masuk laporan `node --test`
coverage (karena dijalankan sebagai proses, bukan diimpor) punya jaring pengaman minimal.

**Konteks**: `server.js` (161 baris) dan `telegram-bot.js` (4 baris, entry tipis ke
`lib/features/telegram/bot.js`) tidak pernah diimpor oleh test manapun — keduanya
self-executing (listen/polling langsung saat modul dimuat), sehingga `node --test` tidak
pernah menjalankannya sama sekali. Coverage report memperlakukan mereka sebagai 0% atau
tidak muncul sama sekali, tergantung glob.

**Tasks**
- [x] Pisahkan logika dari efek samping di `server.js`: ekstrak `createShutdownHandler(...)` dan
      `scheduleBackgroundJobs(...)` (murni, testable, nilai default = perilaku lama) dari
      `bootServer()`, dipanggil hanya lewat guard `if (process.argv[1] && import.meta.url === ...)`
      — pola yang sama dengan `bot.js` (S23)
- [x] Test `server.js`: graceful shutdown (`SIGTERM`/`SIGINT` → tutup pool DB, tutup HTTP server,
      exit code 0; tanpa httpServer tetap exit 0; `closeAgentPools` gagal → exit 1; sinyal kedua
      diabaikan; force-exit terpicu bila `closeAgentPools` tidak pernah selesai);
      **temuan tambahan**: tidak ada listener `error` pada `httpServer` sebelumnya — kegagalan
      listen (mis. port terpakai) akan menjatuhkan proses lewat uncaught exception generik.
      Ditambahkan `httpServer.on('error', ...)` yang log lalu `process.exit(1)` terkendali
      (perubahan perilaku kecil, didokumentasikan di komentar kode dan di sini, bukan disembunyikan)
- [x] `lib/features/telegram/bot.js` — **sudah punya seam DI lengkap sejak S23/S27**
      (`createBot`, `startBot({ bot, launch, registerProcessHandlers, exitOnError, ... })`);
      coverage sudah 94,55% line sebelum sprint ini dimulai, jadi tidak ada ekstraksi baru yang
      diperlukan di file ini
- [x] Test bootstrap Telegram: **sudah ada** dari S23/S27 (`botHandlers.test.js`) — token kosong →
      `createBot` throw pesan jelas; `startBot` dengan `bot` palsu memverifikasi urutan
      DB-check → schema → sync command tanpa `launch()` sungguhan; jalur error dikembalikan ke
      caller lewat `exitOnError: false` tanpa memanggil `process.exit` nyata di test
- [x] `qa-smoke.mjs` — tidak ada path/nama fungsi baru yang perlu didaftarkan (server.js bukan view/actuator)

**Verifikasi**
```bash
npm run test:ci && npm run lint && npm run format:check && npm run test:coverage
sudo systemctl restart socai-node socai-bot   # pastikan tidak ada regresi start/shutdown nyata
```

**Hasil aktual**: 295/295 test (9 baru di `test/server.test.js`); lint & format bersih; coverage
84,84% lines / 81,48% branches / 83,25% functions (gate 82/81/78 tetap lulus, margin ≥2,25pp);
`server.js` **76,82% line** (sebelumnya tidak muncul di laporan sama sekali); restart
`socai-node` bersih (`journalctl` menunjukkan shutdown graceful + semua job cron terdaftar
ulang identik); `curl /health` → `status: ok`.

**Docs**: `logbook.md`, `CODEBASE_WIKI.md`

**Commit**: `refactor(server): extract testable shutdown handler and job scheduler from bootstrap (D2)`

**DoD**: `server.js` muncul di laporan coverage dengan angka >0% (76,82%); `bot.js` sudah >0%
dari sebelumnya (94,55%, tidak berubah); restart manual kedua service tetap bersih; 4 gate CI
hijau.

**Risiko**: mengekstrak logika dari file yang production-critical dan selalu aktif via systemd
bisa memutus start/shutdown nyata tanpa test menangkapnya (test memakai fake, bukan proses asli).
**Mitigasi**: restart manual + `journalctl` setelah commit, sama seperti pola S23/S27/S28 —
terbukti bersih (lihat hasil aktual).

---

## 5. Sprint 34 — Coverage `agent/core.js` dengan Fake SDK (D1)

**Tujuan**: permukaan tak-teruji terbesar yang tersisa (565 baris, 9,20% line) dapat diuji
tanpa memanggil SDK `pi-coding-agent` sungguhan.

**Konteks**: `lib/features/agent/core.js` membungkus SDK eksternal dan menyimpan state sesi
percakapan secara global (`sessions` map atau sejenis). S29 sengaja tidak menyentuhnya karena
butuh fake SDK yang benar — menambal asal-asalan demi angka akan merusak arti gate yang baru
dikalibrasi (`sprint-plan-kalibrasi.md` §"Di luar cakupan").

**Prasyarat**: S33 hijau (harness proses tersedia sebagai referensi pola seam).

### Tasks

- [x] Petakan `core.js` sebelum mengubah kode: state modul (`agentSessions`/`agentSessionLastUsed`/
      `agentSessionPromises` + interval cleanup idle), `buildActuatorPromptSection` (pure),
      `buildActuatorContext`/`runActuatorTool` (hardcode `pool` via `runs.js`/`approval.js`),
      `createAgentSessionForKey` (SDK: `ModelRuntime.create`, 6 `defineTool`, `DefaultResourceLoader`,
      `createAgentSession`, `SessionManager.inMemory()`), `initAgent` (reuse/dedupe/cleanup-on-finally).
      Semua fungsi domain yang dipanggil (`getCalendarGaps`, `saveContentPlan`, `scheduleContent`,
      `syncContentStatus`, `countAgentSchedulesToday`, `logToolCall`, `handlePostSaveApproval`)
      **sudah** menerima `pool` sebagai parameter — satu-satunya coupling adalah `core.js` sendiri
      hardcode pool/aiReadPool modul saat memanggilnya
- [x] `test/helpers/fakeAgentSdk.mjs` (baru): `createFakeAgentSdk({ models })` → fake
      `modelRuntimeCreate`/`createAgentSession` (merekam argumen, termasuk `customTools` supaya
      tool bisa dipanggil langsung dari test) /`sessionManagerFactory`/`resourceLoaderFactory`/
      `getAgentDir`/`fetchFn`; `fakePool(handlers)` — fake `pool.query` berbasis pattern match;
      `findTool(customTools, name)` — cari tool descriptor by name dari call yang direkam
- [x] Seam DI `resolveCoreDeps(deps = {})` di `core.js`: satu titik yang meresolve
      `dbPool`/`aiPool`/`env`/`fetchFn` + semua fungsi domain + primitif SDK, dengan **nilai
      default = modul/pool nyata yang sudah dipakai sebelumnya**. `buildActuatorContext`,
      `runActuatorTool`, `createAgentSessionForKey` (kini `export`), dan `initAgent` menerima
      `deps` opsional yang diteruskan berjenjang — tidak ada perubahan logika bisnis, hanya
      titik injeksi. `buildActuatorPromptSection` dijadikan `export` (pure, tanpa DB/SDK)
- [x] Test siklus hidup sesi (`initAgent`): sesi baru dibuat sekali dan disimpan di
      `agentSessions`; sesi yang sudah ada dipakai ulang tanpa memanggil factory lagi (`touchAgentSession`
      ter-update); dua panggilan bersamaan untuk `sessionKey` sama hanya memicu 1 pembuatan sesi
      (dedupe via `agentSessionPromises`); promise dibersihkan dari map walau gagal, dan percobaan
      berikutnya retry (bukan promise gagal yang di-cache selamanya)
- [x] Test pemanggilan tool (lewat `customTools` yang direkam dari `createAgentSession` palsu):
      `db_query` — 9 test guard keamanan (non-SELECT, multi-statement, 9 keyword berbahaya,
      tabel tak diizinkan, JOIN, comma-join, tanpa FROM, panjang query, sukses/kosong/error);
      `get_calendar_gaps`/`schedule_content`/`sync_content_status` — meneruskan params dengan benar,
      error domain dibungkus jadi teks (tidak dilempar), tool call dicatat via `logToolCall`
      (status `ok`/`error`); `save_content_plan` — `handlePostSaveApproval` terpicu hanya saat ada
      `ids`, dan kegagalan hook tidak menjatuhkan tool (dicatat sebagai warning, perilaku lama);
      `web_search` — tanpa `BRAVE_API_KEY` dilewati tanpa memanggil fetch, hasil diformat, kosong,
      dan fetch gagal ditangani
- [x] `aiLimits.js`/`normalizeAiMessage` **tidak dipanggil dari `core.js`** (dipakai di layer
      pemanggil — `bot.js`/`auth/routes.js` — sebelum `initAgent`) — task ini tidak berlaku untuk
      file ini, dicatat sebagai temuan pemetaan, bukan dilewatkan diam-diam
- [x] Ukur agregat setelah selesai: `core.js` **94,59% → 98,20% line** (dua putaran penambahan
      test) — jauh di atas target ≥70%. Sisa 1,8% (baris 43–53) adalah callback interval cleanup
      sesi idle (15 menit sekali) — dicatat sebagai backlog D1-lanjutan, bukan jalur SDK asli

**Verifikasi**
```bash
npm run test:ci && npm run lint && npm run format:check && npm run test:coverage
```
**Hasil aktual**: 330/330 test (35 baru di `lib/features/agent/test/core.test.js`); lint & format
bersih; coverage agregat **90,76% lines / 81,80% branches / 84,38% functions** (naik dari
85,04/81,18/84,07 pasca-S31 karena `core.js` yang tadinya nyaris tidak diuji kini masuk penuh)
— gate 82/81/78 tetap lulus dengan margin lebih lega dari sebelumnya.

**Verifikasi produksi**: `sudo systemctl restart socai-node` → `journalctl` bersih, tidak ada
error dari `agent/core.js`; `curl /health` → `status: ok`. **Smoke chat asisten end-to-end di web
UI tidak dilakukan** — butuh kredensial login admin yang tidak tersedia untuk sesi kerja ini;
didelegasikan ke owner sebagai verifikasi manual pasca-deploy (sama seperti pola verifikasi
produksi lain yang butuh akses privileged).

**Docs**: `logbook.md`, `CODEBASE_WIKI.md`

**Commit**: satu per kelompok fungsi, mis. `refactor(agent): add DI seam for SDK runtime in core.js (D1)`
lalu `test(agent): cover session lifecycle and tool invocation with fake SDK (D1)`; penutup
`docs: record core.js coverage baseline post-D1`

**DoD**: `core.js` ≥70% line coverage dengan test perilaku (bukan uji import) — **tercapai
98,20%**; tidak ada perubahan logika bisnis di commit seam (hanya parameter `deps` opsional,
default = perilaku lama); restart produksi bersih tanpa error; 4 gate CI hijau; gate coverage
**tidak diturunkan** — margin justru melebar karena agregat naik ke 90,76/81,80/84,38 (gate
tetap 82/81/78, tidak dinaikkan di sprint ini agar perubahan tetap murni "refactor + test").

**Catatan penyimpangan dari rencana awal**: smoke chat asisten end-to-end di browser tidak
dilakukan (butuh kredensial admin yang tidak tersedia di sesi ini) — dimitigasi dengan cakupan
test yang jauh lebih luas dari rencana semula (35 test vs. perkiraan awal, termasuk seluruh
guard keamanan `db_query` dan jalur error/logging tiap tool) plus verifikasi bahwa seam hanya
menambah parameter opsional tanpa mengubah satu pun jalur default.

**Risiko**: **tertinggi di dokumen ini** — SDK eksternal, state sesi global, dan jalur AI yang
dipakai user produksi setiap hari.
**Mitigasi**: (1) pemetaan dulu sebelum kode apa pun berubah — dilakukan; (2) fake SDK dibangun
dan divalidasi dulu sebelum dipakai di seam manapun — `defineTool`/`getAgentDir` diverifikasi
pure lewat REPL sebelum ditulis ke fake; (3) restart + `journalctl` setelah commit — dilakukan,
bersih; (4) smoke chat asisten nyata — **tidak dilakukan**, didelegasikan ke owner (lihat catatan
di atas).

**Rollback**: `git revert <hash>` per commit → `sudo systemctl restart socai-node`.

---

## 6. Estimasi Timeline

| Sprint | Backlog | Estimasi | Blocker |
|---|---|---|---|
| S32 | D3 status code + D4 role notifikasi | 0,5 hari | — |
| S33 | D2 coverage bootstrap server/bot | 1 hari | — |
| S34 | D1 coverage `agent/core.js` + fake SDK | 2–3 hari | S33; window restart produksi |

**Total ≈ 3,5–4,5 hari kerja.**

---

## 7. Di Luar Cakupan (dicatat, bukan diabaikan)

- **Sisa 1,8% `agent/core.js`** (baris 43–53, callback interval cleanup sesi idle 15 menit) —
  bukan jalur SDK, sekadar belum ditest; kandidat sprint kecil terpisah bila diperlukan.
- **Smoke chat asisten end-to-end di web UI** untuk S34 — tidak dilakukan (tidak ada kredensial
  admin di sesi kerja ini); perlu dilakukan owner pasca-deploy sebagai verifikasi tambahan.
- **Integration test dengan SDK `pi-coding-agent` asli** (kredensial AI staging) — di luar
  cakupan unit test dengan fake; kandidat sprint tersendiri bila ingin jaring pengaman tambahan
  di atas 35 test perilaku yang sudah ada.
- **`npm audit` / Dependabot berkala di CI** — masih backlog dari `sprint-plan-backlog.md` §9,
  belum tersentuh.
- **Frontend build step** untuk `view.js` (template literal HTML+JS) — tidak terkait D1–D4,
  tetap di luar cakupan.
- **Rate limit login per-akun** — idem, dari `sprint-plan-backlog.md` §9.

---

## 8. Catatan

- Baseline sprint ini berasal dari commit `7365624` (2 Agustus 2026), hasil S31. Jalankan ulang
  `npm run test:coverage` bila sprint dimulai jauh setelah tanggal tersebut untuk memastikan
  gate `82/81/78` masih relevan.
- Prinsip yang dipegang dokumen ini, konsisten dengan seluruh sprint plan sebelumnya: seam DI
  tidak boleh mengubah perilaku produksi; perbaikan bug (D3, D4) adalah perubahan perilaku yang
  disengaja dan didokumentasikan, bukan efek samping refactor.
