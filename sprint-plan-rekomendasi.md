# Sprint Plan — Rekomendasi Hasil Skoring Proyek (socai.my.id)

Lanjutan dari `sprint-plan.md` (S0–S18). Dokumen ini menindaklanjuti **5 rekomendasi berprioritas**
dari analisis skoring proyek (skor: **7.8/10**, 1 Agustus 2026).

Aturan main, konvensi commit, dan DoD **mengikuti `sprint-plan.md` §2** — tidak diulang di sini.
Ringkas: implementasi → `npm run test:ci` hijau → `npm run lint` hijau → update docs → commit scoped → push → CI hijau.

---

## 1. Baseline Terukur (1 Agustus 2026)

Diambil dari eksekusi nyata, bukan estimasi:

| Metrik | Nilai |
|---|---|
| `npm test` | 106 pass / 0 fail / 27 suites (~64s) |
| `npm run test:ci` | QA PASSED (unit + QA smoke, `QA_SKIP_HTTP=1`) |
| `npm run lint` | bersih (0 error, 0 warning) |
| Coverage keseluruhan | **39.23% line · 70.97% branch · 54.61% funcs** |
| LOC `lib/` | ~8.930 |
| Interpolasi string di SQL | 0 (semua parameterized) ✅ |

**Coverage modul kritis (baseline):**

| File | Line % | Funcs % | Baris tak tercakup |
|---|---|---|---|
| `lib/features/agent/approval.js` | 42.16 | 57.14 | 25–42, 45–52, 55–83, 97–100 |
| `lib/features/agent/routes.js` | 17.76 | 40.00 | 21–136, 142–150 |
| `lib/features/agent/core.js` | 10.77 | 0.00 | 43–472 |
| `lib/features/agent/runner.js` | 12.50 | 0.00 | 9–80 |
| `lib/features/agent/actuator/schedule.js` | 8.96 | 0.00 | 5–67 |
| `lib/features/auth/routes.js` | 43.88 | 42.86 | 12–20, 25–26, 41–63, 68–92 |

Perintah reproduksi: `npm run test:coverage`

---

## 2. Peta Rekomendasi → Sprint

| ID | Rekomendasi | Sprint | Prioritas nilai | Risiko eksekusi |
|----|---|---|---|---|
| R1 | Coverage `approval.js` + `agent/routes.js` ≥ target | **S20, S21** | Tinggi | Rendah |
| R2 | Gate CI: `prettier --check` + ambang coverage | **S22** | Tinggi | Rendah |
| R3 | Pecah `lib/features/telegram/bot.js` (1.282 baris) | **S23** | Sedang | **Tinggi** |
| R4 | Adopsi migration tool, keluarkan DDL dari `server.js` | **S24** | Sedang | Sedang |
| R5 | Hapus file stale di root | **S19** | Rendah | Rendah |

### Urutan eksekusi ≠ urutan prioritas — alasannya:

1. **R5 didahulukan (S19)** — 30 menit, nol risiko, mengurangi noise di `eslint .` dan coverage report untuk semua sprint berikutnya.
2. **R2 ditunda ke S22** — ambang coverage **tidak boleh** dipasang sebelum S20–S21 menaikkan angkanya. Memasang gate 45% saat baseline 39.23% = CI merah seketika.
3. **R3 paling akhir sebelum R4** — pemecahan bot berisiko runtime tertinggi (long-polling aktif via systemd, tanpa harness test bot; lihat keputusan desain S16 di `sprint-plan.md` §23).

**Dependensi:** S22 ⟵ S20, S21 · S24 ⟵ (tidak ada) · S23 ⟵ S22 (butuh gate lint/format aktif saat memindah 1.282 baris)

---

## 3. Sprint 19 — Higiene Repo: Hapus File Stale (R5)

**Tujuan**: root repo hanya berisi entry point, config, dan docs aktif.

**Konteks**: `test-agent.js` & `test-bot.js` adalah skrip debug manual — tidak masuk glob `npm test`
(`test/**/*.test.js`, `lib/**/*.test.js`), tapi ikut ter-lint dan ikut dihitung `eslint .`.
Keduanya **tracked** di git.

