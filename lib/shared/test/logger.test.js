import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createLogger, LOG_LEVELS, requestLogger, resolveLogLevel, telegramLogger } from '../logger.js';

describe('structured logger', () => {
  it('normalizes configured levels and falls back to info', () => {
    assert.deepEqual(LOG_LEVELS, ['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
    assert.equal(resolveLogLevel('DEBUG'), 'debug');
    assert.equal(resolveLogLevel('invalid'), 'info');
    assert.equal(resolveLogLevel(''), 'info');
  });

  it('redacts secret-shaped fields in structured output', () => {
    const lines = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const log = createLogger({ LOG_LEVEL: 'debug' }, destination).child({ scope: 'test' });
    log.info(
      {
        password: 'plain-password',
        token: 'plain-token',
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        nested: { password: 'nested-password' },
      },
      'secret test',
    );

    const record = JSON.parse(lines[0]);
    assert.equal(record.scope, 'test');
    assert.equal(record.password, '[REDACTED]');
    assert.equal(record.token, '[REDACTED]');
    assert.equal(record.authorization, '[REDACTED]');
    assert.equal(record.cookie, '[REDACTED]');
    assert.equal(record.nested.password, '[REDACTED]');
    assert.equal(record.msg, 'secret test');
  });

  it('binds request and Telegram correlation fields on child loggers', () => {
    const request = requestLogger({ requestId: 'request-1' }, 'web.test').bindings();
    assert.equal(request.scope, 'web.test');
    assert.equal(request.requestId, 'request-1');

    const telegram = telegramLogger(
      { update: { update_id: 22 }, from: { id: 99 } },
      'telegram.test',
    ).bindings();
    assert.equal(telegram.scope, 'telegram.test');
    assert.equal(telegram.updateId, 22);
    assert.equal(telegram.userId, 99);
  });
});
