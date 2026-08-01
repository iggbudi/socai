import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBot,
  registerProcessErrorHandlers,
  registerShutdownHandlers,
  resolveBotToken,
  startBot,
} from '../bot.js';
import { downloadTelegramPhoto, uploadBufferToCloudinary } from '../media/cloudinary.js';
import { registerTelegramErrorHandler } from '../handlers/errors.js';
import { resolveTelegramDependencies } from '../commands/deps.js';

function fakeTelegraf() {
  return {
    use: () => {},
    start: () => {},
    help: () => {},
    command: () => {},
    on: () => {},
    action: () => {},
    catch: () => {},
    handleUpdate: () => {},
  };
}

describe('telegram bot lifecycle seams', () => {
  it('resolves token aliases and rejects an empty token', () => {
    assert.equal(resolveBotToken({ TELEGRAM_BOT_TOKEN: 'primary' }), 'primary');
    assert.equal(resolveBotToken({ BOT_TOKEN: 'alias' }), 'alias');
    assert.equal(resolveBotToken({ TELEGRAM_TOKEN: 'legacy' }), 'legacy');
    assert.equal(resolveBotToken({}), '');
    assert.throws(() => createBot({ telegrafFactory: fakeTelegraf, env: {} }), /Token bot Telegram/);
  });

  it('creates a bot with default runtime state and rate limiter seams', () => {
    const access = {
      getRole: () => 'super_admin',
      isAllowed: () => true,
      hasRole: () => true,
      isSuperAdmin: () => true,
      addUser: () => ({ ok: true, role: 'operator' }),
      removeUser: () => ({ ok: true }),
      listUsers: () => [],
    };
    const bot = createBot({
      token: 'dummy',
      env: { TELEGRAM_AI_RATE_LIMIT: '2', TELEGRAM_AI_RATE_WINDOW_MS: '1000' },
      telegrafFactory: fakeTelegraf,
      access,
      dbPool: { query: async () => ({ rows: [] }) },
    });
    assert.ok(bot.__socaiRuntime.state.pendingPlans instanceof Map);
    assert.ok(bot.__socaiRuntime.state.productWizard instanceof Map);
  });

  it('resolves default command dependencies and captures the global error handler', () => {
    const deps = resolveTelegramDependencies({});
    assert.ok(deps.telegramAiRateLimiter);
    let caught;
    registerTelegramErrorHandler({ catch: (handler) => (caught = handler) });
    caught(new Error('handler failed'), { updateType: 'message' });
  });

  it('starts a supplied bot after checking database, schema, and command sync', async () => {
    const calls = [];
    const dbPool = {
      query: async (sql) => {
        calls.push(sql);
        return String(sql).includes('SELECT 1')
          ? { rows: [{ '?column?': 1 }] }
          : { rows: [{ name: '0002_baseline_agent_runs' }] };
      },
    };
    const bot = {
      telegram: {
        getMe: async () => ({ username: 'testbot' }),
        setMyCommands: async (...args) => calls.push(args),
      },
      launch: async () => calls.push('launch'),
    };
    const result = await startBot({
      validate: false,
      bot,
      dbPool,
      superAdminId: 99,
      launch: false,
      registerProcessHandlers: false,
    });
    assert.equal(result, bot);
    assert.equal(calls.filter((item) => item === 'SELECT 1').length, 1);
    assert.equal(calls.filter((item) => Array.isArray(item)).length, 2);
  });

  it('returns start errors to a caller that disables process exit', async () => {
    await assert.rejects(
      () =>
        startBot({
          validate: false,
          bot: { telegram: { getMe: async () => ({ username: 'x' }) } },
          dbPool: { query: async () => Promise.reject(new Error('database unavailable')) },
          registerProcessHandlers: false,
          exitOnError: false,
        }),
      /database unavailable/,
    );
  });

  it('cleans Telegram sessions during shutdown and registers process error callbacks', () => {
    const listeners = new Map();
    const processRef = {
      once: (event, handler) => listeners.set(event, handler),
      on: (event, handler) => listeners.set(event, handler),
      exit: (code) => listeners.set('exitCode', code),
    };
    const aborted = [];
    const runtime = {
      agentSessions: new Map([['telegram:1', { abort: async () => aborted.push(1) }]]),
      agentSessionLastUsed: new Map([['telegram:1', 1]]),
      agentSessionPromises: new Map([['telegram:1', Promise.resolve()]]),
    };
    let stopped;
    registerShutdownHandlers({ stop: (reason) => (stopped = reason) }, runtime, processRef);
    listeners.get('SIGTERM')();
    assert.deepEqual(aborted, [1]);
    assert.equal(stopped, 'shutdown');
    assert.equal(listeners.get('exitCode'), 0);

    registerProcessErrorHandlers(processRef);
    listeners.get('uncaughtException')(new Error('boom'));
    listeners.get('unhandledRejection')({ message: 'reject' });

    const sigintListeners = new Map();
    const sigintProcess = {
      once: (event, handler) => sigintListeners.set(event, handler),
      exit: (code) => sigintListeners.set('exitCode', code),
    };
    registerShutdownHandlers({ stop: () => {} }, { agentSessions: new Map() }, sigintProcess);
    sigintListeners.get('SIGINT')();
    assert.equal(sigintListeners.get('exitCode'), 0);
  });
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('telegram cloudinary media seams', () => {
  it('returns null when Cloudinary is not configured and uploads with signed fields when configured', async () => {
    assert.equal(await uploadBufferToCloudinary(png, 'socai', { env: {} }), null);
    let requested;
    const result = await uploadBufferToCloudinary(png, 'socai', {
      env: {
        CLOUDINARY_CLOUD_NAME: 'cloud',
        CLOUDINARY_API_KEY: 'key',
        CLOUDINARY_API_SECRET: 'secret',
      },
      fetchImpl: async (url, options) => {
        requested = { url, options };
        return { ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/image.png' }) };
      },
    });
    assert.equal(result, 'https://res.cloudinary.com/image.png');
    assert.match(requested.url, /cloud\/image\/upload/);
    assert.equal(requested.options.method, 'POST');
  });

  it('surfaces Cloudinary API errors', async () => {
    await assert.rejects(
      () =>
        uploadBufferToCloudinary(png, 'socai', {
          env: {
            CLOUDINARY_CLOUD_NAME: 'cloud',
            CLOUDINARY_API_KEY: 'key',
            CLOUDINARY_API_SECRET: 'secret',
          },
          fetchImpl: async () => ({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: 'bad upload' } }),
          }),
        }),
      /bad upload/,
    );
  });

  function photoBot() {
    return { telegram: { getFileLink: async (id) => ({ href: `https://telegram.test/${id}` }) } };
  }

  it('downloads a valid image to local storage and can return a Cloudinary URL', async () => {
    let written;
    const local = await downloadTelegramPhoto('file-1', {
      bot: photoBot(),
      uploadDir: '/tmp/uploads',
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => png }),
      fsImpl: { writeFileSync: (...args) => (written = args) },
    });
    assert.match(local, /^\/uploads\/produk-telegram-.*\.png$/);
    assert.equal(written[1].toString('hex'), png.toString('hex'));

    const cloud = await downloadTelegramPhoto('file-2', {
      bot: photoBot(),
      uploadDir: '/tmp/uploads',
      cloudinary: true,
      env: {
        CLOUDINARY_CLOUD_NAME: 'cloud',
        CLOUDINARY_API_KEY: 'key',
        CLOUDINARY_API_SECRET: 'secret',
      },
      fetchImpl: async (url) =>
        url.includes('cloudinary')
          ? { ok: true, json: async () => ({ secure_url: 'https://cloudinary.test/x.png' }) }
          : { ok: true, arrayBuffer: async () => png },
      fsImpl: { writeFileSync: () => assert.fail('cloudinary result should not write locally') },
    });
    assert.equal(cloud, 'https://cloudinary.test/x.png');
  });

  it('wraps missing bot, missing upload directory, HTTP, and invalid-image failures', async () => {
    await assert.rejects(() => downloadTelegramPhoto('id', {}), /Bot Telegram tidak tersedia/);
    await assert.rejects(() => downloadTelegramPhoto('id', { bot: photoBot() }), /Direktori upload/);
    await assert.rejects(
      () =>
        downloadTelegramPhoto('id', {
          bot: photoBot(),
          uploadDir: '/tmp',
          fetchImpl: async () => ({ ok: false, status: 404 }),
        }),
      /Gagal download gambar: 404/,
    );
    await assert.rejects(
      () =>
        downloadTelegramPhoto('id', {
          bot: photoBot(),
          uploadDir: '/tmp',
          fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('not-image') }),
        }),
      /File bukan gambar/,
    );
  });
});
