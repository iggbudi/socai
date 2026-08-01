import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramCtx, registerAndCapture } from '../../../../test/helpers/telegramCtx.mjs';
import {
  formatTelegramRole,
  getTelegramUserId,
  registerAccessCommands,
  registerTelegramAccessMiddleware,
  requireTelegramRole,
} from '../commands/akses.js';
import { registerStatusCommands } from '../commands/status.js';
import { registerProductCommands } from '../commands/produk.js';
import { registerContentCommands } from '../commands/konten.js';
import { registerScheduleCommands } from '../commands/jadwal.js';
import { registerTextHandler } from '../handlers/text.js';
import { registerPhotoHandler } from '../handlers/photo.js';
import { registerTelegramHandlers } from '../commands.js';

function createAccess({ allowed = true, role = 'super_admin', users = [] } = {}) {
  const calls = { add: [], remove: [] };
  return {
    calls,
    getRole: () => role,
    isAllowed: () => allowed,
    hasRole: () => role === 'super_admin',
    isSuperAdmin: () => role === 'super_admin',
    addUser: (...args) => {
      calls.add.push(args);
      return { ok: true, role: args[1] || 'operator', alreadyAdded: false };
    },
    removeUser: (id) => {
      calls.remove.push(id);
      return { ok: true };
    },
    listUsers: () => users,
  };
}

function capture(register, args) {
  return registerAndCapture(({ bot }) => register(bot, args));
}

function command(captured, name) {
  const handler = captured.commands.get(name);
  assert.ok(handler, `command ${name} should be registered`);
  return handler;
}

function action(captured, matcher) {
  const found = captured.actions.find(({ pattern }) => String(pattern) === matcher);
  assert.ok(found, `action ${matcher} should be registered`);
  return found.handler;
}

describe('telegram registration harness', () => {
  it('captures the complete production registration without polling', () => {
    const captured = registerAndCapture(registerTelegramHandlers, {
      access: createAccess(),
      state: {
        pendingPlans: new Map(),
        contentWizard: new Map(),
        productWizard: new Map(),
        uploadDir: '/tmp/uploads',
      },
      dependencies: {
        telegramAiRateLimiter: { check: () => ({ allowed: true }), consume: () => {} },
      },
    });

    for (const name of [
      'status',
      'whoami',
      'listproduk',
      'buatkonten',
      'jadwalkonten',
      'statuskonten',
      'tambahproduk',
      'jadwalkan',
      'postnow',
      'retrypost',
      'cekpost',
      'adduser',
      'removeuser',
      'listusers',
      'batal',
    ]) {
      assert.ok(captured.captured.commands.has(name), `${name} should be captured`);
    }
    assert.equal(captured.captured.starts.length, 1);
    assert.equal(captured.captured.helps.length, 1);
    assert.equal(captured.captured.middleware.length, 1);
    assert.equal(captured.captured.events.has('text'), true);
    assert.equal(captured.captured.events.has('photo'), true);
    assert.ok(captured.captured.actions.some(({ pattern }) => String(pattern).includes('approve_schedule')));
    assert.ok(captured.captured.actions.some(({ pattern }) => String(pattern).includes('reject_schedule')));
    assert.equal(captured.captured.catches.length, 1);
  });
});

