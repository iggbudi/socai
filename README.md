# socai — Autonomous AI Agent untuk Otomasi Konten Media Sosial

Sistem manajemen produk dan otomasi konten **Threads** untuk UMKM **Batik Bakaran**, dibangun sebagai implementasi penelitian *Autonomous AI Agent untuk Otomasi Konten Media Sosial*.

Aplikasi menggabungkan **web dashboard**, **bot Telegram**, **AI agent berbasis tool**, dan integrasi **Repliz** untuk penjadwalan/publikasi konten.

| Komponen | URL / Akses |
|----------|-------------|
| Web app | `https://socai.my.id` |
| Repository | `https://github.com/iggbudi/socai` |
| Runtime | Node.js ≥ 24, PostgreSQL |

---

## Fitur Utama

- **Manajemen produk** — CRUD produk, upload gambar (magic-byte validation)
- **Perencanaan pemasaran** — rencana konten Threads, kalender, status
- **Asisten AI** — chat SSE di web & Telegram; tools `db_query` (read-only), `web_search`, dan actuator terkontrol (`save_content_plan`, `schedule_content`, …)
- **Bounded autonomy (P1)** — `AUTONOMY_MODE`, actuator `lib/actuator/`, audit log `agent_runs`
- **Otomasi Repliz** — jadwalkan, post now, retry, sync status, auto-schedule background
- **Bot Telegram** — wizard konten/produk, role-based ACL (`super_admin` / `operator` / `viewer`)
- **Keamanan** — CSRF, CSP nonce, rate limit, Helmet, DB read-only untuk AI

---

## Tech Stack

| Lapisan | Teknologi |
|---------|-----------|
| Runtime | Node.js 24+ (ESM) |
| Web | Express 5, session (`connect-pg-simple`), Helmet |
| Bot | Telegraf (long-polling) |
| Database | PostgreSQL |
| AI | `@earendil-works/pi-coding-agent`, Xiaomi MiMo / fallback |
| Scheduling | Repliz API (Threads) |
| Media | Cloudinary (opsional), `/uploads/` lokal |
| Test | `node:test` + `node:assert` |

---

## Struktur Proyek

```text
socai/
├── server.js              # Bootstrap web + Repliz background jobs
├── telegram-bot.js        # Entry point bot Telegram
├── lib/
│   ├── agent.js           # AI agent, db_query, web_search, connection pools
│   ├── pemasaran.js       # Logik shared pemasaran & Repliz
│   ├── repliz.js          # HTTP client Repliz
│   ├── telegramAccess.js  # Role-based ACL bot
│   ├── csrfToken.js       # CSRF session token
│   ├── health.js          # Health check
│   └── web/               # Modul web (refactor Sprint 3)
│       ├── createApp.js   # Factory Express
│       ├── middleware/    # auth, csrf, csp, rate limit, upload
│       ├── routes/        # pages, auth, health, api/*
│       ├── views/         # HTML templates (nonce CSP)
│       └── replizJobs.js  # Auto sync & auto schedule
├── test/                  # Unit & smoke tests
├── public/uploads/        # Gambar upload lokal
├── telegram-users.json    # Allowlist & role bot
├── scripts/               # SQL setup (mis. read-only user)
├── AGENTS.md              # Panduan untuk coding agent
└── logbook.md             # Catatan pengembangan per sesi
```

---

## Arsitektur Sistem

### Gambaran Umum

Sistem berlapis **presentation → application → AI agent → actuator → data → external services**. Siklus penelitian: **Perceive → Plan → Act → Evaluate**.

```mermaid
flowchart LR
    subgraph Perceive["Perceive"]
        DB["db_query\nproduk & pemasaran"]
        WS["web_search\ntren & riset"]
        GAP["get_calendar_gaps"]
    end

    subgraph Plan["Plan"]
        LLM["LLM Agent\nrencana + copywriting"]
    end

    subgraph Act["Act (bounded)"]
        SAVE["save_content_plan"]
        SCHED["schedule_content"]
        SYNC["sync_content_status"]
    end

    subgraph Evaluate["Evaluate"]
        RUNS["agent_runs\naudit log"]
        MET["Metrik M1–M7"]
        REP["Repliz status"]
    end

    DB --> LLM
    WS --> LLM
    GAP --> LLM
    LLM --> SAVE
    SAVE --> SCHED
    SCHED --> REP
    LLM --> RUNS
    SAVE --> RUNS
    SCHED --> RUNS
    REP --> SYNC
    SYNC --> DB
    RUNS --> MET
```

