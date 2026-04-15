'use strict';

function el(id) { return document.getElementById(id); }

// 저장된 설정 로드
chrome.storage.sync.get(
  ['serverUrl', 'apiKey', 'notifyCrawlDone', 'pollInterval'],
  (data) => {
    if (data.serverUrl) el('serverUrl').value = data.serverUrl;
    if (data.apiKey) el('apiKey').value = data.apiKey;
    el('notifyCrawlDone').checked = data.notifyCrawlDone !== false;
    el('pollInterval').value = data.pollInterval ?? 5;
  }
);

// 저장
el('btnSave').addEventListener('click', () => {
  const serverUrl = el('serverUrl').value.trim();
  const apiKey = el('apiKey').value.trim();
  const notifyCrawlDone = el('notifyCrawlDone').checked;
  const pollInterval = Math.max(1, parseInt(el('pollInterval').value, 10) || 5);
  const saveMsg = el('saveMsg');
  const errMsg = el('errMsg');

  saveMsg.textContent = '';
  errMsg.textContent = '';

  if (!serverUrl) {
    errMsg.textContent = '서버 주소를 입력해 주세요.';
    return;
  }
  if (!apiKey) {
    errMsg.textContent = 'API 키를 입력해 주세요.';
    return;
  }

  let origin;
  try {
    origin = new URL(serverUrl).origin + '/*';
  } catch {
    errMsg.textContent = '유효하지 않은 서버 주소입니다.';
    return;
  }

  // 권한 요청은 반드시 사용자 제스처 핸들러에서 직접(동기적으로) 호출해야 함.
  // 콜백 내부에서 호출하면 사용자 제스처 컨텍스트가 만료되어 조용히 실패함.
  chrome.permissions.request({ origins: [origin] }, (granted) => {
    if (!granted) {
      errMsg.textContent = '서버 접근 권한이 허용되지 않았습니다. 설정이 저장되지 않았습니다.';
      return;
    }
    chrome.storage.sync.set(
      { serverUrl, apiKey, notifyCrawlDone, pollInterval },
      () => {
        saveMsg.textContent = '저장되었습니다.';
        chrome.runtime.sendMessage({ type: 'RESET_ALARM', pollInterval });
        setTimeout(() => { saveMsg.textContent = ''; }, 2500);
      }
    );
  });
});

// 연결 테스트
el('btnTest').addEventListener('click', async () => {
  const serverUrl = el('serverUrl').value.trim().replace(/\/$/, '');
  const apiKey = el('apiKey').value.trim();
  const resultEl = el('testResult');

  resultEl.textContent = '테스트 중...';
  resultEl.className = 'test-result';

  if (!serverUrl || !apiKey) {
    resultEl.textContent = '주소와 API 키를 먼저 입력하세요.';
    resultEl.classList.add('test-fail');
    return;
  }

  try {
    const res = await fetch(`${serverUrl}/api/v1/crawl/status`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (res.ok) {
      resultEl.textContent = '연결 성공!';
      resultEl.classList.add('test-ok');
    } else {
      resultEl.textContent = `실패 (HTTP ${res.status})`;
      resultEl.classList.add('test-fail');
    }
  } catch (err) {
    resultEl.textContent = `연결 실패: ${err.message}`;
    resultEl.classList.add('test-fail');
  }
});
