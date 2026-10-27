import { createClient } from '@supabase/supabase-js';
import { buildRequest, classifyError, retryAfterSeconds, projectCloudDto } from './myReportsClient.js';
import { migrateFromSelfhost } from './migration.js';

const SUPABASE_URL = __SUPABASE_URL__;
const PUBLISHABLE_KEY = __SUPABASE_KEY__;
const configured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
const AUTH_KEY = configured ? `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token` : null;
const CACHE_TTL = 60_000;
// STATUS is shown instantly from this durable cache; the live check below only
// refreshes it in the background (account change, prior failure, or elapsed TTL).
const STATUS_TTL_OK = 5 * 60_000;
const STATUS_TTL_ERROR = 30_000;
const cache = new Map();
const inflight = new Map();
const activeControllers = new Set();
let generation = 0;
let backendGeneration = 0;
let clientGeneration = -1;
let loginFlight = null;
let refreshFlight = null;
let blockedUntil = 0;
let statusCache = null; // { identity, result, at } — survives worker restarts via srStatusCache
let statusFlight = null;
let client;
let initialized = false;

const storage = {
  getItem: async key => (await chrome.storage.local.get(key))[key] ?? null,
  setItem: async (key, value) => { await chrome.storage.local.set({ [key]: value }); },
  removeItem: async key => { await chrome.storage.local.remove(key); },
};

const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  // 1.3.0 removed the PC (selfhost) backend: stop its leftovers before anything else runs.
  // A failure leaves the migration unrecorded so the next worker start retries it; cloud still starts.
  await migrateFromSelfhost(chrome).catch(() => {});
  const { srStatusCache } = await chrome.storage.local.get('srStatusCache');
  // A worker restart must not force a fresh network check: restore the last known status so
  // the popup/options can show it immediately.
  if (srStatusCache && typeof srStatusCache === 'object' && String(srStatusCache.identity).startsWith('cloud:')) statusCache = srStatusCache;
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
      // an account change. Old retries never send packets.
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
  const epoch = generation, controller = new AbortController();
  activeControllers.add(controller);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 20_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (epoch !== generation) throw new Error('STALE_SESSION');
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
  if (!configured) throw new Error('NOT_CONFIGURED');
  const epoch = generation;
  const authClient = cloudClient();
  const { data, error } = await authClient.auth.getSession();
  if (generation !== epoch) throw new Error('STALE_SESSION');
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
  if (generation !== epoch) throw new Error('STALE_SESSION');
  return session;
}

// An account change must invalidate the cache on its own, without waiting for the TTL:
// the identity is read straight from storage (no network).
async function statusIdentity() {
  if (!configured) return 'cloud:unconfigured';
  const stored = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY];
  return 'cloud:' + (sessionIdentity(stored) || 'anonymous');
}
async function computeStatus() {
  try {
    const session = await currentSession();
    return { connected: true, signedIn: true, error: null,
      name: typeof session.user.user_metadata?.full_name === 'string' ? session.user.user_metadata.full_name : null };
  } catch (error) {
    return { connected: false, signedIn: false, error: error.message === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : null };
  }
}
function sameStatusResult(a, b) {
  if (!a || !b) return a === b;
  return a.connected === b.connected && a.error === b.error &&
    a.signedIn === b.signedIn && a.name === b.name;
}
// The actual live check (session read). Concurrent calls for the same
// identity and generation share one flight; invalidated requests cannot be reused.
function refreshStatus(identity) {
  const epoch = generation;
  if (statusFlight?.identity === identity && statusFlight.epoch === epoch) return statusFlight.promise;
  const promise = (async () => {
    const result = await computeStatus();
    if (epoch !== generation) return result;
    const changed = !sameStatusResult(statusCache?.result, result);
    statusCache = { identity, result, at: Date.now() };
    await chrome.storage.local.set({ srStatusCache: statusCache });
    if (changed) chrome.runtime.sendMessage({ type: 'STATUS_CHANGED' }).catch(() => {});
    return result;
  })().finally(() => { if (statusFlight?.promise === promise) statusFlight = null; });
  statusFlight = { identity, epoch, promise };
  return promise;
}
// Popup/options show this instantly; a live check only runs when there is no cached
// value yet, the caller explicitly asks for one (manual refresh), or it is stale/failed.
async function status(message = {}) {
  await ready;
  const identity = await statusIdentity();
  if (message.fresh) return refreshStatus(identity);
  const cached = statusCache?.identity === identity ? statusCache : null;
  if (!cached) return refreshStatus(identity);
  const ttl = cached.result.connected ? STATUS_TTL_OK : STATUS_TTL_ERROR;
  if (Date.now() - cached.at >= ttl) refreshStatus(identity).catch(() => {});
  return cached.result;
}

