import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { createJwtAssertion, getAccessToken, CWS_OAUTH_SCOPE, GOOGLE_TOKEN_URI } from '../scripts/cws-auth.mjs';
import { CwsApiError } from '../scripts/cws-errors.mjs';

// 가짜(시험용) RSA 키 — 실제 서비스 계정 키가 아니다.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const FAKE_SERVICE_ACCOUNT = {
  type: 'service_account',
  client_email: 'cws-publisher@fake-project.iam.gserviceaccount.com',
  private_key: privateKey,
};

function decodeBase64url(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

test('createJwtAssertion: RS256 헤더·필수 claim·유효한 서명을 만든다', () => {
  const now = 1_700_000_000;
  const { jwt, header, payload } = createJwtAssertion(FAKE_SERVICE_ACCOUNT, { now });

  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(payload.iss, FAKE_SERVICE_ACCOUNT.client_email);
  assert.equal(payload.scope, CWS_OAUTH_SCOPE);
  assert.equal(payload.aud, GOOGLE_TOKEN_URI);
  assert.equal(payload.iat, now);
  assert.equal(payload.exp, now + 3600);

  const [headerSeg, payloadSeg, sigSeg] = jwt.split('.');
  assert.deepEqual(decodeBase64url(headerSeg), header);
  assert.deepEqual(decodeBase64url(payloadSeg), payload);

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerSeg}.${payloadSeg}`);
  verifier.end();
  const signature = Buffer.from(sigSeg, 'base64url');
  assert.ok(verifier.verify(publicKey, signature), '서명이 공개키로 검증되어야 함');
});

test('createJwtAssertion: client_email/private_key 가 없으면 바로 실패한다', () => {
  assert.throws(() => createJwtAssertion({}), /client_email\/private_key/);
});

test('getAccessToken: 토큰 엔드포인트에 grant_type/assertion 을 폼으로 보내고 access_token 을 돌려준다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'fake-access-token-value', expires_in: 3600, token_type: 'Bearer' }),
    };
  };

  const token = await getAccessToken(FAKE_SERVICE_ACCOUNT, { fetchImpl });
  assert.equal(token, 'fake-access-token-value');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GOOGLE_TOKEN_URI);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const params = new URLSearchParams(calls[0].init.body);
  assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.ok(params.get('assertion').split('.').length === 3, 'assertion 은 JWT 형식(점 2개)이어야 함');
});

test('getAccessToken: 토큰 엔드포인트가 실패 응답을 주면 상태코드·본문을 그대로 담은 CwsApiError 를 던진다', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    text: async () => '{"error":"invalid_grant","error_description":"Invalid JWT"}',
  });

  await assert.rejects(
    getAccessToken(FAKE_SERVICE_ACCOUNT, { fetchImpl }),
    err => {
      assert.ok(err instanceof CwsApiError);
      assert.equal(err.status, 400);
      assert.match(err.body, /invalid_grant/);
      return true;
    },
  );
});

test('getAccessToken: 응답에 access_token 이 없으면 실패한다', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ expires_in: 3600 }) });
  await assert.rejects(getAccessToken(FAKE_SERVICE_ACCOUNT, { fetchImpl }), CwsApiError);
});
