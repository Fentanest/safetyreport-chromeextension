import { createClient } from '@supabase/supabase-js';
import { buildRequest, classifyError, retryAfterSeconds, projectCloudDto } from './myReportsClient.js';
import { migrateSettings, validMode, validateSettings, serverOrigin } from './backendConfig.js';
import { createSelfhostClient } from './selfhostClient.js';

const SUPABASE_URL = __SUPABASE_URL__;
const PUBLISHABLE_KEY = __SUPABASE_KEY__;
const configured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
const AUTH_KEY = configured ? `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token` : null;
const CACHE_TTL = 60_000;
const cache = new Map();
const inflight = new Map();
const activeControllers = new Set();
let generation = 0;
let backendGeneration = 0;
let clientGeneration = -1;
let loginFlight = null;
let refreshFlight = null;
let blockedUntil = 0;
let client;
let settings;
let initialized = false;
let settingsFlight = Promise.resolve();
let pollFlight = null;
const ALARM = 'safetyreport_poll';
const selfhostRequest = createSelfhostClient({ version: chrome.runtime.getManifest().version,
  permission: origin => chrome.permissions.contains({ origins: [origin] }) });

const storage = {
  getItem: async key => (await chrome.storage.local.get(key))[key] ?? null,
  setItem: async (key, value) => { await chrome.storage.local.set({ [key]: value }); },
  removeItem: async key => { await chrome.storage.local.remove(key); },
};

const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const [local, sync] = await Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get(null)]);
  settings = migrateSettings(local, sync);
  await chrome.storage.local.set(settings);
  await chrome.storage.sync.remove(['serverUrl', 'apiKey', 'backendMode', 'notifyCrawlDone', 'pollInterval']);
  await chrome.storage.local.remove(['serverUrl', 'apiKey', 'notifyCrawlDone', 'pollInterval', 'wasCrawling']);
  await chrome.action.setBadgeText({ text: '' });
  await resetAlarm();
  initialized = true;
  clearCache(true, 'WORKER_RESTARTED');
})();

function cloudClient() {
  if (!configured) throw new Error('NOT_CONFIGURED');
  if (client && clientGeneration === backendGeneration) return client;
  const owner = backendGeneration;
  const ownedStorage = {
    getItem: storage.getItem,
    setItem: async (key, value) => { if (owner === backendGeneration) await storage.setItem(key, value); },
    removeItem: async key => { if (owner === backendGeneration) await storage.removeItem(key); },
  };
  client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { fetch: (url, options) => {
      // SDK refresh retries belong to the client that started them, even after
      // a rapid selfhost -> cloud round trip. Old retries never send packets.
      if (owner !== backendGeneration) throw new Error('STALE_SESSION');
      return cloudFetch(url, options);
    } },
    auth: { flowType: 'pkce', storage: ownedStorage, storageKey: AUTH_KEY, persistSession: true,
      autoRefreshToken: false, detectSessionInUrl: false },
  });
  clientGeneration = owner;
  return client;
}
async function cloudFetch(url, options = {}) {
  if (settings.backendMode !== 'cloud') throw new Error('STALE_SESSION');
  const epoch = generation, controller = new AbortController();
  activeControllers.add(controller);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 20_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (epoch !== generation || settings.backendMode !== 'cloud') throw new Error('STALE_SESSION');
    return response;
  } finally { clearTimeout(timeout); activeControllers.delete(controller); options.signal?.removeEventListener('abort', abort); }
}
function sessionIdentity(value) {
  try { return (typeof value === 'string' ? JSON.parse(value) : value)?.user?.id || null; }
  catch { return null; }
}
function clearCache(notify = true, type = 'AUTH_CHANGED') {
  generation += 1; if (notify) backendGeneration += 1;
  cache.clear(); inflight.clear(); blockedUntil = 0;
  for (const controller of activeControllers) controller.abort();
  activeControllers.clear();
  chrome.action.setBadgeText({ text: '' });
  if (notify) chrome.runtime.sendMessage({ type }).catch(() => {});
  const tabType = notify ? type : 'DATA_INVALIDATED';
  chrome.tabs.query({}).then(tabs => {
    for (const tab of tabs) if (tab.id !== undefined)
      chrome.tabs.sendMessage(tab.id, { type: tabType }).catch(() => {});
  }).catch(() => {});
}

