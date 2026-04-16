'use strict';

// --- API 헬퍼 ---

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['serverUrl', 'apiKey'], resolve);
  });
}

async function apiFetch(path, options = {}) {
  const { serverUrl, apiKey } = await getConfig();
  if (!serverUrl || !apiKey) throw new Error('NO_CONFIG');

  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// --- DOM 유틸 ---

function el(id) { return document.getElementById(id); }

function setDot(dotEl, state) {
  dotEl.className = 'dot';
  dotEl.classList.add({
    ok: 'dot-ok',
    error: 'dot-error',
    running: 'dot-running',
    unknown: 'dot-unknown',
  }[state] || 'dot-unknown');
}

function stateClass(status) {
  if (!status) return 'state-default';
  if (status === '수용') return 'state-accept';
  if (['불수용', '기타'].includes(status)) return 'state-reject';
  if (status === '일부수용') return 'state-partial';
  if (['처리중', '진행', '진행중'].includes(status)) return 'state-processing';
  return 'state-default';
}

// --- 렌더링 ---

function renderStats(data) {
  el('statTotal').textContent = data.total ?? '-';
  el('statProcessing').textContent = data.processingCount ?? '-';
  el('statAccept').textContent = data.acceptCount ?? '-';
  el('statPartial').textContent = data.partialCount ?? '-';
  el('statReject').textContent = data.rejectCount ?? '-';

  el('tFine').textContent = data.tFineCount ?? '-';
  el('tPenalty').textContent = data.tPenaltyCount ?? '-';
  el('tReject').textContent = data.tRejectCount ?? '-';
  el('tUnconfirmed').textContent = data.tUnconfirmedCount ?? '-';

  const recent = data.recent_answers ?? [];
  el('recentCount').textContent = recent.length;

  const list = el('recentList');
  list.innerHTML = '';

  if (recent.length === 0) {
    list.innerHTML = '<div class="empty-msg">없음</div>';
    return;
  }

  recent.forEach((item) => {
    const fine = item.범칙금_과태료 && item.범칙금_과태료 !== '미확인'
      ? `<span class="recent-fine">${item.범칙금_과태료}</span>` : '';

    const meta = [
      item.신고번호  ? `<span class="recent-meta">#${item.신고번호}</span>`  : '',
      item.차량번호  ? `<span class="recent-meta">🚗 ${item.차량번호}</span>` : '',
      item.담당자    ? `<span class="recent-meta">👤 ${item.담당자}</span>`   : '',
    ].filter(Boolean).join('');

    const div = document.createElement('div');
    div.className = 'recent-item' + (item.ID ? ' recent-item-link' : '');
    div.innerHTML = `
      <div class="recent-row1">
        <span class="recent-name" title="${item.신고명 || ''}">${item.신고명 || '(이름 없음)'}</span>
        <span class="recent-state ${stateClass(item.처리상태)}">${item.처리상태 || '-'}</span>
        ${fine}
      </div>
      ${meta ? `<div class="recent-row2">${meta}</div>` : ''}
    `;
    if (item.ID) {
      div.addEventListener('click', () => {
        chrome.tabs.create({
          url: `https://www.safetyreport.go.kr/#mypage/mysafereport/${item.ID}`,
        });
      });
    }
    list.appendChild(div);
  });

  if (data.last_crawl_time) {
    el('lastCrawl').textContent = `마지막 수집: ${data.last_crawl_time}`;
  }
}

function renderCrawlStatus(running) {
  const dot = el('crawlDot');
  const text = el('crawlText');
  const btnStart = el('btnStartCrawl');
  const btnStop = el('btnStopCrawl');

  if (running) {
    setDot(dot, 'running');
    text.textContent = '실행 중';
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else {
    setDot(dot, 'ok');
    text.textContent = '대기 중';
    btnStart.classList.remove('hidden');
    btnStop.classList.add('hidden');
  }
}

// --- 메인 로드 ---

async function load() {
  const { serverUrl, apiKey } = await getConfig();

  if (!serverUrl || !apiKey) {
    el('noConfig').classList.remove('hidden');
    el('mainContent').classList.add('hidden');
    el('mainFooter').classList.add('hidden');
    setDot(el('connDot'), 'error');
    el('connText').textContent = '미설정';
    return;
  }

  el('noConfig').classList.add('hidden');

  // optional_host_permission 확인 — 스토어 설치 후 권한 미허용 시 fetch 차단됨
  const origin = (() => {
    try { return new URL(serverUrl).origin + '/*'; } catch { return null; }
  })();
  if (origin) {
    const hasPermission = await new Promise(r =>
      chrome.permissions.contains({ origins: [origin] }, r)
    );
    if (!hasPermission) {
      setDot(el('connDot'), 'error');
      el('connText').textContent = '권한 필요';
      el('noPermission').classList.remove('hidden');
      return;
    }
  }

  el('mainContent').classList.remove('hidden');
  el('mainFooter').classList.remove('hidden');

  // 병렬 요청
  try {
    const [summaryRes, crawlRes] = await Promise.all([
      apiFetch('/api/v1/summary'),
      apiFetch('/api/v1/crawl/status'),
    ]);

    setDot(el('connDot'), 'ok');
    el('connText').textContent = '연결됨';

    renderStats(summaryRes.data ?? {});
    renderCrawlStatus(crawlRes.running ?? false);
  } catch (err) {
    setDot(el('connDot'), 'error');
    el('connText').textContent = '연결 실패';
    console.error(err);
  }
}

// --- 크롤링 제어 ---

async function startCrawl() {
  const btn = el('btnStartCrawl');
  btn.disabled = true;
  try {
    await apiFetch('/api/v1/crawl/start', {
      method: 'POST',
      body: JSON.stringify({
        crawl_type: 'api',
        crawl_mode: 'full',
        max_empty_pages: 3,
      }),
    });
    renderCrawlStatus(true);
  } catch (err) {
    alert(`크롤링 시작 실패: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function stopCrawl() {
  const btn = el('btnStopCrawl');
  btn.disabled = true;
  try {
    await apiFetch('/api/v1/crawl/kill', { method: 'POST' });
    renderCrawlStatus(false);
  } catch (err) {
    alert(`크롤링 중지 실패: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// --- 이벤트 바인딩 ---

document.addEventListener('DOMContentLoaded', () => {
  load();

  el('btnRefresh').addEventListener('click', load);

  el('btnOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  el('btnGoOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  el('btnStartCrawl').addEventListener('click', startCrawl);
  el('btnStopCrawl').addEventListener('click', stopCrawl);

  el('btnGrantPermission').addEventListener('click', async () => {
    const { serverUrl } = await getConfig();
    let origin;
    try { origin = new URL(serverUrl).origin + '/*'; } catch { return; }
    chrome.permissions.request({ origins: [origin] }, (granted) => {
      if (granted) {
        el('noPermission').classList.add('hidden');
        load();
      } else {
        el('permissionMsg').textContent = '권한이 거부되었습니다. 설정에서 서버 주소를 다시 저장해 보세요.';
      }
    });
  });

  el('btnOpenDash').addEventListener('click', async () => {
    const { serverUrl } = await getConfig();
    if (serverUrl) {
      chrome.tabs.create({ url: serverUrl.replace(/\/$/, '') + '/' });
    }
  });
});
