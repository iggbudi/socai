import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectContext = `
Konteks project khusus /var/www/socai.my.id:
- Aplikasi Express.js single-file di server.js, ESM, tanpa build step/TypeScript/test/lint.
- HTML inline di server.js; index.html hanya placeholder statis.
- PostgreSQL: produk, pemasaran, users.
- Auth session + bcrypt, CSRF Origin/Referer, upload gambar via multer public/uploads.
- AI assistant memakai @earendil-works/pi-coding-agent, lazy init di /api/asisten.
- Node >=24, npm start menjalankan node server.js pada port default 3010.
- Ikuti AGENTS.md. Jangan ubah .env kecuali diminta eksplisit.
`;

const tasks = {
  wiki: {
    role: "Kamu adalah Sub-agent Wiki untuk project ini.",
    description: "Sub-agent Wiki BG: buat/update CODEBASE_WIKI.md untuk codebase project ini",
    task: `Buat atau update dokumentasi codebase di CODEBASE_WIKI.md.\n- Baca AGENTS.md, package.json, server.js, lib/, dan file relevan.\n- Dokumentasikan arsitektur, route, schema DB dari kode, alur auth, upload, AI assistant, bot Telegram bila relevan, env vars, cara run, gotcha, dan peta fungsi penting.\n- Jika CODEBASE_WIKI.md sudah ada, update secara akurat tanpa menghapus informasi penting.`,
  },
  analis: {
    role: "Kamu adalah Sub-agent Analis untuk project ini.",
    description: "Sub-agent Analis BG: analisis codebase, rencana fitur, atau bug analysis",
    task: `Analisis codebase dan susun rencana sebelum implementasi.\n- Baca file relevan terlebih dahulu.\n- Identifikasi akar masalah/risiko, area terdampak, dan dependensi.\n- Berikan rencana implementasi bertahap yang konkret untuk Worker.\n- Untuk bug: jelaskan reproduksi, hipotesis, penyebab, dan verifikasi.\n- Jangan mengedit kode kecuali user secara eksplisit meminta implementasi.`,
  },
  worker: {
    role: "Kamu adalah Sub-agent Worker untuk project ini.",
    description: "Sub-agent Worker BG: implementasi berdasarkan hasil analis/rencana",
    task: `Terapkan perubahan berdasarkan rencana/analis atau instruksi user.\n- Edit seminimal mungkin dan fokus pada server.js/lib/file terkait.\n- Pertahankan karakter single-file app: jangan membuat build step atau framework baru.\n- Jaga auth, CSRF, upload validation, dan DB SELECT-only tool AI.\n- Setelah edit, jalankan pemeriksaan praktis yang tersedia.\n- Laporkan file yang diubah dan verifikasi.`,
  },
  qa: {
    role: "Kamu adalah Sub-agent QA untuk project ini.",
    description: "Sub-agent QA BG: review hasil Worker, cek bug/regresi/security",
    task: `Review hasil implementasi Worker.\n- Periksa diff/file terkait dan bandingkan dengan rencana.\n- Cari bug, regresi route/API, masalah auth/CSRF/session, upload, SQL injection, XSS HTML inline, dan error handling.\n- Jalankan/verifikasi check yang masuk akal untuk project tanpa test suite.\n- Beri verdict: PASS atau NEEDS_FIX.\n- Jangan mengubah kode kecuali user meminta QA sekaligus memperbaiki.`,
  },
  security: {
    role: "Kamu adalah Sub-agent Security untuk project ini.",
    description: "Sub-agent Security BG: audit keamanan auth, CSRF, upload, SQL, XSS, secrets",
    task: `Lakukan audit keamanan khusus project ini.\n- Fokus pada auth/session/bcrypt, CSRF Origin/Referer + APP_URL, rate limit login, upload multer image validation, akses public/uploads, SQL injection PostgreSQL, XSS pada HTML inline/template literal, exposure secrets/env, permission file, dan AI/db_query SELECT-only.\n- Baca file relevan sebelum menyimpulkan.\n- Klasifikasikan temuan CRITICAL/HIGH/MEDIUM/LOW.\n- Untuk tiap temuan: risiko, lokasi file/baris, skenario eksploitasi, rekomendasi fix konkret.\n- Jangan mengubah kode kecuali user eksplisit meminta perbaikan security.`,
  },
  ops: {
    role: "Kamu adalah Sub-agent Ops untuk project ini.",
    description: "Sub-agent Ops BG: cek deployment, env, runtime, service, database, healthcheck",
    task: `Analisis aspek operasional/deployment project ini.\n- Fokus pada npm start, Node >=24, PORT default 3010, bind 127.0.0.1, PostgreSQL env, .env.example, APP_URL, SESSION_SECRET, BRAVE_API_KEY, public/uploads persistence, logs, healthcheck /health, service/process manager, reverse proxy, backup DB, dan rollback.\n- Berikan checklist deployment dan rekomendasi praktis.\n- Jangan mengubah kode/konfigurasi kecuali user eksplisit meminta implementasi ops.`,
  },
} as const;

