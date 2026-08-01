# Sprint Plan — Kalibrasi Gate & Titik Dingin (S29–S31)

**Baseline:** commit `dfaa933` · 2 Agustus 2026
**Skor saat plan ditulis:** 9,2 / 10
**Sumber temuan:** verifikasi ulang pasca S25–S28 (backlog B1–B5 selesai seluruhnya)

---

## 1. Kondisi awal (terukur, bukan klaim)

Diukur dengan `npm run test:coverage` pada `dfaa933`, tanpa exclusion apa pun:

| | Line | Branch | Funcs |
| --- | --- | --- | --- |
| Aktual | 80,84% | 78,58% | 76,52% |
| Gate CI | 53 | 78 | 73 |
| Margin | **+27,84pp** | **+0,58pp** | +3,52pp |

209 test, 209 pass, 0 fail. `lint` dan `format:check` hijau.

Dua masalah pada angka yang sama:

- **Gate `lines=53` sudah tidak menjaga apa pun.** Line coverage boleh runtuh 28pp sebelum CI berbunyi — itu bukan jaring pengaman, itu hiasan.
- **Gate `branches=78` terlalu mepet (0,58pp).** Satu PR kecil bisa memerahkan CI karena varians, bukan karena regresi. Gate yang berbunyi palsu akan dimatikan orang, dan itu lebih berbahaya daripada gate yang longgar.

Menaikkan gate saja tidak cukup: menaikkannya ke 78 sementara aktual 80,84 hanya memindahkan masalah mepet ke baris. Coverage harus naik dulu, gate menyusul.

---

## 2. Temuan yang dikerjakan

| ID | Temuan | Sprint |
| --- | --- | --- |
| C1 | Titik dingin: 6 modul di bawah 45% tanpa seam DI | S29 |
| C2 | `test/s27Coverage.test.js` dinamai menurut sprint, bukan menurut yang diuji | S30 |
| C3 | Gate coverage salah kalibrasi di dua arah | S31 |

**Urutan wajib:** C1 → C2 → C3. Gate dikunci paling akhir supaya angkanya mencerminkan hasil final, bukan target yang dikarang di depan.

### Titik dingin (C1), urut nilai per baris kerja

| Modul | Baris | Line % | Funcs % | Kenapa dingin |
| --- | --- | --- | --- | --- |
| `agent/actuator/schedule.js` | 67 | 8,96 | 0,00 | aktuator autonomy — tak pernah dipanggil test |
| `pemasaran/jobs.js` | 105 | 18,10 | 0,00 | cron background, `pool` di-import langsung |
| `shared/telegramNotify.js` | 60 | 26,67 | 0,00 | butuh token + jaringan |
| `produk/routes.js` | 133 | 22,56 | 25,00 | `pool` di-import langsung |
| `pemasaran/routes.js` | 179 | 21,23 | 18,18 | idem |
| `auth/routes.js` | 94 | 42,55 | 42,86 | jalur login — **paling kritis keamanannya** |
| `evaluasi/routes.js` | 24 | 41,67 | 50,00 | idem |
| `web/routes/pages.js` | 42 | 66,67 | 28,57 | butuh sesi login, tanpa perlu DB |

Akar masalahnya satu dan sama: modul-modul ini meng-import `pool` di level modul, jadi tidak bisa diuji tanpa database sungguhan. Obatnya sudah terbukti di S21 (`agent/routes.js`: 17,76 → 95,45) — seam DI lewat parameter default.

### Di luar cakupan, disebut eksplisit

`lib/features/agent/core.js` — 565 baris, 9,20% line. Ini permukaan tak-teruji terbesar yang tersisa. **Sengaja tidak dikerjakan di sini**: modul ini membungkus SDK `pi-coding-agent` dan menyimpan state sesi global; mengujinya butuh fake SDK yang benar, dan itu sprint tersendiri. Menambalnya asal-asalan demi angka justru merusak arti gate yang baru dikalibrasi. Dicatat sebagai backlog D1.

