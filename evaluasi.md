# evaluasi.md — Prosedur Evaluasi Penelitian

**Proyek:** socai.my.id — Batik Bakaran  
**Judul:** *Autonomous AI Agent untuk Otomasi Konten Media Sosial*  
**Tanggal:** 17 Juni 2026

Dokumen ini melengkapi `autonomous.md` §3.5–3.7 dengan **cara mengumpulkan dan mengekspor metrik M1–M7** setelah P1–P3 selesai.

---

## 1. Metrik penelitian (M1–M7)

| ID | Metrik | Sumber data | Cara baca |
|---|---|---|---|
| M1 | Planning success rate | `agent_runs.tools_called` → `save_content_plan` | Proporsi tool save berstatus `ok` |
| M2 | Schedule success rate | `agent_runs.tools_called` → `schedule_content` | Proporsi tool schedule berstatus `ok` |
| M3 | Human intervention count | `pemasaran` vs attribution `agent_runs` | Proxy: simpan/jadwal manual (bukan dari agent) |
| M4 | Time-to-publish (median) | `agent_runs.started_at` → `pemasaran.published_at` | Waktu dari run agent hingga konten posted |
| M5 | Tool error rate | `agent_runs.status = error` | Proporsi run gagal |
| M6 | Calendar coverage | `pemasaran` 7 hari ke depan | % hari yang sudah punya konten terjadwal |
| M7 | Publish success rate | `pemasaran.repliz_status` / `status` | % konten terjadwal yang berhasil posted |

**Catatan M3:** belum ada event log UI/Telegram per klik; M3 memakai **proxy** (rencana/jadwal tanpa jejak tool agent sukses). Catat intervensi manual tambahan di spreadsheet sesi uji bila perlu.

---

## 2. Cara mengakses metrik

### 2.1 Web UI

1. Login ke https://socai.my.id (atau staging).
2. Buka **Evaluasi** (`/evaluasi`).
3. Pilih periode (7/30/90 hari), mode autonomi, sumber (`web`/`telegram`/`cron`), dan kanal.
4. Kartu M1–M7 + tabel breakdown per mode/sumber akan dimuat dari `GET /api/agent/metrics`.

### 2.2 API (JSON)

```http
GET /api/agent/metrics?days=30&autonomy_mode=bounded&source=web&channel=threads
```

Auth: session login (sama seperti halaman admin).

### 2.3 CLI export

```bash
npm run eval:export
npm run eval:export -- --days=90 --channel=threads --out=exports/metrics-90d.json
```

### 2.4 SQL manual

```bash
psql -d socai -f scripts/export-agent-metrics.sql
```

Sesuaikan array kanal di query M6/M7 jika `ENABLED_CHANNELS` mencakup `instagram`.

---

## 3. Skenario uji terkontrol

Jalankan minimal **3×7 hari rencana** per mode autonomi (lihat `autonomous.md` §3.7):

| Skenario | `AUTONOMY_MODE` | Prompt contoh | Metrik utama |
|---|---|---|---|
| S1 | `assistive` | "Buat rencana konten 7 hari Threads" | M3 tinggi, M1 rendah |
| S2 | `supervised` | "... lalu simpan ke database" | M1 |
| S3 | `bounded` | "... simpan dan jadwalkan minggu depan" | M1, M2, M4 |
| S4 | `bounded` | Duplikasi jadwal sengaja | M5, log error tool |
| S5 | semua | Repliz off / credential invalid | M2 gagal graceful |
| S6 | `bounded` + `REQUIRE_APPROVAL=true` | Jadwal butuh approve Telegram | M2 tertunda |

**Checklist per sesi uji (spreadsheet):**

| Kolom | Isi |
|---|---|
| Tanggal | Hari uji |
| Mode | assistive / supervised / bounded |
| Sumber | web / telegram / cron |
| Skenario | S1–S6 |
| M1–M7 | Salin dari `/evaluasi` atau `eval:export` |
| Catatan operator | Kualitatif: kepuasan, koreksi manual |

---

## 4. Analisis data (skripsi)

1. **Deskriptif** — mean/median M1–M7 per mode (`by_autonomy_mode` di export JSON).
2. **Komparatif** — assistive vs supervised vs bounded (uji Wilcoxon/Mann-Whitney jika n kecil).
3. **Kualitatif** — wawancara singkat operator (5–10 menit) setelah setiap blok 7 hari.
4. **Keamanan** — sample audit `agent_runs.tools_called`: tidak ada secret/API key.

---

## 5. Konfigurasi disarankan per fase uji

| Fase | Env | Tujuan |
|---|---|---|
| Baseline | `AUTONOMY_MODE=assistive` | Ukur M3 (intervensi manual) |
| P1 supervised | `AUTONOMY_MODE=supervised` | Ukur M1 |
| P1 bounded | `AUTONOMY_MODE=bounded`, Repliz aktif | Ukur M1, M2, M4, M7 |
| Approval | `REQUIRE_APPROVAL=true` | Skenario S6 |

---

## 6. Troubleshooting

| Gejala | Penyebab | Tindakan |
|---|---|---|
| M1/M2 `null` | Belum ada tool call pada periode | Perpanjang `days` atau jalankan skenario S2/S3 |
| M4 `null` | Belum ada `published_at` | Tunggu Repliz sync / jalankan `sync_content_status` |
| M6 rendah | Kalender kosong | Agent `get_calendar_gaps` + save rencana |
| M7 rendah | Repliz error | Cek `repliz_last_error`, skenario S5 dokumentasi |

---

*Lihat juga: `autonomous.md`, `AGENTS.md`, `scripts/export-agent-metrics.sql`*