function makePrompt(role: string, task: string, args: string) {
  return `${role}\n\n${projectContext}\n\nTugas:\n${task}\n\nPermintaan user:\n${args.trim() || "(tidak ada detail tambahan)"}\n\nMode: background sub-agent. Tulis hasil akhir yang jelas ke stdout. Jika membuat/mengubah file, sebutkan file dan verifikasi.`;
}

type RunInfo = {
  runId: string;
  agent: keyof typeof tasks;
  dir: string;
  outFile: string;
  errFile: string;
  statusFile: string;
  pid?: number;
  status: "running" | "done";
  lastLine: string;
  startedAt: string;
  finishedAt?: string;
};

const activeRuns = new Map<string, RunInfo>();

function tailLines(text: string, max = 8) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-max);
}

function renderRunsWidget() {
  const runs = [...activeRuns.values()].slice(-6);
  if (runs.length === 0) return ["Sub-agent: tidak ada pekerjaan background aktif."];
  return [
    "Sub-agent background progress:",
    ...runs.map((run) => {
      const icon = run.status === "running" ? "⏳" : "✅";
      return `${icon} /${run.agent} ${run.runId} pid=${run.pid ?? "-"} — ${run.lastLine || run.status}`;
    }),
  ];
}

function updateProgress(ctx: any) {
  ctx.ui.setWidget("subagents", renderRunsWidget());
  const running = [...activeRuns.values()].filter((run) => run.status === "running").length;
  ctx.ui.setStatus("subagents", running > 0 ? `subagents: ${running} running` : "subagents: idle");
}

function startBackground(ctx: any, name: keyof typeof tasks, args: string) {
  const cwd = ctx.cwd;
  const spec = tasks[name];
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}`;
  const dir = path.join(cwd, ".pi", "subagents", "runs", runId);
  fs.mkdirSync(dir, { recursive: true });

  const prompt = makePrompt(spec.role, spec.task, args);
  const promptFile = path.join(dir, "prompt.md");
  const outFile = path.join(dir, "output.log");
  const errFile = path.join(dir, "error.log");
  const statusFile = path.join(dir, "status.txt");
  const startedAt = new Date().toISOString();

  fs.writeFileSync(promptFile, prompt);
  fs.writeFileSync(statusFile, `running\nstarted_at=${startedAt}\nagent=${name}\n`);
  fs.writeFileSync(outFile, "");
  fs.writeFileSync(errFile, "");

  const run: RunInfo = { runId, agent: name, dir, outFile, errFile, statusFile, status: "running", lastLine: "starting...", startedAt };
  activeRuns.set(runId, run);
  updateProgress(ctx);

  const child = spawn("/home/ubuntu/.nvm/versions/node/v24.14.1/bin/pi", ["-p", prompt], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  run.pid = child.pid;
  updateProgress(ctx);

  let notifyTimer: NodeJS.Timeout | undefined;
  const scheduleNotify = () => {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = undefined;
      updateProgress(ctx);
    }, 1000);
  };

  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    fs.appendFileSync(outFile, text);
    const lines = tailLines(text, 1);
    if (lines[0]) run.lastLine = lines[0].slice(0, 180);
    scheduleNotify();
  });
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    fs.appendFileSync(errFile, text);
    const lines = tailLines(text, 1);
    if (lines[0]) run.lastLine = `stderr: ${lines[0]}`.slice(0, 180);
    scheduleNotify();
  });
  child.on("exit", (code, signal) => {
    run.status = "done";
    run.finishedAt = new Date().toISOString();
    run.lastLine = `finished exit=${code ?? ""} signal=${signal ?? ""}`;
    fs.writeFileSync(statusFile, `done\nfinished_at=${run.finishedAt}\nagent=${name}\nexit_code=${code ?? ""}\nsignal=${signal ?? ""}\n`);
    ctx.ui.notify(`/${name} selesai: ${run.runId}. Output: ${path.relative(cwd, outFile)}`, code === 0 ? "info" : "error");
    updateProgress(ctx);
  });

  return run;
}

export default function (pi: ExtensionAPI) {
  for (const name of Object.keys(tasks) as Array<keyof typeof tasks>) {
    pi.registerCommand(name, {
      description: tasks[name].description,
      handler: async (args, ctx) => {
        const run = startBackground(ctx, name, args);
        ctx.ui.notify(`/${name} berjalan di background: ${run.runId}. Progress tampil di widget. Output: ${path.relative(ctx.cwd, run.outFile)}`, "info");
      },
    });
  }

  pi.registerCommand("subagents", {
    description: "Tampilkan daftar sub-agent project ini dan lokasi run background",
    handler: async (_args, ctx) => {
      updateProgress(ctx);
      ctx.ui.notify("Sub-agent background: /wiki, /analis, /worker, /qa, /security, /ops. Progress realtime tampil di widget/status. Log: .pi/subagents/runs/<run-id>/output.log", "info");
    },
  });

  pi.registerCommand("subagent-progress", {
    description: "Refresh widget progress sub-agent background",
    handler: async (_args, ctx) => {
      updateProgress(ctx);
    },
  });
}
