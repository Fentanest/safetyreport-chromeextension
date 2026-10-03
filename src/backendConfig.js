// Pure migration. Secrets are persisted only after TRUSTED_CONTEXTS is enabled.
export const validMode = value => value === 'selfhost' || value === 'cloud';
export function serverOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || !/^\/*$/.test(url.pathname)) throw new Error();
    return url.origin;
  } catch { throw new Error('INVALID_SERVER_URL'); }
}
export function migrateSettings(local, sync) {
  const old = local.selfhost || {};
  const selfhost = {
    serverUrl: old.serverUrl ?? local.serverUrl ?? sync.serverUrl ?? '',
    apiKey: old.apiKey ?? local.apiKey ?? sync.apiKey ?? '',
    notifyCrawlDone: old.notifyCrawlDone ?? local.notifyCrawlDone ?? sync.notifyCrawlDone ?? true,
    pollInterval: old.pollInterval ?? local.pollInterval ?? sync.pollInterval ?? 5,
  };
  const hasServer = Boolean(selfhost.serverUrl || selfhost.apiKey);
  // Inspect persisted sessions without calling Supabase (getSession can refresh).
  const hasCloud = Object.entries(local).some(([key, value]) => {
    if (!/^sb-.+-auth-token$/.test(key)) return false;
    try { const session = typeof value === 'string' ? JSON.parse(value) : value;
      return Boolean(session?.user?.id && session?.refresh_token); } catch { return false; }
  });
  const explicit = validMode(local.backendMode) ? local.backendMode : validMode(sync.backendMode) ? sync.backendMode : null;
  // An explicit null from this migration means keep waiting for the user's choice.
  const backendMode = explicit || (local.backendMigration === 1 ? null : hasServer === hasCloud ? null : hasServer ? 'selfhost' : 'cloud');
  return { backendMode, selfhost, backendMigration: 1 };
}
export function validateSettings(message) {
  const serverUrl = serverOrigin(message.serverUrl);
  if (typeof message.apiKey !== 'string' || !message.apiKey.trim() || message.apiKey.length > 4096 || /[\r\n]/.test(message.apiKey)) throw new Error('INVALID_API_KEY');
  const pollInterval = Number(message.pollInterval ?? 5);
  if (!Number.isInteger(pollInterval) || pollInterval < 1 || pollInterval > 1440) throw new Error('INVALID_POLL_INTERVAL');
  return { serverUrl, apiKey: message.apiKey.trim(), notifyCrawlDone: message.notifyCrawlDone !== false, pollInterval };
}
