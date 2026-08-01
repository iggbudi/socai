import {
  createThreadsSchedule,
  getReplizSchedule,
  getReplizAccounts,
  buildThreadsSchedulePayload,
} from '../../shared/repliz.js';

export const id = 'instagram';
export const label = 'Instagram';
export const replizAccountType = 'instagram';

export function isConfigured() {
  const apiKey = process.env.REPLIZ_API_KEY || '';
  const secret = process.env.REPLIZ_SECRET || '';
  const accountId = process.env.REPLIZ_INSTAGRAM_ACCOUNT_ID || '';
  return Boolean(apiKey && secret && accountId);
}

export function getAccountId() {
  return process.env.REPLIZ_INSTAGRAM_ACCOUNT_ID || '';
}

export function configurationError() {
  return 'Repliz Instagram belum dikonfigurasi. Isi REPLIZ_API_KEY, REPLIZ_SECRET, dan REPLIZ_INSTAGRAM_ACCOUNT_ID.';
}

export async function listAccounts(options = {}) {
  return getReplizAccounts({ ...options, type: replizAccountType });
}

export async function createSchedule(plan, options = {}) {
  if (!isConfigured()) {
    throw new Error(configurationError());
  }
  return createThreadsSchedule(plan, {
    ...options,
    accountId: options.accountId || getAccountId(),
  });
}

export async function getSchedule(scheduleId, options = {}) {
  return getReplizSchedule(scheduleId, options);
}

export function buildSchedulePayload(plan, options = {}) {
  return buildThreadsSchedulePayload(plan, {
    ...options,
    accountId: options.accountId || getAccountId(),
  });
}
