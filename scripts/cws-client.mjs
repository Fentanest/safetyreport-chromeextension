// Chrome Web Store API v2 호출(업로드/상태 확인/검토 제출). 공식 문서:
// https://developer.chrome.com/docs/webstore/using-api , https://developer.chrome.com/docs/webstore/api/reference/rest
import { CwsApiError } from './cws-errors.mjs';

const BASE_URL = 'https://chromewebstore.googleapis.com';

function itemPath(publisherId, itemId) {
  return `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}`;
}

export function uploadUrl(publisherId, itemId) {
  return `${BASE_URL}/upload/v2/${itemPath(publisherId, itemId)}:upload`;
}

export function publishUrl(publisherId, itemId) {
  return `${BASE_URL}/v2/${itemPath(publisherId, itemId)}:publish`;
}

export function fetchStatusUrl(publisherId, itemId) {
  return `${BASE_URL}/v2/${itemPath(publisherId, itemId)}:fetchStatus`;
}

async function callApi(fetchImpl, url, { method = 'GET', accessToken, body, headers = {} }) {
  const res = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...headers },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    // 오류 응답 본문은 그대로 전달한다(토큰은 Authorization 요청 헤더에만 있고 응답 본문에는 없음).
    throw new CwsApiError(`Chrome Web Store API 오류 (HTTP ${res.status}) ${method} ${url}`, res.status, text);
  }
  return text ? JSON.parse(text) : {};
}

/** zip 바이트를 그대로 본문으로 올린다(POST https://.../upload/v2/.../items/{id}:upload). */
export function uploadPackage({ accessToken, publisherId, itemId, zipBuffer, fetchImpl = fetch }) {
  return callApi(fetchImpl, uploadUrl(publisherId, itemId), {
    method: 'POST',
    accessToken,
    body: zipBuffer,
    headers: { 'Content-Type': 'application/zip' },
  });
}

/** GET .../items/{id}:fetchStatus — 업로드 처리 상태(lastAsyncUploadState)와 제출/게시 상태를 돌려준다. */
export function fetchItemStatus({ accessToken, publisherId, itemId, fetchImpl = fetch }) {
  return callApi(fetchImpl, fetchStatusUrl(publisherId, itemId), { method: 'GET', accessToken });
}

/**
 * POST .../items/{id}:publish — 검토 제출. requestBody 를 비워두면(기본값) `publishType` 기본값인
 * DEFAULT_PUBLISH 로 동작한다(검토 승인되면 자동 게시). skipReview 등은 이 스크립트가 임의로 켜지 않는다.
 */
export function publishItem({ accessToken, publisherId, itemId, fetchImpl = fetch, requestBody = {} }) {
  return callApi(fetchImpl, publishUrl(publisherId, itemId), {
    method: 'POST',
    accessToken,
    body: JSON.stringify(requestBody),
    headers: { 'Content-Type': 'application/json' },
  });
}

const DEFAULT_IN_PROGRESS_STATES = new Set(['IN_PROGRESS', 'UPLOAD_STATE_UNSPECIFIED', 'NOT_FOUND', undefined]);

/**
 * 업로드가 끝날 때까지 fetchStatus 를 시간 제한 안에서 폴링한다.
 * lastAsyncUploadState 가 SUCCEEDED 면 그 응답을 돌려주고, FAILED 면 바로 오류를 던진다.
 * 그 외 상태(IN_PROGRESS 등)는 timeoutMs 까지 intervalMs 간격으로 계속 확인하고, 시간을 넘기면 오류를 던진다.
 */
export async function waitForUploadProcessed({
  accessToken,
  publisherId,
  itemId,
  fetchImpl = fetch,
  timeoutMs = 5 * 60_000,
  intervalMs = 5_000,
  sleepFn = ms => new Promise(resolve => setTimeout(resolve, ms)),
  nowFn = Date.now,
}) {
  const deadline = nowFn() + timeoutMs;
  for (;;) {
    const status = await fetchItemStatus({ accessToken, publisherId, itemId, fetchImpl });
    const state = status.lastAsyncUploadState;
    if (state === 'SUCCEEDED') return status;
    if (state === 'FAILED') {
      throw new CwsApiError('Chrome Web Store 업로드 처리가 실패했습니다(lastAsyncUploadState=FAILED).', 200, JSON.stringify(status));
    }
    if (nowFn() >= deadline) {
      throw new CwsApiError(
        `Chrome Web Store 업로드 처리 확인이 시간 제한을 넘었습니다(lastAsyncUploadState=${state ?? 'UNKNOWN'}).`,
        0,
        JSON.stringify(status),
      );
    }
    if (!DEFAULT_IN_PROGRESS_STATES.has(state)) {
      // 알 수 없는 새 상태값 — 조용히 무한 polling 하지 않고 그대로 보고한다.
      throw new CwsApiError(`알 수 없는 lastAsyncUploadState 값: ${state}`, 0, JSON.stringify(status));
    }
    await sleepFn(intervalMs);
  }
}
