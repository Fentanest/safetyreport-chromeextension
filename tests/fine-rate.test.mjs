import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { searchDto } from '../src/selfhostClient.js';
import { projectCloudDto } from '../src/myReportsClient.js';

const context = {};
vm.runInNewContext(readFileSync('shared-ui.js', 'utf8'), context);
const ui = context.SRUI;
const cloud = () => JSON.parse(readFileSync('contracts/my-reports/fixtures/search-vehicle-first-page.json', 'utf8'));
const manager = () => ({ ...cloud().managers.items[0], total: 10,
  status: { accepted: 8, partial: 1, rejected: 0, completed_unknown: 1 }, accept_rate: 80,
  disposition: { fine: 3, warning: 1, penalty: 0, none: 5, unknown: 1 },
  fine_amount: { fine_count: 3, confirmed_count: 1, confirmed_sum_won: 40000, unconfirmed_count: 2, other_count: 0 } });
const ratio = (html, accepted, fine) => {
  assert.ok(html.includes(`수용률 ${accepted}`), html);
  assert.ok(html.includes(`과태료처분율 ${fine}`), html);
};

test('cloud manager uses full completed total including unknown; fine disposition differs from confirmed amount and pages', () => {
  const payload = cloud();
  payload.managers.items = [manager()];
  payload.reports.items = payload.reports.items.slice(0, 1);
  payload.managers.total_managers = 20;
  payload.managers.next_cursor = 'opaque-manager-cursor';
  const dto = projectCloudDto(payload, 'search');
  const html = ui.managers(dto.managers, true);
  ratio(html, '80.0% (8/10건)', '30.0% (3/10건)');
  assert.ok(html.includes('일부 수용 1건'));
  assert.ok(html.includes('확정 과태료 40,000원'));
  assert.ok(html.includes('고유 완료 신고 기준 · 결과 미상 포함'));
  assert.ok(html.includes('담당자 더 보기'));
  // Receiving more managers never changes an existing person's denominator.
  const appended = ui.managers({ ...dto.managers, items: [...dto.managers.items, { ...manager(), manager_key: 'other' }] });
  assert.equal(appended.match(/과태료처분율 30\.0% \(3\/10건\)/g).length, 2);
  const noAmount = manager();
  noAmount.fine_amount = { fine_count: 3, confirmed_count: 0, confirmed_sum_won: null, unconfirmed_count: 3, other_count: 0 };
  ratio(ui.managers({ items: [noAmount] }), '80.0% (8/10건)', '30.0% (3/10건)');
  assert.ok(ui.managers({ items: [noAmount] }).includes('확정 과태료 금액 없음'));
});

for (const backend of ['cloud', 'selfhost']) {
  test(`${backend} manager distinguishes positive-denominator zero from empty/missing aggregates`, () => {
    const person = backend === 'cloud' ? manager() : { manager_name: '시험', total: 10, accepted: 8, fine_count: 3 };
    const set = (key, value) => {
      const row = structuredClone(person);
      if (backend === 'cloud' && key === 'fine') row.disposition.fine = value;
      else if (backend === 'cloud' && key === 'accepted') row.status.accepted = value;
      else row[key === 'fine' ? 'fine_count' : key] = value;
      return row;
    };
    const render = row => ui.managers({ backend, items: [row] }, true);
    ratio(render(set('fine', 0)), '80.0% (8/10건)', '0.0% (0/10건)');
    ratio(render(set('accepted', 0)), '0.0% (0/10건)', '30.0% (3/10건)');
    for (const absent of [undefined, null]) {
      assert.ok(render(set('fine', absent)).includes('과태료처분율 —'));
      ratio(render(set('total', absent)), '—', '—');
    }
    ratio(render(set('total', 0)), '—', '—');
    // An amount aggregate alone is never a substitute for a missing disposition aggregate.
    if (backend === 'cloud') {
      const row = structuredClone(person); delete row.disposition;
      assert.ok(render(row).includes('과태료처분율 —'));
    }
  });
}

