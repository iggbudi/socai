import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

let telegramAccessModule = null;
try {
  telegramAccessModule = await import('../lib/telegramAccess.js');
} catch {
  // lib/telegramAccess.js belum tersedia — suite dilewati.
}

const { createTelegramAccess } = telegramAccessModule || {};

describe('createTelegramAccess', { skip: !telegramAccessModule }, () => {
  let tempDir;
  let filePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'socai-telegram-access-'));
    filePath = path.join(tempDir, 'telegram-users.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates legacy allowed_user_ids on load', () => {
    fs.writeFileSync(filePath, JSON.stringify({
      super_admin_id: 111,
      allowed_user_ids: [111, 222, 333],
    }));

    const access = createTelegramAccess({ filePath, superAdminId: 111 });

    assert.equal(access.getRole(111), 'super_admin');
    assert.equal(access.hasRole(111, 'super_admin'), true);
    assert.equal(access.hasRole(222, 'operator'), true);
    assert.equal(access.hasRole(333, 'operator'), true);
    assert.equal(access.isAllowed(444), false);

    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.deepEqual(saved.users, { '222': 'operator', '333': 'operator' });
  });

  it('addUser and removeUser update allowlist', () => {
    const access = createTelegramAccess({ filePath, superAdminId: 100 });

    const added = access.addUser(200);
    assert.equal(added.ok, true);
    assert.equal(added.alreadyAdded, false);
    assert.equal(added.role, 'operator');

    const updated = access.addUser(200, 'viewer');
    assert.equal(updated.ok, true);
    assert.equal(updated.alreadyAdded, true);
    assert.equal(updated.role, 'viewer');
    assert.equal(access.getRole(200), 'viewer');
    assert.equal(access.isAllowed(200), true);

    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.deepEqual(saved.users, { '200': 'viewer' });

    const removed = access.removeUser(200);
    assert.equal(removed.ok, true);
    assert.equal(access.isAllowed(200), false);

    const missing = access.removeUser(200);
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'not_found');

    const adminRemove = access.removeUser(100);
    assert.equal(adminRemove.ok, false);
    assert.equal(adminRemove.reason, 'super_admin');
    assert.equal(access.hasRole(100, 'super_admin'), true);
  });

  it('hasRole respects role hierarchy', () => {
    const access = createTelegramAccess({ filePath, superAdminId: 10 });
    access.addUser(20, 'operator');
    access.addUser(30, 'viewer');

    assert.equal(access.hasRole(10, 'super_admin'), true);
    assert.equal(access.hasRole(10, 'operator'), true);
    assert.equal(access.hasRole(10, 'viewer'), true);

    assert.equal(access.hasRole(20, 'operator'), true);
    assert.equal(access.hasRole(20, 'viewer'), true);
    assert.equal(access.hasRole(20, 'super_admin'), false);

    assert.equal(access.hasRole(30, 'viewer'), true);
    assert.equal(access.hasRole(30, 'operator'), false);
    assert.equal(access.hasRole(99, 'viewer'), false);
  });

  it('listUsers includes super admin and registered users', () => {
    const access = createTelegramAccess({ usersFile: filePath, superAdminId: 1 });
    access.addUser(2, 'operator');
    access.addUser(3, 'viewer');

    assert.deepEqual(access.listUsers(), [
      { id: 1, role: 'super_admin' },
      { id: 2, role: 'operator' },
      { id: 3, role: 'viewer' },
    ]);
    assert.equal(access.isSuperAdmin(1), true);
    assert.equal(access.isSuperAdmin(2), false);
  });

  it('rejects invalid roles on addUser', () => {
    const access = createTelegramAccess({ filePath, superAdminId: 100 });
    const result = access.addUser(200, 'super_admin');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_role');
  });
});