describe('telegram access command modules', () => {
  it('formats roles and extracts numeric Telegram user ids', () => {
    const access = createAccess({ role: 'operator' });
    const { ctx } = createTelegramCtx({ from: { id: 42 } });

    assert.equal(getTelegramUserId(ctx), 42);
    assert.equal(formatTelegramRole(42, access), 'Operator');
    assert.equal(formatTelegramRole(42, createAccess({ role: 'unknown' })), 'unknown');
    assert.equal(formatTelegramRole(42, createAccess({ role: null })), 'Belum Terdaftar');
  });

  it('denies a role directly and through a command handler', async () => {
    const access = createAccess({ role: 'viewer' });
    const { ctx, calls } = createTelegramCtx({ message: { text: '/adduser nope', photo: [] } });

    assert.equal(requireTelegramRole(ctx, 'operator', access), false);
    const registered = capture(registerAccessCommands, { access });
    await command(registered.captured, 'adduser')(ctx);
    assert.equal(calls.at(-1).args[0], '⛔ Akses ditolak untuk perintah ini.');
  });

  it('validates adduser and removeuser arguments before mutating access', async () => {
    const access = createAccess();
    const registered = capture(registerAccessCommands, { access });
    const add = command(registered.captured, 'adduser');
    const remove = command(registered.captured, 'removeuser');
    const addCtx = createTelegramCtx({ message: { text: '/adduser nope', photo: [] } });
    const removeCtx = createTelegramCtx({ message: { text: '/removeuser nope', photo: [] } });

    await add(addCtx.ctx);
    await remove(removeCtx.ctx);
    assert.match(addCtx.calls[0].args[0], /Format salah/);
    assert.match(removeCtx.calls[0].args[0], /Format salah/);
    assert.deepEqual(access.calls.add, []);
    assert.deepEqual(access.calls.remove, []);
  });

  it('adds, removes, lists, and describes users', async () => {
    const access = createAccess({ users: [{ id: 7, role: 'operator' }] });
    const registered = capture(registerAccessCommands, { access });
    const addCtx = createTelegramCtx({ message: { text: '/adduser 99 viewer', photo: [] } });
    const removeCtx = createTelegramCtx({ message: { text: '/removeuser 99', photo: [] } });
    const whoCtx = createTelegramCtx({ from: { id: 99, username: 'tester', first_name: 'T' } });

    await command(registered.captured, 'adduser')(addCtx.ctx);
    await command(registered.captured, 'removeuser')(removeCtx.ctx);
    await command(registered.captured, 'listusers')(whoCtx.ctx);
    await command(registered.captured, 'whoami')(whoCtx.ctx);
    assert.deepEqual(access.calls.add, [[99, 'viewer']]);
    assert.deepEqual(access.calls.remove, [99]);
    assert.match(whoCtx.calls.at(-1).args[0], /Whoami/);
    assert.match(whoCtx.calls[0].args[0], /Daftar user/);
  });

  it('handles empty user lists and allows open commands through middleware', async () => {
    const access = createAccess({ allowed: false, users: [] });
    const registered = capture(registerAccessCommands, { access });
    const listCtx = createTelegramCtx({ message: { text: '/listusers', photo: [] } });
    await command(registered.captured, 'listusers')(listCtx.ctx);
    assert.equal(listCtx.calls[0].args[0], 'Belum ada user terdaftar.');

    const middleware = registerAndCapture(({ bot }) => registerTelegramAccessMiddleware(bot, { access }));
    let nextCalled = false;
    await middleware.captured.middleware[0](
      createTelegramCtx({ message: { text: '/whoami', photo: [] } }).ctx,
      async () => {
        nextCalled = true;
      },
    );
    assert.equal(nextCalled, true);

    const denied = createTelegramCtx({ message: { text: '/status', photo: [] } });
    await middleware.captured.middleware[0](denied.ctx, async () =>
      assert.fail('denied user must not continue'),
    );
    assert.match(denied.calls[0].args[0], /Akses ditolak/);
  });
});

describe('telegram status command modules', () => {
  it('registers start/help/status and reports a healthy database session', async () => {
    const access = createAccess();
    const registered = capture(registerStatusCommands, {
      access,
      agentSessions: new Map([['telegram:456', {}]]),
      dbPool: { query: async () => ({ rows: [] }) },
    });
    const startCtx = createTelegramCtx();
    const helpCtx = createTelegramCtx();
    const statusCtx = createTelegramCtx();

    await registered.captured.starts[0](startCtx.ctx);
    await registered.captured.helps[0](helpCtx.ctx);
    await command(registered.captured, 'status')(statusCtx.ctx);
    assert.match(startCtx.calls[0].args[0], /Asisten Automation/);
    assert.match(helpCtx.calls[0].args[0], /Perintah yang tersedia/);
    assert.match(statusCtx.calls[0].args[0], /Database: ✅ OK/);
  });

  it('reports database failures and an admin help section', async () => {
    const access = createAccess();
    const registered = capture(registerStatusCommands, {
      access,
      agentSessions: new Map(),
      dbPool: { query: async () => Promise.reject(new Error('offline')) },
    });
    const helpCtx = createTelegramCtx();
    const statusCtx = createTelegramCtx();
    await registered.captured.helps[0](helpCtx.ctx);
    await command(registered.captured, 'status')(statusCtx.ctx);
    assert.match(helpCtx.calls[0].args[0], /adduser/);
    assert.match(statusCtx.calls[0].args[0], /Database: ❌ Gagal/);
    assert.match(statusCtx.calls[0].args[0], /Belum dibuat/);
  });
});

