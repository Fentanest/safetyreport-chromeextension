import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { worker, session, authKey, SUPA } from './worker-harness.mjs';

const PC = 'http://192.168.0.10:6819/*';
const PC_ORIGINS = [PC, 'https://pc.example/*'];
const config = { serverUrl: 'http://192.168.0.10:6819', apiKey: 'private-server-key', notifyCrawlDone: true, pollInterval: 5 };
// What 1.2.6 left in storage, per user situation. `theme` and the unrelated key must survive every case.
const survivors = { local: { other: { keep: true } }, sync: { theme: 'dark' } };
const selfhostLocal = { backendMode: 'selfhost', backendMigration: 1, selfhost: config, srCrawlState: { identity: 'x', running: true, processingCount: 4 },
  selfhostBlocked: 'CLIENT_PROTOCOL_UNSUPPORTED', wasCrawling: true, serverUrl: config.serverUrl, apiKey: config.apiKey,
  notifyCrawlDone: true, pollInterval: 5, srStatusCache: { identity: 'selfhost:abc', at: 1, result: { connected: true, version: '3.0.0' } } };
const scenarios = {
  'selfhost only': { local: selfhostLocal, signedIn: false },
  'mixed, selfhost mode': { local: { ...selfhostLocal, [authKey]: session('a') }, signedIn: true },
  'mixed, cloud mode': { local: { ...selfhostLocal, backendMode: 'cloud', [authKey]: session('a') }, signedIn: true },
  'cloud only': { local: { backendMode: 'cloud', backendMigration: 1, selfhost: { serverUrl: '', apiKey: '', notifyCrawlDone: true, pollInterval: 5 },
    [authKey]: session('a') }, signedIn: true },
  'logged out': { local: { backendMode: 'cloud', backendMigration: 1 }, signedIn: false },
};
const legacyKeys = ['backendMode', 'backendMigration', 'selfhost', 'srCrawlState', 'selfhostBlocked', 'wasCrawling', 'serverUrl', 'apiKey', 'notifyCrawlDone', 'pollInterval'];

