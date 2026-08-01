/**
 * Minimal Telegram context fake for command/wizard tests.
 * Callers can inspect `calls` to assert replies and callback acknowledgements.
 */
export function createTelegramCtx(overrides = {}) {
  const calls = [];
  const ctx = {
    from: { id: 123, first_name: 'Test' },
    chat: { id: 456, type: 'private' },
    message: { text: '', photo: [] },
    callbackQuery: { data: '', message: { text: '' } },
    update: { update_id: 1 },
    reply: async (...args) => {
      calls.push({ method: 'reply', args });
      return calls.length;
    },
    replyWithPhoto: async (...args) => {
      calls.push({ method: 'replyWithPhoto', args });
      return calls.length;
    },
    answerCbQuery: async (...args) => {
      calls.push({ method: 'answerCbQuery', args });
      return calls.length;
    },
    editMessageText: async (...args) => {
      calls.push({ method: 'editMessageText', args });
      return calls.length;
    },
    editMessageReplyMarkup: async (...args) => {
      calls.push({ method: 'editMessageReplyMarkup', args });
      return calls.length;
    },
    sendChatAction: async (...args) => {
      calls.push({ method: 'sendChatAction', args });
      return calls.length;
    },
    ...overrides,
  };
  return { ctx, calls };
}

/**
 * Register Telegram handlers against a fake Telegraf instance and capture each
 * callback so tests can invoke commands/actions/events without polling.
 */
export function registerAndCapture(registerHandlers, options = {}) {
  const captured = {
    middleware: [],
    starts: [],
    helps: [],
    commands: new Map(),
    actions: [],
    events: new Map(),
    catches: [],
  };
  const bot = {
    use: (handler) => captured.middleware.push(handler),
    start: (handler) => captured.starts.push(handler),
    help: (handler) => captured.helps.push(handler),
    command: (name, handler) => captured.commands.set(name, handler),
    action: (pattern, handler) => captured.actions.push({ pattern, handler }),
    on: (event, handler) => captured.events.set(event, handler),
    catch: (handler) => captured.catches.push(handler),
    handleUpdate: async (...args) => {
      captured.handleUpdate = args;
    },
  };

  const registration = registerHandlers({ bot, ...options });
  return { bot, captured, registration };
}
