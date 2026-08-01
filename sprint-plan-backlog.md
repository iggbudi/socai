# Sprint Plan — Backlog Pasca-Rekomendasi (socai.my.id)

Lanjutan dari `sprint-plan-rekomendasi.md` (S19–S24, R1–R5 selesai).
Dokumen ini menindaklanjuti **5 temuan sisa** dari verifikasi ulang skoring
(skor: **8,6/10**, 2 Agustus 2026) — hal-hal yang muncul *justru karena* S19–S24 berhasil.

Aturan main, konvensi commit, dan DoD **mengikuti `sprint-plan.md` §2**.
Ringkas: implementasi → 5 gate hijau → update docs → commit scoped → push → CI hijau.

---

## 1. Baseline Terukur (2 Agustus 2026, pasca-S24)

Dari eksekusi nyata di commit `6d7a7c9`:

| Metrik | Nilai |
|---|---|
| `npm run test:ci` | 145 pass / 0 fail |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run test:coverage` | lulus gate 41/57/68 |
| Gate CI aktif | 5 step |
| LOC `lib/` | 10.477 |
| `/health` produksi | `status: ok`, `schema.latestMigration: 0002_baseline_agent_runs` |
| `socai-node` / `socai-bot` | active, log startup bersih |

### Dua angka coverage — keduanya benar, artinya beda

| Pengukuran | Line | Branch | Funcs |
|---|---|---|---|
| **Dengan** `--test-coverage-exclude=commands.js` (angka yang dilaporkan CI) | 55,88% | 79,93% | 75,73% |
| **Tanpa** exclude (coverage proyek sesungguhnya) | **39,97%** | 69,62% | **51,44%** |
| Baseline pra-S19 (sebagai pembanding) | 39,23% | 70,97% | 54,61% |

Funcs turun 54,61% → 51,44% **bukan karena kualitas turun**, tapi karena pemecahan `bot.js` (S23)
membuat kode Telegram yang dulu tak pernah ter-*load* test kini masuk laporan. Utangnya jadi
kelihatan — itu progres, bukan kemunduran. Sprint B2 di bawah yang melunasinya.

Reproduksi angka kedua:
```bash
node --test --experimental-test-coverage \
  "test/**/*.test.js" "lib/shared/**/*.test.js" "lib/features/**/*.test.js" "lib/web/**/*.test.js" \
  2>&1 | grep 'all files'