for (const [name, scenario] of Object.entries(scenarios)) {
  test(`migration from 1.2.6 (${name}): no PC request, PC leftovers gone, cloud kept, only the selfhost keys removed`, async () => {
    const app = await worker({ local: { ...scenario.local, ...survivors.local }, sync: { ...survivors.sync, ...config, backendMode: 'selfhost' },
      legacy: true, seedAlarms: ['safetyreport_poll'], seedNotices: ['sr-crawl-done-1', 'foreign-notice'], granted: { origins: PC_ORIGINS, permissions: ['notifications'] },
      fetchImpl: async url => { throw new Error('unexpected request ' + url); } });
    const state = await app.send({ type: 'STATUS' });
    assert.equal(state.signedIn, scenario.signedIn);
    assert.equal(app.calls.filter(call => call.url).length, 0, 'zero network requests, PC or otherwise, while updating');
    assert.equal(app.alarms.size, 0);
    assert.deepEqual([...app.notices.keys()], ['foreign-notice'], 'only the crawl notifications are cleared');
    assert.deepEqual(app.grants, { origins: [], permissions: [] });
    for (const removed of app.removedPermissions) assert.ok(![`${SUPA}/*`, 'https://www.safetyreport.go.kr/*'].some(o => removed.origins?.includes(o)));
    for (const key of legacyKeys) assert.equal(app.stores.local[key], undefined, `local.${key}`);
    for (const key of ['serverUrl', 'apiKey', 'backendMode', 'notifyCrawlDone', 'pollInterval', 'selfhost']) assert.equal(app.stores.sync[key], undefined, `sync.${key}`);
    assert.equal(app.stores.local.srStatusCache?.identity?.startsWith('selfhost:') ?? false, false);
    assert.deepEqual(app.stores.local.other, { keep: true });
    assert.equal(app.stores.sync.theme, 'dark');
    if (scenario.local[authKey]) assert.deepEqual(app.stores.local[authKey], scenario.local[authKey], 'the cloud session is untouched');
    assert.equal(app.stores.local.srMigration, 1);
    assert.equal(app.calls.some(call => call.cleared), false, 'storage.clear() is never used');
    assert.equal(app.badges.at(-1), '');
  });
}
test('migration: running again changes nothing, and the cloud STATUS cache from 1.2.6 stays usable', async () => {
  const cache = { identity: 'cloud:a', at: Date.now(), result: { connected: true, signedIn: true, error: null, name: '테스트 계정' } };
  const app = await worker({ local: { ...selfhostLocal, [authKey]: session('a'), srStatusCache: cache }, sync: config, legacy: true, granted: { origins: PC_ORIGINS, permissions: [] } });
  assert.deepEqual(app.stores.local.srStatusCache, cache);
  const again = await worker({ local: app.stores.local, sync: app.stores.sync, legacy: true });
  assert.deepEqual(again.stores.local, app.stores.local);
  assert.equal(again.removedPermissions.length, 0, 'the recorded version skips every step');
  assert.equal((await again.send({ type: 'STATUS' })).signedIn, true);
  assert.equal(again.calls.filter(call => call.auth === 'getSession').length, 0, 'the cached STATUS needs no session read');
});
test('migration: without the alarms/notifications APIs (permissions removed) cloud still initializes', async () => {
  const app = await worker({ local: { ...selfhostLocal, [authKey]: session('a') }, sync: config, legacy: false, granted: { origins: PC_ORIGINS, permissions: ['notifications'] } });
  assert.equal(app.chrome.alarms, undefined); assert.equal(app.chrome.notifications, undefined);
  assert.equal(app.stores.local.srMigration, 1);
  assert.equal((await app.send({ type: 'STATUS' })).signedIn, true);
  assert.equal(app.stores.local.selfhost, undefined);
});
test('migration: a failing permission cleanup does not block cloud and the rest still finishes', async () => {
  const app = await worker({ local: { ...selfhostLocal, [authKey]: session('a') }, sync: config, legacy: true, seedAlarms: ['safetyreport_poll'],
    granted: { origins: PC_ORIGINS, permissions: ['notifications'] }, failPermissionRemove: true });
  assert.equal((await app.send({ type: 'STATUS' })).signedIn, true);
  assert.equal(app.alarms.size, 0); assert.equal(app.stores.local.selfhost, undefined); assert.equal(app.stores.sync.apiKey, undefined);
  assert.equal(app.stores.local.srMigration, 1);
});
for (const area of ['sync', 'local']) {
  test(`migration: interrupted by a ${area} storage failure leaves no version and resumes on the next worker start`, async () => {
    let broken = true;
    const kept = session('a');
    const first = await worker({ local: { ...selfhostLocal, [authKey]: kept, ...survivors.local }, sync: { ...config, ...survivors.sync }, legacy: true,
      seedAlarms: ['safetyreport_poll'], granted: { origins: PC_ORIGINS, permissions: [] },
      failStorageRemove: (where, keys) => broken && where === area && Array.isArray(keys) && keys.includes(area === 'sync' ? 'apiKey' : 'selfhost') });
    assert.equal(first.stores.local.srMigration, undefined, 'not recorded until the last step');
    const trace = first.stores.local.srMigrationError;
    assert.equal(trace.step, area); assert.equal(trace.attempts, 1); assert.equal(trace.code, 'Error');
    assert.doesNotMatch(JSON.stringify(trace), /private|storage failure/, 'no message or secret in the trace');
    if (area === 'sync') for (const key of ['selfhost', 'apiKey', 'serverUrl']) assert.equal(first.stores.local[key], undefined, 'PC secrets in local go before sync is touched');
    assert.equal((await first.send({ type: 'STATUS' })).signedIn, true, 'cloud starts even though the migration did not finish');
    broken = false;
    const second = await worker({ local: first.stores.local, sync: first.stores.sync, legacy: true });
    assert.equal(second.stores.local.srMigration, 1); assert.equal(second.stores.local.srMigrationError, undefined, 'the trace is cleared on success');
    for (const key of legacyKeys) assert.equal(second.stores.local[key], undefined, key);
    assert.equal(second.stores.sync.apiKey, undefined); assert.equal(second.stores.sync.theme, 'dark');
    assert.deepEqual(second.stores.local[authKey], kept); assert.deepEqual(second.stores.local.other, { keep: true });
  });
}
test('migration: a newer recorded version is left alone', async () => {
  const app = await worker({ local: { srMigration: 2, selfhost: config }, legacy: true });
  assert.equal(app.stores.local.srMigration, 2); assert.deepEqual(app.stores.local.selfhost, config);
});
test('1.3.0 code has no PC alarm listener, polling, notification or selfhost network path', () => {
  const sources = readdirSync('src').map(name => [name, readFileSync(`src/${name}`, 'utf8')]);
  assert.deepEqual(sources.map(([name]) => name).sort(), ['background.js', 'migration.js', 'myReportsClient.js']);
  const background = sources.find(([name]) => name === 'background.js')[1];
  for (const pattern of [/alarms/, /notifications\./, /onAlarm/, /X-API-Key/i, /X-SR-/i, /\/crawl\//, /permissions\.request/, /serverUrl/, /apiKey/])
    assert.doesNotMatch(background, pattern, String(pattern));
  for (const file of ['options.html', 'options.js', 'popup.html', 'popup.js', 'shared-ui.js'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), /serverUrl|apiKey|backendMode|pollInterval|crawlStart|SAVE_SERVER|TEST_SERVER|CRAWL_|SET_MODE/, file);
  assert.equal(existsSync('contracts/selfhost-compat'), false);
});
test('options explains that PC-only reports must come from the mobile app', () => {
  const html = readFileSync('options.html', 'utf8');
  assert.match(html, /PC에만 있던 신고는 모바일 앱에서 가져와/);
  assert.doesNotMatch(html, /type="password"|id="serverUrl"|id="apiKey"|id="backendMode"|<input/);
});
test('source manifest: only the minimal permissions remain', () => {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage', 'identity', 'clipboardWrite']);
  for (const key of ['optional_permissions', 'optional_host_permissions', 'host_permissions']) assert.equal(manifest[key], undefined, key);
});
test('migration: repeated failures increase the attempt count in the trace', async () => {
  let broken = true;
  const opts = { local: { selfhost: config }, sync: config, failStorageRemove: (where, keys) => broken && where === 'sync' && Array.isArray(keys) };
  const first = await worker(opts);
  const second = await worker({ ...opts, local: first.stores.local, sync: first.stores.sync });
  assert.equal(second.stores.local.srMigrationError.attempts, 2);
  assert.equal(second.stores.local.srMigrationError.step, 'sync');
});
