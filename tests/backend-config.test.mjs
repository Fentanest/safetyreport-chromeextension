import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSettings, serverOrigin, validateSettings } from '../src/backendConfig.js';
const session = { 'sb-test-auth-token': JSON.stringify({ user: { id: 'user-a' }, refresh_token: 'private' }) };
test('migration: new, legacy selfhost, existing cloud, ambiguous, explicit choice, worker/browser restart', () => {
  assert.equal(migrateSettings({}, {}).backendMode, null);
  const old = { serverUrl: 'http://192.168.1.1:6819', apiKey: 'legacy-key', notifyCrawlDone: false, pollInterval: 7 };
  const legacy = migrateSettings({}, old);
  assert.equal(legacy.backendMode, 'selfhost');assert.deepEqual(legacy.selfhost, old);
  assert.equal(migrateSettings(session, {}).backendMode, 'cloud');
  assert.equal(migrateSettings(session, old).backendMode, null);
  for (const mode of ['selfhost','cloud']) {
    const result = migrateSettings({ ...session, backendMode: mode }, old);
    assert.equal(result.backendMode, mode);
    assert.deepEqual(migrateSettings(result, {}), result);
    assert.equal(migrateSettings({ ...session, ...result }, { backendMode: mode === 'cloud' ? 'selfhost' : 'cloud' }).backendMode, mode);
  }
  const ambiguous = migrateSettings(session, old);
  assert.equal(migrateSettings(ambiguous, {}).backendMode, null);
  assert.equal(migrateSettings({}, { ...old, backendMode: 'cloud' }).backendMode, 'cloud');
});
test('selfhost URL is an HTTP origin, supports LAN/localhost/IPv6, rejects request proxy input', () => {
  for (const address of ['http://localhost:6819','http://127.0.0.1:6819/','http://192.168.1.2:6819','http://[::1]:6819','https://server.example']) {
    assert.equal(serverOrigin(address), new URL(address).origin);
  }
  for (const address of ['file:///tmp','https://a@server.example','https://server.example/api/other','http://a/#token','http://a/?url=http://evil','javascript:alert(1)']) assert.throws(() => serverOrigin(address), /INVALID_SERVER_URL/);
  assert.throws(() => validateSettings({ serverUrl: 'http://localhost', apiKey: 'bad\nkey' }), /INVALID_API_KEY/);
});