---

## 3. S29 — Seam DI + test titik dingin (C1)

**Tujuan:** menaikkan line coverage ke ≥85% dengan uji perilaku nyata, bukan uji import.

**Aturan keras:** seam DI hanya boleh menambah parameter dengan **nilai default = perilaku lama**. Dilarang mengubah logika bisnis sambil memasang seam. Satu modul = satu commit, supaya kalau ada regresi produksi, yang di-revert cuma satu.

### Tasks

1. **`shared/telegramNotify.js`** — seam `{ api, listUserIds }`; test: tanpa token → `{ sent: 0, skipped: true, reason: 'no_token' }`; kirim ke banyak operator; satu gagal tidak menghentikan sisanya; dedupe id ganda.
2. **`agent/actuator/schedule.js`** — seam untuk dua fungsi domain; test: `pemasaran_id` bukan angka positif → throw; policy menolak → `policyDenied`; sukses memetakan `repliz_schedule_id`; error domain dibungkus dengan `statusCode` + `cause` utuh.
3. **`pemasaran/jobs.js`** — seam `{ dbPool, syncPlan, schedulePlan, refreshFeedback, sleepFn }`; test: Repliz belum dikonfigurasi → `skipped`; tak ada kanal schedulable → `skipped`; hitung `synced`/`failed`; jadwal yang terlalu dekat (di bawah lead time) tidak diambil; urut menaik + hormati `limit`.
4. **`evaluasi/routes.js`** — seam `dbPool`; test: 200 metrik; pesan "tidak valid" → 400; error lain → 500.
5. **`produk/routes.js`** — seam `dbPool`; test: list, 404 saat id tak ada, validasi nama/harga → 400, URL gambar berbahaya ditolak.
6. **`pemasaran/routes.js`** — seam `dbPool`; test: list, validasi, jalur error.
7. **`auth/routes.js`** — seam `{ dbPool, verifyPassword }`; test: kredensial salah → tidak membocorkan mana yang salah; login sukses **memanggil `session.regenerate`** (regresi anti session-fixation); logout menghancurkan sesi.
8. **`web/routes/pages.js`** — tanpa perubahan kode; test 5 halaman render dengan nonce + redirect `/` → `/login`.

**Verifikasi:** `npm test` hijau setelah tiap commit; `npm run test:coverage` di akhir untuk mencatat angka baru.

**Commit:** `refactor(<area>): add DI seam for <modul> (C1)` lalu `test(<area>): cover <modul> (C1)`.

---

## 4. S30 — Rapikan test grab-bag (C2)

`test/s27Coverage.test.js` (117 baris) menguji view, channel adapter, dan agent runner sekaligus, dan namanya menunjuk nomor sprint — enam bulan lagi tidak ada yang tahu isinya apa.

Pecah sesuai domainnya, ikut konvensi `lib/features/<domain>/test/`:

- view 6 halaman → `lib/web/test/pages.test.js` (digabung dengan hasil S29 task 8)
- adapter threads/instagram → `lib/features/channels/test/adapters.test.js`
- runner + reset sesi → `lib/features/agent/test/runner.test.js`

Assertion dipindah **apa adanya**. Jumlah test total tidak boleh turun.

**Commit:** `test: split sprint-named grab-bag by domain (C2)`

---

## 5. S31 — Kalibrasi gate (C3)

Setelah angka final diketahui, set gate pada **aktual − 3pp** (dibulatkan ke bawah). Margin 3pp cukup untuk menyerap varians runner bersih, tapi cukup ketat untuk menangkap regresi nyata.

**Verifikasi negatif wajib** — gate yang tidak pernah dibuktikan bisa gagal adalah gate yang tidak diketahui berfungsi. Naikkan sementara ke 99, pastikan `npm run test:coverage` **exit non-zero**, lalu kembalikan ke nilai final dan pastikan hijau. Bukti kedua-duanya dicatat di logbook.

