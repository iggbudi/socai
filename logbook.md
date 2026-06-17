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