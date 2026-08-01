import { resolveTelegramDependencies } from './commands/deps.js';
import { registerAccessCommands, registerTelegramAccessMiddleware } from './commands/akses.js';
import { registerStatusCommands } from './commands/status.js';
import { registerProductCommands } from './commands/produk.js';
import { registerContentCommands } from './commands/konten.js';
import { registerScheduleCommands } from './commands/jadwal.js';
import { registerTextHandler } from './handlers/text.js';
import { registerPhotoHandler } from './handlers/photo.js';
import { registerTelegramErrorHandler } from './handlers/errors.js';

export const defaultBotCommands = [
  { command: 'start', description: 'Mulai chatbot' },
  { command: 'help', description: 'Bantuan dan daftar perintah' },
  { command: 'whoami', description: 'Lihat User ID, username, dan Chat ID' },
  { command: 'status', description: 'Status koneksi dan sesi AI' },
  { command: 'listproduk', description: 'Lihat daftar produk' },
  { command: 'buatkonten', description: 'Wizard buat konten marketing spesifik' },
  { command: 'jadwalkonten', description: 'Lihat kalender konten' },
  { command: 'statuskonten', description: 'Lihat konten per status' },
  { command: 'ubahstatuskonten', description: 'Ubah status rencana konten' },
  { command: 'hapuskonten', description: 'Hapus rencana konten dengan konfirmasi' },
  { command: 'jadwalkan', description: 'Kirim jadwal konten ke Repliz' },
  { command: 'postnow', description: 'Post konten sekarang via Repliz' },
  { command: 'retrypost', description: 'Coba ulang posting gagal' },
  { command: 'cekpost', description: 'Cek status post Repliz' },
  { command: 'tambahproduk', description: 'Tambah produk baru' },
  { command: 'batal', description: 'Batalkan proses berjalan' },
];

export const superAdminBotCommands = [
  ...defaultBotCommands,
  { command: 'adduser', description: 'Tambah user yang boleh memakai bot' },
  { command: 'removeuser', description: 'Hapus user dari bot' },
  { command: 'listusers', description: 'Lihat daftar user dan role' },
];

/** Register Telegram handlers on an already-created Telegraf instance. */
export function registerTelegramHandlers({ bot, access, state, dependencies = {} }) {
  const deps = resolveTelegramDependencies(dependencies);
  const { pendingPlans, contentWizard, productWizard, uploadDir } = state;

  registerTelegramAccessMiddleware(bot, { access });
  registerStatusCommands(bot, {
    access,
    agentSessions: deps.agentSessions,
    dbPool: deps.dbPool,
  });
  registerAccessCommands(bot, { access });

  const handleText = registerTextHandler(bot, {
    access,
    dbPool: deps.dbPool,
    agentSessions: deps.agentSessions,
    touchAgentSession: deps.touchAgentSession,
    initAgent: deps.initAgent,
    createAgentRun: deps.createAgentRun,
    completeAgentRun: deps.completeAgentRun,
    resolveAutonomyMode: deps.resolveAutonomyMode,
    normalizeAiMessage: deps.normalizeAiMessage,
    AiMessageError: deps.AiMessageError,
    telegramAiRateLimiter: deps.telegramAiRateLimiter,
    pendingPlans,
    contentWizard,
    productWizard,
  });

  registerProductCommands(bot, {
    dbPool: deps.dbPool,
    access,
    productWizard,
    contentWizard,
  });
  registerContentCommands(bot, {
    access,
    contentWizard,
    pendingPlans,
    savePlansToDb: deps.savePlansToDb,
    dbPool: deps.dbPool,
  });
  registerPhotoHandler(bot, {
    contentWizard,
    productWizard,
    downloadTelegramPhoto: deps.downloadTelegramPhoto,
    uploadDir,
  });
  registerScheduleCommands(bot, {
    dbPool: deps.dbPool,
    access,
    isReplizConfigured: deps.isReplizConfigured,
    schedulePlanToRepliz: deps.schedulePlanToRepliz,
    schedulePlanToReplizNow: deps.schedulePlanToReplizNow,
    syncPlanReplizStatus: deps.syncPlanReplizStatus,
    approvePlanSchedule: deps.approvePlanSchedule,
    rejectPlanSchedule: deps.rejectPlanSchedule,
    scheduleViaRepliz: deps.scheduleViaRepliz,
  });
  registerTelegramErrorHandler(bot);

  return { bot, handleText };
}