```mermaid
flowchart TB
    subgraph Presentation["Lapisan Presentasi"]
        WEB["Web UI\n/login /dashboard /produk\n/pemasaran /asisten"]
        TG["Telegram Bot\ncommands & wizards"]
    end

    subgraph Application["Lapisan Aplikasi"]
        EXP["Express lib/web\nREST API + SSE"]
        BOT["telegram-bot.js"]
        JOBS["replizJobs\nauto-schedule & sync"]
    end

    subgraph Agent["Lapisan AI Agent"]
        AG["lib/agent.js"]
        ACT["lib/actuator/\npolicy + wrappers"]
        AR["lib/agentRuns.js"]
    end

    subgraph Data["Lapisan Data"]
        PG[("PostgreSQL\nproduk, pemasaran\nagent_runs, sessions")]
        RO[("socai_ai_read\nread-only pool")]
    end

    subgraph External["Layanan Eksternal"]
        REP["Repliz API\nThreads"]
        LLM["LLM Provider"]
        BR["Brave Search"]
    end

    WEB --> EXP
    TG --> BOT
    EXP --> AG
    BOT --> AG
    AG --> ACT --> PG
    ACT --> AR --> PG
    AG --> RO --> PG
    AG --> BR
    AG --> LLM
    JOBS --> REP --> PG
```

### Prinsip Arsitektur

| Prinsip | Implementasi |
|---------|--------------|
| **Bounded autonomy** | `db_query` SELECT-only; write via actuator + `AUTONOMY_MODE` (`assistive` / `supervised` / `bounded`) |
| **Shared core** | `lib/agent.js`, `lib/pemasaran.js`, `lib/actuator/` dipakai web & bot |
| **Defense in depth** | CSRF, CSP nonce, rate limit, role ACL, URL whitelist, policy caps |
| **Observability** | Setiap agent run & tool call tercatat di `agent_runs` |
| **Human-in-the-loop** | Default `assistive`; supervised/bounded untuk skenario penelitian |

---

## Diagram UML & DAD

Bagian ini mendokumentasikan model sistem sesuai standar dokumentasi perangkat lunak (UML + Diagram Alur Data).

### 1. Use Case Diagram

```mermaid
flowchart LR
    subgraph Actors
        ADM((Admin Web))
        OP((Operator TG))
        VW((Viewer TG))
        SA((Super Admin TG))
        AI((AI Agent))
    end

    subgraph WebUseCases["Web Application"]
        UC1[Login / Logout]
        UC2[Kelola Produk]
        UC3[Kelola Pemasaran]
        UC4[Chat Asisten AI]
        UC5[Jadwalkan ke Repliz]
        UC6[Upload Gambar]
    end

    subgraph BotUseCases["Telegram Bot"]
        UC7[Wizard Konten]
        UC8[Wizard Produk]
        UC9[Chat AI]
        UC10[Kelola Kalender Konten]
        UC11[Post / Sync Repliz]
        UC12[Kelola User Bot]
    end

    subgraph SystemUseCases["Sistem"]
        UC13[Auto Schedule Repliz]
        UC14[Sync Status Repliz]
        UC15[Riset Web]
        UC16[Query DB Read-only]
    end

    ADM --> UC1 & UC2 & UC3 & UC4 & UC5 & UC6
    OP --> UC7 & UC8 & UC9 & UC10 & UC11
    VW --> UC10
    SA --> UC12
    OP --> UC9
    AI --> UC15 & UC16
    UC13 & UC14 -.-> JOBS[Background Jobs]
```

### 2. Activity Diagram — Alur Otomasi Konten

```mermaid
flowchart TD
    START([Mulai]) --> INPUT{Input dari?}
    INPUT -->|Web /asisten| CHAT[User kirim prompt]
    INPUT -->|Telegram wizard| WIZ[Isi form wizard]
    INPUT -->|Telegram free text| CHAT

    CHAT --> AGENT[AI Agent proses]
    WIZ --> AGENT

    AGENT --> READ[db_query: baca produk & pemasaran]
    AGENT --> SEARCH[web_search: riset tren]
    READ --> PLAN[Generate rencana + copywriting + JSON]
    SEARCH --> PLAN

    PLAN --> REVIEW{Review manusia}
    REVIEW -->|Web| SAVE_BTN[Klik Simpan Rencana]
    REVIEW -->|Bot wizard| SAVE_AUTO[Simpan ke DB otomatis]
    REVIEW -->|Batal| END1([Selesai tanpa simpan])

    SAVE_BTN --> DB[(Tabel pemasaran)]
    SAVE_AUTO --> DB

    DB --> SCHED{Jadwalkan?}
    SCHED -->|Manual UI/bot| REPLIZ_MAN[/jadwalkan postnow/]
    SCHED -->|Auto cron| REPLIZ_AUTO[autoSchedulePendingRepliz]
    SCHED -->|Tunda| DRAFT[Status draft]

    REPLIZ_MAN --> REPLIZ_API[Repliz API]
    REPLIZ_AUTO --> REPLIZ_API
    REPLIZ_API --> THREADS[Publikasi Threads]
    REPLIZ_API --> SYNC[syncPendingReplizStatuses]
    SYNC --> DB
    THREADS --> END2([Konten terjadwal / terpublikasi])
    DRAFT --> END3([Draft tersimpan])
```

