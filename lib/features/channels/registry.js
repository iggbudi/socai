import * as threadsChannel from './threads.js';
import * as instagramChannel from './instagram.js';

const ALL_CHANNELS = [threadsChannel, instagramChannel];
const CHANNEL_MAP = new Map(ALL_CHANNELS.map((channel) => [channel.id, channel]));

export const CHANNEL_IDS = ALL_CHANNELS.map((c) => c.id);

export function getEnabledChannelIds() {
  const raw = (process.env.ENABLED_CHANNELS || 'threads').trim();
  const requested = raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const valid = requested.filter((id) => CHANNEL_MAP.has(id));
  return valid.length > 0 ? valid : ['threads'];
}

export function normalizeChannelId(value, { defaultId = null } = {}) {
  const fallback = defaultId || getDefaultChannelId();
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (!CHANNEL_MAP.has(normalized)) {
    throw new Error(`Kanal tidak dikenal: ${value}. Kanal tersedia: ${CHANNEL_IDS.join(', ')}.`);
  }
  if (!getEnabledChannelIds().includes(normalized)) {
    throw new Error(`Kanal ${normalized} tidak diaktifkan. Set ENABLED_CHANNELS untuk mengaktifkan.`);
  }
  return normalized;
}

export function getDefaultChannelId() {
  const enabled = getEnabledChannelIds();
  return enabled[0] || 'threads';
}

export function getChannel(channelId) {
  const id = String(channelId || '').trim().toLowerCase();
  const channel = CHANNEL_MAP.get(id);
  if (!channel) {
    const err = new Error(`Kanal tidak dikenal: ${channelId}`);
    err.statusCode = 400;
    throw err;
  }
  if (!getEnabledChannelIds().includes(id)) {
    const err = new Error(`Kanal ${id} tidak diaktifkan.`);
    err.statusCode = 400;
    throw err;
  }
  return channel;
}

export function listChannels({ includeDisabled = false } = {}) {
  const enabled = new Set(getEnabledChannelIds());
  const channels = includeDisabled ? ALL_CHANNELS : ALL_CHANNELS.filter((c) => enabled.has(c.id));
  return channels.map((channel) => ({
    id: channel.id,
    label: channel.label,
    replizAccountType: channel.replizAccountType,
    enabled: enabled.has(channel.id),
    configured: channel.isConfigured(),
  }));
}

export function isChannelSchedulable(channelId) {
  const channel = getChannel(channelId);
  return channel.isConfigured();
}

export { threadsChannel, instagramChannel };