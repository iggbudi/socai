# Roadmap Socai / Bot Telegram AI Agent

Dokumen ini merangkum kemampuan yang sudah dibuat dan rencana pengembangan berikutnya agar tidak lupa arah project.

## Visi

Membangun **domain-specific AI agent** untuk Batik Bakaran, terinspirasi pola OpenClaw/agentic workflow, tetapi fokus pada domain operasional bisnis:

- manajemen produk,
- perencanaan konten marketing,
- pemasaran Threads,
- workflow Telegram yang ramah user non-teknis,
- integrasi gambar Cloudinary,
- dan nantinya auto schedule/publish ke Threads via Repliz.

Prinsip utama:

- AI boleh reasoning dan membantu membuat output.
- Aksi tulis penting tetap lewat handler/tool khusus yang tervalidasi.
- Hindari shell/file/database bebas untuk bot production.
- Buat agent spesifik domain, bukan general-purpose coding agent.

---

## Yang Sudah Dilakukan

### 1. Web App / Dashboard

Status: **Selesai dasar**

Fitur:

- Express.js single-file app `server.js`.
- Auth session login.
- CRUD produk.
- Upload gambar produk lokal ke `public/uploads/`.
- Halaman dashboard.
- Halaman produk.
- Halaman pemasaran.
- Halaman asisten AI.
- API pemasaran support simpan rencana dari JSON AI.
- Tabel `pemasaran` sudah ditambah kolom:

```sql
gambar text
```

- Detail pemasaran di dashboard bisa menampilkan link dan preview gambar.
- Session store production sudah diganti dari MemoryStore ke PostgreSQL table `user_sessions`.
- Warning `SESSION_SECRET`, `APP_URL`, dan MemoryStore sudah diperbaiki.

### 2. Pi SDK / AI Agent

Status: **Berjalan**

File utama:

```text
lib/agent.js
```

AI agent memakai Pi SDK:

```js
@earendil-works/pi-coding-agent
```

Model:

```text
opencode/deepseek-v4-flash-free
```

Tool AI yang tersedia:

#### `db_query`

- Read-only database tool.
- Hanya mengizinkan `SELECT`.
- Tabel yang boleh dibaca:
  - `produk`
  - `pemasaran`
- Tidak boleh `INSERT`, `UPDATE`, `DELETE`, `DROP`, dll.
- Tidak boleh multi statement.
- Tidak boleh JOIN.
- Maksimal hasil ditampilkan 50 row.

#### `web_search`

- Brave Search API.
- Dipakai untuk riset tren batik, marketing, ide konten, dll.
- Jika `BRAVE_API_KEY` kosong, tool memberi pesan bahwa web search belum aktif.

Prompt AI sudah diarahkan untuk:

- fokus Threads,
- tidak menyarankan kanal lain kecuali diminta,
- cek jadwal pemasaran sebelum membuat jadwal baru,
- format jawaban Telegram/OpenClaw style,
- membuat 7 hari konten untuk request umum,
- membuat 1 konten saja jika prompt berasal dari Wizard Konten Marketing Telegram.

### 3. Bot Telegram

Status: **Berjalan dan aktif**

File utama:

```text
telegram-bot.js
```

Bot memakai:

```js
telegraf
```

Bot Telegram juga memakai Pi SDK secara tidak langsung lewat `lib/agent.js`.

Alur chat biasa:

```text
User Telegram
→ telegram-bot.js
→ initAgent(sessionKey)
→ Pi SDK AgentSession
→ tool db_query/web_search bila perlu
→ jawaban dikirim balik ke Telegram
```

### 4. Access Control Bot Telegram

Status: **Selesai dasar**

Super admin:

```text
275313615
```

Whitelist user disimpan di:

```text
telegram-users.json
```

Command akses:

- User belum terdaftar hanya bisa:
  - `/start`
  - `/help`
  - `/whoami`
- User terdaftar bisa memakai fitur bot.
- Hanya super admin bisa memakai:
  - `/adduser USER_ID`

