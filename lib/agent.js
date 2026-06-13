import pg from 'pg';
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  defineTool,
  DefaultResourceLoader,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const { Pool } = pg;

// ---------- Database Pool ----------
export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || '127.0.0.1',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'socai',
  port: Number(process.env.DB_PORT) || 5432,
});

// ---------- AI Agent Setup ----------
export const agentSessions = new Map();
export const agentSessionLastUsed = new Map();
export const agentSessionPromises = new Map();
export const AGENT_SESSION_TTL_MS = 1000 * 60 * 60 * 4; // 4 jam

export function touchAgentSession(sessionKey) {
  agentSessionLastUsed.set(sessionKey, Date.now());
}

// Cleanup idle agent sessions
setInterval(() => {
  const now = Date.now();
  for (const [sessionKey, lastUsed] of agentSessionLastUsed) {
    if (now - lastUsed > AGENT_SESSION_TTL_MS) {
      const session = agentSessions.get(sessionKey);
      session?.abort().catch(() => {});
      agentSessions.delete(sessionKey);
      agentSessionLastUsed.delete(sessionKey);
      agentSessionPromises.delete(sessionKey);
      console.log('[AI] Cleaned up idle agent session:', sessionKey);
    }
  }
}, 15 * 60 * 1000);

async function createAgentSessionForKey(sessionKey) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  // Model AI dengan fallback. Format env:
  // AI_MODEL=provider/model-id, AI_MODEL_FALLBACKS=provider/model-a,provider/model-b
  // Khusus Telegram bisa override dengan TELEGRAM_AI_MODEL dan TELEGRAM_AI_MODEL_FALLBACKS.
  const parseModelRef = (value) => {
    const text = String(value || '').trim();
    const slashIndex = text.indexOf('/');
    if (slashIndex <= 0 || slashIndex === text.length - 1) return null;
    return { provider: text.slice(0, slashIndex), modelId: text.slice(slashIndex + 1), ref: text };
  };
  const splitModelRefs = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  const isTelegramSession = String(sessionKey || '').startsWith('telegram:');
  const modelCandidates = [
    ...(isTelegramSession ? [process.env.TELEGRAM_AI_MODEL, ...splitModelRefs(process.env.TELEGRAM_AI_MODEL_FALLBACKS)] : []),
    process.env.AI_MODEL,
    ...splitModelRefs(process.env.AI_MODEL_FALLBACKS),
    'opencode/deepseek-v4-flash-free',
  ].map(parseModelRef).filter(Boolean);

  let model = null;
  const triedModels = [];
  for (const candidate of modelCandidates) {
    triedModels.push(candidate.ref);
    model = modelRegistry.find(candidate.provider, candidate.modelId);
    if (model) {
      console.log(`[AI] Using model ${candidate.ref} for session ${sessionKey}`);
      break;
    }
  }

  if (!model) {
    throw new Error(`Tidak ada model AI yang tersedia. Dicoba: ${triedModels.join(', ')}. Periksa konfigurasi provider/API key.`);
  }

  const dbQueryTool = defineTool({
    name: 'db_query',
    label: 'DB Query',
    description: 'Jalankan query SQL SELECT pada database Batik Bakaran. Tabel yang boleh dibaca: produk (id, nama, harga, stok, gambar, deskripsi, created_at, updated_at) dan pemasaran (id, judul, strategi, target_audiens, kanal, jadwal, scheduled_at, copywriting, produk_terkait, gambar, status, created_at). Hanya SELECT, tidak bisa INSERT/UPDATE/DELETE.',
    parameters: Type.Object({
      query: Type.String({ description: 'SQL SELECT query yang akan dijalankan' }),
    }),
    execute: async (_toolCallId, params) => {
      const query = params.query.trim();
      const q = query.toUpperCase();

      // Security: Only allow SELECT statements
      if (!q.startsWith('SELECT')) {
        return { content: [{ type: 'text', text: 'Error: Hanya query SELECT yang diizinkan.' }], details: {} };
      }

      // Security: Block multi-statement queries (semicolon outside of quotes)
      if (/;\s*\S/.test(query)) {
        return { content: [{ type: 'text', text: 'Error: Multi-statement queries tidak diizinkan.' }], details: {} };
      }

      // Security: Block dangerous keywords even in SELECT context
      const dangerous = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE'];
      for (const word of dangerous) {
        if (new RegExp(`\\b${word}\\b`).test(q)) {
          return { content: [{ type: 'text', text: `Error: Keyword ${word} tidak diizinkan dalam query.` }], details: {} };
        }
      }

      // Security: Only allow reads from approved tables (including subqueries)
      const normalizeTableName = (name) => name.replace(/"/g, '').toLowerCase();
      const allowedTables = new Set(['produk', 'public.produk', 'pemasaran', 'public.pemasaran']);
      const fromMatches = [...q.matchAll(/\bFROM\s+([\w."_]+)([\s\S]*?)(?=\bWHERE\b|\bGROUP\b|\bORDER\b|\bLIMIT\b|\bOFFSET\b|\bHAVING\b|\bUNION\b|$)/g)];
      if (fromMatches.length === 0) {
        return { content: [{ type: 'text', text: 'Error: Query harus membaca dari tabel produk atau pemasaran.' }], details: {} };
      }
      for (const match of fromMatches) {
        const table = normalizeTableName(match[1]);
        const tableClauseTail = match[2] || '';
        if (tableClauseTail.includes(',')) {
          return { content: [{ type: 'text', text: 'Error: Hanya satu tabel yang boleh dibaca per query.' }], details: {} };
        }
        if (!allowedTables.has(table)) {
          return { content: [{ type: 'text', text: 'Error: Hanya tabel produk dan pemasaran yang boleh dibaca.' }], details: {} };
        }
      }
      if (/\bJOIN\b/.test(q)) {
        return { content: [{ type: 'text', text: 'Error: JOIN tidak diizinkan. Query tabel produk dan pemasaran secara terpisah.' }], details: {} };
      }

      // Security: Limit query length
      if (query.length > 1000) {
        return { content: [{ type: 'text', text: 'Error: Query terlalu panjang (max 1000 karakter).' }], details: {} };
      }

      try {
        const result = await pool.query(query);
        const rows = result.rows.slice(0, 50);
        const summary = rows.length === 0
          ? 'Tidak ada hasil.'
          : `Ditemukan ${result.rows.length} data${result.rows.length > 50 ? ' (ditampilkan 50)' : ''}:\n` +
            JSON.stringify(rows, null, 2);
        return { content: [{ type: 'text', text: summary }], details: {} };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], details: {} };
      }
    },
  });

  const webSearchTool = defineTool({
    name: 'web_search',
    label: 'Web Search',
    description: 'Cari informasi dari internet via Brave Search API. Gunakan untuk riset tren batik, ide konten, berita terbaru, harga pasar, strategi marketing, dll.',
    parameters: Type.Object({
      query: Type.String({ description: 'Kata kunci pencarian (contoh: "tren batik 2026", "strategi marketing UMKM batik")' }),
    }),
    execute: async (_toolCallId, params) => {
      if (!process.env.BRAVE_API_KEY) {
        return { content: [{ type: 'text', text: 'Web search belum aktif karena BRAVE_API_KEY belum diatur.' }], details: {} };
      }

      try {
        const url = 'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(params.query) + '&count=8';
        const resp = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': process.env.BRAVE_API_KEY,
          },
        });
        const data = await resp.json();

        const web = data.web;
        if (!web || !web.results || web.results.length === 0) {
          return { content: [{ type: 'text', text: `Tidak ditemukan hasil untuk "${params.query}".` }], details: {} };
        }

        const results = web.results.slice(0, 8).map((r, i) => {
          const desc = r.description ? r.description.replace(/<[^>]+>/g, '').slice(0, 200) : '';
          return `${i + 1}. **${r.title}**\n   ${r.url}\n   ${desc ? '> ' + desc : ''}`;
        }).join('\n\n');

        const text = `Hasil pencarian web "${params.query}":\n\n${results}`;
        return { content: [{ type: 'text', text }], details: {} };
      } catch (err) {
        return { content: [{ type: 'text', text: `Gagal mencari: ${err.message}` }], details: {} };
      }
    },
  });

  const systemPrompt = `Kamu adalah Asisten Automation untuk toko Batik Bakaran.

Tugas utamamu: **merencanakan konten pemasaran** berdasarkan data produk yang ada di database.

Kamu punya akses ke:
- Database via tool \`db_query\`:
  - tabel \`produk\`: id, nama, harga, stok, gambar, deskripsi, created_at, updated_at
  - tabel \`pemasaran\`: id, judul, strategi, target_audiens, kanal, jadwal, scheduled_at, copywriting, produk_terkait, gambar, status, created_at
- Internet via tool \`web_search\` (untuk riset tren, berita, harga pasar, strategi marketing, dll)

Yang bisa kamu lakukan:
1. Query data produk untuk analisis
2. Riset tren batik & marketing terkini via web_search
3. Buat rencana konten pemasaran (jadwal posting, ide caption, target audiens)
4. Rekomendasikan strategi promosi berdasarkan stok, harga, dan riset pasar
5. Buat copywriting untuk media sosial / marketplace
6. Analisis produk mana yang perlu diprioritaskan

Batasan penting:
- Tool AI database hanya SELECT, jadi AI tidak boleh mengaku bisa INSERT/UPDATE/DELETE langsung.
- Jika user Telegram ingin menambah produk, arahkan pakai perintah \`/tambahproduk\` atau tulis "tambah produk" untuk membuka wizard tambah produk.
- Jika user web ingin menambah produk, arahkan ke menu Produk.

Gaya komunikasi: profesional, kreatif, actionable, dan mudah dipindai seperti format jawaban OpenClaw. Berikan output yang siap pakai.
Gunakan bahasa Indonesia.

FORMAT KETERBACAAN TELEGRAM / OPENCLAW STYLE:
- Awali dengan judul singkat memakai emoji, contoh: \`📋 Rencana Konten Threads 1 Minggu\`.
- Berikan ringkasan 3-5 bullet: fokus, target, kanal, jam posting, tujuan.
- Gunakan separator visual \`━━━━━━━━━━━━━━━━━━━━\` antar bagian.
- Untuk rencana mingguan, tampilkan setiap hari dengan format konsisten:
  \`📅 Hari 1 — Senin, 1 Juni 2026, 19:00 WIB\`
  \`🎯 Tema:\`
  \`👥 Target:\`
  \`🧵 Strategi:\`
  \`✍️ Copywriting:\`
  \`🛍 Produk terkait:\`
- Hindari paragraf panjang. Maksimal 2-4 baris per bagian agar nyaman dibaca di Telegram.
- Jangan menampilkan tabel Markdown besar karena kurang nyaman di Telegram.
- Setelah versi mudah dibaca, tetap akhiri dengan blok JSON valid untuk sistem simpan otomatis.

PENTING: Fokus kanal promosi hanya **media sosial Threads**. Jangan gunakan Instagram, TikTok, marketplace, Shopee, atau kanal lain kecuali user meminta eksplisit.

PENTING UNTUK PENJADWALAN: Sebelum membuat rencana pemasaran baru, kamu WAJIB cek dulu jadwal pemasaran yang sudah tersimpan dengan tool \`db_query\`, contoh:
\`SELECT id, judul, kanal, jadwal, status, created_at FROM pemasaran ORDER BY created_at DESC LIMIT 50\`.
Gunakan hasilnya untuk:
- menghindari tanggal/jam posting yang sama agar tidak menumpuk,
- membuat jadwal lanjutan setelah jadwal terakhir yang sudah ada,
- menjaga kalender konten berkelanjutan dan rapi,
- jika jadwal lama berupa teks, identifikasi tanggal/hari/jam yang sudah dipakai lalu pilih slot berikutnya.

PENTING: Ketika kamu membuat rencana pemasaran umum (bukan sekedar menjawab pertanyaan), buat **rencana konten 1 minggu / 7 hari** agar strategi lebih fokus dan berkelanjutan. Namun jika prompt berasal dari **Wizard Konten Marketing Telegram** dan secara eksplisit meminta **tepat 1 konten** pada hari/jam tertentu, buat hanya 1 konten dan akhiri dengan JSON array berisi tepat 1 objek. Tulis dulu versi readable/OpenClaw style untuk manusia, lalu AKHIRI response dengan blok JSON di baris terakhir berupa ARRAY berisi objek rencana, menggunakan format ini:

\`\`\`json
[
  {"judul":"Hari 1 - Judul Rencana","strategi":"Deskripsi strategi promosi khusus Threads","target_audiens":"Target audiens","kanal":"threads","jadwal":"Senin, 2026-05-29 jam 19:00 WIB","scheduled_at":"2026-05-29T19:00:00+07:00","copywriting":"Teks posting Threads siap pakai","produk_terkait":"Nama produk terkait","gambar":"URL gambar Cloudinary jika ada"},
  {"judul":"Hari 2 - Judul Rencana","strategi":"Deskripsi strategi promosi khusus Threads","target_audiens":"Target audiens","kanal":"threads","jadwal":"Selasa, 2026-05-30 jam 19:00 WIB","scheduled_at":"2026-05-30T19:00:00+07:00","copywriting":"Teks posting Threads siap pakai","produk_terkait":"Nama produk terkait","gambar":""}
]
\`\`\`

Pastikan array JSON berisi tepat 7 objek untuk rencana mingguan, atau tepat 1 objek untuk Wizard Konten Marketing Telegram. Semua field \`kanal\` wajib bernilai \`threads\`. Field \`gambar\` isi URL Cloudinary jika tersedia, atau string kosong jika tidak ada. Field \`jadwal\` wajib jelas berisi hari/tanggal/jam dan tidak boleh sama dengan jadwal yang sudah tersimpan. Field \`scheduled_at\` wajib ISO 8601 dengan offset \`+07:00\` jika tanggal/jam bisa dipastikan; jika belum pasti gunakan string kosong. Hanya sertakan blok JSON saat kamu benar-benar membuat rencana pemasaran, bukan saat menjawab pertanyaan umum.`;

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    systemPromptOverride: () => systemPrompt,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    model,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    tools: [dbQueryTool.name, webSearchTool.name],
    customTools: [dbQueryTool, webSearchTool],
    resourceLoader,
  });

  agentSessions.set(sessionKey, session);
  touchAgentSession(sessionKey);
  console.log(`[AI] Agent ready for session ${sessionKey}`);
  return session;
}

export async function initAgent(sessionKey) {
  const existingSession = agentSessions.get(sessionKey);
  if (existingSession) {
    touchAgentSession(sessionKey);
    return existingSession;
  }

  const pendingSession = agentSessionPromises.get(sessionKey);
  if (pendingSession) return pendingSession;

  const initPromise = createAgentSessionForKey(sessionKey);
  agentSessionPromises.set(sessionKey, initPromise);

  try {
    return await initPromise;
  } finally {
    agentSessionPromises.delete(sessionKey);
  }
}
