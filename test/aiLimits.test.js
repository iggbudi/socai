import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiMessage, AiMessageError, AI_MESSAGE_MAX_LENGTH } from '../lib/aiLimits.js';

describe('normalizeAiMessage', () => {
  it('throws for empty input', () => {
    assert.throws(() => normalizeAiMessage(''), AiMessageError);
    assert.throws(() => normalizeAiMessage('   '), AiMessageError);
    assert.throws(() => normalizeAiMessage(null), AiMessageError);
    assert.throws(() => normalizeAiMessage(undefined), AiMessageError);
  });

  it('throws when message is too long', () => {
    const tooLong = 'x'.repeat(AI_MESSAGE_MAX_LENGTH + 1);
    assert.throws(() => normalizeAiMessage(tooLong), (err) => {
      assert.ok(err instanceof AiMessageError);
      assert.match(err.message, /terlalu panjang/);
      return true;
    });
  });

  it('returns trimmed message for valid input', () => {
    assert.equal(normalizeAiMessage('  halo dunia  '), 'halo dunia');
    assert.equal(normalizeAiMessage('ok'), 'ok');
    assert.equal(normalizeAiMessage('x'.repeat(AI_MESSAGE_MAX_LENGTH)).length, AI_MESSAGE_MAX_LENGTH);
  });
});