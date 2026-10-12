import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { run } from '../scripts/cws-publish.mjs';
import { CwsApiError } from '../scripts/cws-errors.mjs';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const FAKE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'cws-publisher@fake-project.iam.gserviceaccount.com',
  private_key: privateKey,
});

function installFakeFetch(handlers) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') return handlers.token(url, init);
    if (url.includes(':upload')) return handlers.upload(url, init);
    if (url.includes(':fetchStatus')) return handlers.fetchStatus(url, init);
    if (url.includes(':publish')) return handlers.publish(url, init);
    throw new Error(`예상치 못한 URL: ${url}`);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

test('run(): 업로드가 바로 SUCCEEDED 면 폴링 없이 publish 까지 끝까지 간다', async () => {
  const { calls, restore } = installFakeFetch({
    token: () => jsonRes(200, { access_token: 'fake-token-xyz', expires_in: 3600 }),
    upload: () => jsonRes(200, { uploadState: 'SUCCEEDED', crxVersion: '1.2.0' }),
    fetchStatus: () => { throw new Error('SUCCEEDED 응답이면 폴링하면 안 됨'); },
    publish: () => jsonRes(200, { state: 'PENDING_REVIEW', itemId: 'item-1' }),
  });
  const logs = [];
  try {
    const result = await run({
      zipPath: 'artifacts/fake.zip',
      publisherId: 'pub-1',
      itemId: 'item-1',
      serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON,
      log: m => logs.push(m),
      readFileImpl: async () => Buffer.from('zip-bytes'),
    });
    assert.equal(result.state, 'PENDING_REVIEW');
    assert.ok(logs.some(l => l === '::add-mask::fake-token-xyz'), '토큰을 add-mask 로 가려야 함');
    assert.ok(logs.some(l => l.includes('완료: state=PENDING_REVIEW')));
    const urls = calls.map(c => c.url);
    assert.ok(urls.some(u => u === 'https://oauth2.googleapis.com/token'));
    assert.ok(urls.some(u => u.includes(':upload')));
    assert.ok(urls.some(u => u.includes(':publish')));
    assert.ok(!urls.some(u => u.includes(':fetchStatus')), 'SUCCEEDED 면 fetchStatus 를 부르면 안 됨');
  } finally {
    restore();
  }
});

test('run(): 업로드가 IN_PROGRESS 면 fetchStatus 로 완료를 기다린 뒤 publish 한다', async () => {
  let statusCalls = 0;
  const { restore } = installFakeFetch({
    token: () => jsonRes(200, { access_token: 'fake-token-2', expires_in: 3600 }),
    upload: () => jsonRes(200, { uploadState: 'IN_PROGRESS' }),
    fetchStatus: () => {
      statusCalls++;
      return jsonRes(200, { lastAsyncUploadState: statusCalls < 2 ? 'IN_PROGRESS' : 'SUCCEEDED' });
    },
    publish: () => jsonRes(200, { state: 'PUBLISHED', itemId: 'item-1' }),
  });
  try {
    const result = await run({
      zipPath: 'artifacts/fake.zip',
      publisherId: 'pub-1',
      itemId: 'item-1',
      serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON,
      log: () => {},
      readFileImpl: async () => Buffer.from('zip-bytes'),
      waitOptions: { intervalMs: 1, timeoutMs: 5000 },
    });
    assert.equal(result.state, 'PUBLISHED');
    assert.ok(statusCalls >= 2);
  } finally {
    restore();
  }
});

test('run(): 업로드가 FAILED 면 publish 를 호출하지 않고 CwsApiError 를 던진다', async () => {
  let publishCalled = false;
  const { restore } = installFakeFetch({
    token: () => jsonRes(200, { access_token: 'fake-token-3', expires_in: 3600 }),
    upload: () => jsonRes(200, { uploadState: 'FAILED' }),
    fetchStatus: () => { throw new Error('호출되면 안 됨'); },
    publish: () => { publishCalled = true; return jsonRes(200, { state: 'PUBLISHED' }); },
  });
  try {
    await assert.rejects(
      run({
        zipPath: 'artifacts/fake.zip',
        publisherId: 'pub-1',
        itemId: 'item-1',
        serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON,
        log: () => {},
        readFileImpl: async () => Buffer.from('zip-bytes'),
      }),
      CwsApiError,
    );
    assert.equal(publishCalled, false);
  } finally {
    restore();
  }
});

test('run(): 필수 환경값이 없으면 네트워크를 전혀 부르지 않고 실패한다', async () => {
  const { calls, restore } = installFakeFetch({
    token: () => { throw new Error('호출되면 안 됨'); },
    upload: () => { throw new Error('호출되면 안 됨'); },
    fetchStatus: () => { throw new Error('호출되면 안 됨'); },
    publish: () => { throw new Error('호출되면 안 됨'); },
  });
  try {
    await assert.rejects(run({ zipPath: 'a.zip', publisherId: '', itemId: 'item-1', serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON }), /CWS_PUBLISHER_ID/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test('run(): 서비스 계정 JSON 이 잘못되면 실패한다', async () => {
  await assert.rejects(
    run({ zipPath: 'a.zip', publisherId: 'pub-1', itemId: 'item-1', serviceAccountJson: '{not json' }),
    /JSON/,
  );
});