**Tasks (kode)**
- [x] Hapus `test-agent.js` (skrip probe `initAgent`, digantikan test unit S21)
- [x] Hapus `test-bot.js` (probe token Telegraf, sudah tidak relevan sejak F8)
- [x] Pindah `prompt_materi_pptx_automation_marketing.txt` (10KB) → `docs/prompt-materi-pptx.txt`, atau hapus bila tidak dirujuk
- [x] Verifikasi `backups/` tetap gitignored (sudah ✓ di `.gitignore`) — jangan commit `repliz-reschedule-*.json`
- [x] Cek tidak ada referensi tersisa: `grep -rn 'test-agent\|test-bot\|prompt_materi' --include='*.js' --include='*.json' --include='*.yml' . | grep -v node_modules`
  - Catatan: dua hit di `sprint-plan.md:391` dan `logbook.md:574` adalah **catatan historis** — jangan diubah.

**Verifikasi**
```bash
npm run test:ci && npm run lint
git status --porcelain   # harus bersih setelah commit
```

**Docs**: `logbook.md` (entry S19), `CODEBASE_WIKI.md` (tree root)

**Commit**: `chore: remove stale root debug scripts (R5)`

**DoD**: root tidak punya `test-*.js` di luar `test/`; test + lint hijau; CI hijau.

**Risiko/Rollback**: nihil — `git revert` bila ternyata ada dependensi tersembunyi.

---

## 4. Sprint 20 — Coverage `approval.js` ≥ 85% (R1a)

**Tujuan**: gerbang otonomi agent teruji penuh. Ini modul yang menentukan **apa yang boleh dieksekusi
agent tanpa manusia** — 42.16% coverage di sini adalah risiko produksi, bukan sekadar angka.

**Konteks**: `lib/features/agent/test/scheduleApproval.test.js` sudah menguji
`shouldRequestScheduleApproval` + `markPlansPendingApproval` (pola fake pool: objek dengan
method `query(sql, params)` — pertahankan pola ini, jangan tambah library mock).

**Fungsi yang belum tercakup**: `notifyScheduleApprovalRequest` (25–42),
`handlePostSaveApproval` (45–52), `approvePlanSchedule` (55–83), error path `rejectPlanSchedule` (97–100).

**Tasks (kode)**
- [ ] `lib/features/agent/approval.js` — tambah seam injeksi agar dapat diuji tanpa jaringan:
      ubah `notifyScheduleApprovalRequest(plans)` → `notifyScheduleApprovalRequest(plans, { notify = notifyTelegramOperators } = {})`,
      dan `handlePostSaveApproval(dbPool, { ids }, { autonomyMode, notify })` meneruskan `notify`.
      **Default tetap sama** → nol perubahan perilaku produksi.
- [ ] Idem untuk `approvePlanSchedule(dbPool, planId, { schedule = schedulePlanToRepliz } = {})` —
      hindari memanggil Repliz API nyata di test.

**Tasks (test)** — tambah di `lib/features/agent/test/scheduleApproval.test.js`:
- [ ] `notifyScheduleApprovalRequest: kirim 1 pesan per plan dengan inline_keyboard approve/reject`
      → assert `callback_data` = `approve_schedule:<id>` dan `reject_schedule:<id>`
- [ ] `notifyScheduleApprovalRequest: plans kosong → { sent: 0, plans: 0 } tanpa memanggil notify`
- [ ] `handlePostSaveApproval: autonomyMode assistive → { requested: false }, pool tidak disentuh`
- [ ] `handlePostSaveApproval: bounded + REQUIRE_APPROVAL=true + ids valid → requested true + notify terpanggil`
- [ ] `handlePostSaveApproval: bounded tapi semua id sudah punya repliz_schedule_id → requested false`
- [ ] `approvePlanSchedule: id non-numerik/0/negatif → throw statusCode 400`
- [ ] `approvePlanSchedule: plan tidak ada → statusCode 404`
- [ ] `approvePlanSchedule: plan sudah punya repliz_schedule_id → statusCode 409` ← **cegah double-post**
- [ ] `approvePlanSchedule: status 'published' → statusCode 400`
- [ ] `approvePlanSchedule: status 'pending_approval' → memanggil schedule dengan force:false`
- [ ] `approvePlanSchedule: status 'draft' → juga diizinkan`
- [ ] `rejectPlanSchedule: baris tidak match → statusCode 404`
- [ ] `rejectPlanSchedule: pending_approval → status jadi 'cancelled'`

