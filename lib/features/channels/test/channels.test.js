import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL_IDS,
  getEnabledChannelIds,
  normalizeChannelId,
  getDefaultChannelId,
  listChannels,
  isChannelSchedulable,
} from '../index.js';
import { buildChannelsPromptSection } from '../prompt.js';
import { collectWebEnvironmentIssues } from '../../../env.js';

const baseEnv = {
  DB_USER: 'test',
  DB_PASSWORD: 'test',
};

function withEnv(overrides, fn) {
  const prev = {};
  for (const key of Object.keys(overrides)) {
    prev[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

describe('channel registry', () => {
  it('exposes threads and instagram channel ids', () => {
    assert.deepEqual(CHANNEL_IDS, ['threads', 'instagram']);
  });

  it('defaults enabled channels to threads', () => {
    withEnv({ ENABLED_CHANNELS: undefined }, () => {
      assert.deepEqual(getEnabledChannelIds(), ['threads']);
      assert.equal(getDefaultChannelId(), 'threads');
    });
  });

  it('parses comma-separated ENABLED_CHANNELS', () => {
    withEnv({ ENABLED_CHANNELS: 'threads, instagram' }, () => {
      assert.deepEqual(getEnabledChannelIds(), ['threads', 'instagram']);
      assert.equal(getDefaultChannelId(), 'threads');
    });
  });

  it('falls back to threads when ENABLED_CHANNELS has no valid ids', () => {
    withEnv({ ENABLED_CHANNELS: 'unknown' }, () => {
      assert.deepEqual(getEnabledChannelIds(), ['threads']);
    });
  });

  it('normalizeChannelId uses default for empty kanal', () => {
    withEnv({ ENABLED_CHANNELS: 'threads' }, () => {
      assert.equal(normalizeChannelId(''), 'threads');
      assert.equal(normalizeChannelId(null), 'threads');
    });
  });

  it('normalizeChannelId accepts explicit enabled kanal', () => {
    withEnv({ ENABLED_CHANNELS: 'threads,instagram' }, () => {
      assert.equal(normalizeChannelId('Instagram'), 'instagram');
    });
  });

  it('normalizeChannelId rejects unknown kanal', () => {
    withEnv({ ENABLED_CHANNELS: 'threads' }, () => {
      assert.throws(() => normalizeChannelId('tiktok'), /Kanal tidak dikenal/);
    });
  });

  it('normalizeChannelId rejects disabled kanal', () => {
    withEnv({ ENABLED_CHANNELS: 'threads' }, () => {
      assert.throws(() => normalizeChannelId('instagram'), /tidak diaktifkan/);
    });
  });

  it('listChannels marks enabled and configured flags', () => {
    withEnv(
      {
        ENABLED_CHANNELS: 'threads,instagram',
        REPLIZ_API_KEY: '',
        REPLIZ_SECRET: '',
        REPLIZ_ACCOUNT_ID: '',
        REPLIZ_INSTAGRAM_ACCOUNT_ID: '',
      },
      () => {
        const channels = listChannels({ includeDisabled: true });
        assert.equal(channels.length, 2);
        const threads = channels.find((c) => c.id === 'threads');
        const instagram = channels.find((c) => c.id === 'instagram');
        assert.equal(threads.enabled, true);
        assert.equal(instagram.enabled, true);
        assert.equal(threads.configured, false);
        assert.equal(instagram.configured, false);
      },
    );
  });

  it('isChannelSchedulable reflects Repliz credentials', () => {
    withEnv(
      {
        ENABLED_CHANNELS: 'threads',
        REPLIZ_API_KEY: 'key',
        REPLIZ_SECRET: 'secret',
        REPLIZ_ACCOUNT_ID: 'acc-1',
      },
      () => {
        assert.equal(isChannelSchedulable('threads'), true);
      },
    );
  });
});

describe('buildChannelsPromptSection', () => {
  it('includes enabled channel ids in prompt text', () => {
    withEnv({ ENABLED_CHANNELS: 'threads,instagram' }, () => {
      const section = buildChannelsPromptSection();
      assert.match(section, /threads/);
      assert.match(section, /instagram/);
      assert.match(section, /Kanal default/);
    });
  });
});

describe('ENABLED_CHANNELS env validation', () => {
  it('rejects unknown channel ids', () => {
    const { errors } = collectWebEnvironmentIssues({
      ...baseEnv,
      ENABLED_CHANNELS: 'threads,tiktok',
    });
    assert.ok(errors.some((message) => /ENABLED_CHANNELS/.test(message)));
    assert.ok(errors.some((message) => /tiktok/.test(message)));
  });

  it('accepts valid ENABLED_CHANNELS values', () => {
    const { errors } = collectWebEnvironmentIssues({
      ...baseEnv,
      ENABLED_CHANNELS: 'threads,instagram',
    });
    assert.equal(
      errors.some((message) => /ENABLED_CHANNELS/.test(message)),
      false,
    );
  });
});
