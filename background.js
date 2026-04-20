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
    const count = res.data?.processingCount ?? 0;  // camelCase
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
// wasCrawling을 storage.local에 저장 — service worker 재시작 시에도 유지

async function getWasCrawling() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['wasCrawling'], (d) => resolve(d.wasCrawling || false));
  });
}

async function setWasCrawling(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ wasCrawling: value }, resolve);
  });
}

async function pollCrawlStatus() {
  const { serverUrl, apiKey, notifyCrawlDone } = await getConfig();
  if (!serverUrl || !apiKey) return;

  try {
    const [statusRes, wasCrawling] = await Promise.all([
      apiFetch(serverUrl, apiKey, '/api/v1/crawl/status'),
      getWasCrawling(),
    ]);
    const isRunning = statusRes.running ?? false;

    // 실행 중 → 완료 전환 감지
    if (wasCrawling && !isRunning && notifyCrawlDone !== false) {
      let changed = 0;
      let changes = [];
      try {
        const doneRes = await apiFetch(serverUrl, apiKey, '/api/v1/crawl/done/ext');
        if (doneRes.done) {
          changed = doneRes.changed_count ?? 0;
          changes = doneRes.changes ?? [];
        }
      } catch {
        // 엔드포인트 실패 시 무시
      }

      let message;
      if (changes.length === 0) {
        message = changed > 0 ? `${changed}건이 업데이트되었습니다.` : '크롤링이 완료되었습니다.';
      } else {
        const MAX = 3;
        const lines = changes.slice(0, MAX).map((c) => {
          const num = c.신고번호 ? `[${c.신고번호}]` : '';
          const name = c.신고명 || '(제목 없음)';
          return `${num} ${name}`.trim();
        });
        if (changes.length > MAX) lines.push(`외 ${changes.length - MAX}건`);
        message = lines.join('\n');
      }

      chrome.notifications.create(`crawl_done_${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: `크롤링 완료${changed > 0 ? ` (${changed}건)` : ''}`,
        message,
        priority: 1,
      });
    }

    await setWasCrawling(isRunning);
    await updateBadge(serverUrl, apiKey);
  } catch {
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

// 메시지 핸들러 (팝업/옵션/콘텐츠 스크립트)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'RESET_ALARM') {
    resetAlarm();
    return false;
  }

  // 콘텐츠 스크립트 대신 fetch (HTTPS 페이지 → HTTP 서버 Mixed Content 우회)
  if (msg.type === 'FETCH_VEHICLE') {
    getConfig().then(async ({ serverUrl, apiKey }) => {
      if (!serverUrl || !apiKey) {
        sendResponse({ error: 'NO_CONFIG' });
        return;
      }
      const base = serverUrl.replace(/\/$/, '');
      const url = `${base}/api/v1/vehicle/${encodeURIComponent(msg.vehicleNumber)}`;
      const headers = { 'X-API-Key': apiKey };

      const tryFetch = () => fetch(url, { headers })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        });

      try {
        const data = await tryFetch();
        sendResponse({ data });
      } catch (err) {
        // 5xx 오류는 1회 재시도
        if (/HTTP 5\d\d/.test(err.message)) {
          try {
            await new Promise((r) => setTimeout(r, 1000));
            const data = await tryFetch();
            sendResponse({ data });
          } catch (err2) {
            sendResponse({ error: err2.message });
          }
        } else {
          sendResponse({ error: err.message });
        }
      }
    });
    return true;
  }

  return false;
});
