// Formatting helpers that do not need a Telegram bot instance.

export function escMarkdown(value) {
  if (!value) return '';
  return String(value).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

export function fmtPlan(row) {
  const status = row.status || row.repliz_status || 'draft';
  return `#${row.id} [${status}] ${row.judul || '-'}\n📅 ${row.jadwal || row.scheduled_at || '-'}\n🧵 ${(row.copywriting || row.strategi || '').slice(0, 180)}`;
}
