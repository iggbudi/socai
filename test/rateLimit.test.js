import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../lib/rateLimit.js';

describe('createRateLimiter', () => {
  it('check and consume allow requests under the limit', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, onCleanupIntervalMs: 600_000 });

    assert.deepEqual(limiter.check('user-a'), { allowed: true, remaining: 3, retryAfterMs: 0 });

    const first = limiter.consume('user-a');
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 2);

    const second = limiter.consume('user-a');
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 1);

    const third = limiter.consume('user-a');
    assert.equal(third.allowed, true);
    assert.equal(third.remaining, 0);

    limiter.stop();
  });

  it('blocks further requests after the limit is reached', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, onCleanupIntervalMs: 600_000 });

    limiter.consume('user-b');
    limiter.consume('user-b');

    const blockedCheck = limiter.check('user-b');
    assert.equal(blockedCheck.allowed, false);
    assert.equal(blockedCheck.remaining, 0);
    assert.ok(blockedCheck.retryAfterMs > 0);

    const blockedConsume = limiter.consume('user-b');
    assert.equal(blockedConsume.allowed, false);
    assert.equal(blockedConsume.remaining, 0);
    assert.ok(blockedConsume.retryAfterMs > 0);

    limiter.stop();
  });

  it('resets counter for a key', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, onCleanupIntervalMs: 600_000 });

    limiter.consume('user-c');
    assert.equal(limiter.check('user-c').allowed, false);

    limiter.reset('user-c');
    assert.equal(limiter.check('user-c').allowed, true);

    limiter.stop();
  });
});