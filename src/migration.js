// 1.3.0 removed the PC (selfhost) backend. This runs once from the worker's first initialization
// and only deletes what the selfhost code stored; it never clears storage as a whole.
// Every step is safe to repeat, and the version is recorded last, so an interrupted run resumes.
export const MIGRATION_KEY = 'srMigration';
export const MIGRATION_VERSION = 1;
const LOCAL_KEYS = ['selfhost', 'serverUrl', 'apiKey', 'notifyCrawlDone', 'pollInterval', 'wasCrawling',
  'srCrawlState', 'selfhostBlocked', 'backendMode', 'backendMigration'];
const SYNC_KEYS = ['selfhost', 'serverUrl', 'apiKey', 'notifyCrawlDone', 'pollInterval', 'backendMode'];
const ALARM = 'safetyreport_poll';
const NOTICE_PREFIX = 'sr-crawl-';

// alarms/notifications disappear from `chrome` once their permissions are gone: check, never assume.
const attempt = async step => { try { await step(); } catch { /* best effort */ } };

async function dropGrantedPermissions(api) {
  if (!api.permissions?.getAll || !api.permissions.remove) return;
  const manifest = api.runtime.getManifest();
  const keep = new Set([...(manifest.host_permissions || []), ...(manifest.content_scripts || []).flatMap(script => script.matches || [])]);
  const granted = await api.permissions.getAll();
  for (const origin of (granted.origins || []).filter(value => !keep.has(value)))
    await attempt(() => api.permissions.remove({ origins: [origin] }));
  if ((granted.permissions || []).includes('notifications')) await attempt(() => api.permissions.remove({ permissions: ['notifications'] }));
}

// A failed run leaves a short trace (step, error name, time, count) so a bug report can show it; never a message or value.
export const ERROR_KEY = 'srMigrationError';
async function recordFailure(api, step, error, previous) {
  const trace = { step, code: String(error?.name || 'Error').slice(0, 40), at: Date.now(), attempts: (previous?.attempts || 0) + 1 };
  await attempt(() => api.storage.local.set({ [ERROR_KEY]: trace }));
}

export async function migrateFromSelfhost(api) {
  const stored = await api.storage.local.get([MIGRATION_KEY, ERROR_KEY, 'srStatusCache']);
  if (stored[MIGRATION_KEY] >= MIGRATION_VERSION) {
    // A trace left behind because only its own removal failed after the version was recorded.
    if (stored[ERROR_KEY] !== undefined) await attempt(() => api.storage.local.remove(ERROR_KEY));
    return false;
  }
  let step = 'start';
  try {
    if (api.alarms?.clear) await attempt(() => api.alarms.clear(ALARM));
    if (api.notifications?.getAll && api.notifications.clear) await attempt(async () => {
      for (const id of Object.keys(await api.notifications.getAll())) if (id.startsWith(NOTICE_PREFIX)) await api.notifications.clear(id);
    });
    await attempt(() => api.action.setBadgeText({ text: '' }));
    await dropGrantedPermissions(api);
    // The PC API key lives in local: delete it first so a later sync failure cannot leave it behind.
    step = 'local';
    // The status cache is shared: only an entry that describes a selfhost server is stale.
    const stale = String(stored.srStatusCache?.identity ?? '').startsWith('cloud:') ? [] : ['srStatusCache'];
    await api.storage.local.remove([...LOCAL_KEYS, ...stale]);
    step = 'sync';
    await api.storage.sync.remove(SYNC_KEYS);
    step = 'record';
    await api.storage.local.set({ [MIGRATION_KEY]: MIGRATION_VERSION });
  } catch (error) {
    await recordFailure(api, step, error, stored[ERROR_KEY]);
    throw error;
  }
  // Done: only the trace is left. Its removal failing must not read as a failed migration; the next start retries it.
  await attempt(() => api.storage.local.remove(ERROR_KEY));
  return true;
}
