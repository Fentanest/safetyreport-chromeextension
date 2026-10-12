#!/usr/bin/env node
// Chrome Web Store 업로드 + 검토 제출 CLI. cws-publish.yml(main 브랜치 전용) job 에서만 쓴다.
// 사용법: node scripts/cws-publish.mjs <zip 경로>
// 필요한 환경변수: CWS_SERVICE_ACCOUNT_JSON(비밀 서비스 계정 JSON 원문), CWS_PUBLISHER_ID, CWS_EXTENSION_ID
import { readFile } from 'node:fs/promises';
import { getAccessToken } from './cws-auth.mjs';
import { uploadPackage, waitForUploadProcessed, publishItem } from './cws-client.mjs';
import { CwsApiError } from './cws-errors.mjs';

export async function run({
  zipPath,
  publisherId = process.env.CWS_PUBLISHER_ID,
  itemId = process.env.CWS_EXTENSION_ID,
  serviceAccountJson = process.env.CWS_SERVICE_ACCOUNT_JSON,
  log = console.log,
  errorLog = console.error,
  readFileImpl = readFile,
  waitOptions = {},
} = {}) {
  if (!zipPath) throw new Error('사용법: node scripts/cws-publish.mjs <zip 경로>');
  if (!publisherId || !itemId || !serviceAccountJson) {
    throw new Error('CWS_PUBLISHER_ID, CWS_EXTENSION_ID, CWS_SERVICE_ACCOUNT_JSON 이 모두 필요합니다.');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('CWS_SERVICE_ACCOUNT_JSON 이 올바른 JSON 이 아닙니다.');
  }

  const accessToken = await getAccessToken(serviceAccount);
  // GitHub Actions 로그에서 토큰을 가린다(실제 오류 본문에 토큰이 섞여 있어도 이후부터는 마스킹된다).
  log(`::add-mask::${accessToken}`);

  const zipBuffer = await readFileImpl(zipPath);
  log(`Chrome Web Store 업로드 시작: ${zipPath} (${zipBuffer.length} bytes) → publishers/${publisherId}/items/${itemId}`);
  const uploadResult = await uploadPackage({ accessToken, publisherId, itemId, zipBuffer });
  log(`업로드 응답: ${JSON.stringify(uploadResult)}`);

  if (uploadResult.uploadState === 'FAILED') {
    throw new CwsApiError('Chrome Web Store 업로드가 실패했습니다.', 200, JSON.stringify(uploadResult));
  }
  if (uploadResult.uploadState !== 'SUCCEEDED') {
    log('업로드 처리 완료를 기다립니다 (fetchStatus 폴링)...');
    const status = await waitForUploadProcessed({ accessToken, publisherId, itemId, ...waitOptions });
    log(`업로드 처리 완료: ${JSON.stringify(status)}`);
  }

  log('검토 제출(publish) 요청...');
  const publishResult = await publishItem({ accessToken, publisherId, itemId });
  log(`publish 응답: ${JSON.stringify(publishResult)}`);
  log(`완료: state=${publishResult.state ?? 'UNKNOWN'}`);
  return publishResult;
}

async function main() {
  try {
    await run({ zipPath: process.argv[2] });
  } catch (err) {
    if (err instanceof CwsApiError) {
      console.error(`::error::${err.message}`);
      if (err.body) console.error(err.body);
    } else {
      console.error(`::error::${err.message}`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
