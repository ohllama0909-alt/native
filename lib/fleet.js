/**
 * Fleet primitives shared by the bots page, the roster UI, and the create dialog.
 *
 * Everything in here is pure or touches localStorage only, so it stays safe to
 * import from both server and client components.
 */

import { proxyLabelFor } from '@/lib/format';

export const UNCATEGORIZED = 'Uncategorized';
export const FREE_BOT_QUOTA = 10;
export const BATCH_MAX = 10;

export const PREFS_KEY = 'nativelaunch:bots:prefs';
export const LAST_BOT_CONFIG_KEY = 'nativelaunch:last_bot_config';

export const BOT_ID = /^[a-zA-Z0-9_-]{1,24}$/;
export const MINECRAFT_USERNAME = /^[A-Za-z0-9_]{3,16}$/;

// Mirrors buildConfigFromBody on the server. Anything omitted here is still
// editable afterwards in the workspace's Configuration tab.
export const BLANK_BOT = {
  id: '',
  username: '',
  category: '',
  host: 'play.bananasmp.net',
  port: '25565',
  version: '1.20.1',
  auth: 'offline',
  proxyId: 'auto',
  autoReconnect: true,
  reconnectDelaySec: '5',
  afkMode: true,
  autoRegister: false,
  autoLogin: false,
  loginPassword: '',
  startOnCreate: true,
  discordEnabled: false,
  discordToken: '',
  discordGuildId: '',
  webhookUrl: '',
  collectSlot: '13',
  cycleDelaySec: '15',
  ownerId: '',
};

export const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Live' },
  { value: 'stopped', label: 'Offline' },
];

export const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
  { value: 'shards', label: 'Shards' },
  { value: 'category', label: 'Category' },
];

export const SHORTCUTS = [
  ['/', 'search'],
  ['J K', 'move'],
  ['X', 'check'],
  ['S', 'start'],
  ['\u2318K', 'broadcast'],
];

/* ------------------------------------------------------------------ */
/* storage helpers                                                     */
/* ------------------------------------------------------------------ */

export function readJSON(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode - the page still works, it just forgets */
  }
}

export function loadLastBotConfig() {
  return readJSON(LAST_BOT_CONFIG_KEY, null);
}

export function saveLastBotConfig(config, lastId) {
  writeJSON(LAST_BOT_CONFIG_KEY, {
    lastId: lastId || config.id || '',
    category: config.category || '',
    host: config.host || BLANK_BOT.host,
    port: config.port || BLANK_BOT.port,
    version: config.version || BLANK_BOT.version,
    auth: config.auth || 'offline',
    autoReconnect: config.autoReconnect ?? true,
    reconnectDelaySec: config.reconnectDelaySec || '5',
    afkMode: config.afkMode ?? true,
    autoRegister: config.autoRegister ?? false,
    autoLogin: config.autoLogin ?? false,
    loginPassword: config.loginPassword || '',
    startOnCreate: config.startOnCreate ?? true,
    discordEnabled: config.discordEnabled ?? false,
    discordToken: config.discordToken || '',
    discordGuildId: config.discordGuildId || '',
    webhookUrl: config.webhookUrl || '',
    collectSlot: config.collectSlot || '13',
    cycleDelaySec: config.cycleDelaySec || '15',
    proxyId: config.proxyId || '',
  });
}

/* ------------------------------------------------------------------ */
/* pure helpers                                                        */
/* ------------------------------------------------------------------ */

export function catOf(bot) {
  const raw = (bot && bot.config && bot.config.category) || UNCATEGORIZED;
  return String(raw).trim() || UNCATEGORIZED;
}

export function nameOf(bot) {
  return (bot && bot.config && bot.config.username) || (bot && bot.id) || '';
}

export function statusOf(bot) {
  return String((bot && bot.status) || 'stopped').toLowerCase();
}

/** Short egress label. Non-admins get the proxy URI masked, so this only ever
 *  shows host:port and never reconstructs credentials. */
export function egressLabel(bot) {
  return proxyLabelFor(bot) || ((bot.config && bot.config.proxyId) ? 'proxied' : 'direct');
}

export function formatShards(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2).replace(/\.0+$/, '')}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2).replace(/\.0+$/, '')}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(1).replace(/\.0+$/, '')}k`;
  return num.toLocaleString();
}

export function sortCategories(a, b) {
  if (a.name === b.name) return 0;
  if (a.name === UNCATEGORIZED) return 1;
  if (b.name === UNCATEGORIZED) return -1;
  return a.name.localeCompare(b.name);
}

/** Next free sequential id, continuing whatever numbering was used last. */
export function getNextBotId(existingBots = [], lastId = '') {
  const taken = new Set((existingBots || []).map((bot) => String(bot.id).toLowerCase()));

  if (lastId) {
    const match = String(lastId).match(/^(.*?[-_])?(\d+)$/);
    if (match) {
      const prefix = match[1] || 'bot-';
      const width = match[2].length;
      let next = parseInt(match[2], 10) + 1;
      while (taken.has(`${prefix}${String(next).padStart(width, '0')}`.toLowerCase())) next++;
      return `${prefix}${String(next).padStart(width, '0')}`;
    }
  }

  let n = 1;
  while (taken.has(`bot-${n}`)) n++;
  return `bot-${n}`;
}

export function comparatorFor(sort) {
  if (sort === 'status') {
    return (a, b) => {
      const rank = (bot) => (statusOf(bot) === 'running' ? 0 : statusOf(bot) === 'stopped' ? 2 : 1);
      return rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b));
    };
  }
  if (sort === 'shards') {
    return (a, b) => (Number(b.shards) || 0) - (Number(a.shards) || 0) || nameOf(a).localeCompare(nameOf(b));
  }
  if (sort === 'category') {
    return (a, b) => catOf(a).localeCompare(catOf(b)) || nameOf(a).localeCompare(nameOf(b));
  }
  return (a, b) => nameOf(a).localeCompare(nameOf(b));
}
