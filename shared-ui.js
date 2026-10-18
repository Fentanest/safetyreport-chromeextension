'use strict';
// Pure rendering helpers shared by the popup and the two ShadowRoot panels. API fields are allowlisted here.
globalThis.SRUI = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR') : '0';
  const money = value => Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('ko-KR')}원` : '';
  // server rule (contracts/my-reports types.ts SOURCE_REPORT_ID); the server's official_url is re-checked before use
  const officialUrl = id => /^[0-9A-Za-z_-]{1,40}$/.test(String(id ?? ''))
    ? `https://www.safetyreport.go.kr/#mypage/mysafereport/${encodeURIComponent(id)}` : null;
  const OFFICIAL = /^https:\/\/www\.safetyreport\.go\.kr\/#mypage\/mysafereport\/[0-9A-Za-z_-]{1,40}$/;
  const linkOf = item => (typeof item.official_url === 'string' && OFFICIAL.test(item.official_url) ? item.official_url : null);
  const rate = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Number(value)}%`);
  const isCount = value => Number.isInteger(value) && value >= 0;
  // Use the full manager aggregate, never the loaded report/manager page length or confirmed amount count.
  const managerRate = (n, total) => isCount(n) && isCount(total) && total > 0
    ? `${(Math.round(n * 1000 / total) / 10).toFixed(1)}% (${count(n)}/${count(total)}건)` : '—';
  const managerRates = (accepted, fine, total) => `<div class="sr-officer-results sr-officer-rates"><span class="sr-numeric">수용률 ${managerRate(accepted, total)}</span><span class="sr-numeric">과태료처분율 ${managerRate(fine, total)}</span></div>`;
  const tone = status => ({ accepted: 'accept', partial: 'partial', rejected: 'reject' })[status] || 'unknown';
  const statusName = status => ({ accepted: '수용', partial: '일부 수용', rejected: '불수용', completed_unknown: '결과 미상' })[status] || '결과 미상';
  const dispositionName = value => ({ fine: '과태료', warning: '경고', penalty: '범칙금', none: '처분 없음', unknown: '처분 미확인' })[value] || '처분 미확인';
  // 5분류(observation-v5, 2026-10-11): traffic·parking·safety·living·other. 코드표: map contracts/report-categories.json.
  // 서버가 아직 보내지 않는 분류(구버전)이거나 모르는 값이면 칩을 만들지 않거나 원문 그대로 보여준다(가짜 분류를 만들지 않는다).
  const CATEGORY_LABEL = { traffic: '교통위반', parking: '주정차위반', safety: '안전신고', living: '생활불편', other: '기타' };
  const categoryName = value => (typeof value === 'string' && value ? (CATEGORY_LABEL[value] || value) : null);

  // 아이콘: 장식용 inline SVG만 사용(외부 폰트·CDN 금지). stroke는 .sr-ui svg 기본값(currentColor)을 그대로 쓴다.
  const ICONS = {
    car: '<path d="M3 13.2l1.5-4.6A2 2 0 0 1 6.4 7.2h11.2a2 2 0 0 1 1.9 1.4l1.5 4.6"/><rect x="3" y="13.2" width="18" height="5.1" rx="1.6"/><circle cx="7.4" cy="18.5" r="1.6"/><circle cx="16.6" cy="18.5" r="1.6"/>',
    pin: '<path d="M12 21s7-6.3 7-11.6A7 7 0 0 0 5 9.4C5 14.7 12 21 12 21z"/><circle cx="12" cy="9.4" r="2.3"/>',
    building: '<path d="M5 21V4.8c0-.44.36-.8.8-.8h6.4c.44 0 .8.36.8.8V21"/><path d="M13 10.6h5.2c.44 0 .8.36.8.8V21"/><path d="M3 21h18"/><path d="M7.6 7.5h1M7.6 11h1M7.6 14.5h1"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v3M16 3v3"/>',
    calendarCheck: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v3M16 3v3"/><path d="M8.3 14l2 2 4.2-4.2"/>',
    refresh: '<path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.6"/><path d="M4 4v4.6h4.6"/><path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.4"/><path d="M20 20v-4.6h-4.6"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.6M12 18.4V21M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M3 12h2.6M18.4 12H21M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    pulse: '<path d="M3 12h4l2 7 4-14 2 7h6"/>',
    logout: '<path d="M15 3.5h3.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H15"/><path d="M10 16.5L4.8 12 10 7.5"/><path d="M4.8 12h12.7"/>',
    external: '<path d="M14 4h6v6"/><path d="M10 14L20 4"/><path d="M19 13.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5"/>',
    user: '<circle cx="12" cy="8.3" r="3.3"/><path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.6v5.9"/><circle cx="12" cy="7.3" r="1" fill="currentColor" stroke="none"/>',
    chevronUp: '<path d="M5.5 15.5L12 9l6.5 6.5"/>',
    chevronDown: '<path d="M5.5 8.5L12 15l6.5-6.5"/>',
  };
  const icon = (name, cls = '') => ICONS[name] ? `<svg class="sr-icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>` : '';
  // 차량 query는 번호판 뱃지로, 주소 query는 핀 아이콘 + 말줄임(title로 전체 주소 확인)으로 보여준다.
  const queryBadge = (kind, query) => kind === 'vehicle'
    ? `<span class="sr-query-plate sr-numeric">${esc(query)}</span>`
    : `<span class="sr-query-address" title="${esc(query)}">${icon('pin', 'sr-icon-sm')}<span class="sr-query-address-text">${esc(query)}</span></span>`;

  // 상태/처분 분포를 얇은 막대 + 점·건수 범례로 보여준다. 합계가 0이면 막대 없이 범례만(없는 값을 0으로 꾸미지 않는다).
  function distribution(segments) {
    const total = segments.reduce((sum, s) => sum + s.n, 0);
    const bar = total ? `<div class="sr-bar">${segments.filter(s => s.n > 0).map(s =>
      `<span class="sr-bar-seg sr-bar-seg--${s.tone}" style="width:${(s.n / total * 100).toFixed(3)}%"></span>`).join('')}</div>` : '';
    const legend = `<div class="sr-legend">${segments.map(s =>
      `<span class="sr-legend-item"><i class="sr-status-dot sr-status-dot--${s.tone}"></i>${esc(s.label)}<b class="sr-numeric">${count(s.n)}건</b></span>`).join('')}</div>`;
    return bar + legend;
  }
  // s = my-reports-v1 Summary (contracts/my-reports README §5)
  function summary(s) {
    if (s?.backend === 'selfhost') return selfhostSummary(s);
    s = s || {};
    const total = Number(s.total) || 0, st = s.status || {}, d = s.disposition || {}, f = s.fine_amount || {};
    const statusRows = [['accepted', '수용', 'accept'], ['partial', '일부 수용', 'partial'], ['rejected', '불수용', 'reject']];
    if (Number(st.completed_unknown)) statusRows.push(['completed_unknown', '결과 미상', 'unknown']);
    const statusSegments = statusRows.map(([key, label, t]) => ({ tone: t, label, n: Number(st[key]) || 0 }));
    const dispositionRows = [['fine', '과태료', 'fine'], ['warning', '경고', 'partial'], ['penalty', '범칙금', 'penalty'], ['none', '처분 없음', 'unknown'], ['unknown', '처분 미확인', 'unknown']];
    const dispositionSegments = dispositionRows.map(([key, label, t]) => ({ tone: t, label, n: Number(d[key]) || 0 }));
    const sum = f.confirmed_sum_won === null || f.confirmed_sum_won === undefined ? '확인된 금액 없음' : money(f.confirmed_sum_won);
    return `<section class="sr-section sr-tile"><div class="sr-section-heading"><span class="sr-section-title">처리 결과</span><span class="sr-section-description">완료 신고 ${count(total)}건 · 수용률 ${rate(s.accept_rate)}</span></div>${distribution(statusSegments)}</section>
      <section class="sr-section sr-tile"><div class="sr-section-heading"><span class="sr-section-title">처분</span></div>${distribution(dispositionSegments)}<div class="sr-amount-line"><span>확정 과태료 합계</span><strong class="sr-numeric">${sum}</strong></div><p class="sr-note">확정 금액 ${count(f.confirmed_count)}건 기준${Number(f.unconfirmed_count) ? ` · 금액 미확인 ${count(f.unconfirmed_count)}건` : ''}</p></section>`;
  }
  // page = my-reports-v1 ManagerPage (items accumulated by the caller across "더 보기")
  function managers(page, open = false) {
    const people = Array.isArray(page?.items) ? page.items : [];
    if (!people.length) return '';
    if (page.backend === 'selfhost') return `<section class="sr-section sr-officer-section"><details ${open ? 'open' : ''}><summary class="sr-officer-summary">담당자별 ${count(people.length)}명</summary><p class="sr-note">서버 검색 전체 신고 기준 · 처리중 포함</p>${people.map(p => `<div class="sr-officer"><div class="sr-officer-top"><span class="sr-officer-name">${esc(p.manager_name)}</span><b>${count(p.total)}건</b></div><div class="sr-officer-agency">${esc(p.agency_name_current || p.agency_name_original)}</div>${managerRates(p.accepted, p.fine_count, p.total)}</div>`).join('')}</details></section>`;
    const more = page.next_cursor ? '<button class="sr-button sr-more" data-action="more-managers">담당자 더 보기</button>' : '';
    const unassigned = Number(page.unassigned_count) ? `<p class="sr-note">담당자 정보 없는 신고 ${count(page.unassigned_count)}건</p>` : '';
    return `<section class="sr-section sr-officer-section"><details ${open ? 'open' : ''}><summary class="sr-officer-summary">담당자별 ${count(page.total_managers ?? people.length)}명 <span>수용률·과태료 보기</span></summary><p class="sr-note">고유 완료 신고 기준 · 결과 미상 포함</p>${people.map(p => { const st = p.status || {}, f = p.fine_amount || {}; return `<div class="sr-officer"><div class="sr-officer-top"><span class="sr-officer-name">${esc(p.manager_name || '이름 없음')}</span><b>${count(p.total)}건</b></div><div class="sr-officer-agency">${esc(p.agency_name_current || p.agency_name_original || '')}</div>${managerRates(st.accepted, p.disposition?.fine, p.total)}<div class="sr-officer-results"><span>일부 수용 ${isCount(st.partial) ? `${count(st.partial)}건` : '—'}</span><span>확정 과태료 ${f.confirmed_sum_won === null || f.confirmed_sum_won === undefined ? '금액 없음' : money(f.confirmed_sum_won)}</span></div></div>`; }).join('')}${more}${unassigned}</details></section>`;
  }
  // item = my-reports-v1 ReportRow(cloud) 또는 selfhostClient.projectRecord(selfhost) — 둘 다 같은 카드로 렌더링한다.
  function record(item) {
    const official = linkOf(item);
    const url = item.detail_url && /^https?:\/\/[^/]+\/data\/all\?open=[^&]*$/.test(item.detail_url) ? esc(item.detail_url) : official;
    const label = item.report_number || '신고번호 미확인';
    const number = item.vehicle_number || '차량번호 없음';
    const statusTone = tone(item.status);
    const showAmount = item.confirmed_amount_won !== null && item.confirmed_amount_won !== undefined &&
      ((item.disposition === 'fine' && item.amount_kind === 'fine') ||
       (item.disposition === 'penalty' && item.amount_kind === 'penalty'));
    // 5분류 칩: 셀프호스트 등 category가 없는 행은 칩을 만들지 않는다(없는 값을 꾸미지 않는다).
    const categoryLabel = categoryName(item.category);
    const categoryChip = categoryLabel ? `<span class="sr-badge sr-badge--category">${esc(categoryLabel)}</span>` : '';
    const badges = categoryChip +
      `<span class="sr-badge sr-badge--${statusTone}">${esc(item.status_label || statusName(item.status))}</span>` +
      (item.disposition && item.disposition !== 'none' && item.disposition !== 'unknown'
        ? `<span class="sr-badge sr-badge--${item.disposition === 'fine' ? 'fine' : 'penalty'}">${dispositionName(item.disposition)}${showAmount ? ` ${money(item.confirmed_amount_won)}` : ''}</span>` : '');
    const selfhostBadge = item.selfhost_disposition ? `<span class="sr-badge sr-badge--${item.selfhost_disposition.includes('과태료') ? 'fine' : 'unknown'}">${esc(item.selfhost_disposition)}</span>` : '';
    const rating = Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5
      ? `<span class="sr-rating"><span aria-hidden="true">${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}</span><span class="sr-sr-only">별점 ${item.rating}/5</span></span>` : '';
    const meta = [item.report_number ? `<span class="sr-report-number">${esc(item.report_number)}</span>` : '',
      item.report_date ? `<span class="sr-meta-item">${icon('calendar', 'sr-icon-sm')}<span class="sr-sr-only">신고</span>${esc(item.report_date)}</span>` : '',
      item.completed_date ? `<span class="sr-meta-item">${icon('calendarCheck', 'sr-icon-sm')}<span class="sr-sr-only">답변</span>${esc(item.completed_date)}</span>` : ''].filter(Boolean).join('');
    const agencyText = [item.agency_name_current || item.agency_name_original, item.manager_name].filter(Boolean).map(esc).join(' · ');
    const agency = agencyText ? `<p class="sr-record-agency">${icon('building', 'sr-icon-sm')}<span>${agencyText}</span></p>` : '';
    const agencyOriginal = item.agency_name_original && item.agency_name_current && item.agency_name_original !== item.agency_name_current
      ? `<p class="sr-note">당시 ${esc(item.agency_name_original)}</p>` : '';
    const address = item.address ? `<p class="sr-record-address">${icon('pin', 'sr-icon-sm')}<span>${esc(item.address)}</span></p>` : '';
    const inner = `<div class="sr-record-top"><span class="sr-record-key sr-plate">${esc(number)}</span><div class="sr-record-badges">${badges}${selfhostBadge}</div></div><div class="sr-record-law"><span>${esc(item.violation_law || '')}</span>${rating}</div><div class="sr-record-meta">${meta}</div>${agency}${agencyOriginal}${address}`;
    return `<article class="sr-record sr-record--${statusTone}">${url ? `<a class="sr-record-main" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)} ${item.detail_url ? '내 서버 상세' : '안전신문고 원문'}">${inner}</a>` : `<div class="sr-record-main">${inner}</div>`}</article>`;
  }
  // page = my-reports-v1 ReportPage (items accumulated by the caller)
  const records = page => `<div class="sr-list-heading"><span>${page?.backend === 'selfhost' ? '서버 신고' : '완료 신고'}</span><span>${count(page?.total)}건</span></div><div class="sr-record-list">${page?.items?.length ? page.items.map(record).join('') : '<p class="sr-section sr-note">조회된 신고가 없습니다.</p>'}</div>`;
  function selfhostSummary(s) {
    const statusTone = label => ({ 수용: 'accept', 일부수용: 'partial', 불수용: 'reject' })[label] || 'unknown';
    const dispositionTone = label => label.includes('과태료') ? 'fine' : label.includes('범칙금') ? 'penalty' : label.includes('경고') ? 'partial' : 'unknown';
    const statusSegments = Object.entries(s.statuses || {}).map(([label, n]) => ({ tone: statusTone(label), label, n: Number(n) || 0 }));
    const dispositionSegments = Object.entries(s.dispositions || {}).map(([label, n]) => ({ tone: dispositionTone(label), label, n: Number(n) || 0 }));
    return `<section class="sr-section sr-tile"><div class="sr-section-heading"><span class="sr-section-title">서버 처리 결과</span><span class="sr-section-description">서버 검색 전체 ${count(s.total)}건</span></div>${distribution(statusSegments)}</section>
      <section class="sr-section sr-tile"><div class="sr-section-heading"><span class="sr-section-title">서버 처분</span></div>${distribution(dispositionSegments)}</section>`;
  }
  function serverDashboard(data) {
    const labels = { total:'전체 신고', processingCount:'처리중', acceptCount:'수용', partialCount:'일부 수용', rejectCount:'불수용 / 기타', supplementCount:'보완요청', completedCount:'완료', withdrawCount:'취하' };
    const traffic = { tFineCount:'과태료', tPenaltyCount:'경고 / 범칙금', tRejectCount:'불수용 / 기타', tUnconfirmedCount:'미확인' };
    const cells = map => Object.entries(map).filter(([key]) => data.stats[key] !== undefined).map(([key,label]) => `<div class="sr-disposition"><span>${label}</span><strong>${count(data.stats[key])}건</strong></div>`).join('');
    return `<section class="sr-section sr-tile"><div class="sr-section-heading"><span class="sr-section-title">서버 전체 신고</span></div><div class="sr-disposition-grid">${cells(labels)}</div><p class="sr-note">${data.last_crawl_time ? `마지막 수집 ${esc(data.last_crawl_time)}` : ''}</p></section><section class="sr-section sr-tile"><div class="sr-section-heading"><span class="sr-section-title">교통위반 요약</span></div><div class="sr-disposition-grid">${cells(traffic)}</div></section><section><div class="sr-list-heading"><span>서버 최근 답변</span><span>${count(data.recent.length)}건</span></div><p class="sr-section sr-note">서버의 최근 기간 · 최대 ${count(data.recent_limit)}건 · 클릭하면 내 서버 상세</p><div class="sr-record-list">${data.recent.length ? data.recent.map(record).join('') : '<p class="sr-section sr-note">최근 답변이 없습니다.</p>'}</div></section>`;
  }
  const errorText = code => ({
    MODE_REQUIRED:'설정에서 셀프호스팅 / 클라우드를 선택해 주세요.',
    SERVER_NOT_CONFIGURED:'설정에서 서버 주소와 API 키를 입력해 주세요.',
    INVALID_SERVER_URL:'http(s) 서버 주소만 입력하세요. 경로·사용자 정보·쿼리는 사용할 수 없습니다.',
    INVALID_API_KEY:'API 키를 확인해 주세요.', INVALID_POLL_INTERVAL:'확인 주기는 1~1440분입니다.',
    SERVER_PERMISSION_REQUIRED:'설정에서 해당 서버의 접근 권한을 허용해 주세요.',
    SERVER_AUTH_REQUIRED:'서버 API 키가 유효하지 않습니다. 기기 연동 키를 확인해 주세요.',
    SERVER_ACCESS_DENIED:'서버의 인증·필수 동의 상태를 서버 관리 화면에서 확인해 주세요.',
    SERVER_CONFLICT:'서버의 실행 상태·필수 동의·초기화 상태를 확인해 주세요.',
    SERVER_OFFLINE:'서버에 연결할 수 없습니다. 주소·네트워크·서버 실행 상태를 확인해 주세요.',
    SERVER_UPGRADE_REQUIRED:'셀프호스팅 서버를 v3 이상으로 업데이트해 주세요.',
    COMPAT_INFO_MISSING:'서버에 protocol 3 호환 정보가 없습니다. 서버를 업데이트해 주세요.',
    CLIENT_UPGRADE_REQUIRED:'확장을 protocol 3 지원 버전으로 업데이트해 주세요.',
    CLIENT_PROTOCOL_UNSUPPORTED:'서버가 이 통신 protocol을 지원하지 않습니다. 서버·확장을 업데이트해 주세요.',
    AUTH_REQUIRED:'확장 아이콘에서 카카오 로그인 후 조회해 주세요.',
    ACCESS_DENIED:'이 계정의 공유 동의 또는 접근 상태를 확인해 주세요.',
    NOT_CONFIGURED:'배포용 클라우드 공개 설정이 필요합니다.',
    CLOUD_SHORT_VEHICLE_UNSUPPORTED:'현재 클라우드 서버는 차량번호 6글자부터 조회할 수 있습니다. 4글자 조회 지원이 필요합니다.',
    RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    UNAVAILABLE:'서버가 잠시 응답하지 않습니다. 잠시 후 다시 시도해 주세요.',
    STALE_SESSION:'모드·서버·계정이 바뀌었습니다. 다시 조회해 주세요.',
  })[code] || '요청에 실패했습니다. 다시 시도해 주세요.';
  return { esc, count, money, officialUrl, icon, queryBadge, summary, managers, record, records, serverDashboard, errorText };
})();
