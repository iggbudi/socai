/**
 * S34 (D1) — lib/features/agent/core.js, permukaan tak-teruji terbesar (565 baris, 9,20% line
 * sebelum sprint ini). SDK `pi-coding-agent` dan seluruh pool DB di-seam lewat parameter `deps`
 * (nilai default = perilaku lama); test ini memverifikasi siklus hidup sesi, pemilihan model,
 * dan logika masing-masing tool tanpa memanggil SDK atau database sungguhan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActuatorPromptSection,
  createAgentSessionForKey,
  initAgent,
  agentSessions,
  agentSessionLastUsed,
  agentSessionPromises,
  setActiveAgentRunContext,
  clearActiveAgentRunContext,
} from '../core.js';
import { createFakeAgentSdk, fakePool, findTool } from '../../../../test/helpers/fakeAgentSdk.mjs';

function cleanupSession(sessionKey) {
  agentSessions.delete(sessionKey);
  agentSessionLastUsed.delete(sessionKey);
  agentSessionPromises.delete(sessionKey);
  clearActiveAgentRunContext(sessionKey);
}

const DEFAULT_MODEL = { id: 'fake-model' };

function baseDeps(overrides = {}) {
  const sdk = createFakeAgentSdk({ models: { 'opencode/deepseek-v4-flash-free': DEFAULT_MODEL } });
  return {
    sdk,
    deps: {
      ...sdk.deps,
      dbPool: fakePool(),
      aiPool: fakePool(),
      env: {},
      ...overrides,
    },
  };
}

test('buildActuatorPromptSection: assistive melarang save/schedule', () => {
  const text = buildActuatorPromptSection('assistive');
  assert.match(text, /JANGAN panggil `save_content_plan` atau `schedule_content`/);
});

test('buildActuatorPromptSection: supervised boleh save, larang schedule', () => {
  const text = buildActuatorPromptSection('supervised');
  assert.match(text, /boleh `save_content_plan`/);
  assert.match(text, /jangan `schedule_content`/);
});

test('buildActuatorPromptSection: bounded boleh keduanya; tanpa REQUIRE_APPROVAL tidak menyebut notifikasi', () => {
  const original = process.env.REQUIRE_APPROVAL;
  delete process.env.REQUIRE_APPROVAL;
  try {
    const text = buildActuatorPromptSection('bounded');
    assert.match(text, /boleh `save_content_plan` dan `schedule_content`/);
    assert.doesNotMatch(text, /- REQUIRE_APPROVAL aktif: setelah save/);
  } finally {
    if (original === undefined) delete process.env.REQUIRE_APPROVAL;
    else process.env.REQUIRE_APPROVAL = original;
  }
});

test('buildActuatorPromptSection: bounded + REQUIRE_APPROVAL=true menyebut notifikasi approval', () => {
  const original = process.env.REQUIRE_APPROVAL;
  process.env.REQUIRE_APPROVAL = 'true';
  try {
    const text = buildActuatorPromptSection('bounded');
    assert.match(text, /REQUIRE_APPROVAL aktif/);
  } finally {
    if (original === undefined) delete process.env.REQUIRE_APPROVAL;
    else process.env.REQUIRE_APPROVAL = original;
  }
});

test('buildActuatorPromptSection: default ke assistive bila mode kosong', () => {
  const text = buildActuatorPromptSection(undefined);
  assert.match(text, /JANGAN panggil `save_content_plan`/);
});

test('createAgentSessionForKey: model AI_MODEL dipakai bila tersedia', async () => {
  const sessionKey = 'web:test-model-select';
  const { sdk, deps } = baseDeps({
    env: { AI_MODEL: 'anthropic/claude' },
  });
  sdk.deps.modelRuntimeCreate = async () => ({
    getModel: (provider, modelId) =>
      provider === 'anthropic' && modelId === 'claude' ? { id: 'claude-model' } : null,
  });
  try {
    await createAgentSessionForKey(sessionKey, { ...deps, ...sdk.deps });
    assert.equal(sdk.calls.createAgentSession.length, 1);
    assert.deepEqual(sdk.calls.createAgentSession[0].model, { id: 'claude-model' });
  } finally {
    cleanupSession(sessionKey);
  }
});

test('createAgentSessionForKey: sesi telegram mencoba TELEGRAM_AI_MODEL lebih dulu', async () => {
  const sessionKey = 'telegram:123';
  const { sdk, deps } = baseDeps({
    env: { TELEGRAM_AI_MODEL: 'groq/llama', AI_MODEL: 'anthropic/claude' },
  });
  const triedProviders = [];
  sdk.deps.modelRuntimeCreate = async () => ({
    getModel: (provider, modelId) => {
      triedProviders.push(`${provider}/${modelId}`);
      return provider === 'groq' ? { id: 'groq-model' } : null;
    },
  });
  try {
    await createAgentSessionForKey(sessionKey, { ...deps, ...sdk.deps });
    assert.equal(triedProviders[0], 'groq/llama');
    assert.deepEqual(sdk.calls.createAgentSession[0].model, { id: 'groq-model' });
  } finally {
    cleanupSession(sessionKey);
  }
});

test('createAgentSessionForKey: tidak ada model tersedia → error jelas berisi daftar yang dicoba', async () => {
  const sessionKey = 'web:no-model';
  const { sdk, deps } = baseDeps({ env: { AI_MODEL: 'anthropic/claude' } });
  sdk.deps.modelRuntimeCreate = async () => ({ getModel: () => null });
  try {
    await assert.rejects(
      () => createAgentSessionForKey(sessionKey, { ...deps, ...sdk.deps }),
      /Tidak ada model AI yang tersedia. Dicoba: anthropic\/claude, opencode\/deepseek-v4-flash-free/,
    );
  } finally {
    cleanupSession(sessionKey);
  }
});

test('createAgentSessionForKey: berhasil mendaftarkan sesi dan menyusun 6 tool', async () => {
  const sessionKey = 'web:tool-wiring';
  const { sdk, deps } = baseDeps();
  try {
    const session = await createAgentSessionForKey(sessionKey, deps);
    assert.equal(agentSessions.get(sessionKey), session);
    assert.ok(agentSessionLastUsed.has(sessionKey));

    const call = sdk.calls.createAgentSession[0];
    const toolNames = call.customTools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      'db_query',
      'get_calendar_gaps',
      'save_content_plan',
      'schedule_content',
      'sync_content_status',
      'web_search',
    ]);
    assert.deepEqual(call.tools.sort(), toolNames);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: menolak query non-SELECT', async () => {
  const sessionKey = 'web:dbquery-guard';
  const { sdk, deps } = baseDeps();
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');
    const result = await dbQueryTool.execute('call-1', { query: 'DELETE FROM produk' });
    assert.match(result.content[0].text, /Hanya query SELECT yang diizinkan/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: menolak multi-statement dan keyword berbahaya', async () => {
  const sessionKey = 'web:dbquery-guard-2';
  const { sdk, deps } = baseDeps();
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');

    const multi = await dbQueryTool.execute('c', { query: 'SELECT 1; DROP TABLE produk' });
    assert.match(multi.content[0].text, /Multi-statement queries tidak diizinkan/);

    const dangerous = await dbQueryTool.execute('c', {
      query: 'SELECT * FROM produk WHERE 1=1; DROP TABLE x',
    });
    assert.match(dangerous.content[0].text, /Multi-statement queries tidak diizinkan/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: menolak tabel tak diizinkan dan JOIN', async () => {
  const sessionKey = 'web:dbquery-guard-3';
  const { sdk, deps } = baseDeps();
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');

    const badTable = await dbQueryTool.execute('c', { query: 'SELECT * FROM users' });
    assert.match(badTable.content[0].text, /Hanya tabel produk dan pemasaran/);

    const joined = await dbQueryTool.execute('c', {
      query: 'SELECT * FROM produk JOIN pemasaran ON produk.id = pemasaran.id',
    });
    assert.match(joined.content[0].text, /JOIN tidak diizinkan/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: menolak keyword berbahaya standalone (DROP/DELETE/dst)', async () => {
  const sessionKey = 'web:dbquery-dangerous-keyword';
  const { sdk, deps } = baseDeps();
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');
    const result = await dbQueryTool.execute('c', {
      query: "SELECT * FROM produk WHERE nama = 'DROP the beat'",
    });
    assert.match(result.content[0].text, /Keyword DROP tidak diizinkan/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: query tanpa klausa FROM ditolak', async () => {
  const sessionKey = 'web:dbquery-no-from';
  const { sdk, deps } = baseDeps();
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');
    const result = await dbQueryTool.execute('c', { query: 'SELECT 1' });
    assert.match(result.content[0].text, /Query harus membaca dari tabel produk atau pemasaran/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: dua tabel dalam satu klausa FROM (comma join) ditolak', async () => {
  const sessionKey = 'web:dbquery-comma-join';
  const { sdk, deps } = baseDeps();
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');
    const result = await dbQueryTool.execute('c', { query: 'SELECT * FROM produk, pemasaran' });
    assert.match(result.content[0].text, /Hanya satu tabel yang boleh dibaca per query/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: query terlalu panjang ditolak', async () => {
  const sessionKey = 'web:dbquery-length';
  const { sdk, deps } = baseDeps();
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');
    const longQuery = `SELECT * FROM produk WHERE nama = '${'x'.repeat(1000)}'`;
    const result = await dbQueryTool.execute('c', { query: longQuery });
    assert.match(result.content[0].text, /Query terlalu panjang/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: SELECT valid mengembalikan ringkasan hasil dari aiPool', async () => {
  const sessionKey = 'web:dbquery-success';
  const aiPool = fakePool({
    'FROM produk': () => ({ rows: [{ id: 1, nama: 'Batik A' }] }),
  });
  const { sdk, deps } = baseDeps({ aiPool });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');
    const result = await dbQueryTool.execute('c', { query: 'SELECT * FROM produk' });
    assert.match(result.content[0].text, /Ditemukan 1 data/);
    assert.match(result.content[0].text, /Batik A/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: query sukses tanpa hasil melapor "Tidak ada hasil"', async () => {
  const sessionKey = 'web:dbquery-empty';
  const { sdk, deps } = baseDeps();
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');
    const result = await dbQueryTool.execute('c', { query: 'SELECT * FROM pemasaran' });
    assert.equal(result.content[0].text, 'Tidak ada hasil.');
  } finally {
    cleanupSession(sessionKey);
  }
});

test('db_query tool: error dari pool dikembalikan sebagai teks, bukan dilempar', async () => {
  const sessionKey = 'web:dbquery-error';
  const aiPool = {
    query: async () => {
      throw new Error('pool mati');
    },
  };
  const { sdk, deps } = baseDeps({ aiPool });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const dbQueryTool = findTool(sdk.calls.createAgentSession[0].customTools, 'db_query');
    const result = await dbQueryTool.execute('c', { query: 'SELECT * FROM produk' });
    assert.match(result.content[0].text, /Error: pool mati/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('get_calendar_gaps tool: meneruskan params ke getCalendarGaps dan mencatat tool call', async () => {
  const sessionKey = 'web:calendar-gaps';
  const calls = [];
  const logCalls = [];
  const { sdk, deps } = baseDeps({
    getCalendarGaps: async (aiPool, params) => {
      calls.push(params);
      return { gaps: ['2026-08-05T19:00:00+07:00'] };
    },
    logToolCall: async (dbPool, runId, entry) => {
      logCalls.push({ runId, entry });
      return null;
    },
  });
  setActiveAgentRunContext(sessionKey, { id: 42, source: 'web', autonomy_mode: 'assistive' });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'get_calendar_gaps');
    const result = await tool.execute('c', { days_ahead: 3, preferred_hour: 20 });
    assert.deepEqual(calls[0], { days_ahead: 3, preferred_hour: 20 });
    assert.deepEqual(result.details, { gaps: ['2026-08-05T19:00:00+07:00'] });
    assert.equal(logCalls.length, 1);
    assert.equal(logCalls[0].runId, 42);
    assert.equal(logCalls[0].entry.name, 'get_calendar_gaps');
    assert.equal(logCalls[0].entry.status, 'ok');
  } finally {
    cleanupSession(sessionKey);
  }
});

test('get_calendar_gaps tool: fungsi domain gagal → dicatat sebagai tool call status error', async () => {
  const sessionKey = 'web:calendar-gaps-error';
  const logCalls = [];
  const { sdk, deps } = baseDeps({
    getCalendarGaps: async () => {
      throw new Error('kalender tidak tersedia');
    },
    logToolCall: async (dbPool, runId, entry) => {
      logCalls.push({ runId, entry });
      return null;
    },
  });
  setActiveAgentRunContext(sessionKey, { id: 99, source: 'web', autonomy_mode: 'assistive' });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'get_calendar_gaps');
    const result = await tool.execute('c', {});
    assert.match(result.content[0].text, /Error: kalender tidak tersedia/);
    assert.equal(logCalls.length, 1);
    assert.equal(logCalls[0].runId, 99);
    assert.equal(logCalls[0].entry.status, 'error');
    assert.equal(logCalls[0].entry.error, 'kalender tidak tersedia');
  } finally {
    cleanupSession(sessionKey);
  }
});

test('save_content_plan tool: hasil dengan ids memicu handlePostSaveApproval', async () => {
  const sessionKey = 'web:save-plan-approval';
  const approvalCalls = [];
  const { sdk, deps } = baseDeps({
    saveContentPlan: async () => ({ ids: [1, 2], saved_count: 2 }),
    handlePostSaveApproval: async (dbPool, result, opts) => {
      approvalCalls.push({ result, opts });
      return { requested: false };
    },
  });
  setActiveAgentRunContext(sessionKey, { id: 7, source: 'web', autonomy_mode: 'bounded', plans_saved: 0 });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'save_content_plan');
    const result = await tool.execute('c', { plans: [{ judul: 'Hari 1' }] });
    assert.deepEqual(result.details, { ids: [1, 2], saved_count: 2 });
    assert.equal(approvalCalls.length, 1);
    assert.deepEqual(approvalCalls[0].result, { ids: [1, 2], saved_count: 2 });
    assert.equal(approvalCalls[0].opts.autonomyMode, 'bounded');
  } finally {
    cleanupSession(sessionKey);
  }
});

test('save_content_plan tool: tanpa ids tidak memicu handlePostSaveApproval', async () => {
  const sessionKey = 'web:save-plan-no-ids';
  const approvalCalls = [];
  const { sdk, deps } = baseDeps({
    saveContentPlan: async () => ({ ids: [], saved_count: 0 }),
    handlePostSaveApproval: async () => {
      approvalCalls.push(1);
      return { requested: false };
    },
  });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'save_content_plan');
    await tool.execute('c', { plans: [{ judul: 'Hari 1' }] });
    assert.equal(approvalCalls.length, 0);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('save_content_plan tool: handlePostSaveApproval gagal tidak menjatuhkan tool (dicatat sebagai warning)', async () => {
  const sessionKey = 'web:save-plan-approval-fail';
  const { sdk, deps } = baseDeps({
    saveContentPlan: async () => ({ ids: [5], saved_count: 1 }),
    handlePostSaveApproval: async () => {
      throw new Error('notify gagal');
    },
  });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'save_content_plan');
    const result = await tool.execute('c', { plans: [{ judul: 'Hari 1' }] });
    // Tool tetap sukses meski hook approval gagal — errornya cuma dicatat log.
    assert.deepEqual(result.details, { ids: [5], saved_count: 1 });
  } finally {
    cleanupSession(sessionKey);
  }
});

test('schedule_content tool: meneruskan pemasaran_id dan force ke scheduleContent', async () => {
  const sessionKey = 'web:schedule-content';
  const calls = [];
  const { sdk, deps } = baseDeps({
    scheduleContent: async (dbPool, context, params) => {
      calls.push({ context, params });
      return { pemasaran_id: 9, repliz_schedule_id: 'r-1' };
    },
  });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'schedule_content');
    const result = await tool.execute('c', { pemasaran_id: 9, force: true });
    assert.deepEqual(calls[0].params, { pemasaran_id: 9, force: true });
    assert.deepEqual(result.details, { pemasaran_id: 9, repliz_schedule_id: 'r-1' });
  } finally {
    cleanupSession(sessionKey);
  }
});

test('schedule_content tool: error domain dikembalikan sebagai teks error, bukan dilempar', async () => {
  const sessionKey = 'web:schedule-content-error';
  const { sdk, deps } = baseDeps({
    scheduleContent: async () => {
      const err = new Error('policy menolak');
      err.statusCode = 403;
      throw err;
    },
  });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'schedule_content');
    const result = await tool.execute('c', { pemasaran_id: 1 });
    assert.match(result.content[0].text, /Error: policy menolak/);
    assert.equal(result.details.error, 'policy menolak');
  } finally {
    cleanupSession(sessionKey);
  }
});

test('sync_content_status tool: meneruskan pemasaran_id ke syncContentStatus', async () => {
  const sessionKey = 'web:sync-status';
  const calls = [];
  const { sdk, deps } = baseDeps({
    syncContentStatus: async (dbPool, context, params) => {
      calls.push(params);
      return { status: 'published' };
    },
  });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'sync_content_status');
    const result = await tool.execute('c', { pemasaran_id: 3 });
    assert.deepEqual(calls[0], { pemasaran_id: 3 });
    assert.deepEqual(result.details, { status: 'published' });
  } finally {
    cleanupSession(sessionKey);
  }
});

test('web_search tool: tanpa BRAVE_API_KEY dilewati tanpa memanggil fetch', async () => {
  const sessionKey = 'web:websearch-no-key';
  let fetchCalled = false;
  const { sdk, deps } = baseDeps({
    env: {},
    fetchFn: async () => {
      fetchCalled = true;
      return { json: async () => ({}) };
    },
  });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'web_search');
    const result = await tool.execute('c', { query: 'tren batik' });
    assert.match(result.content[0].text, /BRAVE_API_KEY belum diatur/);
    assert.equal(fetchCalled, false);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('web_search tool: dengan hasil memformat daftar link', async () => {
  const sessionKey = 'web:websearch-results';
  const { sdk, deps } = baseDeps({
    env: { BRAVE_API_KEY: 'key-123' },
    fetchFn: async (url, options) => {
      assert.equal(options.headers['X-Subscription-Token'], 'key-123');
      return {
        json: async () => ({
          web: { results: [{ title: 'Tren Batik 2026', url: 'https://example.com', description: 'desc' }] },
        }),
      };
    },
  });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'web_search');
    const result = await tool.execute('c', { query: 'tren batik' });
    assert.match(result.content[0].text, /Tren Batik 2026/);
    assert.match(result.content[0].text, /https:\/\/example\.com/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('web_search tool: tanpa hasil melapor tidak ditemukan', async () => {
  const sessionKey = 'web:websearch-empty';
  const { sdk, deps } = baseDeps({
    env: { BRAVE_API_KEY: 'key-123' },
    fetchFn: async () => ({ json: async () => ({ web: { results: [] } }) }),
  });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'web_search');
    const result = await tool.execute('c', { query: 'tidak ada' });
    assert.match(result.content[0].text, /Tidak ditemukan hasil/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('web_search tool: fetch gagal dikembalikan sebagai teks error', async () => {
  const sessionKey = 'web:websearch-fetch-error';
  const { sdk, deps } = baseDeps({
    env: { BRAVE_API_KEY: 'key-123' },
    fetchFn: async () => {
      throw new Error('network down');
    },
  });
  try {
    await createAgentSessionForKey(sessionKey, deps);
    const tool = findTool(sdk.calls.createAgentSession[0].customTools, 'web_search');
    const result = await tool.execute('c', { query: 'x' });
    assert.match(result.content[0].text, /Gagal mencari: network down/);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('initAgent: sesi baru dibuat sekali dan disimpan di agentSessions', async () => {
  const sessionKey = 'web:init-new';
  const { sdk, deps } = baseDeps();
  try {
    const session = await initAgent(sessionKey, deps);
    assert.equal(agentSessions.get(sessionKey), session);
    assert.equal(sdk.calls.createAgentSession.length, 1);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('initAgent: sesi yang sudah ada dipakai ulang tanpa memanggil factory lagi', async () => {
  const sessionKey = 'web:init-reuse';
  const { sdk, deps } = baseDeps();
  try {
    const first = await initAgent(sessionKey, deps);
    const beforeTouch = agentSessionLastUsed.get(sessionKey);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await initAgent(sessionKey, deps);

    assert.equal(second, first);
    assert.equal(sdk.calls.createAgentSession.length, 1);
    assert.ok(agentSessionLastUsed.get(sessionKey) >= beforeTouch);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('initAgent: dua panggilan bersamaan untuk sessionKey yang sama hanya membuat 1 sesi (dedupe pending)', async () => {
  const sessionKey = 'web:init-dedupe';
  let resolveCreate;
  const { sdk, deps } = baseDeps();
  sdk.deps.createAgentSession = async (options) => {
    sdk.calls.createAgentSession.push(options);
    await new Promise((resolve) => {
      resolveCreate = resolve;
    });
    return { session: sdk.session };
  };
  try {
    const p1 = initAgent(sessionKey, { ...deps, ...sdk.deps });
    const p2 = initAgent(sessionKey, { ...deps, ...sdk.deps });
    // beri kesempatan microtask agar keduanya masuk fase "pending" sebelum di-resolve
    await new Promise((resolve) => setImmediate(resolve));
    resolveCreate();
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(r1, r2);
    assert.equal(sdk.calls.createAgentSession.length, 1);
    assert.equal(agentSessionPromises.has(sessionKey), false);
  } finally {
    cleanupSession(sessionKey);
  }
});

test('initAgent: promise dibersihkan dari agentSessionPromises walau gagal, dan error diteruskan', async () => {
  const sessionKey = 'web:init-error-cleanup';
  const { sdk, deps } = baseDeps();
  sdk.deps.modelRuntimeCreate = async () => ({ getModel: () => null });
  try {
    await assert.rejects(() => initAgent(sessionKey, { ...deps, ...sdk.deps }), /Tidak ada model AI/);
    assert.equal(agentSessionPromises.has(sessionKey), false);
    assert.equal(agentSessions.has(sessionKey), false);

    // Percobaan berikutnya harus mencoba lagi (bukan promise gagal yang di-cache selamanya).
    const workingDeps = baseDeps();
    const session = await initAgent(sessionKey, workingDeps.deps);
    assert.ok(session);
  } finally {
    cleanupSession(sessionKey);
  }
});
