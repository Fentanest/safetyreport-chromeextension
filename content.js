'use strict';

// 차량번호 입력 필드 감시 → 이전 신고 내역 패널 표시

const PANEL_ID = 'sr-vehicle-panel';
const DEBOUNCE_MS = 600;

let debounceTimer = null;
let lastQueried = '';

// --- API 조회 (background service worker 경유 — Mixed Content 우회) ---

function fetchVehicleReports(vehicleNumber) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'FETCH_VEHICLE', vehicleNumber },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response.data);
      }
    );
  });
}

// --- 패널 렌더링 ---

function stateLabel(status) {
  if (!status) return { text: '-', cls: 'sr-state-default' };
  if (status === '수용') return { text: '수용', cls: 'sr-state-accept' };
  if (['불수용', '기타'].includes(status)) return { text: status, cls: 'sr-state-reject' };
  if (status === '일부수용') return { text: '일부수용', cls: 'sr-state-partial' };
  if (['처리중', '진행', '진행중'].includes(status)) return { text: status, cls: 'sr-state-processing' };
  return { text: status, cls: 'sr-state-default' };
}

function buildPanel(anchorEl) {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'sr-panel';
    document.body.appendChild(panel);
  }

  // 앵커 위치 계산
  const rect = anchorEl.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

  panel.style.top = `${rect.bottom + scrollTop + 4}px`;
  panel.style.left = `${rect.left + scrollLeft}px`;
  panel.style.minWidth = `${Math.max(rect.width, 420)}px`;
  panel.style.display = 'flex';

  return panel;
}

function showLoading(anchorEl) {
  const panel = buildPanel(anchorEl);
  panel.innerHTML = `
    <div class="sr-panel-header">
      <span class="sr-panel-title">이전 신고 내역 조회 중...</span>
    </div>
    <div class="sr-loading">&#9679; &#9679; &#9679;</div>
  `;
}

function showNoConfig(anchorEl) {
  const panel = buildPanel(anchorEl);
  panel.innerHTML = `
    <div class="sr-panel-header">
      <span class="sr-panel-title">나만의 안전신문고</span>
      <button class="sr-close" id="sr-close-btn">&#x2715;</button>
    </div>
    <div class="sr-empty">확장 설정에서 서버 주소와 API 키를 입력해 주세요.</div>
  `;
  bindClose(panel);
}

function showError(anchorEl, msg) {
  const panel = buildPanel(anchorEl);
  panel.innerHTML = `
    <div class="sr-panel-header">
      <span class="sr-panel-title">나만의 안전신문고</span>
      <button class="sr-close" id="sr-close-btn">&#x2715;</button>
    </div>
    <div class="sr-empty sr-error">서버 연결 실패: ${msg}</div>
  `;
  bindClose(panel);
}

function showResults(anchorEl, vehicleNumber, data) {
  const panel = buildPanel(anchorEl);
  const records = data.data || [];

  const summaryHtml = buildSummary(records);
  const rowsHtml = records.length === 0
    ? '<div class="sr-empty">조회된 신고 내역이 없습니다.</div>'
    : records.map(buildRow).join('');

  panel.innerHTML = `
    <div class="sr-panel-header">
      <span class="sr-panel-title">
        <strong>${vehicleNumber}</strong> 이전 신고 내역
        <span class="sr-count">${records.length}건</span>
      </span>
      <button class="sr-close" id="sr-close-btn">&#x2715;</button>
    </div>
    ${summaryHtml}
    <div class="sr-list">${rowsHtml}</div>
  `;
  bindClose(panel);
}

function buildSummary(records) {
  if (records.length === 0) return '';

  const counts = { 수용: 0, 불수용: 0, 처리중: 0, 기타: 0 };
  let fineCount = 0;

  records.forEach((r) => {
    const s = r.처리상태 || '';
    if (s === '수용' || s === '일부수용') counts.수용++;
    else if (s === '불수용' || s === '기타') counts.불수용++;
    else if (['처리중', '진행', '진행중'].includes(s)) counts.처리중++;
    else counts.기타++;

    const fp = r.범칙금_과태료 || '';
    if (fp.includes('과태료') || fp.includes('범칙금')) fineCount++;
  });

  return `
    <div class="sr-summary">
      <span class="sr-sum-item sr-state-accept">수용 ${counts.수용}</span>
      <span class="sr-sum-item sr-state-reject">불수용 ${counts.불수용}</span>
      <span class="sr-sum-item sr-state-processing">처리중 ${counts.처리중}</span>
      <span class="sr-sum-item sr-fine">과태료/범칙금 ${fineCount}</span>
    </div>
  `;
}

function buildRow(r) {
  const { text, cls } = stateLabel(r.처리상태);
  const fine = r.범칙금_과태료 ? `<span class="sr-fine-tag">${r.범칙금_과태료}</span>` : '';
  const place = r.위반장소 || r.위반법규 || '';

  return `
    <div class="sr-row">
      <div class="sr-row-top">
        <span class="sr-date">${r.신고일 || ''}</span>
        <span class="sr-name" title="${r.신고명 || ''}">${r.신고명 || '(제목 없음)'}</span>
        <span class="sr-state ${cls}">${text}</span>
        ${fine}
      </div>
      ${place ? `<div class="sr-row-place">${place}</div>` : ''}
      ${r.처리내용 ? `<div class="sr-row-result">${r.처리내용.slice(0, 80)}${r.처리내용.length > 80 ? '…' : ''}</div>` : ''}
    </div>
  `;
}

function bindClose(panel) {
  const btn = panel.querySelector('#sr-close-btn');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      hidePanel();
    });
  }
}

function hidePanel() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) panel.style.display = 'none';
  lastQueried = '';
}

// --- 입력 처리 ---

async function handleVehicleInput(inputEl) {
  const value = inputEl.value.trim().replace(/\s/g, '');

  if (value.length < 4) {
    hidePanel();
    return;
  }

  if (value === lastQueried) return;
  lastQueried = value;

  showLoading(inputEl);

  try {
    const data = await fetchVehicleReports(value);
    showResults(inputEl, value, data);
  } catch (err) {
    if (err.message === 'NO_CONFIG') {
      showNoConfig(inputEl);
    } else {
      showError(inputEl, err.message);
    }
  }
}

// --- 초기화 ---

function attachToInput(inputEl) {
  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => handleVehicleInput(inputEl), DEBOUNCE_MS);
  });

  // 차량번호 없음 체크 시 패널 숨기기
  const noVhrChk = document.getElementById('chkNoVhrNo');
  if (noVhrChk) {
    noVhrChk.addEventListener('change', () => {
      if (noVhrChk.checked) hidePanel();
    });
  }

  // 패널 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || panel.style.display === 'none') return;
    if (!panel.contains(e.target) && e.target !== inputEl) {
      hidePanel();
    }
  });

  // 스크롤 시 패널 위치 재조정
  window.addEventListener('scroll', () => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || panel.style.display === 'none') return;
    const rect = inputEl.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
    panel.style.top = `${rect.bottom + scrollTop + 4}px`;
    panel.style.left = `${rect.left + scrollLeft}px`;
  }, { passive: true });
}

// #VHRNO를 즉시 찾거나, MutationObserver로 동적 생성 대기
function init() {
  const existing = document.getElementById('VHRNO');
  if (existing) {
    attachToInput(existing);
    return;
  }

  // 동적으로 삽입되는 경우 대기 (최대 30초)
  const observer = new MutationObserver(() => {
    const inputEl = document.getElementById('VHRNO');
    if (inputEl) {
      observer.disconnect();
      attachToInput(inputEl);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => observer.disconnect(), 30000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