### 5. Command Bot Telegram Saat Ini

Status: **Aktif**

Command default:

```text
/start
/help
/whoami
/status
/listproduk
/buatkonten
/tambahproduk
/batal
```

Command khusus super admin:

```text
/adduser USER_ID
```

Menu command Telegram sudah disinkronkan otomatis saat bot start agar command lama seperti `/exec` atau `/command` tidak muncul lagi.

### 6. `/whoami`

Status: **Selesai**

Menampilkan:

- User ID,
- username,
- nama,
- role,
- Chat ID,
- Chat Type,
- Chat Title.

Digunakan agar user bisa memberi User ID ke super admin untuk didaftarkan.

### 7. `/adduser`

Status: **Selesai dasar**

Format:

```text
/adduser 123456789
```

Hanya bisa dipakai super admin `275313615`.

Menambahkan user ke whitelist `telegram-users.json`.

### 8. `/listproduk`

Status: **Selesai dasar**

Menampilkan daftar produk dari database:

- nama,
- harga,
- stok.

### 9. `/tambahproduk`

Status: **Selesai dasar**

Wizard tambah produk via Telegram.

Alur:

1. nama produk,
2. harga,
3. stok,
4. deskripsi,
5. foto produk atau skip,
6. konfirmasi,
7. simpan ke tabel `produk`.

Foto produk saat ini disimpan lokal ke:

```text
public/uploads/
```

Natural language shortcut juga ada:

- `tambah produk`
- `tambahkan produk`
- `input produk`
- `masukkan produk`
- `produk baru`

Shortcut sudah diperbaiki agar tidak salah menangkap prompt internal `/buatkonten`.

### 10. `/buatkonten` — Content Marketing Wizard

Status: **Selesai versi awal**

Tujuan:

Agar user tidak harus prompt panjang. Bot mengumpulkan brief dulu, baru melempar ke LLM setelah lengkap.

Alur wizard:

1. Pilih jenis konten:
   - Edukasi
   - Storytelling / brand story
   - Soft selling
   - Promo / limited stock
   - Engagement / tanya jawab
   - Custom

2. Pilih tujuan konten:
   - Awareness — mengenalkan Batik Bakaran / produk
   - Edukasi — memberi pengetahuan motif, bahan, perawatan
   - Engagement — memancing komentar / diskusi
   - Trust building — membangun kepercayaan dan cerita brand
   - Traffic / inquiry — mendorong orang tanya stok/harga
   - Conversion — mendorong pembelian secara halus
   - Retention — menjaga pelanggan lama tetap ingat
   - Custom

3. Pilih produk terkait dari list produk database.
   - User tinggal membalas angka.
   - Bisa pilih `0` untuk konten tanpa produk spesifik.
   - Tidak ada fitur tambah produk di wizard konten.

4. Isi target audiens.
5. Isi jadwal hari/jam.
6. Isi tone/gaya bahasa.
7. Isi catatan tambahan.
8. Tambahkan gambar atau skip.
9. Jika foto dikirim, upload ke Cloudinary.
10. Brief lengkap dikirim ke LLM.
11. LLM membuat 1 konten Threads.
12. Bot mendeteksi JSON dan menampilkan tombol `📋 Simpan Rencana`.
13. Saat tombol ditekan, data masuk ke tabel `pemasaran`.

### 11. Cloudinary Integration

Status: **Selesai dasar**

Environment:

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Untuk `/buatkonten`:

- Foto dari Telegram diupload ke Cloudinary.
- URL Cloudinary dikirim ke LLM.
- LLM diminta mengisi field JSON `gambar`.
- Saat disimpan, URL masuk ke kolom `pemasaran.gambar`.

Catatan keamanan:

- Cloudinary secret pernah dikirim di chat.
- Sebaiknya rotate secret jika chat ini tidak sepenuhnya privat.

### 12. Format Jawaban Telegram

Status: **Diperbaiki**

Masalah sebelumnya:

```text
**Daftar Produk Batik Bakaran**
```

muncul literal, tidak bold.

Perbaikan:

