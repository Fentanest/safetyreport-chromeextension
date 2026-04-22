'use strict';

// 차량번호 입력 필드 감시 → 이전 신고 내역 패널 표시

const PANEL_ID = 'sr-vehicle-panel';
const DEBOUNCE_MS = 600;

let debounceTimer = null;
let lastQueried = '';
let lastData = null; // 마지막 조회 결과 캐시

// 서버 URL 캐시 (스토리지에서 로드, 웹앱 링크 생성용)
let cachedServerUrl = '';
chrome.storage.sync.get(['serverUrl'], (d) => { cachedServerUrl = d.serverUrl || ''; });
chrome.storage.onChanged.addListener((changes) => {
  if (changes.serverUrl) cachedServerUrl = changes.serverUrl.newValue || '';
});

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
  panel.style.minWidth = `${Math.max(rect.width, 560)}px`;
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
    <div class="sr-empty sr-error">서버 연결 실패: ${esc(msg)}</div>
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

  const copyBtn = records.length > 0
    ? `<button class="sr-copy-btn" id="sr-copy-btn">신고번호 복사</button>`
    : '';

  panel.innerHTML = `
    <div class="sr-panel-header">
      <span class="sr-panel-title">
        <strong>${esc(vehicleNumber)}</strong> 이전 신고 내역
        <span class="sr-count">${records.length}건</span>
      </span>
      <div class="sr-header-actions">
        ${copyBtn}
        <button class="sr-close" id="sr-close-btn">&#x2715;</button>
      </div>
    </div>
    ${summaryHtml}
    <div class="sr-list">${rowsHtml}</div>
  `;
  bindClose(panel);

  const copyBtnEl = panel.querySelector('#sr-copy-btn');
  if (copyBtnEl) {
    copyBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const numbers = records.map((r) => r.신고번호).filter(Boolean).join('\n');
      navigator.clipboard.writeText(numbers).then(() => {
        copyBtnEl.textContent = '복사됨!';
        setTimeout(() => { copyBtnEl.textContent = '신고번호 복사'; }, 1500);
      });
    });
  }

  // 카드 클릭 → 안전신문고 신고 상세 새 탭
  panel.querySelector('.sr-list')?.addEventListener('click', (e) => {
    const row = e.target.closest('.sr-row-link');
    if (!row) return;
    e.stopPropagation();
    window.open(row.dataset.url, '_blank');
  });
}

