// 서비스 계정 JSON(secrets.CWS_SERVICE_ACCOUNT_JSON)으로 Chrome Web Store API 액세스 토큰을 받는다.
// 외부 action 을 쓰지 않고 Node 내장 crypto 로 RS256 JWT 를 만들어 Google OAuth2 토큰 엔드포인트와
// 직접 교환한다(https://developer.chrome.com/docs/webstore/service-accounts).
import { createSign } from 'node:crypto';
import { CwsApiError } from './cws-errors.mjs';

export const CWS_OAUTH_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
export const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * 서비스 계정 키(client_email, private_key)로 RS256 서명된 JWT assertion 을 만든다.
 * aud(기본값: Google 토큰 엔드포인트)와 scope, 만료 시각을 그대로 돌려줘 시험에서 검증할 수 있게 한다.
 */
export function createJwtAssertion(serviceAccount, {
  scope = CWS_OAUTH_SCOPE,
  aud = serviceAccount.token_uri || GOOGLE_TOKEN_URI,
  now = Math.floor(Date.now() / 1000),
  lifetimeSeconds = 3600,
} = {}) {
  if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('서비스 계정 JSON 에 client_email/private_key 가 필요합니다.');
  }
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope,
    aud,
    iat: now,
    exp: now + lifetimeSeconds,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).end().sign(serviceAccount.private_key);
  return { jwt: `${signingInput}.${signature.toString('base64url')}`, header, payload };
}

/**
 * JWT assertion 을 https://oauth2.googleapis.com/token 에 교환해 access_token 을 받는다.
 * fetchImpl 을 주입할 수 있어(기본값: 전역 fetch) 실제 네트워크 없이 시험할 수 있다.
 */
export async function getAccessToken(serviceAccount, {
  scope,
  tokenUri,
  fetchImpl = fetch,
  now,
  lifetimeSeconds,
} = {}) {
  const aud = tokenUri || serviceAccount.token_uri || GOOGLE_TOKEN_URI;
  const { jwt } = createJwtAssertion(serviceAccount, { scope, aud, now, lifetimeSeconds });
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const res = await fetchImpl(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new CwsApiError(`Google OAuth2 토큰 발급 실패 (HTTP ${res.status})`, res.status, text);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CwsApiError('토큰 응답을 JSON 으로 해석할 수 없습니다.', res.status, text);
  }
  if (!data.access_token) {
    throw new CwsApiError('토큰 응답에 access_token 이 없습니다.', res.status, text);
  }
  return data.access_token;
}
