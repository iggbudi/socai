import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../bot.js';

class FakeBot {
  constructor() {
    this.registered = { commands: [], actions: [], events: [], middleware: 0, starts: 0, helps: 0 };
    this.telegram = {};
  }

  use() {
    this.registered.middleware++;
  }

  start() {
    this.registered.starts++;
  }

  help() {
    this.registered.helps++;
  }

  command(name) {
    this.registered.commands.push(name);
  }

  on(event) {
    this.registered.events.push(event);
  }

  action(pattern) {
    this.registered.actions.push(pattern);
  }

  catch() {}

  handleUpdate() {}
}

function createAccessStub() {
  return {
    getRole: () => 'super_admin',
    isAllowed: () => true,
    hasRole: () => true,
    isSuperAdmin: () => true,
    addUser: () => ({ ok: true, role: 'operator', alreadyAdded: false }),
    removeUser: () => ({ ok: true }),
    listUsers: () => [],
  };
}

describe('createBot', () => {
  it('registers commands without launching Telegram polling', () => {
    let instance;
    const bot = createBot({
      token: 'dummy-token',
      telegrafFactory: () => {
        instance = new FakeBot();
        return instance;
      },
      access: createAccessStub(),
      rateLimiter: { check: () => ({ allowed: true }), consume: () => ({ allowed: true }) },
    });

    assert.equal(bot, instance);
    assert.equal(instance.registered.middleware, 1);
    assert.equal(instance.registered.starts, 1);
    assert.equal(instance.registered.helps, 1);
    assert.deepEqual(instance.registered.commands.sort(), [
      'adduser',
      'batal',
      'buatkonten',
      'cekpost',
      'hapuskonten',
      'jadwalkan',
      'jadwalkonten',
      'listproduk',
      'listusers',
      'postnow',
      'removeuser',
      'retrypost',
      'status',
      'statuskonten',
      'tambahproduk',
      'ubahstatuskonten',
      'whoami',
    ]);
    assert.deepEqual(instance.registered.events.sort(), ['photo', 'text']);
    assert.equal(instance.registered.actions.length, 5);
  });
});