```

### Coverage modul Telegram (target utama B2)

| File | LOC | Line % | Funcs % |
|---|---|---|---|
| `lib/features/telegram/commands.js` | 795 | **23,77** | **3,03** |
| `lib/features/telegram/wizards/produk.js` | 159 | 13,21 | 20,00 |
| `lib/features/telegram/media/cloudinary.js` | 69 | 18,84 | 33,33 |
| `lib/features/telegram/wizards/konten.js` | 233 | 34,33 | 55,56 |
| `lib/features/telegram/bot.js` | 201 | 58,21 | 22,22 |
| `lib/features/telegram/schedule.js` | 44 | 72,73 | 100,00 |

---

## 2. Peta Backlog → Sprint

| ID | Temuan | Sprint | Nilai | Risiko |
|----|---|---|---|---|
| B1 | Gate coverage 41/57/68 terlalu longgar (~15pp di bawah aktual) | **S25** | Tinggi | Rendah |
| B4 | Peletakan test Telegram tidak konsisten (4 di level modul, 2 di `test/`) | **S25** | Rendah | Rendah |
| B3 | `LATEST_SCHEMA_MIGRATION` hardcoded, wajib bump manual | **S26** | Sedang | Rendah |
| B2 | `commands.js` 795 baris @ 23,77% + `--test-coverage-exclude` masih aktif | **S27** | Tinggi | **Tinggi** |
| B5 | 66 `console.*` tanpa structured logging | **S28** | Sedang | Sedang |

### Urutan dan dependensi

1. **B1 didahulukan** — mengunci hasil S19–S24 sebelum pekerjaan baru masuk. Tanpa ini, regresi 15pp lolos CI diam-diam.
2. **B3 sebelum B2** — kecil, independen, dan menutup risiko operasional (`/health` bisa melapor `pending` palsu) sebelum sprint berisiko tinggi dimulai.
3. **B2 paling berat** — menyentuh seluruh handler bot produksi. Butuh gate B1 aktif sebagai jaring pengaman.
4. **B5 terakhir** — menyentuh 66 titik di 12+ file; paling aman dikerjakan saat struktur sudah stabil.

**Dependensi:** S25 ⟵ (tidak ada) · S26 ⟵ (tidak ada) · S27 ⟵ S25 · S28 ⟵ S27 (agar tidak menulis ulang `console.*` di `commands.js` dua kali)

---

## 3. Sprint 25 — Naikkan Gate Coverage + Rapikan Peletakan Test (B1, B4)

**Tujuan**: CI benar-benar menahan regresi, dan konvensi test kembali seragam.

### B1 — Gate coverage

**Konteks**: gate saat ini `41/57/68`, sementara hasil aktual `55,88/75,73/79,93`.
Selisih ~15pp artinya seseorang bisa menghapus separuh test `approval.js` dan CI tetap hijau.
Penurunan ke 41% dulu beralasan (variance clean runner, `logbook.md:856`), tapi setelah S23–S24
angkanya sudah stabil di dua run berturut.

**Tasks**
- [x] Ukur ulang 3× berturut untuk memastikan stabil:
      `for i in 1 2 3; do npm run test:coverage 2>&1 | grep 'all files'; done`
- [x] `package.json` → `--test-coverage-lines=53 --test-coverage-functions=73 --test-coverage-branches=78`
      (margin ~2–3pp di bawah aktual untuk variance runner — **bukan** 15pp)
- [x] Verifikasi negatif: set sementara `--test-coverage-lines=95` → exit 1, lalu kembalikan
- [x] `AGENTS.md` — pertegas aturan yang sudah ada: ambang hanya naik; setiap penurunan wajib
      disertai angka pengukuran + alasan di `logbook.md`

### B4 — Peletakan test

**Konteks**: konvensi repo (sejak F5) adalah co-located di `<fitur>/test/`. Slice Telegram menyimpang:
```
lib/features/telegram/helpers/format.test.js      ← level modul
lib/features/telegram/media/cloudinary.test.js    ← level modul
lib/features/telegram/schedule.test.js            ← level modul
lib/features/telegram/schema.test.js              ← level modul
lib/features/telegram/wizards/konten.test.js      ← level modul
lib/features/telegram/wizards/produk.test.js      ← level modul
lib/features/telegram/test/botFactory.test.js     ← konvensi ✓
lib/features/telegram/test/telegramAccess.test.js ← konvensi ✓
```

**Tasks**
- [x] `git mv` 6 file ke `lib/features/telegram/test/` dengan nama yang tidak bentrok:
      `format.test.js`, `cloudinary.test.js`, `schedule.test.js`, `schema.test.js`,
      `wizardKonten.test.js`, `wizardProduk.test.js`
- [x] Perbaiki path import relatif di tiap file (`./x.js` → `../x.js`, `../x.js` → `../wizards/x.js`)
- [x] Pastikan glob `lib/features/**/*.test.js` tetap menangkap semuanya → jumlah test **tetap 145**
- [x] `AGENTS.md` / `CODEBASE_WIKI.md` — catat konvensi peletakan test secara eksplisit agar tidak menyimpang lagi

**Verifikasi**
```bash
npm run test:ci        # tetap 145 pass — bukan 139
npm run lint && npm run format:check && npm run test:coverage
```

**Docs**: `logbook.md`, `AGENTS.md`, `CODEBASE_WIKI.md`

**Commit**: 2 commit — `test(telegram): move tests to feature test/ dir (B4)` lalu `ci: raise coverage gate to 53/73/78 (B1)`

**DoD**: 145 test tetap lulus; tidak ada `*.test.js` di luar `test/` dalam `lib/features/`; gate terbukti merah saat ambang dinaikkan.

**Risiko/Rollback**: rendah — bila jumlah test turun setelah `git mv`, ada file yang tidak lagi tertangkap glob → `git revert`.

---

## 4. Sprint 26 — Versi Skema Diturunkan dari `migrations/` (B3)

**Tujuan**: hilangkan konstanta manual yang bisa lupa di-bump.

**Konteks**: `lib/shared/schema.js:1` berisi
`export const LATEST_SCHEMA_MIGRATION = '0002_baseline_agent_runs';` — hardcoded.
Menambah `0003_*` tanpa memperbarui konstanta → `/health` melapor `schema.status: pending`
selamanya meski DB sudah benar. Arah gagalnya **aman** (tidak pernah false-ok), tapi menghasilkan
alarm palsu yang lama-lama diabaikan — dan alarm yang diabaikan sama saja dengan tidak ada alarm.

**Tasks (kode)**
- [x] `lib/shared/schema.js` — ganti konstanta dengan pembacaan direktori sekali saat modul dimuat:
      baca `migrations/`, filter `/^\d{4}_.*\.js$/`, urutkan, ambil terakhir, buang ekstensi.
      Pertahankan ekspor `LATEST_SCHEMA_MIGRATION` agar `health.js` tidak berubah.
- [x] Fallback aman: bila direktori tidak terbaca (mis. paket deploy tanpa `migrations/`),
      kembalikan `null` dan laporkan `schema.status: 'unknown'` — **jangan** lempar error yang
      menjatuhkan `/health`.
- [x] Perbandingan tetap eksak (`latestMigration === requiredMigration`) — jangan longgarkan jadi `>=`.

**Tasks (test)** — `lib/shared/test/schema.test.js` (baru):
- [x] `LATEST_SCHEMA_MIGRATION mengikuti file terbaru di migrations/` → assert `0002_baseline_agent_runs` hari ini
- [x] `getSchemaStatus: pool null → error 'Database pool not provided', ok false`
- [x] `getSchemaStatus: fake pool mengembalikan migrasi terbaru → ok true, status 'ok'`
- [x] `getSchemaStatus: fake pool mengembalikan migrasi lama → ok false, status 'pending'`
- [x] `getSchemaStatus: pool throw err.code '42P01' → pesan 'Migration table pgmigrations belum ada'`
- [x] `getSchemaStatus: pool throw error lain → pesan error diteruskan, tidak dilempar`
- [x] `direktori migrations/ tidak ada → status 'unknown', tidak throw`

**Verifikasi**
```bash
npm run test:ci
curl -s http://127.0.0.1:3010/health | jq .checks.schema   # tetap ok setelah restart
```
Uji regresi manual: buat `migrations/0003_dummy.js` sementara → `/health` harus jadi `pending`
tanpa mengubah kode, lalu hapus file dan pastikan kembali `ok`.

**Docs**: `logbook.md`, `AGENTS.md` (aturan: tambah migrasi = cukup taruh file, konstanta ikut sendiri), `CODEBASE_WIKI.md`

**Commit**: `refactor(db): derive latest schema version from migrations dir (B3)`

**DoD**: tidak ada nama migrasi hardcoded di `lib/`; 7 test baru lulus; `/health` produksi tetap `ok` setelah restart.

**Risiko**: pembacaan direktori gagal di lingkungan deploy → `/health` rusak.
**Mitigasi**: fallback `unknown` non-throwing + verifikasi `/health` produksi sebelum menutup sprint.

---

## 5. Sprint 27 — Pecah `commands.js` & Cabut Pengecualian Coverage (B2)

**Tujuan**: melunasi utang yang tersisa dari S23 — monolit tidak hilang, hanya berpindah dari
`bot.js` (1.385 → 201) ke `commands.js` (795 baris, 23,77% line, **3,03% funcs**).

**Konteks**: `--test-coverage-exclude=lib/features/telegram/commands.js` adalah penanda utang yang
sah dan terdokumentasi (`logbook.md:880`) — tapi **sementara**. Selama flag itu aktif, angka
coverage yang dilaporkan CI bukan coverage proyek. Sprint ini mencabutnya.

**Prasyarat**: S25 hijau (gate 53/73/78 aktif).

### Struktur `commands.js` saat ini (hasil pemetaan)

| Blok | Baris | Isi |
|---|---|---|
| Helper akses | 73–101 | `getTelegramUserId`, `formatTelegramRole`, `requireTelegramRole`, `createDefaultRateLimiter` |
| `registerTelegramHandlers` | 103–147 | wiring + dependency resolution |
| Command user/akses | 148–307 | `start`, `status`, `whoami`, `adduser`, `removeuser`, `listusers` |
| **Handler `text`** | **308–478** | blok terbesar & paling tidak teruji |
| Command produk/konten | 480–514 | `listproduk`, `buatkonten`, `tambahproduk`, `batal` |
| Handler `photo` | 515–586 | upload foto → Cloudinary |
| Action inline | 587–686 | `save_produk`, `cancel_produk`, `save_plan`, `approve_schedule`, `reject_schedule` |
| Command jadwal | 687–791 | `jadwalkonten`, `statuskonten`, `ubahstatuskonten`, `hapuskonten`, `jadwalkan`, `postnow`, `retrypost`, `cekpost` |

### Fase A — Perluas harness (jangan pindahkan kode)
- [ ] Perkuat `test/helpers/telegramCtx.mjs`: fake `ctx` dengan `from`, `message`, `callbackQuery`,
      `reply()`, `replyWithPhoto()`, `answerCbQuery()`, `editMessageText()` yang merekam pemanggilan
- [ ] Helper `registerAndCapture()`: jalankan `registerTelegramHandlers` dengan fake `bot` yang
      **menyimpan handler ke Map**, sehingga tiap handler bisa dipanggil langsung di test tanpa Telegraf

### Fase B — Ekstraksi per kelompok (satu commit per modul, ekstraksi murni)
- [ ] `commands/akses.js` ← helper akses + `adduser`/`removeuser`/`listusers`/`whoami`
- [ ] `commands/status.js` ← `start`, `status`
- [ ] `commands/produk.js` ← `listproduk`, `tambahproduk`, `batal`, action `save_produk`/`cancel_produk`
- [ ] `commands/konten.js` ← `buatkonten`, action `save_plan`
- [ ] `commands/jadwal.js` ← 8 command jadwal + action `approve_schedule`/`reject_schedule`
- [ ] `handlers/text.js` ← blok 308–478 (rute wizard aktif → handler yang tepat)
- [ ] `handlers/photo.js` ← blok 515–586
- [ ] `commands.js` tersisa: hanya `registerTelegramHandlers` yang memanggil `registerX(bot, deps)` — target **<150 baris**

### Fase C — Test per modul
- [ ] `requireTelegramRole`: role cukup → lanjut; role kurang → balas penolakan, handler tidak jalan
- [ ] `adduser`/`removeuser`: argumen kosong → pesan usage; id non-numerik → ditolak
- [ ] `handlers/text.js`: state wizard produk aktif → diarahkan ke `handleWizardText`; wizard konten aktif → `handleContentWizardText`; tanpa wizard → jalur chat AI
- [ ] `handlers/photo.js`: Cloudinary tidak terkonfigurasi → fallback simpan lokal; upload gagal → pesan error, bukan crash
- [ ] Action `approve_schedule:<id>` → memanggil `approvePlanSchedule` dengan id ter-parse benar
- [ ] Action `reject_schedule:<id>` → memanggil `rejectPlanSchedule`; error 404 → `answerCbQuery` berisi pesan
- [ ] `cekpost`/`statuskonten`: fake pool kosong → pesan "belum ada", bukan exception

### Fase D — Cabut pengecualian dan setel ulang gate
- [ ] Hapus `--test-coverage-exclude=lib/features/telegram/commands.js` dari `package.json`
- [ ] Ukur agregat sesungguhnya 3× berturut
- [ ] Setel gate baru = hasil aktual − 2pp
- [ ] **Bar kelulusan sprint**: agregat **tanpa** exclude harus **≥53% line / ≥73% funcs** —
      yaitu setidaknya menyamai gate yang S25 tetapkan. Bila belum tercapai, sprint belum selesai;
      **dilarang** menurunkan gate atau mengembalikan flag exclude untuk "menghijaukan" CI.

**Verifikasi**
```bash
node --check lib/features/telegram/**/*.js
npm run test:ci && npm run lint && npm run format:check && npm run test:coverage
wc -l lib/features/telegram/commands.js   # target <150
grep -c 'test-coverage-exclude' package.json   # harus 0
```
**Verifikasi produksi (wajib, oleh owner)** — sama seperti S23, dan terbukti efektif waktu itu:
```bash
sudo systemctl restart socai-bot && journalctl -u socai-bot -n 30 --no-pager
```
Smoke Telegram per fase B: `/status`, `/whoami`, `/listproduk`, wizard `tambahproduk` sampai konfirmasi,
kirim foto, `/jadwalkonten`, dan satu tombol inline approve/reject.

**Docs**: `logbook.md`, `AGENTS.md`, `CODEBASE_WIKI.md` (tree `features/telegram/`), `README.md`

**Commit**: satu per modul, mis. `refactor(telegram): extract jadwal commands (B2-B5)`; penutup `ci: drop coverage exclusion, raise gate (B2-D)`

**DoD**: `commands.js` <150 baris; `--test-coverage-exclude` hilang; agregat sesungguhnya ≥53/73;
bot produksi terverifikasi manual; CI hijau.

**Risiko**: **tertinggi di dokumen ini** — seluruh permukaan command bot produksi.
**Mitigasi**: (1) Fase A wajib tuntas dulu; (2) satu modul per commit agar `revert` presisi;
(3) ekstraksi murni — dilarang memperbaiki bug/menata ulang logika di sprint ini, catat temuan ke
`logbook.md` untuk sprint terpisah; (4) restart + smoke setelah **setiap** commit fase B.

**Rollback**: `git revert <hash modul>` → `sudo systemctl restart socai-bot`.

---

## 6. Sprint 28 — Structured Logging (B5)

**Tujuan**: log bisa di-query saat insiden, bukan digulir manual.

**Konteks**: 66 `console.*` di `lib/` (di luar test), tersebar:
`telegram/bot.js` 9 · `pemasaran/routes.js` 9 · `telegram/commands.js` 8 · `agent/routes.js` 8 ·
`env.js` 6 · `pemasaran/jobs.js` 5 · `produk/routes.js` 4 · `agent/core.js` 4 · `agent/autonomousJobs.js` 4 · sisanya 1–2.
Semuanya masuk journald sebagai teks bebas — tidak ada level, tidak ada korelasi antar-request,
dan prefiks manual (`[Repliz]`, `[AutoPlan]`, `[Chat]`) tidak konsisten.

**Tasks (infra)**
- [ ] `npm i pino` (dependency runtime; **hindari** `pino-pretty` di produksi — journald sudah menangani rendering)
- [ ] `lib/shared/logger.js`:
      - `export const logger` — root logger, level dari `LOG_LEVEL` (default `info`)
      - `export function childLogger(scope)` — `logger.child({ scope })`, menggantikan prefiks manual
      - redaksi wajib: `password`, `token`, `TELEGRAM_BOT_TOKEN`, `authorization`, `cookie`
- [ ] `lib/env.js` — validasi `LOG_LEVEL` (`trace|debug|info|warn|error|fatal`) mengikuti pola
      `validateAutonomyModeEnv` yang sudah ada; tambahkan ke `.env.example`
- [ ] Request id: middleware di `createApp.js` yang men-generate `crypto.randomUUID()` per request,
      simpan di `res.locals.requestId`, sertakan di setiap log route
- [ ] Telegram: sertakan `updateId` + `userId` sebagai korelasi setara request id

**Tasks (migrasi bertahap — satu commit per fitur, jangan sekali sapu)**
- [ ] `lib/shared/*` (4 titik) — paling sedikit dependensi, jadikan percontohan
- [ ] `lib/features/agent/*` (16 titik)
- [ ] `lib/features/pemasaran/*` (14 titik)
- [ ] `lib/features/telegram/*` (19 titik) — **setelah S27**, agar `commands.js` tidak ditulis ulang dua kali
- [ ] `lib/features/{produk,auth,channels,evaluasi}/*` + `lib/env.js` (sisanya)
- [ ] `server.js` — log boot/shutdown ikut logger yang sama

**Aturan pemetaan level (tetapkan sekali, jangan improvisasi)**
| Sekarang | Menjadi |
|---|---|
| `console.error` di `catch` | `log.error({ err }, 'pesan')` |
| `console.warn` (mis. fallback kredensial AI di `db.js`) | `log.warn` |
| `console.log` status boot/cron | `log.info` |
| `console.log` debug per-request (mis. `[Chat] Request, agentReady:`) | `log.debug` |

**Tasks (lint gate)**
- [ ] `eslint.config.js` → `'no-console': 'error'` untuk `lib/**`, dengan pengecualian
      `server.js`, `scripts/**`, `test/**`, `**/*.test.js` — mencegah `console.*` merayap kembali

**Verifikasi**
```bash
grep -rn 'console\.' lib --include='*.js' | grep -v '\.test\.js' | wc -l   # target 0
npm run test:ci && npm run lint && npm run format:check && npm run test:coverage
sudo systemctl restart socai-node socai-bot
journalctl -u socai-node -n 30 --no-pager | jq .   # baris log valid JSON
journalctl -u socai-node --no-pager | grep -i 'password\|token' | head   # harus kosong / ter-redaksi
```
Uji korelasi: kirim satu request `/api/asisten`, pastikan seluruh baris log terkait berbagi `requestId` yang sama.

**Docs**: `logbook.md`, `README.md` (bagian troubleshooting + contoh query journald), `AGENTS.md` (aturan: pakai `childLogger`, bukan `console`), `.env.example`, `deploy/README.md`

**Commit**: `feat(obs): structured logging with pino + request correlation (B5)` + satu commit per fitur

**DoD**: 0 `console.*` di `lib/` (di luar test); `no-console` aktif di ESLint; log produksi valid JSON;
tidak ada rahasia bocor di journald; kedua service berjalan bersih.

**Risiko**: kehilangan visibilitas bila level salah setel, atau rahasia bocor ke log terstruktur.
**Mitigasi**: mulai dari `lib/shared/*` sebagai percontohan; daftar redaksi ditulis sebelum migrasi
pertama, bukan sesudah; verifikasi journald dengan `grep` rahasia sebelum menutup sprint.

---

## 7. Estimasi Timeline

| Sprint | Backlog | Estimasi | Blocker |
|---|---|---|---|
| S25 | B1 gate + B4 peletakan test | 0,5 hari | — |
| S26 | B3 versi skema otomatis | 0,5 hari | — |
| S27 | B2 pecah `commands.js` + cabut exclude | 3 hari | S25; window restart bot |
| S28 | B5 structured logging | 2 hari | S27 |

**Total ≈ 6 hari kerja.** S25–S26 (1 hari) sudah menutup dua risiko nyata:
regresi lolos CI, dan alarm skema palsu.

---

## 8. Target Metrik (pasca-S24 → target)

| Metrik | Sekarang | Target S25–S26 | Target S28 |
|---|---|---|---|
| Coverage line (**tanpa** exclude) | 39,97% | 39,97% | **≥53%** |
| Coverage funcs (**tanpa** exclude) | 51,44% | 51,44% | **≥73%** |
| Gate CI coverage | 41/57/68 | 53/73/78 | = aktual − 2pp |
| Selisih gate vs aktual | ~15pp | ~2pp | ~2pp |
| `--test-coverage-exclude` aktif | 1 | 1 | **0** |
| `commands.js` LOC | 795 | 795 | **<150** |
| Jumlah test | 145 | ~152 | ~185 |
| `console.*` di `lib/` | 66 | 66 | **0** |
| Nama migrasi hardcoded | 1 | **0** | 0 |
| Test di luar konvensi | 6 | **0** | 0 |
| **Skor proyek (proyeksi)** | **8,6** | **8,8** | **9,2** |

---

## 9. Di Luar Cakupan (backlog berikutnya lagi)

- **`npm audit` / Dependabot di CI** — S2 menangani A3 manual; belum ada pengecekan berkala.
  Kandidat sprint kecil setelah S26.
- **Coverage `agent/core.js` (10,77%) & `runner.js` (12,50%)** — butuh harness sesi AI; sprint tersendiri.
- **`auth/routes.js` 41,94%** — jalur login sukses butuh fixture DB (testcontainers / DB test terpisah).
- **`actuator/schedule.js` 8,96%** — belum tersentuh S20 karena diinjeksi sebagai fake.
- **Frontend build step** — `view.js` masih template literal HTML+JS (`produk/view.js` 520 baris);
  perubahan terbesar dan paling tidak mendesak.
- **Rate limit login per-akun** — saat ini hanya per-IP; belum ada lockout akun.

---

## 10. Catatan

- Semua angka baseline berasal dari eksekusi nyata pada **2 Agustus 2026** di commit `6d7a7c9`
  (`npm run test:ci`, `npm run lint`, `npm run format:check`, `npm run test:coverage`, `curl /health`,
  `systemctl`) — bukan estimasi. Jalankan ulang bila sprint dimulai jauh setelah tanggal tersebut.
- Nomor baris yang dirujuk (`commands.js` 73–791, `schema.js:1`) valid pada commit `6d7a7c9`.
- Prinsip yang dipegang dokumen ini: **angka coverage yang dilaporkan harus angka coverage
  sesungguhnya.** Pengecualian boleh dipakai sebagai penanda utang sementara — asal ada sprint
  yang mencabutnya, dan itulah S27.