**Verifikasi**
```bash
npm run test:coverage 2>&1 | grep 'approval.js'   # target: line ≥85, funcs 100
npm run test:ci && npm run lint
```

**Docs**: `logbook.md`, `CODEBASE_WIKI.md` (catat seam injeksi di approval.js)

**Commit**: `test(agent): cover approval gate paths, add notify/schedule seams (R1a)`

**DoD**: `approval.js` ≥85% line & 100% funcs; 106 → ~119 test; CI hijau.

**Risiko**: menambah parameter opsional bisa memicu argumen salah di call-site.
**Mitigasi**: `grep -rn 'handlePostSaveApproval\|approvePlanSchedule\|notifyScheduleApprovalRequest' lib/` sebelum & sesudah — pastikan semua call-site produksi tidak berubah.

---

## 5. Sprint 21 — Coverage `agent/routes.js` ≥ 70% + Seam Testability (R1b)

**Tujuan**: route AI (SSE chat + agent runs) teruji tanpa DB dan tanpa memanggil model.

**Konteks**: `registerAsistenRoutes` mengimpor `pool`, `initAgent`, `agentSessions` di module scope →
tidak bisa diuji tanpa DB + kunci API. `test/routes.test.js` saat ini hanya menutup jalur 401/403.
Coverage 17.76% line / 40% funcs.

**Tasks (kode)**
- [ ] `lib/features/agent/routes.js` — ubah signature jadi
      `registerAsistenRoutes(app, deps = {})` dengan destructuring berdefault:
      `const { dbPool = pool, initAgent: initAgentFn = initAgent, sessions = agentSessions, requireAuth = requireLogin } = deps;`
      → `createApp.js` tetap memanggil `registerAsistenRoutes(app)` tanpa perubahan.
- [ ] Idem `registerAgentRunsRoutes(app, deps = {})` (`dbPool`).
- [ ] Ekstrak handler SSE ke fungsi bernama (mis. `handleAsistenChat`) agar bisa diuji terpisah
      dari wiring express — **tanpa mengubah alur `res.writeHead`/`res.write`**.

**Tasks (test)** — file baru `lib/features/agent/test/agentRoutes.test.js`:
- [ ] Helper lokal: bangun `express()` polos, `app.use(express.json())`, inject
      `requireAuth: (req,_res,next)=>{ req.session={user:{id:1}}; req.sessionID='t1'; next(); }`
- [ ] Fake agent session: `{ subscribe(cb){...}, prompt(){...}, abort(){} }` yang meng-emit
      2 event teks lalu selesai — nol jaringan.
- [ ] `POST /api/asisten: message kosong/terlalu panjang → 400 JSON (AiMessageError)` ← jalur `normalizeAiMessage`
- [ ] `POST /api/asisten: header SSE benar (text/event-stream, no-cache)`
- [ ] `POST /api/asisten: session baru → stream berisi '⏳ Menyiapkan AI agent' lalu '✅ Agent siap'`
- [ ] `POST /api/asisten: initAgent throw → event type:'error' lalu res.end(), bukan 500`
- [ ] `POST /api/asisten: rate limiter — request ke-(N+1) dalam window → 429`
      (set `WEB_AI_RATE_LIMIT=2` sebelum import, atau inject limiter)
- [ ] `GET /api/agent/runs: fake pool → JSON array + limit ter-clamp`
- [ ] `GET /api/agent/runs: pool throw → 500 JSON { error }`, tidak bocor stack trace

**Verifikasi**
```bash
npm run test:coverage 2>&1 | grep -E 'agent +\||routes.js'
npm run test:ci
# smoke manual (opsional, butuh app hidup): curl -N -X POST .../api/asisten
```