- Bot mengonversi Markdown umum ke Telegram HTML.
- `**teks**` menjadi bold.
- Inline code dan code block tetap dirapikan.
- Heading `# Judul` dibuat bold.

### 13. Simpan Rencana Pemasaran

Status: **Berjalan**

Jika AI mengirim JSON block di akhir jawaban, bot menampilkan tombol:

```text
📋 Simpan Rencana
```

Data disimpan ke tabel `pemasaran`.

Field yang didukung:

- `judul`
- `strategi`
- `target_audiens`
- `kanal`
- `jadwal`
- `copywriting`
- `produk_terkait`
- `gambar`

`kanal` dinormalisasi menjadi:

```text
threads
```

Duplicate schedule untuk kanal Threads dicegah dengan validasi sederhana berdasarkan teks `jadwal`.

---

## Insight Arsitektur Saat Ini

Bot Telegram sekarang sudah masuk kategori:

```text
Bot Telegram + AI Agent + Workflow Automation
```

Mirip pola OpenClaw, tetapi domain-specific.

Perbedaan utama dengan general agent seperti OpenClaw:

- OpenClaw lebih general untuk coding/automation.
- Bot ini lebih spesifik untuk Batik Bakaran, produk, stok, konten, pemasaran Threads.
- Tool AI dibatasi agar aman.
- Aksi tulis dilakukan oleh handler khusus, bukan shell/database bebas.
- Lebih ramah user non-teknis.

---

## Yang Belum Dilakukan / Roadmap Berikutnya

## Phase 2 — Inventory Agent

Status: **Belum**

Tujuan:

Menjadikan bot sebagai asisten stok dan inventory sederhana.

Fitur yang disarankan:

### 1. `/stokrendah`

Menampilkan produk:

- stok 0,
- stok <= threshold tertentu,
- rekomendasi restock,
- rekomendasi konten clearance/promo.

### 2. `/updatestok`

Wizard update stok produk.

Alur:

1. pilih produk dari list,
2. input stok baru,
3. konfirmasi,
4. update tabel `produk.stok`.

Bisa juga support natural language:

```text
ubah stok Batik A jadi 12
```

Tetap harus ada validasi/konfirmasi.

### 3. Riwayat perubahan stok

Butuh tabel baru opsional:

```sql
stok_log (
  id serial primary key,
  produk_id integer,
  old_stok integer,
  new_stok integer,
  changed_by text,
  source text,
  created_at timestamp default now()
)
```

---

## Phase 3 — Marketing Calendar Agent

Status: **Belum**

Tujuan:

Bot bisa melihat, mengatur, dan memantau kalender konten.

Command yang disarankan:

### `/jadwalkonten`

Menampilkan konten terjadwal:

- hari ini,
- minggu ini,
- bulan ini.

### `/statuskonten`

Menampilkan berdasarkan status:

- draft,
- scheduled,
- posted,
- failed,
- cancelled.

### `/ubahstatuskonten`

Wizard update status pemasaran.

Status yang disarankan:

```text
draft
scheduled
posting
posted
failed
cancelled
```

Saat ini kolom `status` sudah ada, tetapi belum dimanfaatkan maksimal.

### `/hapuskonten`

Hapus rencana pemasaran dengan konfirmasi ganda.

Contoh:

```text
Ketik HAPUS 12 untuk konfirmasi.
```

---

## Phase 4 — Repliz Integration untuk Auto Schedule Threads

Status: **Belum**

Tujuan:

Menghubungkan konten yang sudah dibuat ke Repliz agar bisa auto schedule/publish ke Threads.

Target flow:

```text
Telegram Bot / Dashboard
→ buat konten pemasaran
→ simpan ke tabel pemasaran
→ jadwal terdeteksi
→ worker scheduler
→ Repliz API
→ auto publish ke Threads
→ update status pemasaran
```

### Database changes yang disarankan

Tabel `pemasaran` sebaiknya ditambah:

