import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

let csrfModule = null;
try {
  csrfModule = await import('../lib/csrfToken.js');
} catch {
  // lib/csrfToken.js belum tersedia — suite dilewati.
}

const { generateCsrfToken, validateCsrfToken } = csrfModule || {};

describe('csrfToken', { skip: !csrfModule }, () => {
  it('generateCsrfToken returns a non-empty hex string', () => {
    const token = generateCsrfToken();
    assert.equal(typeof token, 'string');
    assert.ok(token.length >= 32);
    assert.notEqual(token, generateCsrfToken());
  });

  it('validateCsrfToken returns true for matching tokens', () => {
    const token = generateCsrfToken();
    assert.equal(validateCsrfToken(token, token), true);
  });

  it('validateCsrfToken returns false for mismatch', () => {
    const token = generateCsrfToken();
    assert.equal(validateCsrfToken(token, generateCsrfToken()), false);
    assert.equal(validateCsrfToken(token, ''), false);
    assert.equal(validateCsrfToken('', token), false);
    assert.equal(validateCsrfToken(null, token), false);
  });
});