function buildSummary(records) {
  if (records.length === 0) return '';

  const st = { 처리중: 0, 수용: 0, 일부수용: 0, 불수용: 0 };
  const ft = { 과태료: 0, 범칙금: 0, 불수용: 0, 미확인: 0 };

  records.forEach((r) => {
    const s = r.처리상태 || '';
    const fp = r.범칙금_과태료 || '';
    const isReject = ['불수용', '기타'].includes(s);

    if (['처리중', '진행', '진행중'].includes(s)) st.처리중++;
    else if (s === '수용') st.수용++;
    else if (s === '일부수용') st.일부수용++;
    else if (isReject) st.불수용++;

    if (fp.includes('과태료')) ft.과태료++;
    else if (fp.includes('범칙금') || fp.includes('경고')) ft.범칙금++;
    else if (isReject) ft.불수용++;
    else if (fp === '미확인') ft.미확인++;
  });

  return `
    <div class="sr-summary">
      <span class="sr-sum-item sr-state-processing">처리중 ${st.처리중}</span>
      <span class="sr-sum-item sr-state-accept">수용 ${st.수용}</span>
      <span class="sr-sum-item sr-state-partial">일부수용 ${st.일부수용}</span>
      <span class="sr-sum-item sr-state-reject">불수용 ${st.불수용}</span>
      <span class="sr-sum-divider"></span>
      <span class="sr-sum-item sr-fine-fine">과태료 ${ft.과태료}</span>
      <span class="sr-sum-item sr-fine-penalty">경고/범칙금 ${ft.범칙금}</span>
      <span class="sr-sum-item sr-state-reject">불수용 ${ft.불수용}</span>
      <span class="sr-sum-item sr-fine-unknown">미확인 ${ft.미확인}</span>
    </div>
  `;
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildRow(r) {
  const { text, cls } = stateLabel(r.처리상태);
  const fine = r.범칙금_과태료 ? `<span class="sr-fine-tag">${esc(r.범칙금_과태료)}</span>` : '';
  const place = r.위반장소 || r.위반법규 || '';
  const detailUrl = r.신고번호 && cachedServerUrl
    ? `${cachedServerUrl.replace(/\/$/, '')}/data/all?open=${encodeURIComponent(r.신고번호)}`
    : '';

  const meta = [
    r.차량번호 ? `<span class="sr-meta-item">🚗 ${esc(r.차량번호)}</span>` : '',
    r.처리기관 ? `<span class="sr-meta-item">🏢 ${esc(r.처리기관)}</span>` : '',
    r.담당자   ? `<span class="sr-meta-item">👤 ${esc(r.담당자)}</span>` : '',
  ].filter(Boolean).join('');

  return `
    <div class="sr-row${detailUrl ? ' sr-row-link' : ''}" ${detailUrl ? `data-url="${detailUrl}"` : ''}>
      <div class="sr-row-top">
        <span class="sr-rnum">${esc(r.신고번호 || '')}</span>
        <span class="sr-date">${esc(r.신고일 || '')}</span>
        <span class="sr-name" title="${esc(r.신고명 || '')}">${esc(r.신고명 || '(제목 없음)')}</span>
        <span class="sr-state ${cls}">${text}</span>
        ${fine}
      </div>
      ${meta ? `<div class="sr-row-meta">${meta}</div>` : ''}
      ${place ? `<div class="sr-row-place">📍 ${esc(place)}</div>` : ''}
      ${r.신고내용 ? `<div class="sr-row-content">${esc(r.신고내용.slice(0, 60))}${r.신고내용.length > 60 ? '…' : ''}</div>` : ''}
      ${r.처리내용 ? `<div class="sr-row-result">▶ ${esc(r.처리내용.slice(0, 80))}${r.처리내용.length > 80 ? '…' : ''}</div>` : ''}
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
    lastData = { value, data };
    showResults(inputEl, value, data);
  } catch (err) {
    if (err.message === 'NO_CONFIG') {
      showNoConfig(inputEl);
    } else {
      showError(inputEl, err.message);
    }
  }
}

// #VHRNO를 즉시 찾거나, MutationObserver로 동적 생성 대기
let attachedInput = null;
let pendingObserver = null;
let initTimer = null;

function attachToInput(inputEl) {
  if (inputEl._srAttached) return; // 중복 등록 방지
  inputEl._srAttached = true;

  // 텍스트 변경 시
  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    lastQueried = ''; // 강제 재조회 허용
    debounceTimer = setTimeout(() => handleVehicleInput(inputEl), DEBOUNCE_MS);
  });

  // 포커스 진입 또는 클릭 시 — 캐시된 결과 즉시 표시, 없으면 재조회
  const showOnActivate = () => {
    clearTimeout(debounceTimer);
    const value = inputEl.value.trim().replace(/\s/g, '');
    if (value.length < 4) return;

    if (lastData && lastData.value === value) {
      showResults(inputEl, value, lastData.data);
      return;
    }

    lastQueried = '';
    debounceTimer = setTimeout(() => handleVehicleInput(inputEl), DEBOUNCE_MS);
  };
  inputEl.addEventListener('focus', showOnActivate);
  inputEl.addEventListener('click', showOnActivate);

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

function init() {
  if (pendingObserver) {
    pendingObserver.disconnect();
    pendingObserver = null;
  }

  const existing = document.getElementById('VHRNO');
  if (existing) {
    if (!existing._srAttached) {
      attachedInput = existing;
      attachToInput(existing);
    }
  } else {
    // 동적으로 삽입되는 경우 대기 (최대 30초)
    const observer = new MutationObserver(() => {
      const inputEl = document.getElementById('VHRNO');
      if (inputEl) {
        observer.disconnect();
        pendingObserver = null;
        if (!inputEl._srAttached) {
          attachedInput = inputEl;
          attachToInput(inputEl);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    pendingObserver = observer;
    setTimeout(() => {
      observer.disconnect();
      if (pendingObserver === observer) pendingObserver = null;
    }, 30000);
  }

  initAddressWatch();
}

// --- 주소 이전 신고 패널 (우측 고정) ---

const ADDR_PANEL_ID = 'sr-address-panel';
let addrDebounceTimer = null;
let lastAddrQueried = '';
let pendingAddrObserver = null;

function fetchAddressReports(address) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'FETCH_ADDRESS', address },
      (response) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (response.error) { reject(new Error(response.error)); return; }
        resolve(response.data);
      }
    );
  });
}

function buildAddrPanel() {
  let panel = document.getElementById(ADDR_PANEL_ID);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = ADDR_PANEL_ID;
    document.body.appendChild(panel);
  }
  return panel;
}

function showAddrLoading() {
  const panel = buildAddrPanel();
  panel.style.display = 'flex';
  panel.innerHTML = `
    <div class="sr-addr-header">
      <span class="sr-addr-title">주소 신고 내역 조회 중...</span>
    </div>
    <div class="sr-loading" style="padding:12px;">&#9679; &#9679; &#9679;</div>
  `;
}

function showAddrResults(address, data) {
  const panel = buildAddrPanel();
  const records = data.data || [];

  const copyBtn = records.length > 0
    ? `<button class="sr-copy-btn" id="sr-addr-copy-btn">신고번호 복사</button>`
    : '';

  panel.style.display = 'flex';
  panel.innerHTML = `
    <div class="sr-addr-header">
      <div class="sr-addr-title-wrap">
        <span class="sr-addr-title" title="${esc(address)}">${esc(address)}</span>
        <span class="sr-count">${records.length}건</span>
      </div>
      <div class="sr-header-actions">
        ${copyBtn}
        <button class="sr-close" id="sr-addr-close-btn">&#x2715;</button>
      </div>
    </div>
    <div class="sr-addr-stats-wrap">
      ${buildAddrStats(records)}
    </div>
    <div class="sr-list">
      ${records.length === 0
        ? '<div class="sr-empty">이 주소에서 신고한 내역이 없습니다.</div>'
        : records.map(buildRow).join('')}
    </div>
  `;

  panel.querySelector('#sr-addr-close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.style.display = 'none';
  });

  const copyBtnEl = panel.querySelector('#sr-addr-copy-btn');
  if (copyBtnEl) {
    copyBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const numbers = records.map((r) => r.신고번호).filter(Boolean).join('\n');
      navigator.clipboard.writeText(numbers).then(() => {
        copyBtnEl.textContent = '복사됨!';
        setTimeout(() => { copyBtnEl.textContent = '신고번호 복사'; }, 1500);
      });
    });
  }

  panel.querySelector('.sr-list')?.addEventListener('click', (e) => {
    const row = e.target.closest('.sr-row-link');
    if (!row) return;
    e.stopPropagation();
    window.open(row.dataset.url, '_blank');
  });
}

// "과태료: 30,000원" 또는 "범칙금: 50,000원" 문자열에서 숫자 추출
function parseFineAmount(fp) {
  if (!fp) return 0;
  const m = fp.match(/([\d,]+)원/);
  if (!m) return 0;
  return parseInt(m[1].replace(/,/g, ''), 10) || 0;
}

function fmtAmount(won) {
  if (!won) return '';
  return won.toLocaleString('ko-KR') + '원';
}

function buildAddrStats(records) {
  if (records.length === 0) return '';

  const total = records.length;
  const st = { 처리중: 0, 수용: 0, 일부수용: 0, 불수용: 0 };
  const ft = { 과태료: 0, 범칙금: 0, 총액: 0 };
  const officers = {};

  records.forEach((r) => {
    const s = r.처리상태 || '';
    const fp = r.범칙금_과태료 || '';
    const isProcessing = ['처리중', '진행', '진행중'].includes(s);
    const isReject = ['불수용', '기타'].includes(s);
    const amount = parseFineAmount(fp);

    if (isProcessing) st.처리중++;
    else if (s === '수용') st.수용++;
    else if (s === '일부수용') st.일부수용++;
    else if (isReject) st.불수용++;

    if (fp.includes('과태료')) { ft.과태료++; ft.총액 += amount; }
    else if (fp.includes('범칙금') || fp.includes('경고')) ft.범칙금++;

    const officer = r.담당자;
    if (officer && officer !== '미지정' && officer !== '') {
      if (!officers[officer]) {
        officers[officer] = { total: 0, 처리중: 0, 수용: 0, 일부수용: 0, 불수용: 0, 과태료: 0, 범칙금: 0, 총액: 0 };
      }
      const o = officers[officer];
      o.total++;
      if (isProcessing) o.처리중++;
      else if (s === '수용') o.수용++;
      else if (s === '일부수용') o.일부수용++;
      else if (isReject) o.불수용++;
      if (fp.includes('과태료')) { o.과태료++; o.총액 += amount; }
      else if (fp.includes('범칙금') || fp.includes('경고')) o.범칙금++;
    }
  });

  const pct = (n, base) => base > 0 ? Math.round(n / base * 100) : 0;
  const badge = (cls, label, n, base) =>
    `<span class="sr-sum-item ${cls}">${label} <b>${n}</b><span class="sr-pct">${pct(n, base)}%</span></span>`;

  const statusItems = [
    st.처리중  ? badge('sr-state-processing', '처리중', st.처리중, total) : '',
    st.수용    ? badge('sr-state-accept',     '수용',   st.수용,   total) : '',
    st.일부수용 ? badge('sr-state-partial',    '일부수용', st.일부수용, total) : '',
    st.불수용  ? badge('sr-state-reject',     '불수용', st.불수용,  total) : '',
  ].filter(Boolean).join('');

  const fineAmountLine = ft.총액 > 0
    ? `<div class="sr-addr-fine-total">총 과태료 <b>${fmtAmount(ft.총액)}</b></div>` : '';

  const fineItems = [
    ft.과태료 ? badge('sr-fine-fine',    '과태료',      ft.과태료, total) : '',
    ft.범칙금 ? badge('sr-fine-penalty', '경고/범칙금', ft.범칙금, total) : '',
  ].filter(Boolean).join('');

  const topOfficers = Object.entries(officers).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  const officerRows = topOfficers.map(([name, o]) => {
    const badges = [
      o.처리중  ? badge('sr-state-processing', '처리중',   o.처리중,  o.total) : '',
      o.수용    ? badge('sr-state-accept',     '수용',     o.수용,    o.total) : '',
      o.일부수용 ? badge('sr-state-partial',   '일부수용', o.일부수용, o.total) : '',
      o.불수용  ? badge('sr-state-reject',     '불수용',   o.불수용,  o.total) : '',
      o.과태료  ? `<span class="sr-sum-item sr-fine-fine">과태료 <b>${o.과태료}</b>${o.총액 ? `<span class="sr-pct">${fmtAmount(o.총액)}</span>` : ''}</span>` : '',
      o.범칙금  ? `<span class="sr-sum-item sr-fine-penalty">경고/범칙금 <b>${o.범칙금}</b></span>` : '',
    ].filter(Boolean).join('');
    return `
      <div class="sr-addr-officer-row">
        <div class="sr-addr-officer-top">
          <span class="sr-addr-officer-name">${esc(name)}</span>
          <span class="sr-addr-officer-total">${o.total}건</span>
        </div>
        <div class="sr-addr-officer-badges">${badges}</div>
      </div>
    `;
  }).join('');

  return `
    ${statusItems ? `<div class="sr-addr-stat-section"><div class="sr-addr-stat-label">처리상태</div><div class="sr-addr-stat-row">${statusItems}</div></div>` : ''}
    ${fineItems || fineAmountLine ? `
      <div class="sr-addr-stat-section">
        <div class="sr-addr-stat-label">과태료/범칙금</div>
        <div class="sr-addr-stat-row">${fineItems}</div>
        ${fineAmountLine}
      </div>` : ''}
    ${officerRows ? `<div class="sr-addr-stat-section"><div class="sr-addr-stat-label">담당자</div><div class="sr-addr-officers">${officerRows}</div></div>` : ''}
  `;
}

async function handleAddressChange(address) {
  address = address.trim();
  if (!address || address.length < 5) return;
  if (address === lastAddrQueried) return;
  lastAddrQueried = address;

  showAddrLoading();
  try {
    const data = await fetchAddressReports(address);
    showAddrResults(address, data);
  } catch {
    const panel = document.getElementById(ADDR_PANEL_ID);
    if (panel) panel.style.display = 'none';
  }
}

function attachToAdd1(el) {
  if (el._srAddrAttached) return;
  el._srAddrAttached = true;

  const initial = el.textContent.trim();
  if (initial && initial.length >= 5) {
    addrDebounceTimer = setTimeout(() => handleAddressChange(initial), 1500);
  }

  const observer = new MutationObserver(() => {
    const newAddr = el.textContent.trim();
    clearTimeout(addrDebounceTimer);
    addrDebounceTimer = setTimeout(() => handleAddressChange(newAddr), 800);
  });
  observer.observe(el, { childList: true, characterData: true, subtree: true });
}

function initAddressWatch() {
  if (pendingAddrObserver) {
    pendingAddrObserver.disconnect();
    pendingAddrObserver = null;
  }

  const existing = document.getElementById('add1');
  if (existing) { attachToAdd1(existing); return; }

  const obs = new MutationObserver(() => {
    const el = document.getElementById('add1');
    if (el) {
      obs.disconnect();
      if (pendingAddrObserver === obs) pendingAddrObserver = null;
      attachToAdd1(el);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  pendingAddrObserver = obs;
  setTimeout(() => {
    obs.disconnect();
    if (pendingAddrObserver === obs) pendingAddrObserver = null;
  }, 30000);
}

// SPA 해시 이동 감지 — 새 신고 폼으로 전환 시 재초기화
window.addEventListener('hashchange', () => {
  attachedInput = null;
  lastQueried = '';
  lastData = null;
  lastAddrQueried = '';
  clearTimeout(addrDebounceTimer);
  if (pendingAddrObserver) {
    pendingAddrObserver.disconnect();
    pendingAddrObserver = null;
  }
  hidePanel();
  const addrPanel = document.getElementById(ADDR_PANEL_ID);
  if (addrPanel) addrPanel.style.display = 'none';
  clearTimeout(initTimer);
  initTimer = setTimeout(init, 300); // SPA 렌더링 대기
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
