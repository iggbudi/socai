import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEvaluationPeriod } from '../metrics.js';

describe('resolveEvaluationPeriod', () => {
  it('parses explicit since ISO date', () => {
    const { since, days } = resolveEvaluationPeriod({ since: '2026-06-01T00:00:00.000Z' });
    assert.equal(since.toISOString(), '2026-06-01T00:00:00.000Z');
    assert.equal(days, null);
  });

  it('rejects invalid since value', () => {
    assert.throws(() => resolveEvaluationPeriod({ since: 'not-a-date' }), /since tidak valid/);
  });

  it('defaults to 30-day window', () => {
    const { since, days } = resolveEvaluationPeriod({});
    assert.equal(days, 30);
    assert.ok(since instanceof Date);
    assert.ok(since.getTime() < Date.now());
  });

  it('respects custom days window', () => {
    const { days } = resolveEvaluationPeriod({ days: 7 });
    assert.equal(days, 7);
  });
});
