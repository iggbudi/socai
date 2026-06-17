export { getCalendarGaps } from './calendar.js';
export { saveContentPlan } from './contentPlan.js';
export { scheduleContent, syncContentStatus } from './schedule.js';
export {
  AUTONOMY_MODES,
  getAutonomyConfig,
  assertValidAutonomyMode,
  checkSavePolicy,
  checkSchedulePolicy,
  checkSyncPolicy,
} from './policy.js';

export function resolveAutonomyMode(source) {
  const base = (process.env.AUTONOMY_MODE || 'assistive').trim().toLowerCase();
  if (source === 'web') {
    const override = (process.env.WEB_AUTONOMY_MODE || '').trim().toLowerCase();
    return override || base;
  }
  if (source === 'telegram') {
    const override = (process.env.TELEGRAM_AUTONOMY_MODE || '').trim().toLowerCase();
    return override || base;
  }
  return base;
}

export function resolveSourceFromSessionKey(sessionKey) {
  return String(sessionKey || '').startsWith('telegram:') ? 'telegram' : 'web';
}