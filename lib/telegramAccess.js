import fs from 'fs';

const VALID_ROLES = new Set(['operator', 'viewer']);

const ROLE_RANK = {
  viewer: 1,
  operator: 2,
  super_admin: 3,
};

function normalizeStoredRole(role) {
  if (role === 'super_admin') return null;
  if (role === 'user') return 'operator';
  return VALID_ROLES.has(role) ? role : null;
}

function loadFromFile(filePath, superAdminId) {
  const users = new Map();
  let adminId = Number(superAdminId);
  let needsMigration = false;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Number.isFinite(Number(raw.super_admin_id))) {
      adminId = Number(raw.super_admin_id);
    }

    if (raw.users && typeof raw.users === 'object') {
      for (const [id, role] of Object.entries(raw.users)) {
        const num = Number(id);
        if (!Number.isFinite(num) || num === adminId) continue;
        const normalized = normalizeStoredRole(role);
        if (!normalized) continue;
        if (role === 'user') needsMigration = true;
        users.set(num, normalized);
      }
    }

    if (Array.isArray(raw.allowed_user_ids)) {
      for (const id of raw.allowed_user_ids) {
        const num = Number(id);
        if (!Number.isFinite(num) || num === adminId || users.has(num)) continue;
        users.set(num, 'operator');
        needsMigration = true;
      }
    }
  } catch (_) {
    // Fresh or unreadable file — start with empty allowlist.
  }

  return { users, superAdminId: adminId, needsMigration };
}

/**
 * @param {{ usersFile?: string, filePath?: string, superAdminId: number }} options
 */
export function createTelegramAccess({ usersFile, filePath, superAdminId }) {
  const resolvedPath = usersFile || filePath;
  if (!resolvedPath) {
    throw new Error('usersFile or filePath is required');
  }

  const data = loadFromFile(resolvedPath, superAdminId);

  function getRole(userId) {
    const id = Number(userId);
    if (!Number.isFinite(id)) return null;
    if (id === data.superAdminId) return 'super_admin';
    return data.users.get(id) || null;
  }

  function save() {
    const users = Object.fromEntries(
      [...data.users.entries()]
        .sort(([a], [b]) => a - b)
        .map(([id, role]) => [String(id), role])
    );

    const payload = {
      super_admin_id: data.superAdminId,
      users,
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  if (data.needsMigration) {
    save();
  }

  return {
    get superAdminId() {
      return data.superAdminId;
    },

    getSuperAdminId() {
      return data.superAdminId;
    },

    getRole,

    isSuperAdmin(userId) {
      return getRole(userId) === 'super_admin';
    },

    isAllowed(userId) {
      return getRole(userId) !== null;
    },

    hasRole(userId, minRole = 'viewer') {
      const role = getRole(userId);
      if (!role) return false;
      const userRank = ROLE_RANK[role];
      const requiredRank = ROLE_RANK[minRole];
      if (!userRank || !requiredRank) return false;
      return userRank >= requiredRank;
    },

    addUser(userId, role = 'operator') {
      const id = Number(userId);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return { ok: false, reason: 'invalid_id' };
      }
      if (id === data.superAdminId) {
        return { ok: false, reason: 'super_admin' };
      }
      if (!VALID_ROLES.has(role)) {
        return { ok: false, reason: 'invalid_role' };
      }

      const alreadyAdded = data.users.has(id);
      data.users.set(id, role);
      save();

      return { ok: true, role, alreadyAdded };
    },

    removeUser(userId) {
      const id = Number(userId);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return { ok: false, reason: 'invalid_id' };
      }
      if (id === data.superAdminId) {
        return { ok: false, reason: 'super_admin' };
      }
      if (!data.users.has(id)) {
        return { ok: false, reason: 'not_found' };
      }

      data.users.delete(id);
      save();
      return { ok: true };
    },

    listUsers() {
      const list = [{ id: data.superAdminId, role: 'super_admin' }];
      for (const [id, role] of [...data.users.entries()].sort(([a], [b]) => a - b)) {
        list.push({ id, role });
      }
      return list;
    },

    save,

    load() {
      const loaded = loadFromFile(resolvedPath, superAdminId);
      data.users = loaded.users;
      data.superAdminId = loaded.superAdminId;
    },
  };
}