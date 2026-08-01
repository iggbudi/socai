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
    ...overrides,
  };
  return { ctx, calls };
}
