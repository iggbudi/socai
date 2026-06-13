const DEFAULT_BASE_URL = 'https://api.repliz.com';
const DEFAULT_TIMEOUT_MS = 30_000;

function getConfig() {
  return {
    apiKey: process.env.REPLIZ_API_KEY || '',
    secret: process.env.REPLIZ_SECRET || '',
    accountId: process.env.REPLIZ_ACCOUNT_ID || process.env.REPLIZ_THREADS_ACCOUNT_ID || '',
    baseUrl: process.env.REPLIZ_BASE_URL || DEFAULT_BASE_URL,
  };
}

export function isReplizConfigured() {
  const { apiKey, secret, accountId } = getConfig();
  return Boolean(apiKey && secret && accountId);
}

function buildUrl(path) {
  const { baseUrl } = getConfig();
  const url = new URL(path.startsWith('http') ? path : path.replace(/^\/+/, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  return url;
}

function safeErrorMessage(status, body) {
  const bodyMessage = body && typeof body === 'object'
    ? (body.message || body.error || body.detail)
    : (typeof body === 'string' ? body : '');
  return `Repliz request failed${status ? ` (${status})` : ''}${bodyMessage ? `: ${String(bodyMessage).slice(0, 500)}` : ''}`;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function replizFetch(path, options = {}) {
  const { apiKey, secret } = getConfig();
  if (!apiKey || !secret) {
    throw new Error('Repliz belum dikonfigurasi: REPLIZ_API_KEY dan REPLIZ_SECRET wajib diisi.');
  }

  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers = {},
    body,
    ...fetchOptions
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let requestBody = body;
  const requestHeaders = {
    Authorization: `Basic ${Buffer.from(`${apiKey}:${secret}`).toString('base64')}`,
    Accept: 'application/json',
    ...headers,
  };

  if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof FormData)) {
    requestBody = JSON.stringify(body);
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
  }

  try {
    const response = await fetch(buildUrl(path), {
      ...fetchOptions,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal,
    });
    const parsed = await parseResponse(response);
    if (!response.ok) throw new Error(safeErrorMessage(response.status, parsed));
    return parsed;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Repliz request timeout.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function getThreadsAccounts({ page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), type: 'threads' });
  return replizFetch(`/public/account?${params.toString()}`, { method: 'GET' });
}

function normalizeScheduleAt(plan, options) {
  const raw = options.scheduleAt || plan?.scheduled_at || plan?.repliz_scheduled_at;
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error('scheduleAt Repliz tidak valid/ belum tersedia. Isi options.scheduleAt atau kolom scheduled_at/repliz_scheduled_at dengan tanggal ISO yang valid.');
  }
  return date.toISOString();
}

function resolveImageUrl(plan, options) {
  const raw = options.imageUrl || plan?.imageUrl || plan?.gambar || '';
  if (!raw || typeof raw !== 'string') return '';
  try {
    return new URL(raw).toString();
  } catch {
    if (raw.startsWith('/') && process.env.APP_URL) {
      try { return new URL(raw, process.env.APP_URL).toString(); } catch { return ''; }
    }
    return '';
  }
}

function sanitizeMarketingText(value) {
  return String(value || '')
    // Hilangkan marker markdown yang sering terasa seperti output AI: **bold**, *italic*, __bold__, _italic_.
    .replace(/\*\*+/g, '')
    .replace(/(^|\s)\*(?=\S)/g, '$1')
    .replace(/(?<=\S)\*(?=\s|$|[.,!?;:)])/g, '')
    .replace(/__+/g, '')
    .replace(/(^|\s)_(?=\S)/g, '$1')
    .replace(/(?<=\S)_(?=\s|$|[.,!?;:)])/g, '')
    // Bersihkan markdown heading/list yang tidak natural untuk caption Threads.
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateMarketingText(value, maxLength = 500) {
  const text = sanitizeMarketingText(value);
  if (text.length <= maxLength) return text;
  const suffix = '…';
  const limit = maxLength - suffix.length;
  const sliced = text.slice(0, limit);
  const smartCut = Math.max(sliced.lastIndexOf('\n\n'), sliced.lastIndexOf('. '), sliced.lastIndexOf(' '));
  return `${sliced.slice(0, smartCut > 250 ? smartCut : limit).trim()}${suffix}`;
}

function splitMarketingText(value, maxLength = 500) {
  const text = sanitizeMarketingText(value);
  if (!text) return [];

  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const sliced = remaining.slice(0, maxLength);
    const smartCut = Math.max(
      sliced.lastIndexOf('\n\n'),
      sliced.lastIndexOf('\n'),
      sliced.lastIndexOf('. '),
      sliced.lastIndexOf('! '),
      sliced.lastIndexOf('? '),
      sliced.lastIndexOf(' ')
    );
    const cutAt = smartCut > Math.floor(maxLength * 0.6) ? smartCut + (remaining[smartCut] === ' ' ? 0 : 1) : maxLength;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

export function buildThreadsSchedulePayload(plan, options = {}) {
  const { accountId: envAccountId } = getConfig();
  const accountId = options.accountId || envAccountId;
  if (!accountId) throw new Error('REPLIZ_ACCOUNT_ID belum dikonfigurasi.');

  const title = truncateMarketingText(plan?.judul || plan?.title || 'Konten Threads Batik Bakaran', 120);
  const contentParts = splitMarketingText(plan?.copywriting || plan?.strategi || plan?.description || '', 500);
  const description = contentParts[0] || '';
  if (!description) throw new Error('Deskripsi/copywriting rencana pemasaran kosong.');
  const replies = options.replies || contentParts.slice(1).map((description) => ({
    description,
    type: 'text',
    medias: [],
  }));

  const imageUrl = resolveImageUrl(plan, options);
  const type = imageUrl ? 'image' : 'text';

  return {
    title,
    description,
    topic: options.topic || process.env.REPLIZ_DEFAULT_TOPIC || 'Batik Bakaran',
    type,
    medias: imageUrl ? [{ type: 'image', url: imageUrl }] : [],
    meta: options.meta || { title, description, url: imageUrl || '' },
    additionalInfo: options.additionalInfo || {
      isAiGenerated: true,
      isDraft: false,
      collaborators: [],
      music: { id: '', artist: '', name: '', thumbnail: '' },
      products: [],
      tags: [],
      mentions: [],
    },
    replies,
    accountId,
    scheduleAt: normalizeScheduleAt(plan, options),
  };
}

export function createThreadsSchedule(plan, options = {}) {
  const payload = buildThreadsSchedulePayload(plan, options);
  return replizFetch('/public/schedule', { method: 'POST', body: payload, timeoutMs: options.timeoutMs });
}

export function getReplizSchedule(scheduleId, options = {}) {
  if (!scheduleId) throw new Error('scheduleId Repliz wajib diisi.');
  return replizFetch(`/public/schedule/${encodeURIComponent(scheduleId)}`, { method: 'GET', timeoutMs: options.timeoutMs });
}