async function currentSession() {
  await ready;
  if (settings.backendMode !== 'cloud') throw new Error('STALE_SESSION');
  if (!configured) throw new Error('NOT_CONFIGURED');
  const epoch = generation;
  const authClient = cloudClient();
  const { data, error } = await authClient.auth.getSession();
  if (generation !== epoch || settings.backendMode !== 'cloud') throw new Error('STALE_SESSION');
  if (error) throw new Error('AUTH_REQUIRED');
  let session = data.session;
  if (!session) throw new Error('AUTH_REQUIRED');
  if (session.expires_at && session.expires_at * 1000 < Date.now() + 30_000) {
    refreshFlight ??= cloudClient().auth.refreshSession().finally(() => { refreshFlight = null; });
    const refreshed = await refreshFlight;
    if (generation !== epoch) throw new Error('STALE_SESSION');
    if (refreshed.error || !refreshed.data.session) throw new Error('AUTH_REQUIRED');
    session = refreshed.data.session;
  }
  if (generation !== epoch || settings.backendMode !== 'cloud') throw new Error('STALE_SESSION');
  return session;
}

async function status() {
  await ready;
  if (!settings.backendMode) return { backendMode: null, connected: false, error: 'MODE_REQUIRED' };
  if (settings.backendMode === 'selfhost') {
    try { const version = await selfhost('connection');
      return { backendMode: 'selfhost', connected: true, version: version.version }; }
    catch (error) { return { backendMode: 'selfhost', connected: false, error: error.message }; }
  }
  try {
    const session = await currentSession();
    return { backendMode: 'cloud', connected: true, signedIn: true, name: typeof session.user.user_metadata?.full_name === 'string' ? session.user.user_metadata.full_name : null };
  } catch (error) {
    return { backendMode: 'cloud', connected: false, signedIn: false, error: error.message === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : null };
  }
}

async function login() {
  if (loginFlight) return loginFlight;
  loginFlight = (async () => {
    await ready;
    if (settings.backendMode !== 'cloud') throw new Error('MODE_UNSUPPORTED');
    const epoch = generation;
    if (!configured) throw new Error('NOT_CONFIGURED');
    const redirectTo = chrome.identity.getRedirectURL('supabase-auth');
    const issuedAt = Date.now();
    const { data, error } = await cloudClient().auth.signInWithOAuth({ provider: 'kakao',
      options: { redirectTo, skipBrowserRedirect: true } });
    if (error || !data?.url) throw new Error('LOGIN_START_FAILED');
    await chrome.storage.session.set({ srAuthFlow: { redirectTo, issuedAt } });
    try {
      const callback = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true });
      if (!callback || Date.now() - issuedAt > 10 * 60_000) throw new Error('LOGIN_EXPIRED');
      const expected = new URL(redirectTo);
      const received = new URL(callback);
      if (received.protocol !== expected.protocol || received.host !== expected.host ||
          received.pathname !== expected.pathname || received.hash || received.searchParams.has('error')) {
        throw new Error('LOGIN_CALLBACK_INVALID');
      }
      const code = received.searchParams.get('code');
      if (!code || !/^[A-Za-z0-9_-]{8,2048}$/.test(code)) throw new Error('LOGIN_CALLBACK_INVALID');
      const flow = (await chrome.storage.session.get('srAuthFlow')).srAuthFlow;
      if (!flow || flow.redirectTo !== redirectTo || flow.issuedAt !== issuedAt) throw new Error('LOGIN_CALLBACK_INVALID');
      if (epoch !== generation || settings.backendMode !== 'cloud') throw new Error('STALE_SESSION');
      const exchanged = await cloudClient().auth.exchangeCodeForSession(code);
      if (exchanged.error || !exchanged.data.session) throw new Error('LOGIN_EXCHANGE_FAILED');
      const persisted = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY];
      const savedSession = typeof persisted === 'string' ? JSON.parse(persisted) : persisted;
      if (settings.backendMode !== 'cloud' || savedSession?.access_token !== exchanged.data.session.access_token) throw new Error('STALE_SESSION');
      clearCache();
      if (settings.backendMode !== 'cloud') throw new Error('STALE_SESSION');
      return status();
    } finally {
      await chrome.storage.session.remove('srAuthFlow');
    }
  })().finally(() => { loginFlight = null; });
  return loginFlight;
}

