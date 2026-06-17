import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectWebEnvironmentIssues } from '../lib/env.js';

const baseEnv = {
  DB_USER: 'test',
  DB_PASSWORD: 'test',
};

describe('AUTONOMY_MODE env validation', () => {
  it('rejects invalid AUTONOMY_MODE values', () => {
    const { errors } = collectWebEnvironmentIssues({
      ...baseEnv,
      AUTONOMY_MODE: 'full-auto',
    });
    assert.ok(errors.some((message) => /AUTONOMY_MODE/.test(message)));
  });

  it('accepts valid AUTONOMY_MODE values', () => {
    for (const mode of ['assistive', 'supervised', 'bounded']) {
      const { errors } = collectWebEnvironmentIssues({
        ...baseEnv,
        AUTONOMY_MODE: mode,
      });
      assert.equal(errors.some((message) => /AUTONOMY_MODE/.test(message)), false, `mode ${mode} should be valid`);
    }
  });
});