import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
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

test('cloud manager distinguishes positive-denominator zero from empty/missing aggregates', () => {
  const person = manager();
  const set = (key, value) => {
    const row = structuredClone(person);
    if (key === 'fine') row.disposition.fine = value;
    else if (key === 'accepted') row.status.accepted = value;
    else row[key] = value;
    return row;
  };
  const render = row => ui.managers({ items: [row] }, true);
  ratio(render(set('fine', 0)), '80.0% (8/10건)', '0.0% (0/10건)');
  ratio(render(set('accepted', 0)), '0.0% (0/10건)', '30.0% (3/10건)');
  for (const absent of [undefined, null]) {
    assert.ok(render(set('fine', absent)).includes('과태료처분율 —'));
    ratio(render(set('total', absent)), '—', '—');
  }
  ratio(render(set('total', 0)), '—', '—');
  // An amount aggregate alone is never a substitute for a missing disposition aggregate.
  const row = structuredClone(person); delete row.disposition;
  assert.ok(render(row).includes('과태료처분율 —'));
});

test('manager rates round original counts to one decimal instead of using pre-rounded accept_rate', () => {
  const p = { ...manager(), total: 6, status: { ...manager().status, accepted: 1 }, disposition: { fine: 1 }, accept_rate: 99 };
  ratio(ui.managers({ items: [p] }), '16.7% (1/6건)', '16.7% (1/6건)');
  const large = { ...manager(), total: 2000, status: { ...manager().status, accepted: 333 }, disposition: { fine: 333 } };
  ratio(ui.managers({ items: [large] }), '16.7% (333/2,000건)', '16.7% (333/2,000건)');
});