describe('telegram product command modules', () => {
  it('lists products and handles a failed product query', async () => {
    const access = createAccess();
    const empty = capture(registerProductCommands, {
      access,
      productWizard: new Map(),
      contentWizard: new Map(),
      dbPool: { query: async () => ({ rows: [] }) },
    });
    const emptyCtx = createTelegramCtx();
    await command(empty.captured, 'listproduk')(emptyCtx.ctx);
    assert.match(emptyCtx.calls.find((call) => call.method === 'reply').args[0], /Belum ada produk/);

    const failed = capture(registerProductCommands, {
      access,
      productWizard: new Map(),
      contentWizard: new Map(),
      dbPool: { query: async () => Promise.reject(new Error('db down')) },
    });
    const failedCtx = createTelegramCtx();
    await command(failed.captured, 'listproduk')(failedCtx.ctx);
    assert.match(failedCtx.calls.find((call) => call.method === 'reply').args[0], /db down/);
  });

  it('starts and cancels product/content wizards', async () => {
    const productWizard = new Map();
    const contentWizard = new Map();
    const registered = capture(registerProductCommands, {
      access: createAccess(),
      productWizard,
      contentWizard,
      dbPool: { query: async () => ({ rows: [] }) },
    });
    const startCtx = createTelegramCtx();
    await command(registered.captured, 'tambahproduk')(startCtx.ctx);
    assert.equal(productWizard.has(456), true);
    const cancelCtx = createTelegramCtx();
    await command(registered.captured, 'batal')(cancelCtx.ctx);
    assert.equal(productWizard.has(456), false);
    assert.match(cancelCtx.calls[0].args[0], /Pembatalan/);
    const noCancelCtx = createTelegramCtx();
    await command(registered.captured, 'batal')(noCancelCtx.ctx);
    assert.match(noCancelCtx.calls[0].args[0], /Tidak ada proses/);
  });

  it('saves a product and handles missing sessions, cancel, and database errors', async () => {
    const productWizard = new Map();
    const dbCalls = [];
    const registered = capture(registerProductCommands, {
      access: createAccess(),
      productWizard,
      contentWizard: new Map(),
      dbPool: {
        query: async (...args) => {
          dbCalls.push(args);
          return { rows: [{ id: 12 }] };
        },
      },
    });
    const missingCtx = createTelegramCtx();
    await action(registered.captured, 'save_produk')(missingCtx.ctx);
    assert.match(missingCtx.calls[0].args[0], /Sesi habis/);

    productWizard.set(456, {
      data: { nama: 'Batik', harga: 50000, stok: 2, deskripsi: 'Indah', gambar: '' },
    });
    const saveCtx = createTelegramCtx();
    await action(registered.captured, 'save_produk')(saveCtx.ctx);
    assert.equal(dbCalls.length, 1);
    assert.match(saveCtx.calls.at(-1).args[0], /Produk berhasil/);

    productWizard.set(456, { data: { nama: 'Batik', harga: 1, stok: 1, deskripsi: '', gambar: '' } });
    const cancelCtx = createTelegramCtx();
    await action(registered.captured, 'cancel_produk')(cancelCtx.ctx);
    assert.equal(productWizard.has(456), false);
    assert.match(cancelCtx.calls.at(-1).args[0], /Pembatalan/);

    const failed = capture(registerProductCommands, {
      access: createAccess(),
      productWizard: new Map([
        [456, { data: { nama: 'Batik', harga: 1, stok: 1, deskripsi: '', gambar: '' } }],
      ]),
      contentWizard: new Map(),
      dbPool: { query: async () => Promise.reject(new Error('insert failed')) },
    });
    const failedCtx = createTelegramCtx();
    await action(failed.captured, 'save_produk')(failedCtx.ctx);
    assert.match(failedCtx.calls.at(-1).args[0], /insert failed/);
  });
});