### 3. Sequence Diagram — Chat Asisten Web (SSE)

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant Express as Express /api/asisten
    participant Agent as lib/agent.js
    participant LLM as LLM Provider
    participant DB as PostgreSQL (read-only)

    User->>Browser: Ketik pesan & kirim
    Browser->>Express: POST /api/asisten (SSE)
    Express->>Express: Validasi CSRF, rate limit, auth

    alt Agent belum ada di sesi
        Express->>Agent: initAgent(sessionID)
        Agent->>LLM: Setup model & tools
        Express-->>Browser: SSE "Menyiapkan agent..."
    end

    Express->>Agent: prompt(message)
    Agent->>DB: db_query (SELECT) [opsional]
    Agent->>LLM: Inference + tool loop
    LLM-->>Agent: text_delta stream
    Agent-->>Express: subscribe events
    Express-->>Browser: SSE data:text chunks
    Agent-->>Express: agent_end
    Express-->>Browser: SSE data:done

    opt Response berisi JSON rencana
        User->>Browser: Klik "Simpan Rencana"
        Browser->>Express: POST /api/pemasaran
        Express->>DB: INSERT pemasaran (pool utama)
    end
```

### 4. Sequence Diagram — Penjadwalan Repliz

```mermaid
sequenceDiagram
    actor Operator
    participant UI as Web / Bot
    participant API as pemasaran routes
    participant PEM as lib/pemasaran.js
    participant REP as lib/repliz.js
    participant DB as PostgreSQL
    participant Threads as Threads via Repliz

    Operator->>UI: Jadwalkan rencana ID
    UI->>API: POST .../repliz/schedule
    API->>PEM: schedulePlanToRepliz(id)
    PEM->>DB: SELECT plan, validasi kanal=threads
    PEM->>REP: createThreadsSchedule()
    REP->>Threads: Schedule post
    Threads-->>REP: schedule_id
    REP-->>PEM: response
    PEM->>DB: UPDATE repliz_schedule_id, status
    PEM-->>API: ok
    API-->>UI: JSON sukses

    Note over API,DB: Background: syncPendingReplizStatuses()<br/>poll status ke DB berkala
```

### 5. Class Diagram — Model Domain (tersederhanakan)

```mermaid
classDiagram
    class User {
        +int id
        +string username
        +string password_hash
    }

    class Produk {
        +int id
        +string nama
        +decimal harga
        +int stok
        +string gambar
        +string deskripsi
    }

    class Pemasaran {
        +int id
        +string judul
        +string strategi
        +string target_audiens
        +string kanal
        +string jadwal
        +string copywriting
        +string status
        +datetime scheduled_at
        +string repliz_schedule_id
        +string repliz_status
        +bool auto_schedule_enabled
    }

    class AgentSession {
        +string sessionKey
        +prompt(message)
        +subscribe(events)
        +abort()
    }

    class TelegramAccess {
        +getRole(userId)
        +hasRole(userId, minRole)
        +addUser(id, role)
        +listUsers()
    }

    class ReplizClient {
        +createThreadsSchedule()
        +getReplizSchedule()
        +isReplizConfigured()
    }

    User "1" --> "0..*" Produk : kelola
    User "1" --> "0..*" Pemasaran : kelola
    AgentSession ..> Produk : db_query read
    AgentSession ..> Pemasaran : db_query read
    Pemasaran --> ReplizClient : schedule/sync
    TelegramAccess ..> User : ACL terpisah
