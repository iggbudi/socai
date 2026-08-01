/**
 * Helper waktu WIB (UTC+07:00).
 *
 * Semua parsing teks jadwal Indonesia & generasi slot kalender memakai zona WIB
 * eksplisit agar konsisten di server dengan timezone apa pun (lihat A4 audit —
 * server produksi memakai Asia/Shanghai +8, bukan WIB).
 */

const WIB_TIME_ZONE = 'Asia/Jakarta';
const WIB_OFFSET_HOURS = 7;

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: WIB_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  timeZone: WIB_TIME_ZONE,
  weekday: 'long',
});

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Konstruksi Date dari komponen WIB (bulan 1-based, seperti `new Date(y, m, d)`).
 * Tidak bergantung timezone server.
 */
export function wibDate(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - WIB_OFFSET_HOURS, minute, second, ms));
}

/** Ekstrak komponen jam WIB dari sebuah Date (absolute instant). */
export function getWibParts(date) {
  const parts = PARTS_FORMATTER.formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  let hour = get('hour');
  if (hour === 24) hour = 0; // Intl kadang menghasilkan '24' untuk tengah malam
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Slot key berbasis komponen WIB (deteksi slot terisi harus memakai zona yang sama). */
export function wibSlotKey(date) {
  const p = getWibParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}-${pad2(p.hour)}-${pad2(p.minute)}`;
}

/** Format `scheduled_at` ISO 8601 dengan offset +07:00 dari komponen WIB. */
export function formatWibScheduledAt(date) {
  const p = getWibParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:00+07:00`;
}

/** Label jadwal Indonesia (hari, tanggal, jam WIB) dari komponen WIB. */
export function formatWibLabel(date) {
  const p = getWibParts(date);
  const weekday = WEEKDAY_FORMATTER.format(date);
  return `${weekday}, ${p.day} ${MONTHS_ID[p.month - 1]} ${p.year} jam ${pad2(p.hour)}:${pad2(p.minute)} WIB`;
}