describe('telegram content command modules', () => {
  it('starts the content wizard and saves plans through the injected domain function', async () => {
    const contentWizard = new Map();
    const pendingPlans = new Map([[456, [{ judul: 'Plan' }]]]);
    const savedCalls = [];
    const registered = capture(registerContentCommands, {
      access: createAccess(),
      contentWizard,
      pendingPlans,
      dbPool: { query: async () => ({ rows: [] }) },
      savePlansToDb: async (...args) => {
        savedCalls.push(args);
        return [{ id: 1 }, { id: 2 }];
      },
    });
    const startCtx = createTelegramCtx();
    await command(registered.captured, 'buatkonten')(startCtx.ctx);
    assert.equal(contentWizard.has(456), true);
    const saveCtx = createTelegramCtx();
    await action(registered.captured, 'save_plan')(saveCtx.ctx);
    assert.equal(savedCalls.length, 1);
    assert.equal(pendingPlans.has(456), false);
    assert.match(saveCtx.calls.at(-1).args[0], /2 rencana/);
  });

  it('handles missing plan and save errors', async () => {
    const missing = capture(registerContentCommands, {
      access: createAccess(),
      contentWizard: new Map(),
      pendingPlans: new Map(),
      dbPool: {},
      savePlansToDb: async () => [],
    });
    const missingCtx = createTelegramCtx();
    await action(missing.captured, 'save_plan')(missingCtx.ctx);
    assert.match(missingCtx.calls[0].args[0], /Data rencana/);

    const failed = capture(registerContentCommands, {
      access: createAccess(),
      contentWizard: new Map(),
      pendingPlans: new Map([[456, { judul: 'Plan' }]]),
      dbPool: {},
      savePlansToDb: async () => Promise.reject(new Error('save failed')),
    });
    const failedCtx = createTelegramCtx();
    await action(failed.captured, 'save_plan')(failedCtx.ctx);
    assert.match(failedCtx.calls.at(-1).args[0], /save failed/);
  });
});