async function logout() {
  await ready;
  if (settings.backendMode !== 'cloud') throw new Error('MODE_UNSUPPORTED');
  clearCache();
  if (configured) {
    const previous = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY];
    const result = await cloudClient().auth.signOut({ scope: 'local' });
    // Explicit logout must remove the local session even when the server is offline.
    const current = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY];
    if (result?.error && sessionIdentity(current) === sessionIdentity(previous)) {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(all).filter(key => key === AUTH_KEY || key.startsWith(AUTH_KEY + '-')));
    }
  }
  await chrome.storage.session.remove('srAuthFlow');
  return { signedIn: false };
}

async function reports(mode, message) {
  await ready;
  const epoch = generation;
  if (settings.backendMode === 'selfhost') return selfhost(mode, message);
  if (!settings.backendMode) throw new Error('MODE_REQUIRED');
  const { route, body } = buildRequest(mode, message);
  if (Date.now() < blockedUntil) throw new Error('RATE_LIMITED');
  const session = await currentSession();
  if (epoch !== generation) throw new Error('STALE_SESSION');
  const key = JSON.stringify(['cloud', SUPABASE_URL, session.user.id, route, body]);
  if (message.fresh === true) cache.delete(key);
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < CACHE_TTL) return saved.value;
  if (inflight.has(key)) return inflight.get(key);
  const controller = new AbortController();
  activeControllers.add(controller);
  const request = (async () => {
    const send = token => { if (epoch !== generation || settings.backendMode !== 'cloud') throw new Error('STALE_SESSION'); return cloudFetch(`${SUPABASE_URL}/functions/v1/my-reports/${route}`, {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }); };
    const read = async response => { try { return await response.json(); } catch { return null; } };
    let response = await send(session.access_token);
    let payload = response.ok ? null : await read(response);
    if (response.status === 401 && classifyError(401, payload).refresh) {
      if (generation !== epoch) throw new Error('STALE_SESSION');
      refreshFlight ??= cloudClient().auth.refreshSession().finally(() => { refreshFlight = null; });
      const refreshed = await refreshFlight;
      if (generation !== epoch) throw new Error('STALE_SESSION');
      if (refreshed.error || !refreshed.data.session) { clearCache(false); throw new Error('AUTH_REQUIRED'); }
      response = await send(refreshed.data.session.access_token);
      payload = response.ok ? null : await read(response);
    }
    if (generation !== epoch) throw new Error('STALE_SESSION');
    if (!response.ok) {
      const failure = classifyError(response.status, payload);
      if (failure.clear) clearCache(false);
      else if (failure.restart) cache.clear();
      if (failure.code === 'RATE_LIMITED') blockedUntil = Date.now() + retryAfterSeconds(response.headers.get('retry-after')) * 1000;
      throw new Error(failure.code);
    }
    const value = projectCloudDto(await read(response), route);
    if (!value || value.contract !== 'my-reports-v1' || value.route !== route) throw new Error('REQUEST_FAILED');
    if (generation !== epoch) throw new Error('STALE_SESSION');
    cache.set(key, { at: Date.now(), value });
    while (cache.size > 50) cache.delete(cache.keys().next().value);
    return value;
  })().finally(() => { if (inflight.get(key) === request) inflight.delete(key); activeControllers.delete(controller); });
  inflight.set(key, request);
  return request;
}

