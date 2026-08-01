import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectWebEnvironmentIssues } from '../../../env.js';

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
      assert.equal(
        errors.some((message) => /AUTONOMY_MODE/.test(message)),
        false,
        `mode ${mode} should be valid`,
      );
    }
  });

  it('reports production, model, numeric, boolean, and channel configuration errors', () => {
    const { errors, warnings } = collectWebEnvironmentIssues({
      NODE_ENV: 'production',
      AI_MODEL: 'invalid-model',
      AI_MODEL_FALLBACKS: 'invalid,provider/model-id',
      TELEGRAM_AI_MODEL: 'xiaomi/mimo-v2',
      PORT: 'abc',
      DB_PORT: 'abc',
      AI_MESSAGE_MAX_LENGTH: '0',
      TELEGRAM_AI_RATE_LIMIT: '-1',
      TELEGRAM_AI_RATE_WINDOW_MS: 'nope',
      WEB_AI_RATE_LIMIT: '0',
      WEB_AI_RATE_WINDOW_MS: 'nope',
      AUTONOMY_MODE: 'invalid',
      WEB_AUTONOMY_MODE: 'invalid',
      TELEGRAM_AUTONOMY_MODE: 'invalid',
      AUTO_PLAN_CRON_AUTONOMY_MODE: 'invalid',
      REQUIRE_APPROVAL: 'maybe',
      MAX_AGENT_SAVES_PER_RUN: '0',
      MAX_AGENT_SCHEDULES_PER_DAY: 'nope',
      AGENT_RUNS_RETAIN_DAYS: '0',
      AUTO_PLAN_CRON_INTERVAL_MS: 'nope',
      AUTO_PLAN_MIN_GAPS: '0',
      AGENT_RUNS_PURGE_INTERVAL_MS: 'nope',
      ENABLED_CHANNELS: ' ',
      LOG_LEVEL: 'verbose',
    });
    assert.ok(errors.length > 10);
    assert.ok(errors.some((message) => /SESSION_SECRET/.test(message)));
    assert.ok(errors.some((message) => /XIAOMI_API_KEY/.test(message)));
    assert.ok(errors.some((message) => /LOG_LEVEL/.test(message)));
    assert.ok(warnings.some((message) => /BRAVE_API_KEY/.test(message)));
  });

  it('accepts a complete valid production environment', () => {
    const { errors, warnings } = collectWebEnvironmentIssues({
      NODE_ENV: 'production',
      DB_USER: 'db',
      DB_PASSWORD: 'secret',
      SESSION_SECRET: 'session',
      APP_URL: 'https://socai.my.id',
      AI_MODEL: 'openai/model',
      AI_MODEL_FALLBACKS: 'provider/model',
      TELEGRAM_AI_MODEL: 'xiaomi/mimo-v2',
      XIAOMI_API_KEY: 'xiaomi-key',
      BRAVE_API_KEY: 'brave-key',
      PORT: '3010',
      DB_PORT: '5432',
      AI_MESSAGE_MAX_LENGTH: '4000',
      TELEGRAM_AI_RATE_LIMIT: '10',
      TELEGRAM_AI_RATE_WINDOW_MS: '60000',
      WEB_AI_RATE_LIMIT: '10',
      WEB_AI_RATE_WINDOW_MS: '60000',
      AUTONOMY_MODE: 'assistive',
      WEB_AUTONOMY_MODE: 'supervised',
      TELEGRAM_AUTONOMY_MODE: 'bounded',
      AUTO_PLAN_CRON_AUTONOMY_MODE: 'supervised',
      REQUIRE_APPROVAL: 'true',
      MAX_AGENT_SAVES_PER_RUN: '7',
      MAX_AGENT_SCHEDULES_PER_DAY: '10',
      AGENT_RUNS_RETAIN_DAYS: '90',
      AUTO_PLAN_CRON_INTERVAL_MS: '1000',
      AUTO_PLAN_MIN_GAPS: '3',
      AGENT_RUNS_PURGE_INTERVAL_MS: '1000',
      ENABLED_CHANNELS: 'threads,instagram',
      DB_AI_READ_USER: 'readonly',
      LOG_LEVEL: 'debug',
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });
});
