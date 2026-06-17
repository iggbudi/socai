import { parseMarketingSchedule } from '../pemasaran.js';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatSlotLabel(date) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return {
    jadwal: `${dayName}, ${day} ${month} ${year} jam ${hour}:${minute} WIB`,
    scheduled_at: `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hour}:${minute}:00+07:00`,
  };
}

function slotKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

export async function getCalendarGaps(readPool, { days_ahead = 7, preferred_hour = 19 } = {}) {
  const daysAhead = Math.min(Math.max(Number(days_ahead) || 7, 1), 30);
  const preferredHour = Math.min(Math.max(Number(preferred_hour) || 19, 0), 23);
  const now = new Date();
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + daysAhead);
  rangeEnd.setHours(23, 59, 59, 999);

  const result = await readPool.query(
    `SELECT id, judul, kanal, jadwal, scheduled_at, repliz_scheduled_at, status
     FROM pemasaran
     WHERE lower(coalesce(kanal, '')) = 'threads'
       AND (
         scheduled_at IS NOT NULL
         OR repliz_scheduled_at IS NOT NULL
         OR coalesce(jadwal, '') <> ''
       )
     ORDER BY coalesce(scheduled_at, repliz_scheduled_at, created_at) ASC
     LIMIT 200`,
  );

  const occupied = new Set();
  for (const row of result.rows) {
    const parsed = parseMarketingSchedule(row);
    if (!parsed || Number.isNaN(parsed.getTime())) continue;
    if (parsed < startOfDay(now) || parsed > rangeEnd) continue;
    occupied.add(slotKey(parsed));
  }

  const gaps = [];
  for (let i = 0; i < daysAhead; i += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() + i);
    day.setHours(preferredHour, 0, 0, 0);
    if (day <= now) continue;
    if (occupied.has(slotKey(day))) continue;
    const label = formatSlotLabel(day);
    gaps.push({
      date: day.toISOString(),
      jadwal: label.jadwal,
      scheduled_at: label.scheduled_at,
      preferred_hour: preferredHour,
    });
  }

  return {
    days_ahead: daysAhead,
    preferred_hour: preferredHour,
    occupied_count: occupied.size,
    gaps,
  };
}