import { getDefaultChannelId, listChannels } from './registry.js';

export function buildChannelsPromptSection() {
  const channels = listChannels();
  const enabledIds = channels.map((c) => c.id);
  const configured = channels.filter((c) => c.configured).map((c) => c.id);
  const defaultId = getDefaultChannelId();

  const lines = [
    '',
    'KANAL MEDIA SOSIAL AKTIF:',
    `- Kanal diaktifkan: ${enabledIds.join(', ') || defaultId}`,
    `- Kanal default: **${defaultId}**`,
  ];

  if (configured.length > 0) {
    lines.push(`- Kanal siap dijadwalkan via Repliz: ${configured.join(', ')}`);
  } else {
    lines.push(
      '- Belum ada kanal Repliz terkonfigurasi penuh (penjadwalan manual/approval tetap bisa setelah save).',
    );
  }

  lines.push(
    `- Field JSON \`kanal\` wajib salah satu dari: ${enabledIds.join(', ')}.`,
    '- Jika user tidak menyebut kanal, gunakan kanal default.',
    '- Fokus utama UMKM tetap Threads kecuali user meminta kanal lain secara eksplisit.',
  );

  return lines.join('\n');
}
