import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = __SUPABASE_URL__;
const PUBLISHABLE_KEY = __SUPABASE_KEY__;
const configured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
const CACHE_TTL = 60_000;
const cache = new Map();
const inflight = new Map();
const activeControllers = new Set();
let generation = 0;
let loginFlight = null;
let refreshFlight = null;
let client;

const storage = {
  getItem: async key => (await chrome.storage.local.get(key))[key] ?? null,
  setItem: async (key, value) => { await chrome.storage.local.set({ [key]: value }); },
  removeItem: async key => { await chrome.storage.local.remove(key); },
};

const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.alarms?.clear?.('safetyreport_poll');
  await chrome.action.setBadgeText({ text: '' });
  if (configured) {
    client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { flowType: 'pkce', storage, persistSession: true,
        autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
})();

function clearCache() {
  generation += 1; cache.clear(); inflight.clear();
  for (const controller of activeControllers) controller.abort();
  activeControllers.clear();
  chrome.tabs.query({}).then(tabs => {
    for (const tab of tabs) if (tab.id !== undefined)
      chrome.tabs.sendMessage(tab.id, { type: 'AUTH_CHANGED' }).catch(() => {});
  }).catch(() => {});
}

async function currentSession() {
  await ready;
  if (!configured) throw new Error('NOT_CONFIGURED');
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error('AUTH_REQUIRED');
  let session = data.session;
  if (!session) throw new Error('AUTH_REQUIRED');
  if (session.expires_at && session.expires_at * 1000 < Date.now() + 30_000) {
    refreshFlight ??= client.auth.refreshSession().finally(() => { refreshFlight = null; });
    const refreshed = await refreshFlight;
    if (refreshed.error || !refreshed.data.session) throw new Error('AUTH_REQUIRED');
    session = refreshed.data.session;
  }
  return session;
}

async function status() {
  try {
    const session = await currentSession();
    return { signedIn: true, name: session.user.user_metadata?.full_name || null };
  } catch (error) {
    return { signedIn: false, error: error.message === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : null };
  }
}

async function login() {
  if (loginFlight) return loginFlight;
  loginFlight = (async () => {
    await ready;
    if (!configured) throw new Error('NOT_CONFIGURED');
    const redirectTo = chrome.identity.getRedirectURL('supabase-auth');
    const issuedAt = Date.now();
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'kakao',
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
      const exchanged = await client.auth.exchangeCodeForSession(code);
      if (exchanged.error || !exchanged.data.session) throw new Error('LOGIN_EXCHANGE_FAILED');
      clearCache();
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
  if (configured) await client.auth.signOut({ scope: 'local' });
  await chrome.storage.session.remove('srAuthFlow');
  return { signedIn: false };
}

function validRequest(mode, msg) {
  const offset = msg.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000) throw new Error('INVALID_QUERY');
  const version = msg.expectedVersion ?? null;
  if (version !== null && (typeof version !== 'string' || !/^[0-9a-f]{32}$/.test(version))) throw new Error('INVALID_QUERY');
  if (mode === 'summary') return { mode, body: { offset, limit: 20,
    ...(version ? { expected_version: version } : {}) } };
  const kind = msg.kind;
  if (kind !== 'vehicle' && kind !== 'address') throw new Error('INVALID_QUERY');
  if (typeof msg.query !== 'string') throw new Error('INVALID_QUERY');
  const query = kind === 'vehicle' ? msg.query.normalize('NFC').replace(/\s/gu, '')
    : msg.query.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const length = [...query].length;
  if (kind === 'vehicle' ? length < 6 || length > 64 : length < 5 || length > 200) throw new Error('INVALID_QUERY');
  return { mode, body: { kind, query, offset, limit: mode === 'numbers' ? 50 : 20,
    ...(version ? { expected_version: version } : {}) } };
}

async function reports(mode, message) {
  const { body } = validRequest(mode, message);
  const session = await currentSession();
  const epoch = generation;
  const key = JSON.stringify([epoch, session.user.id, mode, body]);
  if (mode === 'summary' && message.fresh === true) cache.delete(key);
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < CACHE_TTL) return saved.value;
  if (inflight.has(key)) return inflight.get(key);
  const controller = new AbortController();
  activeControllers.add(controller);
  const request = (async () => {
    const send = token => fetch(`${SUPABASE_URL}/functions/v1/my-reports/${mode}`, {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let response = await send(session.access_token);
    if (response.status === 401) {
      refreshFlight ??= client.auth.refreshSession().finally(() => { refreshFlight = null; });
      const refreshed = await refreshFlight;
      if (refreshed.error || !refreshed.data.session) throw new Error('AUTH_REQUIRED');
      response = await send(refreshed.data.session.access_token);
    }
    if (!response.ok) {
      if (response.status === 401) { clearCache(); throw new Error('AUTH_REQUIRED'); }
      if (response.status === 403) { clearCache(); throw new Error('ACCESS_DENIED'); }
      if (response.status === 409) throw new Error('DATASET_CHANGED');
      if (response.status === 429) throw new Error('RATE_LIMITED');
      throw new Error('REQUEST_FAILED');
    }
    const value = await response.json();
    if (generation !== epoch) throw new Error('STALE_SESSION');
    cache.set(key, { at: Date.now(), value });
    while (cache.size > 50) cache.delete(cache.keys().next().value);
    return value;
  })().finally(() => { inflight.delete(key); activeControllers.delete(controller); });
  inflight.set(key, request);
  return request;
}

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
    const type = message.type;
    if (type === 'STATUS') return status();
    if (type === 'SEARCH') return reports('search', message);
    if (type === 'NUMBERS') return reports('numbers', message);
    if (role !== 'trusted') throw new Error('FORBIDDEN');
    if (type === 'SUMMARY') return reports('summary', message);
    if (type === 'LOGIN') return login();
    if (type === 'LOGOUT') return logout();
    throw new Error('UNKNOWN_MESSAGE');
  })().then(data => respond({ data }), error => respond({ error: error?.message || 'REQUEST_FAILED' }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await ready;
  await chrome.storage.sync.remove(['serverUrl','apiKey','notifyCrawlDone','pollInterval']);
  await chrome.storage.local.remove(['wasCrawling']);
});
