import {
  isReplizConfigured,
  createThreadsSchedule,
  getReplizSchedule,
  getReplizAccounts,
  buildThreadsSchedulePayload,
} from '../shared/repliz.js';

export const id = 'threads';
export const label = 'Threads';
export const replizAccountType = 'threads';

export function isConfigured() {
  return isReplizConfigured();
}

export function getAccountId() {
  return process.env.REPLIZ_ACCOUNT_ID || process.env.REPLIZ_THREADS_ACCOUNT_ID || '';
}

export function configurationError() {
  return 'Repliz Threads belum dikonfigurasi. Isi REPLIZ_API_KEY, REPLIZ_SECRET, dan REPLIZ_ACCOUNT_ID.';
}

export async function listAccounts(options = {}) {
  return getReplizAccounts({ ...options, type: replizAccountType });
}

export async function createSchedule(plan, options = {}) {
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