```

### 6. Component Diagram

```mermaid
flowchart TB
    subgraph EntryPoints
        SRV[server.js]
        TGB[telegram-bot.js]
    end

    subgraph WebModule["lib/web"]
        APP[createApp.js]
        MW[middleware/*]
        RT[routes/*]
        VW[views/*]
        RJ[replizJobs.js]
    end

    subgraph SharedLib["lib/ shared"]
        AGT[agent.js]
        PEM[pemasaran.js]
        REP[repliz.js]
        TAC[telegramAccess.js]
        ENV[env.js]
        HL[health.js]
    end

    subgraph Storage
        PG[(PostgreSQL)]
        FS[public/uploads]
        TUF[telegram-users.json]
    end

    SRV --> APP
    APP --> MW & RT & VW
    SRV --> RJ
    RT --> PEM & AGT
    TGB --> AGT & PEM & TAC
    AGT --> PG
    PEM --> REP & PG
    RJ --> PEM & REP
    TGB --> TUF
    RT --> FS
```

### 7. Deployment Diagram

```mermaid
flowchart TB
    subgraph Internet
        USER[Admin Browser]
        TGUSER[Telegram User]
    end

    subgraph VPS["Server VPS (socai.my.id)"]
        NGX[Nginx Reverse Proxy\nHTTPS :443]
        NODE[socai-node.service\n127.0.0.1:3010]
        BOT[socai-bot.service\nlong-polling]
        PG[(PostgreSQL\n:5432)]
    end

    subgraph CloudServices["Layanan Cloud"]
        REPLIZ[Repliz API]
        LLM[Xiaomi / LLM API]
        BRAVE[Brave Search API]
        CLD[Cloudinary]
        THREADS[Meta Threads]
    end

    USER --> NGX --> NODE
    TGUSER --> BOT
    NODE --> PG
    BOT --> PG
    NODE --> REPLIZ
    BOT --> REPLIZ
    NODE --> LLM
    BOT --> LLM
    NODE --> BRAVE
    BOT --> CLD
    REPLIZ --> THREADS
```

### 8. State Diagram — Status Rencana Pemasaran / Repliz

```mermaid
stateDiagram-v2
    [*] --> draft: Rencana dibuat

    draft --> scheduled: Jadwalkan Repliz sukses
    draft --> draft: Edit / tunggu auto-schedule

    scheduled --> pending: Repliz menerima jadwal
    pending --> process: Repliz memproses
    process --> success: Post terbit
    process --> error: Post gagal

    error --> scheduled: Retry (/retrypost)
    success --> [*]

    note right of draft
        auto_schedule_enabled=true
        → cron boleh jadwalkan otomatis
    end note
```

### 9. DAD — Diagram Alur Data

**DAD Level 0 (Diagram Konteks)** — interaksi sistem dengan entitas luar:

```mermaid
flowchart LR
    ADMIN([Admin / Operator])
    TG([Pengguna Telegram])
    SYS[["SISTEM socai\nOtomasi Konten Media Sosial"]]
    REPLIZ([Repliz / Threads])
    LLM([Provider LLM])
    WEBAPI([Brave Search])

    ADMIN <-->|produk, rencana, chat AI| SYS
    TG <-->|wizard, perintah, chat AI| SYS
    SYS <-->|jadwal & status post| REPLIZ
    SYS <-->|inferensi & tool| LLM
    SYS <-->|riset tren| WEBAPI
```

**DAD Level 1** — proses utama di dalam sistem:

```mermaid
flowchart TB
    ADMIN([Admin Web])
    TG([Telegram User])

    subgraph SISTEM_SOCAI["SISTEM socai — Level 1"]
        P1["1.0\nAutentikasi &\nAutorisasi"]
        P2["2.0\nKelola Produk"]
        P3["3.0\nPerencanaan Konten\n(AI Agent)"]
        P4["4.0\nKelola Rencana\nPemasaran"]
        P5["5.0\nOrkestrasi Repliz"]
        P6["6.0\nSinkronisasi\nBackground"]

        D1[(D1: Produk)]
        D2[(D2: Pemasaran)]
        D3[(D3: Users & Sessions)]
        D4[(D4: Telegram ACL)]
    end

    REPLIZ([Repliz])
    LLM([LLM])
    BRAVE([Brave])

    ADMIN --> P1
    TG --> P1
    P1 --> D3
    P1 --> D4

    ADMIN --> P2
    P2 --> D1

    ADMIN --> P3
    TG --> P3
    P3 --> D1
    P3 --> D2
    P3 --> LLM
    P3 --> BRAVE

    P3 -->|JSON rencana| P4
    ADMIN --> P4
    TG --> P4
    P4 --> D2

    ADMIN --> P5
    TG --> P5
    P4 --> P5
    P5 --> D2
    P5 --> REPLIZ

    P6 --> D2
    P6 --> REPLIZ
```

| Proses DAD | Deskripsi | Data Store |
|------------|-----------|------------|
| 1.0 Autentikasi | Login web, session, role Telegram | D3, D4 |
| 2.0 Kelola Produk | CRUD produk & upload gambar | D1 |
| 3.0 Perencanaan AI | Chat, db_query, web_search, generate JSON | D1, D2 (baca) |
| 4.0 Kelola Rencana | Simpan, ubah status, hapus rencana | D2 |
| 5.0 Orkestrasi Repliz | Schedule, post now, retry | D2 ↔ Repliz |
| 6.0 Sinkronisasi | Auto schedule & sync status | D2 ↔ Repliz |

---

## Keamanan

| Mekanisme | Cakupan |
|-----------|---------|
| Session + bcrypt | Login web |
| CSRF Origin/Referer | Semua mutasi `/api/*` |
| CSRF token | `POST /logout` |
| CSP nonce | Inline script/style di views |
| `script-src-attr 'none'` | Event via `addEventListener` |
| Rate limit | Login, AI web, AI Telegram |
| `socai_ai_read` | AI `db_query` SELECT-only |
| Role ACL | Telegram `super_admin` / `operator` / `viewer` |
| URL whitelist | Gambar eksternal (`sanitizeImageUrl`) |

---

## Persiapan & Menjalankan

### Prasyarat

- Node.js ≥ 24
- PostgreSQL
- (Opsional) Akun Repliz, Cloudinary, Brave, Xiaomi API

### Instalasi

```bash
git clone https://github.com/iggbudi/socai.git
cd socai
cp .env.example .env
# Edit .env — isi DB, SESSION_SECRET, APP_URL, token bot, API keys
npm install
```

### Setup database read-only (disarankan)

```bash
psql -U postgres -d socai -f scripts/setup-ai-readonly.sql
# Set DB_AI_READ_USER & DB_AI_READ_PASSWORD di .env
```

### Menjalankan

```bash
npm start          # Web — http://127.0.0.1:3010
npm run bot        # Telegram bot
npm run dev        # Keduanya (development)
npm test           # Unit tests (32 tests)
node test/qa-smoke.mjs   # Smoke test CSP & HTTP
```

### Production (systemd)

```bash
sudo systemctl start socai-node socai-bot
sudo systemctl status socai-node socai-bot
```

Web bind `127.0.0.1` — wajib reverse proxy (Nginx) + `APP_URL=https://socai.my.id`.

---

## Variabel Lingkungan Penting

Lihat `.env.example` untuk daftar lengkap. Ringkasan:

| Variabel | Fungsi |
|----------|--------|
| `DB_*` | Koneksi PostgreSQL utama |
| `DB_AI_READ_*` | Pool read-only untuk AI |
| `SESSION_SECRET`, `APP_URL` | Session & CSRF production |
| `AI_MODEL`, `TELEGRAM_AI_MODEL` | Model LLM (format `provider/model-id`) |
| `XIAOMI_API_KEY` | Provider Xiaomi MiMo |
| `BRAVE_API_KEY` | Tool `web_search` |
| `TELEGRAM_BOT_TOKEN` | Token bot |
| `TELEGRAM_SUPER_ADMIN_ID` | Super admin bot |
| `REPLIZ_*` | Integrasi Threads scheduling |
| `CLOUDINARY_*` | Upload gambar dari Telegram |

---

## Konteks Penelitian

Sistem ini mengimplementasikan **AI agent terkendali** (*bounded autonomy*) untuk UMKM:

- **Perceive:** baca produk & kalender konten (`db_query`), riset tren (`web_search`)
- **Plan:** generate rencana 7 hari + copywriting Threads (JSON terstruktur)
- **Act (terbatas):** simpan & publish melalui actuator (UI, bot, cron Repliz) dengan pengawasan operator

Tingkat autonomi penuh end-to-end menjadi ruang pengembangan lanjutan (lihat `logbook.md`).

---

## Dokumentasi Lain

| File | Isi |
|------|-----|
| [AGENTS.md](AGENTS.md) | Panduan teknis untuk AI coding agent |
| [logbook.md](logbook.md) | Log pengembangan per sesi |
| [CODEBASE_WIKI.md](CODEBASE_WIKI.md) | Wiki codebase (sebagian perlu di-update pasca refactor) |

---

## Lisensi

Proyek privat (`"private": true` di `package.json`). Hak cipta penelitian — Batik Bakaran / socai.my.id.