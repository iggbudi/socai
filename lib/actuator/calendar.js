import { parseMarketingSchedule } from '../features/pemasaran/domain.js';
import { getEnabledChannelIds } from '../features/channels/index.js';
import { wibDate, getWibParts, wibSlotKey, formatWibScheduledAt, formatWibLabel } from '../shared/wibTime.js';

export async function getCalendarGaps(readPool, { days_ahead = 7, preferred_hour = 19, channels = null } = {}) {
  const daysAhead = Math.min(Math.max(Number(days_ahead) || 7, 1), 30);
  const preferredHour = Math.min(Math.max(Number(preferred_hour) || 19, 0), 23);
  const channelIds = Array.isArray(channels) && channels.length > 0 ? channels : getEnabledChannelIds();
  const now = new Date();
  const nowWib = getWibParts(now);
  const rangeEnd = wibDate(nowWib.year, nowWib.month, nowWib.day + daysAhead, 23, 59, 59, 999);
  const startToday = wibDate(nowWib.year, nowWib.month, nowWib.day);

  const result = await readPool.query(
    `SELECT id, judul, kanal, jadwal, scheduled_at, repliz_scheduled_at, status
     FROM pemasaran
     WHERE lower(coalesce(kanal, '')) = ANY($1::text[])
       AND (
         scheduled_at IS NOT NULL
         OR repliz_scheduled_at IS NOT NULL
         OR coalesce(jadwal, '') <> ''
       )
     ORDER BY coalesce(scheduled_at, repliz_scheduled_at, created_at) ASC
     LIMIT 200`,
    [channelIds],
  );

  // Slot key berbasis komponen WIB (A4): parsing & slot memakai zona yang sama,
  // jadi deteksi slot terisi konsisten di server timezone apa pun.
  const occupied = new Set();
  for (const row of result.rows) {
    const parsed = parseMarketingSchedule(row);
    if (!parsed || Number.isNaN(parsed.getTime())) continue;
    if (parsed < startToday || parsed > rangeEnd) continue;
    occupied.add(wibSlotKey(parsed));
  }

  const gaps = [];
  for (let i = 0; i < daysAhead; i += 1) {
    // Slot dibangun dari komponen WIB hari ini + i hari, pada jam preferred.
    const day = wibDate(nowWib.year, nowWib.month, nowWib.day + i, preferredHour);
    if (day <= now) continue;
    if (occupied.has(wibSlotKey(day))) continue;
    gaps.push({
      date: day.toISOString(),
      jadwal: formatWibLabel(day),
      scheduled_at: formatWibScheduledAt(day),
      preferred_hour: preferredHour,
    });
  }

  return {
    days_ahead: daysAhead,
    preferred_hour: preferredHour,
    channels: channelIds,
    occupied_count: occupied.size,
    gaps,
  };
}