**Larangan:** menurunkan gate untuk menghijaukan CI. Kalau coverage turun, yang diperbaiki test-nya.

**Commit:** `ci: recalibrate coverage gate to actual minus 3pp (C3)`

---

## 6. Definition of Done

- [x] 8 modul titik dingin punya test perilaku; tidak ada yang tersisa di bawah 45% line kecuali `agent/core.js`
- [x] Line coverage ≥85%, seluruh gate bermargin 3–5pp
- [x] Gate terbukti bisa merah (verifikasi negatif tercatat)
- [x] Tidak ada file test yang dinamai menurut nomor sprint
- [x] `npm run test:ci`, `lint`, `format:check`, `test:coverage` hijau
- [x] `logbook.md`, `CODEBASE_WIKI.md`, `AGENTS.md` diperbarui
- [x] `/health` produksi tetap `ok` setelah restart

### Hasil aktual

| | Sebelum (`dfaa933`) | Sesudah (`7365624`) |
| --- | --- | --- |
| Test | 209 | **286** |
| Line | 80,84% | **85,04%** |
| Branch | 78,58% | **81,18%** |
| Funcs | 76,52% | **84,07%** |
| Gate | 53/73/78 | **82/81/78** |
| Margin terkecil | 0,58pp | **3,04pp** |

Titik dingin sesudah dikerjakan: `telegramNotify.js` 26,67 → 100%, `actuator/schedule.js`
8,96 → 100%, `pemasaran/jobs.js` 18,10 → 98,10%, `auth/routes.js` 42,55 → 96,81%,
`produk/routes.js` 22,56 → 78,20%, `pemasaran/routes.js` 21,23 → 82,68%,
`evaluasi/routes.js` 41,67 → 100%, `web/routes/pages.js` 66,67 → 100%.

Dua bug lama tersingkap oleh seam DI dan **sengaja tidak diperbaiki di sini** agar sprint
refactor tetap murni; perilaku lamanya dikunci di test dan didaftarkan sebagai D3 dan D4.

## 7. Risiko

| Risiko | Mitigasi |
| --- | --- |
| Seam DI mengubah perilaku produksi | default parameter = perilaku lama; satu modul satu commit; smoke `/health` + Telegram sesudah restart |
| Test login menyentuh bcrypt sungguhan → lambat | `verifyPassword` di-inject; hash asli tidak dipanggil di test |
| Coverage naik dari test dangkal | dilarang test yang hanya meng-import; tiap test harus mengassert perilaku |
| Gate baru jadi mepet lagi | margin ditetapkan sebagai aturan (aktual − 3pp), bukan angka ad-hoc |

## 8. Backlog lanjutan

- **D1** — `agent/core.js` (565 baris, 9,20%): fake SDK `pi-coding-agent`, uji siklus hidup sesi. Sprint tersendiri.
- **D2** — `server.js` dan `telegram-bot.js` tidak pernah masuk laporan coverage; jalur bootstrap/shutdown belum tersentuh.
- **D3** — `POST /logout` dengan CSRF salah mengembalikan 302, bukan 403: `res.status(403).redirect(...)` ditimpa oleh `res.redirect()`. Sesi tetap tidak dihancurkan, jadi ini cacat status code, bukan lubang keamanan. Perbaikannya mengubah kontrak respons, jadi perlu dicek dulu apakah frontend mengandalkan redirect tersebut.
- **D4** — `resolveNotifyMinRole()` tidak pernah menghasilkan peran di atas `operator` karena akumulator `reduce` diinisialisasi `'operator'`. Akibatnya `TELEGRAM_APPROVAL_NOTIFY_ROLES=super_admin` tetap menotifikasi operator — notifikasi persetujuan tersebar lebih luas dari yang dikonfigurasi.