async function login() {
  if (loginFlight) return loginFlight;
  loginFlight = (async () => {
    await ready;
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
      if (epoch !== generation) throw new Error('STALE_SESSION');
      const exchanged = await cloudClient().auth.exchangeCodeForSession(code);
      if (exchanged.error || !exchanged.data.session) throw new Error('LOGIN_EXCHANGE_FAILED');
      const persisted = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY];
      const savedSession = typeof persisted === 'string' ? JSON.parse(persisted) : persisted;
      if (savedSession?.access_token !== exchanged.data.session.access_token) throw new Error('STALE_SESSION');
      clearCache();
      statusCache = null;
      return status();
    } finally {
      await chrome.storage.session.remove('srAuthFlow');
    }
  })().finally(() => { loginFlight = null; });
  return loginFlight;
}

async function logout() {
  await ready;
  clearCache();
  statusCache = null;
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
    const send = token => { if (epoch !== generation) throw new Error('STALE_SESSION'); return cloudFetch(`${SUPABASE_URL}/functions/v1/my-reports/${route}`, {
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
      if (refreshed.error || !refreshed.data.session) { clearCache(false); statusCache = null; throw new Error('AUTH_REQUIRED'); }
      response = await send(refreshed.data.session.access_token);
      payload = response.ok ? null : await read(response);
    }
    if (generation !== epoch) throw new Error('STALE_SESSION');
    if (!response.ok) {
      if (response.status === 400 && payload?.error?.code === 'QUERY_LENGTH' && body.kind === 'vehicle' && [...body.query].length < 6) {
        throw new Error('CLOUD_SHORT_VEHICLE_UNSUPPORTED');
      }
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

const ERROR_CODES = new Set(['NOT_CONFIGURED','CLOUD_SHORT_VEHICLE_UNSUPPORTED','AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED','UNAVAILABLE','REQUEST_FAILED',
  'DATASET_CHANGED','NUMBERS_LIMIT_EXCEEDED','INVALID_QUERY','STALE_SESSION','FORBIDDEN','UNKNOWN_MESSAGE',
  'LOGIN_START_FAILED','LOGIN_EXPIRED','LOGIN_CALLBACK_INVALID','LOGIN_EXCHANGE_FAILED']);
const safeError = error => ERROR_CODES.has(error?.message) ? error.message : 'REQUEST_FAILED';
function senderRole(sender) {
  if (sender.id !== chrome.runtime.id) return null;
  if (sender.url === chrome.runtime.getURL('popup.html') || sender.url === chrome.runtime.getURL('options.html')) return 'trusted';
  // The real site serves identical content on the bare host too (no redirect either way).
  if (sender.frameId === 0 && /^https?:\/\/(?:www\.)?safetyreport\.go\.kr\//.test(sender.url || '')) return 'content';
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const role = senderRole(sender);
  if (!role || !message || typeof message !== 'object') return false;
  (async () => {
    await ready;
    const type = message.type;
    if (type === 'STATUS') return status(message);
    if (type === 'SEARCH') return reports('search', message);
    if (type === 'NUMBERS') return reports('numbers', message);
    if (role !== 'trusted') throw new Error('FORBIDDEN');
    if (type === 'SUMMARY') return reports('summary', message);
    if (type === 'TEST_CLOUD') return reports('summary', { fresh: true }).then(() => ({ connected: true }));
    if (type === 'LOGIN') return login();
    if (type === 'LOGOUT') return logout();
    throw new Error('UNKNOWN_MESSAGE');
  })().then(data => respond({ data }), error => respond({ error: safeError(error) }));
  return true;
});

// Direct trusted storage changes (account changes or restored sessions) invalidate old data.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !initialized) return;
  if (Object.entries(changes).some(([key, value]) => /^sb-.+-auth-token$/.test(key) &&
      sessionIdentity(value.oldValue) !== sessionIdentity(value.newValue))) { clearCache(); statusCache = null; }
});