const ERROR_CODES = new Set(['NOT_CONFIGURED','AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED','UNAVAILABLE','REQUEST_FAILED',
  'DATASET_CHANGED','NUMBERS_LIMIT_EXCEEDED','INVALID_QUERY','STALE_SESSION','FORBIDDEN','UNKNOWN_MESSAGE','INVALID_MODE','MODE_UNSUPPORTED','MODE_REQUIRED',
  'INVALID_SERVER_URL','INVALID_API_KEY','INVALID_POLL_INTERVAL','SERVER_NOT_CONFIGURED','SERVER_PERMISSION_REQUIRED','SERVER_AUTH_REQUIRED',
  'SERVER_ACCESS_DENIED','SERVER_CONFLICT','SERVER_OFFLINE','SERVER_UPGRADE_REQUIRED','COMPAT_INFO_MISSING','CLIENT_UPGRADE_REQUIRED','CLIENT_PROTOCOL_UNSUPPORTED',
  'LOGIN_START_FAILED','LOGIN_EXPIRED','LOGIN_CALLBACK_INVALID','LOGIN_EXCHANGE_FAILED']);
const safeError = error => ERROR_CODES.has(error?.message) ? error.message : 'REQUEST_FAILED';
function senderRole(sender) {
  if (sender.id !== chrome.runtime.id) return null;
  if (sender.url === chrome.runtime.getURL('popup.html') || sender.url === chrome.runtime.getURL('options.html')) return 'trusted';
  if (sender.frameId === 0 && /^https:\/\/www\.safetyreport\.go\.kr\//.test(sender.url || '')) return 'content';
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const role = senderRole(sender);
  if (!role || !message || typeof message !== 'object') return false;
  (async () => {
    await ready;
    await settingsFlight;
    const type = message.type;
    if (type === 'STATUS') return status();
    if (type === 'SEARCH') return reports('search', message);
    if (type === 'NUMBERS') return reports('numbers', message);
    if (role !== 'trusted') throw new Error('FORBIDDEN');
    if (type === 'SUMMARY') return reports('summary', message);
    if (type === 'GET_SETTINGS') return { ...settings, configured };
    if (type === 'SET_MODE') return changeSettings(message);
    if (type === 'SAVE_SERVER') return changeSettings(message);
    if (type === 'TEST_SERVER') {
      const value = await selfhost('connection', message);
      const active = message.serverUrl === undefined || (message.serverUrl === settings.selfhost.serverUrl && message.apiKey === settings.selfhost.apiKey);
      if (active) { await chrome.storage.local.remove('selfhostBlocked'); await resetAlarm(); }
      return { ...value, active };
    }
    if (type === 'TEST_CLOUD') { if (settings.backendMode !== 'cloud') throw new Error('MODE_UNSUPPORTED'); return reports('summary', { fresh: true }).then(() => ({ connected: true })); }
    if (type === 'OPEN_SERVER') { if (settings.backendMode !== 'selfhost') throw new Error('MODE_UNSUPPORTED'); await chrome.tabs.create({ url: serverOrigin(settings.selfhost.serverUrl) + '/' }); return { success: true }; }
    if (type === 'CRAWL_STATUS') return selfhost('crawl-status');
    if (type === 'CRAWL_START' || type === 'CRAWL_STOP') { await pollCrawlStatus(); const result = await selfhost(type === 'CRAWL_START' ? 'crawl-start' : 'crawl-stop'); await pollCrawlStatus(); return result; }
    if (type === 'LOGIN') return login();
    if (type === 'LOGOUT') return logout();
    throw new Error('UNKNOWN_MESSAGE');
  })().then(data => respond({ data }), error => respond({ error: safeError(error) }));
  return true;
});