describe('telegram schedule command modules', () => {
  function scheduleOptions(overrides = {}) {
    return {
      access: createAccess(),
      dbPool: { query: async () => ({ rows: [] }) },
      isReplizConfigured: () => true,
      schedulePlanToRepliz: async () => ({ repliz_status: 'scheduled' }),
      schedulePlanToReplizNow: async () => ({ repliz_status: 'posted' }),
      syncPlanReplizStatus: async () => ({
        plan: { repliz_schedule_id: 'r1', repliz_status: 'posted', status: 'posted' },
      }),
      approvePlanSchedule: async () => ({ repliz_status: 'scheduled' }),
      rejectPlanSchedule: async () => ({ id: 7 }),
      scheduleViaRepliz: async (ctx) => ctx.reply('scheduled'),
      ...overrides,
    };
  }

  it('reports empty calendar and empty status results', async () => {
    const registered = capture(registerScheduleCommands, scheduleOptions());
    const calendarCtx = createTelegramCtx({ message: { text: '/jadwalkonten bulan', photo: [] } });
    const statusCtx = createTelegramCtx({ message: { text: '/statuskonten posted', photo: [] } });
    await command(registered.captured, 'jadwalkonten')(calendarCtx.ctx);
    await command(registered.captured, 'statuskonten')(statusCtx.ctx);
    assert.equal(calendarCtx.calls[0].args[0], 'Belum ada rencana konten.');
    assert.match(statusCtx.calls[0].args[0], /Tidak ada konten/);
  });

  it('formats calendar/status rows and rejects invalid status', async () => {
    const dbPool = {
      query: async (sql) =>
        String(sql).includes('UPDATE')
          ? { rows: [{ id: 4, judul: 'Batik', status: 'draft' }] }
          : { rows: [{ id: 4, judul: 'Batik', status: 'posted', jadwal: 'Jumat', copywriting: 'Halo' }] },
    };
    const registered = capture(registerScheduleCommands, scheduleOptions({ dbPool }));
    const calendarCtx = createTelegramCtx({ message: { text: '/jadwalkonten hari', photo: [] } });
    const statusCtx = createTelegramCtx({ message: { text: '/statuskonten posted', photo: [] } });
    const invalidCtx = createTelegramCtx({ message: { text: '/statuskonten nope', photo: [] } });
    await command(registered.captured, 'jadwalkonten')(calendarCtx.ctx);
    await command(registered.captured, 'statuskonten')(statusCtx.ctx);
    await command(registered.captured, 'statuskonten')(invalidCtx.ctx);
    assert.match(calendarCtx.calls[0].args[0], /Batik/);
    assert.match(statusCtx.calls[0].args[0], /Batik/);
    assert.match(invalidCtx.calls[0].args[0], /Status valid/);
  });

  it('validates and mutates status/delete commands for the super admin', async () => {
    const dbPool = {
      query: async (sql) => {
        if (String(sql).includes('UPDATE')) return { rows: [{ id: 4, judul: 'Batik', status: 'draft' }] };
        if (String(sql).includes('DELETE')) return { rows: [{ id: 4, judul: 'Batik' }] };
        return { rows: [] };
      },
    };
    const registered = capture(registerScheduleCommands, scheduleOptions({ dbPool }));
    const badStatus = createTelegramCtx({ message: { text: '/ubahstatuskonten no nope', photo: [] } });
    const goodStatus = createTelegramCtx({ message: { text: '/ubahstatuskonten 4 draft', photo: [] } });
    const badDelete = createTelegramCtx({ message: { text: '/hapuskonten 4', photo: [] } });
    const goodDelete = createTelegramCtx({ message: { text: '/hapuskonten HAPUS 4', photo: [] } });
    await command(registered.captured, 'ubahstatuskonten')(badStatus.ctx);
    await command(registered.captured, 'ubahstatuskonten')(goodStatus.ctx);
    await command(registered.captured, 'hapuskonten')(badDelete.ctx);
    await command(registered.captured, 'hapuskonten')(goodDelete.ctx);
    assert.match(badStatus.calls[0].args[0], /Format/);
    assert.match(goodStatus.calls[0].args[0], /Status diperbarui/);
    assert.match(badDelete.calls[0].args[0], /Konfirmasi ganda/);
    assert.match(goodDelete.calls[0].args[0], /dihapus/);
  });

  it('routes schedule, post-now, and retry commands through the injected helper', async () => {
    const calls = [];
    const registered = capture(
      registerScheduleCommands,
      scheduleOptions({
        scheduleViaRepliz: async (ctx, id, options) => {
          calls.push({ id, options });
          return ctx.reply('ok');
        },
      }),
    );
    for (const name of ['jadwalkan', 'postnow', 'retrypost']) {
      const ctx = createTelegramCtx({ message: { text: `/${name} 7`, photo: [] } });
      await command(registered.captured, name)(ctx.ctx);
    }
    assert.deepEqual(
      calls.map(({ id, options }) => [id, options.postNow, options.force]),
      [
        ['7', false, false],
        ['7', true, false],
        ['7', false, true],
      ],
    );
  });

  it('checks post ids and handles post status success/error', async () => {
    const registered = capture(registerScheduleCommands, scheduleOptions());
    const invalidCtx = createTelegramCtx({ message: { text: '/cekpost nope', photo: [] } });
    const okCtx = createTelegramCtx({ message: { text: '/cekpost 7', photo: [] } });
    await command(registered.captured, 'cekpost')(invalidCtx.ctx);
    await command(registered.captured, 'cekpost')(okCtx.ctx);
    assert.match(invalidCtx.calls[0].args[0], /Format/);
    assert.match(okCtx.calls[0].args[0], /Status Repliz #7/);

    const failed = capture(
      registerScheduleCommands,
      scheduleOptions({ syncPlanReplizStatus: async () => Promise.reject(new Error('not found')) }),
    );
    const failedCtx = createTelegramCtx({ message: { text: '/cekpost 7', photo: [] } });
    await command(failed.captured, 'cekpost')(failedCtx.ctx);
    assert.match(failedCtx.calls[0].args[0], /not found/);
  });

  it('parses approve/reject action ids and reports action errors', async () => {
    let approved;
    let rejected;
    const registered = capture(
      registerScheduleCommands,
      scheduleOptions({
        approvePlanSchedule: async (_pool, id) => {
          approved = id;
          return { plan: { repliz_status: 'scheduled' } };
        },
        rejectPlanSchedule: async (_pool, id) => {
          rejected = id;
          return { id };
        },
      }),
    );
    const approveCtx = createTelegramCtx({ match: ['approve_schedule:7', '7'] });
    const rejectCtx = createTelegramCtx({ match: ['reject_schedule:8', '8'] });
    await action(registered.captured, '/^approve_schedule:(\\d+)$/')(approveCtx.ctx);
    await action(registered.captured, '/^reject_schedule:(\\d+)$/')(rejectCtx.ctx);
    assert.equal(approved, '7');
    assert.equal(rejected, '8');
    assert.match(approveCtx.calls.at(-1).args[0], /dijadwalkan/);
    assert.match(rejectCtx.calls.at(-1).args[0], /dibatalkan/);

    const failed = capture(
      registerScheduleCommands,
      scheduleOptions({
        rejectPlanSchedule: async () => {
          const error = new Error('Rencana tidak ditemukan');
          error.statusCode = 404;
          throw error;
        },
      }),
    );
    const failedCtx = createTelegramCtx({ match: ['reject_schedule:9', '9'] });
    await action(failed.captured, '/^reject_schedule:(\\d+)$/')(failedCtx.ctx);
    assert.match(
      failedCtx.calls.findLast((call) => call.method === 'answerCbQuery').args[0],
      /Rencana tidak ditemukan/,
    );
    assert.match(failedCtx.calls.at(-1).args[0], /Gagal membatalkan/);
  });
});

describe('telegram text handler', () => {
  function textOptions(overrides = {}) {
    const agentSessions = new Map();
    const pendingPlans = new Map();
    const contentWizard = new Map();
    const productWizard = new Map();
    const events = [];
    const session = {
      subscribe: (listener) => {
        events.push(listener);
        return () => {};
      },
      prompt: async () => {
        for (const listener of events) {
          listener({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: 'AI reply' },
          });
        }
      },
    };
    return {
      access: createAccess(),
      dbPool: { query: async () => ({ rows: [] }) },
      agentSessions,
      touchAgentSession: () => {},
      initAgent: async () => session,
      createAgentRun: async () => ({ id: 1 }),
      completeAgentRun: async () => {},
      resolveAutonomyMode: () => 'assistive',
      normalizeAiMessage: (text) => text.trim(),
      AiMessageError: class AiMessageError extends Error {},
      telegramAiRateLimiter: { check: () => ({ allowed: true }), consume: () => {} },
      pendingPlans,
      contentWizard,
      productWizard,
      ...overrides,
    };
  }

  it('routes product and content wizard text before AI chat', async () => {
    const productWizard = new Map([[456, { step: 'waiting_nama', data: {} }]]);
    const productOptions = textOptions({ productWizard });
    const product = capture(registerTextHandler, productOptions);
    const productCtx = createTelegramCtx({ message: { text: 'Batik Pesisir', photo: [] } });
    await product.captured.events.get('text')(productCtx.ctx, async () => {});
    assert.match(productCtx.calls[0].args[0], /Nama:.*Batik Pesisir/);

    const contentWizard = new Map([
      [
        456,
        {
          step: 'jenis',
          data: {
            jenis: '',
            tujuan: '',
            produk: '',
            audiens: '',
            jadwal: '',
            tone: '',
            catatan: '',
            gambar: '',
          },
        },
      ],
    ]);
    const content = capture(registerTextHandler, textOptions({ contentWizard }));
    const contentCtx = createTelegramCtx({ message: { text: '1', photo: [] } });
    await content.captured.events.get('text')(contentCtx.ctx, async () => {});
    assert.match(contentCtx.calls[0].args[0], /Pilih tujuan/);

    const intent = capture(registerTextHandler, textOptions());
    const intentCtx = createTelegramCtx({ message: { text: 'Tolong tambah produk baru', photo: [] } });
    await intent.captured.events.get('text')(intentCtx.ctx, async () => {});
    assert.match(intentCtx.calls[0].args[0], /Tambah Produk Baru/);

    const generated = textOptions({
      contentWizard: new Map([[456, { step: 'gambar', data: { jenis: 'Edukasi' } }]]),
    });
    const generatedCapture = capture(registerTextHandler, generated);
    const generatedCtx = createTelegramCtx({ message: { text: 'skip', photo: [] } });
    await generatedCapture.captured.events.get('text')(generatedCtx.ctx, async () => {});
    assert.match(generatedCtx.calls.map((call) => call.args[0]).join('\n'), /AI reply/);
  });

  it('passes commands to the next handler when no wizard is active', async () => {
    const registered = capture(registerTextHandler, textOptions());
    const ctx = createTelegramCtx({ message: { text: '/status', photo: [] } });
    let nextCalled = false;
    await registered.captured.events.get('text')(ctx.ctx, async () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(ctx.calls.length, 0);
  });

  it('runs AI chat, records an agent run, and stores a generated plan', async () => {
    const options = textOptions();
    const registered = capture(registerTextHandler, options);
    const ctx = createTelegramCtx({ message: { text: 'buat rencana', photo: [] } });
    await registered.captured.events.get('text')(ctx.ctx, async () => {});
    assert.match(ctx.calls.map((call) => call.args[0]).join('\n'), /AI reply/);

    const planOptions = textOptions();
    planOptions.initAgent = async () => ({
      subscribe: (listener) => {
        planOptions.listener = listener;
        return () => {};
      },
      prompt: async () => {
        planOptions.listener({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            delta: '```json\n[{"judul":"Plan"}]\n```',
          },
        });
      },
    });
    const plan = capture(registerTextHandler, planOptions);
    const planCtx = createTelegramCtx({ message: { text: 'buat plan', photo: [] } });
    await plan.captured.events.get('text')(planCtx.ctx, async () => {});
    assert.deepEqual(planOptions.pendingPlans.get(456), [{ judul: 'Plan' }]);
    assert.equal(planCtx.calls.at(-1).args[1].reply_markup.inline_keyboard[0][0].callback_data, 'save_plan');
  });

  it('handles existing sessions, rate limits, invalid messages, and agent init failures', async () => {
    let touched = false;
    const existing = textOptions({
      agentSessions: new Map(),
      touchAgentSession: () => {
        touched = true;
      },
    });
    existing.agentSessions.set('telegram:456', {
      subscribe: (listener) => {
        listener({ type: 'other' });
        return () => {};
      },
      prompt: async () => {},
    });
    const existingCapture = capture(registerTextHandler, existing);
    await existingCapture.captured.events.get('text')(
      createTelegramCtx({ message: { text: 'hello', photo: [] } }).ctx,
      async () => {},
    );
    assert.equal(touched, true);

    const limited = capture(
      registerTextHandler,
      textOptions({
        telegramAiRateLimiter: { check: () => ({ allowed: false, retryAfterMs: 1500 }), consume: () => {} },
      }),
    );
    const limitedCtx = createTelegramCtx({ message: { text: 'hello', photo: [] } });
    await limited.captured.events.get('text')(limitedCtx.ctx, async () => {});
    assert.match(limitedCtx.calls[0].args[0], /2 detik/);

    class MessageError extends Error {}
    const invalid = capture(
      registerTextHandler,
      textOptions({
        normalizeAiMessage: () => {
          throw new MessageError('too long');
        },
        AiMessageError: MessageError,
      }),
    );
    const invalidCtx = createTelegramCtx({ message: { text: 'hello', photo: [] } });
    await invalid.captured.events.get('text')(invalidCtx.ctx, async () => {});
    assert.match(invalidCtx.calls[0].args[0], /too long/);

    const initFailed = capture(
      registerTextHandler,
      textOptions({ initAgent: async () => Promise.reject(new Error('model unavailable')) }),
    );
    const initCtx = createTelegramCtx({ message: { text: 'hello', photo: [] } });
    await initFailed.captured.events.get('text')(initCtx.ctx, async () => {});
    assert.match(initCtx.calls.at(-1).args[0], /model unavailable/);

    const unknownError = capture(
      registerTextHandler,
      textOptions({
        normalizeAiMessage: () => {
          throw new Error('normalizer crashed');
        },
      }),
    );
    const unknownCtx = createTelegramCtx({ message: { text: 'hello', photo: [] } });
    await assert.rejects(
      () => unknownError.captured.events.get('text')(unknownCtx.ctx, async () => {}),
      /normalizer crashed/,
    );

    const runError = capture(
      registerTextHandler,
      textOptions({ createAgentRun: async () => Promise.reject(new Error('audit unavailable')) }),
    );
    const runErrorCtx = createTelegramCtx({ message: { text: 'hello', photo: [] } });
    await runError.captured.events.get('text')(runErrorCtx.ctx, async () => {});
    assert.match(runErrorCtx.calls.map((call) => call.args[0]).join('\n'), /AI reply/);

    const promptError = textOptions({
      initAgent: async () => ({
        subscribe: () => () => {},
        prompt: async () => Promise.reject(new Error('prompt failed')),
      }),
    });
    const promptErrorCapture = capture(registerTextHandler, promptError);
    const promptErrorCtx = createTelegramCtx({ message: { text: 'hello', photo: [] } });
    await promptErrorCapture.captured.events.get('text')(promptErrorCtx.ctx, async () => {});
    assert.match(promptErrorCtx.calls.at(-1).args[0], /prompt failed/);
  });

  it('splits an oversized AI response into multiple replies', async () => {
    const options = textOptions();
    options.initAgent = async () => ({
      subscribe: (listener) => {
        options.listener = listener;
        return () => {};
      },
      prompt: async () => {
        options.listener({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'x'.repeat(4100) },
        });
      },
    });
    const registered = capture(registerTextHandler, options);
    const ctx = createTelegramCtx({ message: { text: 'panjang', photo: [] } });
    await registered.captured.events.get('text')(ctx.ctx, async () => {});
    assert.equal(ctx.calls.filter((call) => call.method === 'reply').length, 3);
  });
});