```sql
ALTER TABLE pemasaran ADD COLUMN IF NOT EXISTS scheduled_at timestamp;
ALTER TABLE pemasaran ADD COLUMN IF NOT EXISTS published_at timestamp;
ALTER TABLE pemasaran ADD COLUMN IF NOT EXISTS external_post_id text;
ALTER TABLE pemasaran ADD COLUMN IF NOT EXISTS external_status text;
ALTER TABLE pemasaran ADD COLUMN IF NOT EXISTS last_error text;
```

Alasan:

- `jadwal` saat ini text bebas, bagus untuk manusia tapi kurang aman untuk scheduler.
- `scheduled_at` dipakai mesin.
- `published_at` untuk catatan waktu publish.
- `external_post_id` untuk ID posting dari Repliz/Threads.
- `external_status` untuk status dari Repliz.
- `last_error` untuk debugging jika gagal.

### Normalisasi Jadwal

Wizard `/buatkonten` sekarang masih menerima jadwal bebas.

Untuk scheduler, jadwal harus jadi timestamp machine-readable.

Pilihan implementasi:

1. Buat input jadwal lebih ketat di wizard.
   Contoh:

```text
2026-05-29 19:00
```

2. Tambahkan parser jadwal Indonesia.
3. Minta AI mengisi `scheduled_at`, tapi tetap validasi manual di kode.

Rekomendasi:

- Tetap simpan `jadwal` untuk manusia.
- Tambahkan `scheduled_at` untuk scheduler.
- Bot memvalidasi format tanggal sebelum simpan/jadwalkan.

### Repliz API yang perlu diketahui

Belum diimplementasikan karena masih butuh detail:

- API base URL,
- API key/token,
- endpoint schedule/publish Threads,
- format payload,
- support gambar URL atau upload multipart,
- timezone,
- format response,
- cara cek status posting.

Payload kira-kira:

```json
{
  "platform": "threads",
  "text": "copywriting siap posting",
  "media_url": "https://res.cloudinary.com/...",
  "scheduled_at": "2026-05-29T19:00:00+07:00"
}
```

### Worker Scheduler

Belum dibuat.

Rencana:

- berjalan tiap 1 menit,
- cari konten dengan status `scheduled`,
- `scheduled_at <= NOW()`,
- kirim ke Repliz,
- update status:
  - `posting`,
  - `posted`,
  - `failed`.

Pseudo-flow:

```text
setInterval setiap 60 detik
→ SELECT pemasaran WHERE status='scheduled' AND scheduled_at <= NOW()
→ call Repliz API
→ jika sukses: status='posted', published_at=NOW(), external_post_id=...
→ jika gagal: status='failed', last_error=...
```

### Command Repliz yang disarankan

```text
/jadwalkan ID
```

Menjadwalkan konten ke Repliz.

```text
/postnow ID
```

Post sekarang via Repliz.

```text
/batalpost ID
```

Batalkan jadwal.

```text
/retrypost ID
```

Coba ulang konten yang gagal.

```text
/cekpost ID
```

Cek status post dari Repliz.

### Approval flow yang disarankan

Jangan langsung auto publish semua hasil AI.

Flow aman:

```text
AI buat konten
→ tombol Simpan Rencana
→ user review
→ tombol/command Jadwalkan ke Threads
→ masuk queue scheduler
→ Repliz publish
```

---

## Phase 5 — Reporting Agent

Status: **Belum**

Tujuan:

Bot bisa membuat laporan produk dan pemasaran.

Command yang disarankan:

```text
/laporanmingguan
/laporanbulanan
/laporanproduk
/laporanpemasaran
```

Output awal bisa berupa teks Telegram.

Tahap berikutnya bisa generate PDF.

Tool yang disarankan:

```text
generate_pdf_report
```

Lebih aman jika tool ini terbatas, bukan shell bebas.

Contoh isi laporan:

- total produk,
- produk stok kosong,
- produk stok rendah,
- daftar konten dibuat minggu ini,
- konten scheduled/posted/failed,
- rekomendasi aksi minggu depan.

---

## Phase 6 — Performance / Analytics Agent

