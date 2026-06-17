import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarketingSchedule,
  normalizePlan,
  extractReplizScheduleId,
} from '../lib/pemasaran.js';

describe('parseMarketingSchedule', () => {
  it('parses ISO scheduled_at values', () => {
    const date = parseMarketingSchedule({ scheduled_at: '2026-06-05T19:00:00.000Z' });
    assert.ok(date instanceof Date);
    assert.equal(date.toISOString(), '2026-06-05T19:00:00.000Z');
  });

  it('parses Indonesian date text', () => {
    const date = parseMarketingSchedule({ jadwal: '5 Juni 2026 jam 19:00' });
    assert.ok(date instanceof Date);
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 5);
    assert.equal(date.getDate(), 5);
    assert.equal(date.getHours(), 19);
    assert.equal(date.getMinutes(), 0);
  });

  it('returns null for empty schedule input', () => {
    assert.equal(parseMarketingSchedule({}), null);
    assert.equal(parseMarketingSchedule({ jadwal: '' }), null);
    assert.equal(parseMarketingSchedule({ jadwal: '   ' }), null);
  });
});

describe('normalizePlan', () => {
  it('normalizes valid plan data', () => {
    const plan = normalizePlan({
      judul: '  Promo Batik  ',
      strategi: 'Highlight motif baru',
      target_audiens: 'Pembeli muda',
      jadwal: '6 Juni 2026',
      copywriting: 'Diskon 10%',
      produk_terkait: 'Kemeja Batik',
      gambar: '/uploads/produk-1.jpg',
    }, 0);

    assert.equal(plan.judul, 'Promo Batik');
    assert.equal(plan.strategi, 'Highlight motif baru');
    assert.equal(plan.target_audiens, 'Pembeli muda');
    assert.equal(plan.kanal, 'threads');
    assert.equal(plan.jadwal, '6 Juni 2026');
    assert.equal(plan.copywriting, 'Diskon 10%');
    assert.equal(plan.produk_terkait, 'Kemeja Batik');
    assert.equal(plan.gambar, '/uploads/produk-1.jpg');
  });
});

describe('extractReplizScheduleId', () => {
  it('extracts schedule id from common response shapes', () => {
    assert.equal(extractReplizScheduleId({ scheduleId: 'sched-1' }), 'sched-1');
    assert.equal(extractReplizScheduleId({ id: 'sched-2' }), 'sched-2');
    assert.equal(extractReplizScheduleId({ _id: 'sched-3' }), 'sched-3');
    assert.equal(extractReplizScheduleId({ data: { scheduleId: 'sched-4' } }), 'sched-4');
    assert.equal(extractReplizScheduleId({ data: { id: 'sched-5' } }), 'sched-5');
    assert.equal(extractReplizScheduleId({ schedule: { id: 'sched-6' } }), 'sched-6');
    assert.equal(extractReplizScheduleId(null), null);
    assert.equal(extractReplizScheduleId({}), null);
  });
});