describe('telegram photo handler', () => {
  function photoContext() {
    return createTelegramCtx({
      from: { id: 123, first_name: 'Test' },
      message: { message_id: 9, date: 1, photo: [{ file_id: 'small' }, { file_id: 'large' }] },
    });
  }

  it('saves content photos locally through the injected downloader and forwards an AI update', async () => {
    const contentWizard = new Map([
      [
        456,
        {
          step: 'gambar',
          data: {
            jenis: 'Edukasi',
            tujuan: 'Awareness',
            produk: '',
            audiens: 'umum',
            jadwal: 'Jumat',
            tone: 'hangat',
            catatan: '',
            gambar: '',
          },
        },
      ],
    ]);
    const updates = [];
    const bot = {
      on: (event, handler) => (bot[event] = handler),
      handleUpdate: async (update) => updates.push(update),
    };
    registerPhotoHandler(bot, {
      contentWizard,
      productWizard: new Map(),
      uploadDir: '/tmp/uploads',
      downloadTelegramPhoto: async (id, options) => {
        assert.equal(id, 'large');
        assert.equal(options.cloudinary, true);
        return '/uploads/content.jpg';
      },
    });
    const ctx = photoContext();
    await bot.photo(ctx.ctx);
    assert.equal(updates.length, 1);
    assert.equal(contentWizard.has(456), false);
    assert.match(ctx.calls.find((call) => call.method === 'reply').args[0], /Gambar berhasil/);
  });

  it('reports content upload failures and product photo success/failure', async () => {
    const contentWizard = new Map([[456, { step: 'gambar', data: {} }]]);
    const failedBot = { on: (event, handler) => (failedBot[event] = handler), handleUpdate: async () => {} };
    registerPhotoHandler(failedBot, {
      contentWizard,
      productWizard: new Map(),
      uploadDir: '/tmp/uploads',
      downloadTelegramPhoto: async () => Promise.reject(new Error('upload failed')),
    });
    const failedCtx = photoContext();
    await failedBot.photo(failedCtx.ctx);
    assert.match(failedCtx.calls.at(-1).args[0], /upload failed/);

    const productWizard = new Map([
      [456, { step: 'waiting_gambar', data: { nama: 'Batik', harga: 1, stok: 1 } }],
    ]);
    const productBot = {
      on: (event, handler) => (productBot[event] = handler),
      handleUpdate: async () => {},
    };
    registerPhotoHandler(productBot, {
      contentWizard: new Map(),
      productWizard,
      uploadDir: '/tmp/uploads',
      downloadTelegramPhoto: async () => '/uploads/product.jpg',
    });
    const productCtx = photoContext();
    await productBot.photo(productCtx.ctx);
    assert.equal(productWizard.get(456).step, 'confirm');
    assert.match(productCtx.calls.at(-1).args[0], /Konfirmasi Produk/);

    const errorBot = { on: (event, handler) => (errorBot[event] = handler), handleUpdate: async () => {} };
    const errorWizard = new Map([[456, { step: 'waiting_gambar', data: {} }]]);
    registerPhotoHandler(errorBot, {
      contentWizard: new Map(),
      productWizard: errorWizard,
      uploadDir: '/tmp/uploads',
      downloadTelegramPhoto: async () => Promise.reject(new Error('local failed')),
    });
    const errorCtx = photoContext();
    await errorBot.photo(errorCtx.ctx);
    assert.match(errorCtx.calls.at(-1).args[0], /local failed/);
  });
});