**Docs**: `logbook.md`, `AGENTS.md` (pola DI untuk route feature), `CODEBASE_WIKI.md`

**Commit**: `test(agent): inject deps into asisten/runs routes + SSE route tests (R1b)`

**DoD**: `agent/routes.js` ≥70% line & ≥80% funcs; coverage keseluruhan naik ke **≥46% line**; CI hijau.

**Risiko**: refactor signature route menyentuh jalur chat produksi.
**Mitigasi**: default parameter identik dengan import lama; verifikasi manual satu request chat di
staging/produksi setelah deploy (owner), sebelum lanjut S22.

---

## 6. Sprint 22 — Gate Kualitas di CI (R2)

**Tujuan**: CI menolak regresi format & penurunan coverage secara otomatis.

**Konteks**: `.github/workflows/ci.yml` sekarang hanya `npm ci` → `npm run test:ci` → `npm run lint`.
`prettier` terpasang tapi hanya ada script `format` (menulis) — tidak pernah dicek di CI.
Belum ada `.prettierrc` → format bergantung default Prettier, rawan diff besar saat pertama dijalankan.

**Tasks (config)**
- [ ] Buat `.prettierrc` eksplisit agar deterministik lintas mesin:
      `{ "printWidth": 110, "singleQuote": true, "trailingComma": "all", "arrowParens": "always" }`
      — `printWidth` besar karena banyak template literal HTML di `view.js`.
- [ ] Buat `.prettierignore`: `node_modules/`, `public/`, `backups/`, `.pi/`, `package-lock.json`, `*.md`
      (docs Indonesia panjang — jangan di-reflow otomatis).
- [ ] **Jalankan `npm run format` sekali** dan commit hasilnya **sebagai commit terpisah**
      (`style: apply prettier baseline`) agar diff fungsional sprint ini tetap terbaca.
- [ ] `package.json` → tambah `"format:check": "prettier --check ."`
- [ ] `package.json` → ubah `test:coverage` menjadi bergate:
      ```
      node --test --experimental-test-coverage \
        --test-coverage-lines=45 --test-coverage-functions=58 --test-coverage-branches=68 \
        "test/**/*.test.js" "lib/shared/**/*.test.js" "lib/features/**/*.test.js"
      ```
      (flag native Node 24 — **tanpa dependensi baru**; ambang diset sedikit di bawah hasil S21
      agar tidak flaky, lalu dinaikkan tiap sprint)
- [ ] `.github/workflows/ci.yml` → tambah step setelah lint:
      `- run: npm run format:check` dan `- run: npm run test:coverage`

**Tasks (kebijakan)**
- [ ] Catat di `AGENTS.md`: **ambang coverage hanya boleh naik, tidak boleh turun**; menurunkan ambang
      wajib disertai alasan di `logbook.md`.

**Verifikasi**
```bash
npm run format:check   # harus exit 0 setelah baseline commit
npm run test:coverage  # harus exit 0; exit 1 bila di bawah ambang
npm run test:ci && npm run lint
```
Verifikasi negatif (wajib, buktikan gate benar-benar menggigit):
```bash
# sementara naikkan --test-coverage-lines=95 → pastikan CI/lokal MERAH, lalu kembalikan
```

**Docs**: `logbook.md`, `AGENTS.md`, `README.md` (bagian skrip npm), `CODEBASE_WIKI.md`

**Commit**: 2 commit — `style: apply prettier baseline` lalu `ci: add format check + coverage thresholds (R2)`

**DoD**: CI menjalankan 4 gate (test:ci, lint, format:check, coverage); gate terbukti merah saat ambang dinaikkan; CI hijau di ambang final.

**Risiko**: commit baseline Prettier menyentuh puluhan file → menyulitkan `git blame`.
**Mitigasi**: commit terpisah + catat hash-nya di `logbook.md`; tim dapat memakai `git blame --ignore-rev`.

---

## 7. Sprint 23 — Pecah `telegram/bot.js` (R3)

**Tujuan**: menutup satu-satunya slice yang melanggar pola vertical slicing proyek sendiri.

