'use strict';
// Pure rendering helpers shared by the popup and the two ShadowRoot panels. API fields are allowlisted here.
globalThis.SRUI = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR') : '0';
  const money = value => Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('ko-KR')}원` : '';
  const officialUrl = id => /^\d{1,20}$/.test(String(id ?? ''))
    ? `https://www.safetyreport.go.kr/#mypage/mysafereport/${encodeURIComponent(id)}` : null;
  const tone = status => ({ accepted: 'accept', partial: 'partial', rejected: 'reject' })[status] || 'unknown';
  const statusName = status => ({ accepted: '수용', partial: '일부수용', rejected: '불수용', completed_unknown: '결과 분류 없음' })[status] || '결과 분류 없음';
  const dispositionName = value => ({ fine: '과태료', warning: '경고', penalty: '범칙금', none: '처분 없음', unknown: '처분 미확인' })[value] || '처분 미확인';
  function summary(data) {
    const s = data?.summary || {};
    const total = Number(s.total) || 0;
    const statuses = [['accepted','수용'],['partial','일부수용'],['rejected','불수용']];
    if (Number(s.completed_unknown)) statuses.push(['completed_unknown','분류 없음']);
    const cells = statuses.map(([key,label]) => `<div class="sr-stat"><span class="sr-stat-label"><i class="sr-status-dot sr-status-dot--${tone(key)}"></i>${label}</span><b class="sr-stat-value sr-numeric">${count(s[key])}</b><span class="sr-stat-percent">${total ? Math.round(Number(s[key] || 0) / total * 100) : 0}%</span></div>`).join('');
    return `<section class="sr-section"><div class="sr-section-heading"><span class="sr-section-title">처리 결과</span><span class="sr-section-description">완료 신고 ${count(total)}건 기준</span></div><div class="sr-stat-grid${statuses.length === 4 ? ' sr-stat-grid--four' : ''}">${cells}</div></section>
      <section class="sr-section"><div class="sr-section-heading"><span class="sr-section-title">처분</span></div><div class="sr-disposition-grid"><div class="sr-disposition"><span>과태료</span><strong>${count(s.fine)}건</strong></div><div class="sr-disposition"><span>경고·범칙금</span><strong>${count(Number(s.warning || 0) + Number(s.penalty || 0))}건</strong></div><div class="sr-disposition"><span>처분 없음</span><strong>${count(s.disposition_none)}건</strong></div><div class="sr-disposition"><span>미확인</span><strong>${count(s.disposition_unknown)}건</strong></div></div><div class="sr-amount-line"><span>확정 과태료 합계</span><strong>${money(s.confirmed_fine_won)}</strong></div><p class="sr-note">확정 금액 ${count(s.confirmed_fine_count)}건 기준</p></section>`;
  }
  function managers(data, open = false) {
    const people = Array.isArray(data?.managers) ? data.managers : [];
    if (!people.length) return '';
    return `<section class="sr-section sr-officer-section"><details ${open ? 'open' : ''}><summary class="sr-officer-summary">담당자별 ${count(data.manager_total ?? people.length)}명 <span>수용률·과태료 보기</span></summary>${data.managers_truncated ? '<p class="sr-note">건수 상위 100명만 표시합니다.</p>' : ''}${people.map(p => `<div class="sr-officer"><div class="sr-officer-top"><span class="sr-officer-name">${esc(p.manager_name)}</span><b>${count(p.total)}건</b></div><div class="sr-officer-agency">${esc(p.agency_name_current || p.agency_name_original || '')}</div><div class="sr-officer-results"><span>수용 ${count(p.accepted)}건 · ${p.total ? Math.round(Number(p.accepted) / Number(p.total) * 100) : 0}%</span><span>일부수용 ${count(p.partial)}건</span><span>과태료 ${count(p.fine)}건</span><span>확정 ${money(p.confirmed_fine_won)}</span></div></div>`).join('')}</details></section>`;
  }
  function record(item) {
    const url = officialUrl(item.source_report_id);
    const label = item.report_number || '신고번호 미확인';
    const number = item.vehicle_number || '차량번호 없음';
    const showAmount = item.confirmed_amount_won !== null && item.confirmed_amount_won !== undefined &&
      ((item.disposition === 'fine' && item.amount_kind === 'fine') ||
       (item.disposition === 'penalty' && item.amount_kind === 'penalty'));
    const badges = `<span class="sr-badge sr-badge--${tone(item.status)}">${statusName(item.status)}</span>` +
      (item.disposition && item.disposition !== 'none' && item.disposition !== 'unknown'
        ? `<span class="sr-badge sr-badge--${item.disposition === 'fine' ? 'fine' : 'penalty'}">${dispositionName(item.disposition)}${showAmount ? ` ${money(item.confirmed_amount_won)}` : ''}</span>` : '');
    const meta = [item.report_number ? `<span class="sr-report-number">${esc(item.report_number)}</span>` : '',
      item.report_date ? `<span>신고 ${esc(item.report_date)}</span>` : '',
      item.completed_date ? `<span>답변 ${esc(item.completed_date)}</span>` : ''].filter(Boolean).join('');
    const agency = [item.agency_name_current || item.agency_name_original, item.manager_name].filter(Boolean).map(esc).join(' · ');
    const agencyOriginal = item.agency_name_original && item.agency_name_current && item.agency_name_original !== item.agency_name_current
      ? `<p class="sr-note">당시 ${esc(item.agency_name_original)}</p>` : '';
    const inner = `<div class="sr-record-top"><span class="sr-record-key">${esc(number)}</span><div class="sr-record-badges">${badges}</div></div><div class="sr-record-law"><span>${esc(item.violation_law || '')}</span>${Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5 ? `<span class="sr-rating">별점 ${item.rating}/5</span>` : ''}</div><div class="sr-record-meta">${meta}</div>${agency ? `<p class="sr-record-agency">${agency}</p>` : ''}${agencyOriginal}${item.address ? `<p class="sr-record-address">${esc(item.address)}</p>` : ''}`;
    return `<article class="sr-record">${url ? `<a class="sr-record-main" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)} 안전신문고 원문">${inner}</a>` : `<div class="sr-record-main">${inner}</div>`}</article>`;
  }
  const records = data => `<div class="sr-list-heading"><span>완료 신고</span><span>${count(data?.total)}건</span></div><div class="sr-record-list">${data?.items?.length ? data.items.map(record).join('') : '<p class="sr-section sr-note">조회된 완료 신고가 없습니다.</p>'}</div>`;
  return { esc, count, money, officialUrl, summary, managers, record, records };
})();
