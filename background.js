'use strict';

const ALARM_NAME = 'safetyreport_poll';

// --- 설정 로드 ---

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['serverUrl', 'apiKey', 'notifyCrawlDone', 'pollInterval'], resolve);
  });
}

// --- API 요청 ---

async function apiFetch(serverUrl, apiKey, path, options = {}) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- 배지 업데이트 ---

async function updateBadge(serverUrl, apiKey) {
  try {
    const res = await apiFetch(serverUrl, apiKey, '/api/v1/summary');
    const count = res.data?.processing_count ?? 0;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

// --- 크롤링 완료 알림 ---

// 이전에 크롤링이 실행 중이었는지 추적
let wasCrawling = false;

async function pollCrawlStatus() {
  const { serverUrl, apiKey, notifyCrawlDone } = await getConfig();
  if (!serverUrl || !apiKey) return;

  try {
    // 현재 크롤링 상태 확인
    const statusRes = await apiFetch(serverUrl, apiKey, '/api/v1/crawl/status');
    const isRunning = statusRes.running ?? false;

    // 실행 중 → 완료 전환 감지
    if (wasCrawling && !isRunning) {
      // crawl/done으로 변경 건수 확인
      try {
        const doneRes = await apiFetch(serverUrl, apiKey, '/api/v1/crawl/done');
        if (doneRes.done && notifyCrawlDone !== false) {
          const changed = doneRes.changed_count ?? 0;
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: '크롤링 완료',
            message: changed > 0
              ? `${changed}건의 신고가 업데이트되었습니다.`
              : '크롤링이 완료되었습니다.',
            priority: 1,
          });
        }
      } catch {
        // done 엔드포인트 실패는 무시
      }
    }

    wasCrawling = isRunning;

    // 배지 업데이트
    await updateBadge(serverUrl, apiKey);
  } catch {
    // 연결 실패 시 배지 초기화
    chrome.action.setBadgeText({ text: '' });
  }
}

// --- 알람 설정 ---

async function resetAlarm() {
  const { pollInterval } = await getConfig();
  const minutes = Math.max(1, parseInt(pollInterval, 10) || 5);

  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
}

// --- 이벤트 핸들러 ---

chrome.runtime.onInstalled.addListener(() => {
  resetAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  resetAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollCrawlStatus();
  }
});

// 팝업/옵션에서 알람 재설정 요청
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RESET_ALARM') {
    resetAlarm();
  }
});
