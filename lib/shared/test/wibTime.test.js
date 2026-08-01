/**
 * Sprint 3 (A4) — Konsistensi timezone WIB (+07:00):
 * parsing teks jadwal & slot kalender tidak boleh bergantung timezone server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  wibDate,
  getWibParts,
  wibSlotKey,
  formatWibScheduledAt,
  formatWibLabel,
} from '../wibTime.js';
import { parseMarketingSchedule } from '../../pemasaran.js';
import { getCalendarGaps } from '../../actuator/calendar.js';

describe('wibTime helpers', () => {
  it('wibDate constructs WIB components independent of server TZ', () => {
    assert.equal(wibDate(2026, 6, 5, 19, 0).toISOString(), '2026-06-05T12:00:00.000Z');
    // tengah malam WIB = 17:00 UTC hari sebelumnya
    assert.equal(wibDate(2026, 6, 5).toISOString(), '2026-06-04T17:00:00.000Z');
  });

  it('getWibParts extracts WIB components', () => {
    const p = getWibParts(new Date('2026-06-05T12:00:00.000Z'));
    assert.deepEqual(
      { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute },
      { year: 2026, month: 6, day: 5, hour: 19, minute: 0 },
    );
  });

  it('formatWibScheduledAt emits +07:00 offset', () => {
    assert.equal(
      formatWibScheduledAt(new Date('2026-06-05T12:00:00.000Z')),
      '2026-06-05T19:00:00+07:00',
    );
  });

  it('formatWibLabel produces Indonesian WIB label', () => {
    assert.match(
      formatWibLabel(new Date('2026-06-05T12:00:00.000Z')),
      /^[A-Za-z]+, 5 Juni 2026 jam 19:00 WIB$/,
    );
  });

  it('parseMarketingSchedule text is WIB, not server-local (A4)', () => {
    const d = parseMarketingSchedule({ jadwal: '5 Juni 2026 jam 19:00' });
    assert.equal(d.toISOString(), '2026-06-05T12:00:00.000Z');
  });
});

describe('getCalendarGaps WIB consistency (A4)', () => {
  it('generates slots whose scheduled_at matches the slot instant (19:00 WIB)', async () => {
    const mockPool = { query: async () => ({ rows: [] }) };
    const result = await getCalendarGaps(mockPool, { days_ahead: 7, preferred_hour: 19 });
    assert.ok(result.gaps.length > 0);
    for (const gap of result.gaps) {
      assert.match(gap.scheduled_at, /\+07:00$/);
      // scheduled_at dan date harus instant yang sama persis
      assert.equal(new Date(gap.scheduled_at).toISOString(), new Date(gap.date).toISOString());
      // jam WIB slot = preferred hour
      assert.equal(getWibParts(new Date(gap.scheduled_at)).hour, 19);
      // slot key konsisten
      assert.equal(wibSlotKey(new Date(gap.scheduled_at)), wibSlotKey(new Date(gap.date)));
    }
  });

  it('marks an occupied slot (same WIB instant) as not available', async () => {
    const nowWib = getWibParts(new Date());
    const occupiedDate = wibDate(nowWib.year, nowWib.month, nowWib.day + 2, 19, 0);
    const mockPool = {
      query: async () => ({
        rows: [{
          id: 1,
          judul: 'Terisi',
          kanal: 'threads',
          jadwal: null,
          scheduled_at: occupiedDate.toISOString(),
          repliz_scheduled_at: null,
          status: 'scheduled',
        }],
      }),
    };
    const result = await getCalendarGaps(mockPool, { days_ahead: 7, preferred_hour: 19 });
    const occupiedKey = wibSlotKey(occupiedDate);
    const clash = result.gaps.find((g) => wibSlotKey(new Date(g.date)) === occupiedKey);
    assert.equal(clash, undefined, 'slot terisi tidak boleh muncul sebagai gap');
  });
});
