import pino from 'pino';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

const REDACT_PATHS = [
  'password',
  'token',
  'TELEGRAM_BOT_TOKEN',
  'authorization',
  'cookie',
  '*.password',
  '*.token',
  '*.TELEGRAM_BOT_TOKEN',
  '*.authorization',
  '*.cookie',
];

export function resolveLogLevel(value = process.env.LOG_LEVEL) {
  const normalized = String(value || 'info')
    .trim()
    .toLowerCase();
  return LOG_LEVELS.includes(normalized) ? normalized : 'info';
}

export function createLogger(env = process.env, destination) {
  return pino(
    {
      level: resolveLogLevel(env.LOG_LEVEL),
      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}

export const logger = createLogger();

export function childLogger(scope) {
  return logger.child({ scope });
}

export function requestLogger(req, scope = 'web') {
  const requestId = req?.requestId || req?.res?.locals?.requestId;
  return logger.child({ scope, ...(requestId ? { requestId } : {}) });
}

export function telegramLogger(ctx, scope = 'telegram') {
  const updateId = ctx?.update?.update_id;
  const userId = ctx?.from?.id;
  return logger.child({
    scope,
    ...(updateId === undefined ? {} : { updateId }),
    ...(userId === undefined ? {} : { userId }),
  });
}
