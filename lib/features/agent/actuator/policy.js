export const AUTONOMY_MODES = ['assistive', 'supervised', 'bounded'];

export function getAutonomyConfig() {
  return {
    autonomyMode: (process.env.AUTONOMY_MODE || 'assistive').trim().toLowerCase(),
    requireApproval: String(process.env.REQUIRE_APPROVAL || 'false').toLowerCase() === 'true',
    maxSavesPerRun: Number(process.env.MAX_AGENT_SAVES_PER_RUN) || 7,
    maxSchedulesPerDay: Number(process.env.MAX_AGENT_SCHEDULES_PER_DAY) || 10,
  };
}

export function assertValidAutonomyMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (!AUTONOMY_MODES.includes(normalized)) {
    throw new Error(`AUTONOMY_MODE tidak valid: ${mode}. Gunakan assistive, supervised, atau bounded.`);
  }
  return normalized;
}

export function checkSavePolicy({ autonomyMode, savesInRun = 0, planCount = 1 } = {}) {
  const mode = assertValidAutonomyMode(autonomyMode);
  const config = getAutonomyConfig();

  if (mode === 'assistive') {
    return {
      allowed: false,
      reason: 'Mode assistive: simpan rencana hanya via UI web atau tombol Telegram, bukan tool otomatis.',
    };
  }

  if (!['supervised', 'bounded'].includes(mode)) {
    return { allowed: false, reason: `Mode ${mode} tidak mengizinkan save_content_plan.` };
  }

  const projected = savesInRun + planCount;
  if (projected > config.maxSavesPerRun) {
    return {
      allowed: false,
      reason: `Batas simpan per respons agent (${config.maxSavesPerRun}) terlampaui. Sudah tersimpan: ${savesInRun}, diminta: ${planCount}.`,
    };
  }

  return { allowed: true };
}

export function checkSchedulePolicy({ autonomyMode, schedulesToday = 0 } = {}) {
  const mode = assertValidAutonomyMode(autonomyMode);
  const config = getAutonomyConfig();

  if (mode !== 'bounded') {
    return {
      allowed: false,
      reason: mode === 'assistive'
        ? 'Mode assistive: jadwalkan manual via UI atau perintah /jadwalkan di Telegram.'
        : 'Mode supervised: jadwalkan manual setelah simpan; schedule_content hanya di mode bounded.',
    };
  }

  if (config.requireApproval) {
    return {
      allowed: false,
      reason: 'REQUIRE_APPROVAL aktif: penjadwalan otomatis diblokir. Operator akan menerima notifikasi Telegram untuk approve (✅ Jadwalkan / ❌ Batal).',
    };
  }

  if (schedulesToday >= config.maxSchedulesPerDay) {
    return {
      allowed: false,
      reason: `Batas jadwal agent per hari (${config.maxSchedulesPerDay}) tercapai.`,
    };
  }

  return { allowed: true };
}

export function checkSyncPolicy() {
  return { allowed: true };
}