**Konteks**: `lib/features/telegram/bot.js` = **1.282 baris** berisi wizard produk, wizard konten,
upload Cloudinary, scheduling Repliz, formatting Markdown, dan seluruh registrasi command.
S16 (`sprint-plan.md` §23) sengaja menunda pemecahan ini: **bot long-polling aktif via systemd,
belum ada harness test**. Sprint ini membangun harness itu **lebih dulu**, baru memecah.

**Prasyarat wajib**: S22 hijau (lint + format + coverage gate aktif).

### Fase A — Harness test bot (jangan pindahkan kode apa pun di fase ini)
- [ ] `bot.js` saat ini **self-executing** (memanggil `startBot()` saat diimpor) → tidak bisa diimpor test.
      Ubah menjadi: ekspor `createBot()` / `startBot()`, dan jadikan `telegram-bot.js` root pemanggilnya
      (`import { startBot } from './lib/features/telegram/bot.js'; startBot();`).
- [ ] Test `lib/features/telegram/test/botFactory.test.js`: `createBot()` dengan token dummy →
      assert daftar command yang teregistrasi (tanpa `bot.launch()`).
- [ ] Fake `ctx` helper (`test/helpers/telegramCtx.mjs`): `{ from, message, reply(), replyWithPhoto(), answerCbQuery() }`
      yang merekam pemanggilan.

### Fase B — Ekstraksi murni (tanpa perubahan logika, satu commit per modul)
- [ ] `helpers/format.js` ← `escMarkdown` (963), `fmtPlan` (1127)
- [ ] `media/cloudinary.js` ← `isCloudinaryConfigured` (753), `uploadBufferToCloudinary` (757), `downloadTelegramPhoto` (778)
- [ ] `wizards/produk.js` ← `isAddProductIntent` (531), `startProductWizard` (537), `handleWizardText` (859), `showProductConfirm` (941), `renderProdukList` (805)
- [ ] `wizards/konten.js` ← `startContentWizard` (548), `normalizeContentType` (569), `normalizeContentGoal` (582), `getContentProductOptions` (597), `formatContentProductOptions` (602), `resolveContentProductChoice` (610), `buildContentPrompt` (625), `handleContentWizardText` (646)
- [ ] `schedule.js` ← `getPlanById` (1132), `scheduleViaRepliz` (1179)
- [ ] `schema.js` ← `ensureMarketingSchema` (93), `syncBotCommands` (86)
- [ ] `bot.js` tersisa: wiring command/handler + state wizard + `startBot()` — target **<400 baris**

### Fase C — Test unit per modul yang diekstrak
- [ ] `normalizeContentType` / `normalizeContentGoal`: input valid, alias, input sampah → default
- [ ] `resolveContentProductChoice`: pilih by nomor, by nama persis, by nama parsial, tidak ketemu → null
- [ ] `buildContentPrompt`: berisi nama produk + tipe + goal
- [ ] `escMarkdown`: karakter `_*[]()` ter-escape
- [ ] `isAddProductIntent`: true/false untuk frasa umum

**Verifikasi**
```bash
node --check lib/features/telegram/**/*.js
npm run test:ci && npm run lint && npm run format:check && npm run test:coverage
wc -l lib/features/telegram/bot.js   # target <400
```
**Verifikasi produksi (wajib, oleh owner)** — bot long-polling tidak tercakup test:
```bash
sudo systemctl restart socai-bot && sudo systemctl status socai-bot
journalctl -u socai-bot -n 50 --no-pager     # tidak ada error saat startup
```
Smoke manual di Telegram: `/status`, `/listproduk`, wizard `tambahproduk` (sampai konfirmasi), `/jadwalkonten`.

**Docs**: `logbook.md`, `AGENTS.md`, `CODEBASE_WIKI.md` (tree `features/telegram/`), `README.md`

**Commit**: satu per fase/modul, mis. `refactor(telegram): extract cloudinary media module (R3-B2)`

**DoD**: `bot.js` <400 baris; semua modul punya minimal 1 test; **bot produksi terverifikasi manual**; CI hijau.

