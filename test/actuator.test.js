import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAutonomyMode,
  checkSavePolicy,
  checkSchedulePolicy,
  getAutonomyConfig,
} from '../lib/actuator/index.js';
import { saveContentPlan } from '../lib/actuator/contentPlan.js';

const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

describe('resolveAutonomyMode', () => {
  beforeEach(() => {
    process.env.AUTONOMY_MODE = 'assistive';
    delete process.env.WEB_AUTONOMY_MODE;
    delete process.env.TELEGRAM_AUTONOMY_MODE;
  });

  afterEach(restoreEnv);

  it('defaults to assistive when unset', () => {
    delete process.env.AUTONOMY_MODE;
    assert.equal(resolveAutonomyMode('web'), 'assistive');
  });

  it('applies per-source overrides', () => {
    process.env.AUTONOMY_MODE = 'assistive';
    process.env.WEB_AUTONOMY_MODE = 'supervised';
    process.env.TELEGRAM_AUTONOMY_MODE = 'bounded';
    assert.equal(resolveAutonomyMode('web'), 'supervised');
    assert.equal(resolveAutonomyMode('telegram'), 'bounded');
  });
});

describe('actuator policy', () => {
  beforeEach(() => {
    process.env.AUTONOMY_MODE = 'assistive';
    process.env.REQUIRE_APPROVAL = 'false';
    process.env.MAX_AGENT_SAVES_PER_RUN = '7';
    process.env.MAX_AGENT_SCHEDULES_PER_DAY = '10';
  });

  afterEach(restoreEnv);

  it('denies save in assistive mode', () => {
    const policy = checkSavePolicy({ autonomyMode: 'assistive', savesInRun: 0, planCount: 1 });
    assert.equal(policy.allowed, false);
    assert.match(policy.reason, /assistive/i);
  });

  it('allows save in supervised mode within cap', () => {
    const policy = checkSavePolicy({ autonomyMode: 'supervised', savesInRun: 2, planCount: 3 });
    assert.equal(policy.allowed, true);
  });

  it('denies save when MAX_AGENT_SAVES_PER_RUN cap would be exceeded', () => {
    process.env.MAX_AGENT_SAVES_PER_RUN = '3';
    const policy = checkSavePolicy({ autonomyMode: 'supervised', savesInRun: 3, planCount: 1 });
    assert.equal(policy.allowed, false);
    assert.match(policy.reason, /Batas simpan/i);
  });

  it('denies schedule unless bounded and approval off', () => {
    assert.equal(checkSchedulePolicy({ autonomyMode: 'assistive' }).allowed, false);
    assert.equal(checkSchedulePolicy({ autonomyMode: 'supervised' }).allowed, false);

    process.env.REQUIRE_APPROVAL = 'true';
    const blocked = checkSchedulePolicy({ autonomyMode: 'bounded', schedulesToday: 0 });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /REQUIRE_APPROVAL/i);

    process.env.REQUIRE_APPROVAL = 'false';
    const allowed = checkSchedulePolicy({ autonomyMode: 'bounded', schedulesToday: 2 });
    assert.equal(allowed.allowed, true);

    const capped = checkSchedulePolicy({ autonomyMode: 'bounded', schedulesToday: 10 });
    assert.equal(capped.allowed, false);
  });

  it('getAutonomyConfig defaults assistive', () => {
    delete process.env.AUTONOMY_MODE;
    const config = getAutonomyConfig();
    assert.equal(config.autonomyMode, 'assistive');
    assert.equal(config.maxSavesPerRun, 7);
  });
});

describe('saveContentPlan duplicate schedule scenario', () => {
  afterEach(restoreEnv);

  it('surfaces duplicate schedule errors from savePlansToDb', async () => {
    process.env.AUTONOMY_MODE = 'supervised';

    const mockPool = {
      connect: async () => ({
        query: async (sql) => {
          const text = String(sql);
          if (text.includes('BEGIN') || text.includes('COMMIT') || text.includes('ROLLBACK')) {
            return { rows: [] };
          }
          if (text.includes('SELECT id, judul, jadwal FROM pemasaran')) {
            return { rows: [{ id: 99, judul: 'Existing', jadwal: 'Senin, 1 Juni 2026 jam 19:00 WIB' }] };
          }
          throw new Error('unexpected query');
        },
        release() {},
      }),
    };

    const context = { autonomyMode: 'supervised', plans_saved: 0 };
    await assert.rejects(
      () => saveContentPlan(mockPool, context, {
        plans: [{
          judul: 'Hari 1',
          strategi: 'Promo batik',
          jadwal: 'Senin, 1 Juni 2026 jam 19:00 WIB',
        }],
      }),
      /Jadwal sudah ada/i,
    );
  });

  it('rejects save when policy denies assistive mode', async () => {
    const mockPool = { connect: async () => { throw new Error('should not connect'); } };
    await assert.rejects(
      () => saveContentPlan(mockPool, { autonomyMode: 'assistive', plans_saved: 0 }, {
        plans: [{ judul: 'Test', strategi: 'Strategi' }],
      }),
      /assistive/i,
    );
  });
});