Status: **Belum**

Saat ini database belum punya data performa.

Belum bisa akurat menjawab:

- produk terlaris,
- omzet,
- conversion rate,
- engagement konten,
- konten paling efektif.

Tabel tambahan yang disarankan:

### `penjualan`

```sql
CREATE TABLE penjualan (
  id serial primary key,
  produk_id integer references produk(id),
  qty integer not null,
  total_harga numeric not null,
  tanggal timestamp default now(),
  channel text,
  customer_name text,
  catatan text
);
```

### `aktivitas_konten`

```sql
CREATE TABLE aktivitas_konten (
  id serial primary key,
  pemasaran_id integer references pemasaran(id),
  tanggal_posting timestamp,
  views integer default 0,
  likes integer default 0,
  replies integer default 0,
  reposts integer default 0,
  clicks integer default 0,
  status text,
  created_at timestamp default now()
);
```

Jika Repliz bisa menarik metrik Threads, data bisa masuk ke tabel ini.

---

## Phase 7 — Skills

Status: **Belum dibuat sebagai file skill formal**

Saat ini instruksi masih banyak tertanam di prompt `lib/agent.js`.

Nanti bisa dipisah menjadi Pi skill agar lebih modular.

Skill yang disarankan:

### 1. `threads-content-planner`

Isi:

- SOP membuat konten Threads,
- format OpenClaw style,
- aturan 7 hari vs 1 konten wizard,
- wajib cek jadwal lama,
- JSON output valid.

### 2. `batik-copywriting-style`

Isi:

- tone Batik Bakaran,
- bahasa heritage/lokal/elegan,
- contoh caption,
- larangan hard selling berlebihan,
- template edukasi motif,
- template storytelling perajin.

### 3. `inventory-manager`

Isi:

- cara membaca stok,
- threshold stok rendah,
- rekomendasi restock,
- rekomendasi promosi stok menumpuk.

### 4. `marketing-audit`

Isi:

- audit variasi konten,
- audit jadwal bentrok,
- audit produk yang terlalu sering/jarang dipromosikan,
- rekomendasi kalender berikutnya.

---

## Tool Tambahan yang Disarankan

Belum diimplementasikan.

### `low_stock_alert`

Cek stok rendah dan stok habis.

### `update_stock`

Update stok produk dengan validasi.

### `create_marketing_plan`

Tool khusus insert pemasaran agar AI bisa menyimpan konten lewat tool terkontrol, bukan SQL bebas.

### `update_marketing_status`

Update status rencana pemasaran.

### `schedule_threads_post`

Integrasi Repliz untuk jadwalkan post Threads.

### `publish_threads_now`

Integrasi Repliz untuk publish langsung.

### `generate_pdf_report`

Generate laporan PDF dari data produk dan pemasaran.

---

## Catatan Keamanan

- Jangan memberikan tool bawaan Pi seperti `bash`, `write`, `edit`, atau akses file bebas ke bot Telegram production.
- Jangan memberi AI akses database write bebas.
- Gunakan custom tool sempit dan tervalidasi.
- Tetap pakai whitelist user Telegram.
- Untuk aksi berisiko, gunakan konfirmasi ganda.
- Token Telegram dan secret Cloudinary yang pernah dikirim di chat sebaiknya di-rotate jika chat tidak privat.

---

## Prioritas Berikutnya yang Disarankan

Urutan paling masuk akal:

1. Rapikan `/buatkonten` sampai stabil.
2. Tambah `scheduled_at` dan validasi jadwal.
3. Tambah `/jadwalkonten` untuk lihat kalender.
4. Tambah status flow `draft/scheduled/posted/failed`.
5. Integrasi Repliz API untuk schedule Threads.
6. Tambah `/postnow`, `/retrypost`, `/batalpost`.
7. Tambah inventory tools: `/stokrendah`, `/updatestok`.
8. Tambah laporan mingguan/bulanan.
9. Tambah tabel engagement/performance.
10. Pecah prompt besar menjadi Pi skills formal.