async function resetAlarm(force = false) {
  const blocked = (await chrome.storage.local.get('selfhostBlocked')).selfhostBlocked;
  const minutes = Math.max(1, Number(settings.selfhost.pollInterval) || 5);
  if (settings.backendMode === 'selfhost' && settings.selfhost.serverUrl && settings.selfhost.apiKey && !blocked) {
    const alarm = await chrome.alarms.get(ALARM);
    // Waking a worker must not postpone an existing periodic poll every time.
    if (!force && alarm?.periodInMinutes === minutes) return;
    await chrome.alarms.clear(ALARM);
    await chrome.alarms.create(ALARM, { periodInMinutes: minutes });
  } else await chrome.alarms.clear(ALARM);
}
async function changeSettings(message) {
  // Serialize mutations and invalidate immediately, before any storage await.
  if (message.type === 'SET_MODE' && !validMode(message.backendMode)) throw new Error('INVALID_MODE');
  const selfhostConfig = message.type === 'SAVE_SERVER' ? validateSettings(message) : null;
  if (selfhostConfig && !await chrome.permissions.contains({ origins: [selfhostConfig.serverUrl + '/*'] })) throw new Error('SERVER_PERMISSION_REQUIRED');
  clearCache();
  const operation = settingsFlight.then(async () => {
    settings = { ...settings, ...(selfhostConfig ? { selfhost: selfhostConfig } : { backendMode: message.backendMode }) };
    await chrome.storage.local.set(settings);
    await chrome.storage.local.remove('selfhostBlocked');
    if (await chrome.permissions.contains({ permissions: ['notifications'] })) {
      const notifications = await chrome.notifications.getAll();
      for (const id of Object.keys(notifications)) if (id.startsWith('sr-crawl-')) await chrome.notifications.clear(id);
    }
    await resetAlarm(true);
    return { backendMode: settings.backendMode };
  });
  settingsFlight = operation.catch(() => {});
  return operation;
}
async function selfhost(operation, message = {}) {
  await ready;
  if (settings.backendMode !== 'selfhost') throw new Error(settings.backendMode ? 'MODE_UNSUPPORTED' : 'MODE_REQUIRED');
  const config = operation === 'connection' && message.serverUrl !== undefined ? validateSettings(message) : settings.selfhost, epoch = generation;
  const isActiveConfig = config.serverUrl === settings.selfhost.serverUrl && config.apiKey === settings.selfhost.apiKey;
  const key = JSON.stringify(['selfhost', config.serverUrl, operation, operation === 'search' || operation === 'numbers' ? buildRequest(operation, message).body : null]);
  const canCache = operation === 'search' || operation === 'numbers' || operation === 'summary';
  if (message.fresh) cache.delete(key);
  const saved = cache.get(key);
  if (canCache && saved && Date.now() - saved.at < CACHE_TTL) return saved.value;
  if (operation !== 'connection' && operation !== 'version' && inflight.has(key)) return inflight.get(key);
  const controller = new AbortController(); activeControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(new Error('REQUEST_TIMEOUT')), 20_000);
  const promise = (async () => {
    try {
      const value = await selfhostRequest(config, operation, message, controller.signal);
      if (epoch !== generation) throw new Error('STALE_SESSION');
      if (canCache) {
        cache.set(key, { at: Date.now(), value });
        while (cache.size > 50) cache.delete(cache.keys().next().value);
      }
      return value;
    } catch (error) {
      if (epoch !== generation) throw new Error('STALE_SESSION');
      if (isActiveConfig && ['CLIENT_UPGRADE_REQUIRED','CLIENT_PROTOCOL_UNSUPPORTED','SERVER_UPGRADE_REQUIRED','COMPAT_INFO_MISSING'].includes(error.message)) {
        await chrome.storage.local.set({ selfhostBlocked: error.message });
        await chrome.alarms.clear(ALARM);
      }
      throw error;
    }
  })().finally(() => { clearTimeout(timeout); if (inflight.get(key) === promise) inflight.delete(key); activeControllers.delete(controller); });
  if (operation !== 'connection' && operation !== 'version') inflight.set(key, promise); return promise;
}
async function pollCrawlStatus() {
  await ready; await settingsFlight;
  if (settings.backendMode !== 'selfhost') return;
  if (pollFlight) return pollFlight;
  const epoch = generation, config = settings.selfhost;
  pollFlight = (async () => {
    try {
      // Credential fingerprint namespaces persistent transitions without retaining keys in state.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(config.apiKey));
      const fingerprint = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
      const identity = JSON.stringify([config.serverUrl, fingerprint]);
      const previous = (await chrome.storage.local.get('srCrawlState')).srCrawlState;
      const crawl = await selfhost('crawl-status');
      if (epoch !== generation) return;
      if (previous?.identity === identity && previous.running !== crawl.running && config.notifyCrawlDone &&
          await chrome.permissions.contains({ permissions: ['notifications'] })) {
        const done = crawl.running ? null : await selfhost('crawl-done');
        if (epoch !== generation) return;
        const lines = done?.changes.slice(0, 3).map(row => row.notification_kind === 'duplicate'
          ? [`[중복] ${{ group_added: '신규 중복군', members_changed: '멤버 변경', representative_changed: '대표건 변경' }[row.duplicate_change_type] || '중복 변경'}`, row.status_label,
            row.member_count === null ? '' : `${row.member_count}건`, row.representative_report_number ? '대표 ' + row.representative_report_number : ''].filter(Boolean).join(' · ')
          : [row.report_number ? `[${row.report_number}]` : '', row.report_title || '신고 변경'].filter(Boolean).join(' ')) || [];
        if (done?.changes.length > 3) lines.push(`외 ${done.changes.length - 3}건`);
        const duplicateCount = done?.changes.filter(row => row.notification_kind === 'duplicate').length || 0;
        const reportCount = (done?.changes.length || 0) - duplicateCount;
        const counts = duplicateCount ? ` (신고 ${reportCount}건, 중복 ${duplicateCount}건)` : done?.changed_count > 0 ? ` (${done.changed_count}건)` : '';
        await chrome.notifications.create(`sr-crawl-${epoch}`, { type: 'basic', iconUrl: 'icons/icon48.png',
          title: crawl.running ? '크롤링 시작' : `크롤링 완료${counts}`,
          message: lines.length ? lines.join('\n') : crawl.running ? '서버에서 크롤링을 시작했습니다.' : '서버 크롤링이 완료되었습니다.' });
        if (epoch !== generation) { await chrome.notifications.clear(`sr-crawl-${epoch}`); return; }
      }
      if (epoch !== generation) return;
      await chrome.storage.local.set({ srCrawlState: { identity, running: crawl.running } });
      const summary = await selfhost('summary', { fresh: true });
      if (epoch !== generation) return;
      await chrome.action.setBadgeText({ text: summary.stats.processingCount > 0 ? String(summary.stats.processingCount) : '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      if (epoch !== generation) await chrome.action.setBadgeText({ text: '' });
    } catch { if (epoch === generation) await chrome.action.setBadgeText({ text: '' }); }
  })().finally(() => { pollFlight = null; });
  return pollFlight;
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) pollCrawlStatus(); });
chrome.runtime.onInstalled.addListener(async () => { await ready; await resetAlarm(); });
chrome.runtime.onStartup.addListener(async () => { await ready; await resetAlarm(); });
// Direct trusted storage changes (account changes or restored settings) invalidate old data.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !initialized) return;
  if (Object.entries(changes).some(([key, value]) => /^sb-.+-auth-token$/.test(key) &&
      sessionIdentity(value.oldValue) !== sessionIdentity(value.newValue))) clearCache();
  const changedMode = changes.backendMode && changes.backendMode.newValue !== settings.backendMode;
  const changedServer = changes.selfhost && JSON.stringify(changes.selfhost.newValue) !== JSON.stringify(settings.selfhost);
  if (changedMode || changedServer) {
    clearCache();
    settings = { ...settings, ...(changedMode ? { backendMode: validMode(changes.backendMode.newValue) ? changes.backendMode.newValue : null } : {}),
      ...(changedServer ? { selfhost: changes.selfhost.newValue || {} } : {}) };
    settingsFlight = settingsFlight.then(async () => { if (changedServer) await chrome.storage.local.remove('selfhostBlocked'); await resetAlarm(true); }).catch(() => {});
  }
});