test('selfhost counts only disposition has_fine and preserves all server rows, processing and separate agencies', () => {
  const dispositions = ['과태료', '과태료 금액 미확인', '범칙금 / 과태료', '범칙금 40,000원', '계도', '경고', '미확인', null, ''];
  const rows = dispositions.map((범칙금_과태료, index) => ({
    id: String(9100000000 + index), 신고번호: `TEST-${index}`, 처리기관: '기관 A', 담당자: '동명이인',
    처리상태: index < 2 ? '수용' : index === 2 ? '처리중' : '불수용', 범칙금_과태료,
    처리내용: '과태료 90,000원 부과', 신고내용: '과태료', confirmed_amount_won: 90000,
  }));
  rows.push({ 처리기관: '기관 B', 담당자: '동명이인', 처리상태: '일부수용', 범칙금_과태료: '범칙금' });
  const dto = searchDto({ status: 'success', count: rows.length, data: rows }, 'http://localhost:6819');
  assert.equal(dto.summary.total, 10);
  assert.equal(dto.reports.items.length, 10);
  assert.equal(dto.summary.statuses.처리중, 1);
  assert.deepEqual(dto.managers.items.map(p => [p.agency_name_original, p.total, p.accepted, p.fine_count]),
    [['기관 A', 9, 2, 3], ['기관 B', 1, 0, 0]]);
  const html = ui.managers(dto.managers, true);
  ratio(html, '22.2% (2/9건)', '33.3% (3/9건)');
  assert.ok(html.includes('과태료처분율 0.0% (0/1건)'));
  assert.ok(html.includes('서버 검색 전체 신고 기준 · 처리중 포함'));
  assert.ok(!html.includes('90,000'));
});

test('selfhost groups one agency arriving under several department codes by the server agency_key', () => {
  const key = 'inst:ag-c1321068', current = '서울특별시경찰청 서울강서경찰서';
  const rows = [
    ['경찰청 서울특별시경찰청 서울강서경찰서 경비교통과', '수용'],
    ['경찰청 서울특별시경찰청 서울강서경찰서 교통과', '불수용'],
    ['경찰청 서울특별시경찰청 서울강서경찰서', '불수용'],
  ].map(([처리기관, 처리상태], index) => ({ id: String(9200000000 + index), 신고번호: `K-${index}`, 처리기관, 처리상태,
    담당자: '담당자 갑', 범칙금_과태료: '', agency_name_current: current, agency_key: key }));
  // An older server without the additive fields keeps the previous per-original-name grouping.
  rows.push({ 처리기관: '기관 B', 담당자: '담당자 갑', 처리상태: '수용', 범칙금_과태료: '' });
  const dto = searchDto({ status: 'success', count: rows.length, data: rows }, 'http://localhost:6819');
  assert.deepEqual(dto.managers.items.map(p => [p.agency_name_current ?? null, p.agency_name_original, p.total, p.accepted]),
    [[current, '경찰청 서울특별시경찰청 서울강서경찰서 경비교통과', 3, 1], [null, '기관 B', 1, 1]]);
  assert.equal(dto.reports.items[1].agency_name_current, current);
  assert.equal(dto.reports.items[1].agency_name_original, '경찰청 서울특별시경찰청 서울강서경찰서 교통과');
  const html = ui.managers(dto.managers, true);
  assert.ok(html.includes(`<div class="sr-officer-agency">${current}</div>`));
  assert.ok(!html.includes('경비교통과'));
  // Report cards show the current name and keep the source name as a note.
  const cards = ui.records(dto.reports);
  assert.ok(cards.includes(current));
  assert.ok(cards.includes('당시 경찰청 서울특별시경찰청 서울강서경찰서 교통과'));
});

test('both manager paths round original counts to one decimal instead of using pre-rounded accept_rate', () => {
  const p = { ...manager(), total: 6, status: { ...manager().status, accepted: 1 }, disposition: { fine: 1 }, accept_rate: 99 };
  ratio(ui.managers({ items: [p] }), '16.7% (1/6건)', '16.7% (1/6건)');
  ratio(ui.managers({ backend: 'selfhost', items: [{ total: 6, accepted: 1, fine_count: 1 }] }), '16.7% (1/6건)', '16.7% (1/6건)');
  ratio(ui.managers({ backend: 'selfhost', items: [{ total: 2000, accepted: 333, fine_count: 333 }] }), '16.7% (333/2,000건)', '16.7% (333/2,000건)');
});