**Risiko**: **tertinggi di dokumen ini.** Bot berjalan di produksi; regresi = wizard rusak untuk user nyata.
**Mitigasi**:
1. Fase A wajib selesai sebelum Fase B — jangan memindah kode tanpa harness.
2. Satu modul per commit → `git revert` presisi.
3. Ekstraksi murni: **dilarang** memperbaiki bug/menata ulang logika di sprint ini (catat temuan ke `logbook.md` untuk sprint terpisah).
4. Restart + smoke Telegram setelah **setiap** commit fase B, bukan di akhir.

**Rollback**: `git revert <hash modul>` → `sudo systemctl restart socai-bot`.

---

## 8. Sprint 24 — Migrasi Skema Berversi (R4)

**Tujuan**: keluarkan DDL dari boot path aplikasi; skema jadi berversi, auditable, dan bisa di-rollback.

**Konteks**: `server.js:23–47` menjalankan `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (14 kolom) +
`CREATE UNIQUE INDEX IF NOT EXISTS` setiap kali proses start, dan `initAgentRunsSchema(pool)`
(`lib/features/agent/runs.js:18–49`) melakukan hal serupa. Idempoten, tapi:
tidak berversi, tidak bisa rollback, tidak bisa mengubah tipe kolom / backfill,
dan menunda `app.listen()` di setiap restart.

**Tasks (tooling)**
- [ ] `npm i -D node-pg-migrate` (devDependency — migrasi dijalankan sebagai langkah deploy, bukan runtime app)
- [ ] `migrations/` + `package.json` scripts:
      `"migrate": "node-pg-migrate -j js -m migrations"`, `"migrate:up": "npm run migrate -- up"`, `"migrate:down": "npm run migrate -- down 1"`
- [ ] Konfigurasi koneksi dari env yang sudah ada (`DB_HOST/DB_NAME/DB_PORT/DB_USER/DB_PASSWORD`) —
      **jangan** tambah variabel `DATABASE_URL` baru tanpa memperbarui `lib/env.js` + `.env.example`.

**Tasks (migrasi)**
- [ ] `migrations/0001_baseline_pemasaran_repliz.js` — salin persis 14 `ADD COLUMN IF NOT EXISTS` + unique index dari `server.js:24–46`, dengan `down` yang eksplisit
- [ ] `migrations/0002_baseline_agent_runs.js` — dari `initAgentRunsSchema` (`runs.js:18–49`)
- [ ] Jalankan di database produksi: karena semua DDL `IF NOT EXISTS`, migrasi baseline **no-op**
      pada DB yang sudah terisi — efeknya hanya mencatat versi di tabel `pgmigrations`.
      Verifikasi dulu di DB copy: `pg_dump --schema-only` sebelum & sesudah → diff harus kosong.

**Tasks (aplikasi)**
- [ ] Hapus `initPemasaranReplizSchema()` dari `server.js`; `Promise.all([...])` → langsung `app.listen()`
- [ ] Hapus pemanggilan `initAgentRunsSchema(pool)` dari boot path (fungsi boleh tetap ada untuk test fixture)
- [ ] Tambah **guard versi skema** di `lib/web/health.js`: query `SELECT max(name) FROM pgmigrations`
      → `/health` melaporkan `checks.schema` (`ok` / `pending`) sehingga skema tertinggal terdeteksi cepat

**Tasks (deploy)**
- [ ] `deploy/README.md` — urutan deploy baru: `git pull` → `npm ci` → **`npm run migrate:up`** → `systemctl restart socai-node socai-bot`
- [ ] `deploy/socai-node.service` — pertimbangkan `ExecStartPre=/usr/bin/npm run migrate:up`
      (**keputusan**: jangan otomatis bila DB user runtime tidak punya hak DDL — lebih aman langkah manual/CD terpisah; catat pilihan di `logbook.md`)

**Verifikasi**
```bash
npm run migrate:up          # DB dev
npm run migrate:down        # rollback 1 → pastikan down script benar
npm run migrate:up
npm run test:ci && npm run lint && npm run test:coverage
curl -s http://127.0.0.1:3010/health | jq .checks   # checks.schema hadir
```

**Docs**: `logbook.md`, `README.md` (setup DB), `AGENTS.md` (aturan: **DDL baru wajib lewat `migrations/`**), `deploy/README.md`, `CODEBASE_WIKI.md`

**Commit**: `feat(db): versioned migrations, remove DDL from boot path (R4)`

**DoD**: `server.js` tidak berisi `ALTER TABLE`/`CREATE INDEX`; `migrations/` berisi 2 baseline;
`pg_dump --schema-only` produksi tidak berubah; `/health` melaporkan status skema; CI hijau.

**Risiko**: migrasi baseline dijalankan di DB produksi yang sudah punya data.
**Mitigasi**: semua DDL baseline `IF NOT EXISTS` (no-op); uji di DB copy hasil `pg_dump` lebih dulu;
backup `pg_dump` sebelum eksekusi produksi; **jangan** jadikan `ExecStartPre` sebelum satu siklus deploy manual sukses.

---

## 9. Estimasi Timeline

| Sprint | Rekomendasi | Estimasi | Blocker |
|---|---|---|---|
| S19 | R5 higiene | 0,5 hari | — |
| S20 | R1a approval coverage | 1 hari | — |
| S21 | R1b agent routes coverage | 1,5 hari | verifikasi chat produksi |
| S22 | R2 gate CI | 1 hari | S20, S21 |
| S23 | R3 pecah bot (A/B/C) | 3 hari | S22; window restart bot |
| S24 | R4 migrasi | 1,5 hari | window maintenance DB |

**Total ≈ 8,5 hari kerja.** S19–S22 (≈4 hari) sudah memberi sebagian besar nilai:
gerbang otonomi teruji + CI mencegah regresi.

---

## 10. Target Metrik (before → after)

| Metrik | Baseline | Target S22 | Target S24 |
|---|---|---|---|
| Coverage line | 39,23% | ≥46% | ≥52% |
| Coverage funcs | 54,61% | ≥58% | ≥64% |
| `approval.js` line | 42,16% | ≥85% | ≥85% |
| `agent/routes.js` line | 17,76% | ≥70% | ≥70% |
| Jumlah test | 106 | ~135 | ~150 |
| Gate CI | 2 (test, lint) | 4 (+format, +coverage) | 4 |
| `bot.js` LOC | 1.282 | 1.282 | <400 |
| DDL di boot path | 2 blok | 2 blok | 0 |
| **Skor proyek (proyeksi)** | **7,8** | **8,4** | **8,8** |

---

## 11. Di Luar Cakupan (backlog, bukan sprint ini)

Tercatat agar tidak hilang, tapi **tidak** termasuk 5 rekomendasi berprioritas:

- **Structured logging** — 67 `console.*` di `lib/`; ganti dengan logger ber-level + request id (pino).
- **`npm audit` / Dependabot di CI** — S2 dulu menangani A3 secara manual; belum ada pengecekan berkala.
- **Coverage `agent/core.js` (10,77%) & `runner.js` (12,50%)** — butuh harness sesi AI; sprint tersendiri.
- **`auth/routes.js` 43,88%** — jalur login sukses butuh fixture DB (testcontainers / DB test terpisah).
- **`actuator/schedule.js` 8,96%** — tercakup sebagian lewat S20 bila `schedulePlanToRepliz` diinjeksi.
- **Frontend build step** — `view.js` masih template literal HTML+JS (`produk/view.js` 520 baris).

---

## 12. Catatan

- Semua angka baseline di dokumen ini berasal dari eksekusi nyata pada **1 Agustus 2026**
  (`npm test`, `npm run lint`, `npm run test:coverage`) — bukan estimasi. Jalankan ulang bila sprint dimulai jauh setelah tanggal tersebut.
- Nomor baris yang dirujuk (mis. `server.js:24–46`, `bot.js:963`) valid pada commit `15ad561`.
- Setiap sprint tetap mengikuti DoD `sprint-plan.md` §2 — termasuk verifikasi CI hijau sebelum sprint berikutnya dimulai.
