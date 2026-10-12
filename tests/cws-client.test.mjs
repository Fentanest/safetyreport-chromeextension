import test from 'node:test';
import assert from 'node:assert/strict';
import {
  uploadUrl, publishUrl, fetchStatusUrl,
  uploadPackage, fetchItemStatus, publishItem, waitForUploadProcessed,
} from '../scripts/cws-client.mjs';
import { CwsApiError } from '../scripts/cws-errors.mjs';

const PUBLISHER_ID = '1234567890123456789012';
const ITEM_ID = 'abcdefghijklmnopabcdefghijklmnop';

test('URL 빌더: 업로드/검토제출/상태확인 엔드포인트가 공식 문서 형식과 일치한다', () => {
  assert.equal(
    uploadUrl(PUBLISHER_ID, ITEM_ID),
    `https://chromewebstore.googleapis.com/upload/v2/publishers/${PUBLISHER_ID}/items/${ITEM_ID}:upload`,
  );
  assert.equal(
    publishUrl(PUBLISHER_ID, ITEM_ID),
    `https://chromewebstore.googleapis.com/v2/publishers/${PUBLISHER_ID}/items/${ITEM_ID}:publish`,
  );
  assert.equal(
    fetchStatusUrl(PUBLISHER_ID, ITEM_ID),
    `https://chromewebstore.googleapis.com/v2/publishers/${PUBLISHER_ID}/items/${ITEM_ID}:fetchStatus`,
  );
});

test('uploadPackage: zip 바이트를 그대로 본문으로, Authorization/Content-Type 헤더와 함께 POST 한다', async () => {
  const calls = [];
  const zipBuffer = Buffer.from('fake-zip-bytes');
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ uploadState: 'SUCCEEDED', crxVersion: '1.2.0' }) };
  };

  const result = await uploadPackage({ accessToken: 'tok', publisherId: PUBLISHER_ID, itemId: ITEM_ID, zipBuffer, fetchImpl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, uploadUrl(PUBLISHER_ID, ITEM_ID));
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/zip');
  assert.equal(calls[0].init.body, zipBuffer);
  assert.deepEqual(result, { uploadState: 'SUCCEEDED', crxVersion: '1.2.0' });
});

test('fetchItemStatus: GET 요청에 Authorization 헤더만 싣는다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ lastAsyncUploadState: 'IN_PROGRESS' }) };
  };
  const result = await fetchItemStatus({ accessToken: 'tok', publisherId: PUBLISHER_ID, itemId: ITEM_ID, fetchImpl });
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(result.lastAsyncUploadState, 'IN_PROGRESS');
});

test('publishItem: 기본값은 빈 JSON 본문({})을 application/json 으로 POST 한다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ state: 'PENDING_REVIEW', itemId: ITEM_ID }) };
  };
  const result = await publishItem({ accessToken: 'tok', publisherId: PUBLISHER_ID, itemId: ITEM_ID, fetchImpl });
  assert.equal(calls[0].url, publishUrl(PUBLISHER_ID, ITEM_ID));
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, '{}');
  assert.equal(result.state, 'PENDING_REVIEW');
});

test('오류 응답(HTTP 4xx/5xx)은 상태코드와 본문을 그대로 담은 CwsApiError 로 전달된다', async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, text: async () => '{"error":{"message":"item is already published"}}' });
  await assert.rejects(
    publishItem({ accessToken: 'tok', publisherId: PUBLISHER_ID, itemId: ITEM_ID, fetchImpl }),
    err => {
      assert.ok(err instanceof CwsApiError);
      assert.equal(err.status, 409);
      assert.match(err.body, /already published/);
      return true;
    },
  );
});

test('waitForUploadProcessed: IN_PROGRESS 가 몇 번 나온 뒤 SUCCEEDED 가 되면 그 상태를 돌려준다', async () => {
  const states = ['IN_PROGRESS', 'IN_PROGRESS', 'SUCCEEDED'];
  let call = 0;
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ lastAsyncUploadState: states[call++] }) });
  const sleeps = [];
  const sleepFn = async ms => { sleeps.push(ms); };

  const result = await waitForUploadProcessed({
    accessToken: 'tok', publisherId: PUBLISHER_ID, itemId: ITEM_ID, fetchImpl, sleepFn, intervalMs: 10, timeoutMs: 10_000,
  });

  assert.equal(call, 3);
  assert.equal(result.lastAsyncUploadState, 'SUCCEEDED');
  assert.deepEqual(sleeps, [10, 10]);
});

test('waitForUploadProcessed: FAILED 이면 바로 CwsApiError 를 던진다(재시도 없음)', async () => {
  let call = 0;
  const fetchImpl = async () => { call++; return { ok: true, status: 200, text: async () => JSON.stringify({ lastAsyncUploadState: 'FAILED' }) }; };
  await assert.rejects(
    waitForUploadProcessed({ accessToken: 'tok', publisherId: PUBLISHER_ID, itemId: ITEM_ID, fetchImpl, sleepFn: async () => {} }),
    CwsApiError,
  );
  assert.equal(call, 1);
});

test('waitForUploadProcessed: 시간 제한을 넘기면 오류를 던진다(말줄임표 폴링 없음)', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ lastAsyncUploadState: 'IN_PROGRESS' }) });
  let fakeNow = 0;
  const nowFn = () => fakeNow;
  const sleepFn = async () => { fakeNow += 1000; };

  await assert.rejects(
    waitForUploadProcessed({
      accessToken: 'tok', publisherId: PUBLISHER_ID, itemId: ITEM_ID, fetchImpl, sleepFn, nowFn, timeoutMs: 3000, intervalMs: 1000,
    }),
    err => {
      assert.ok(err instanceof CwsApiError);
      assert.match(err.message, /시간 제한/);
      return true;
    },
  );
});
