// my-reports-v1 client rules (src/myReportsClient.js) and the contract copy (contracts/my-reports, map repo canonical).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { buildRequest, classifyError, retryAfterSeconds, PAGE } from '../src/myReportsClient.js';

const fixture = name => JSON.parse(readFileSync(`contracts/my-reports/fixtures/${name}.json`, 'utf8'));

test('contract copy matches MANIFEST.sha256 byte-for-byte (sync_contract_copy.py --contract my-reports)', () => {
  const root = 'contracts/my-reports/';
  const listed = new Map(readFileSync(`${root}MANIFEST.sha256`, 'utf8').trim().split('\n')
    .map(line => { const [hash, path] = line.split('  '); return [path.replace(/^\.\//, ''), hash]; }));
  const files = [];
  const walk = rel => { for (const name of readdirSync(root + (rel || '.'))) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(root + r).isDirectory()) walk(r); else if (r !== 'MANIFEST.sha256') files.push(r);
  } };
  walk('');
  assert.deepEqual([...listed.keys()].sort(), files.sort());
  for (const f of files) assert.equal(createHash('sha256').update(readFileSync(root + f)).digest('hex'), listed.get(f), f);
});

test('requests: normalised query in the body, fixed page sizes, cursor passed through, no offset/version', () => {
  assert.deepEqual(buildRequest('search', { kind: 'vehicle', query: ' 12 가 3456 ' }),
    { route: 'search', body: { kind: 'vehicle', query: '12가3456', part: 'reports', cursor: null, page_size: 20, managers_page_size: 10 } });
  assert.deepEqual(buildRequest('search', { kind: 'address', query: '  서울특별시  종로구 예시로 1 ', part: 'managers', cursor: 'abc.def' }),
    { route: 'search', body: { kind: 'address', query: '서울특별시 종로구 예시로 1', part: 'managers', cursor: 'abc.def', managers_page_size: 10 } });
  assert.deepEqual(buildRequest('numbers', { kind: 'vehicle', query: '12가3456', cursor: 'a.b' }),
    { route: 'numbers', body: { kind: 'vehicle', query: '12가3456', cursor: 'a.b', page_size: 500 } });
  assert.deepEqual(buildRequest('summary', {}), { route: 'summary', body: { cursor: null, page_size: 20 } });
  assert.equal(PAGE.numbers, 500);
  for (const bad of [{ kind: 'vehicle', query: '가3456' }, { kind: 'vehicle', query: '가'.repeat(65) }, { kind: 'plate', query: '12가3456' },
    { kind: 'address', query: '종로구' }, { kind: 'vehicle', query: '12가3456', cursor: 'no dot' }, { kind: 'vehicle', query: '12가3456', cursor: 5 }]) {
    assert.throws(() => buildRequest('search', bad), /INVALID_QUERY/, JSON.stringify(bad));
  }
});

test('errors: contract codes map to one UI code each; non-contract bodies never look like data', () => {
  const body = code => ({ error: { code, message: 'x', retryable: false }, request_id: 'r' });
  assert.deepEqual(classifyError(401, body('SESSION_EXPIRED')), { code: 'AUTH_REQUIRED', refresh: true, clear: true });
  assert.deepEqual(classifyError(401, body('AUTH_REQUIRED')), { code: 'AUTH_REQUIRED', refresh: false, clear: true });
  assert.equal(classifyError(401, null).refresh, true); // gateway 401 without a contract body
  assert.equal(classifyError(403, body('KAKAO_REQUIRED')).code, 'ACCESS_DENIED');
  assert.equal(classifyError(403, body('ACCOUNT_INELIGIBLE')).code, 'ACCESS_DENIED');
  assert.equal(classifyError(403, body('ORIGIN_FORBIDDEN')).code, 'NOT_CONFIGURED');
  for (const c of ['DATASET_CHANGED', 'CURSOR_EXPIRED', 'INVALID_CURSOR']) assert.deepEqual(classifyError(c === 'INVALID_CURSOR' ? 400 : 409, body(c)), { code: 'DATASET_CHANGED', restart: true });
  assert.equal(classifyError(422, body('NUMBERS_LIMIT_EXCEEDED')).code, 'NUMBERS_LIMIT_EXCEEDED');
  assert.equal(classifyError(429, body('RATE_LIMITED')).code, 'RATE_LIMITED');
  assert.equal(classifyError(503, body('QUERY_TIMEOUT')).code, 'UNAVAILABLE');
  assert.equal(classifyError(402, null).code, 'UNAVAILABLE');
  assert.equal(classifyError(500, '<html>').code, 'REQUEST_FAILED');
  assert.equal(retryAfterSeconds('30'), 30);
  assert.equal(retryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT'), 60);
  assert.equal(retryAfterSeconds('99999'), 60);
});

test('shared-ui renders the real v1 fixtures: nested summary, null fine sum, server link, status label', () => {
  const context = {}; vm.runInNewContext(readFileSync('shared-ui.js', 'utf8'), context);
  const ui = context.SRUI;
  const first = fixture('search-vehicle-first-page');
  const summaryHtml = ui.summary(first.summary);
  assert.ok(summaryHtml.includes('수용률 50%'));
  assert.ok(summaryHtml.includes('40,000원'));
  const empty = fixture('search-empty');
  assert.ok(ui.summary(empty.summary).includes('확인된 금액 없음'));
  const html = ui.records(first.reports);
  assert.ok(html.includes('href="https://www.safetyreport.go.kr/#mypage/mysafereport/9100000001"'));
  assert.ok(html.includes('결과 미상') || first.reports.items.every(i => i.status !== 'completed_unknown'));
  const legacy = fixture('search-vehicle-next-page').reports.items.find(i => i.official_url === null);
  if (legacy) assert.ok(!ui.record(legacy).includes('href='));
  const managers = ui.managers({ ...first.managers, items: first.managers.items }, true);
  assert.ok(managers.includes('담당자 더 보기') === Boolean(first.managers.next_cursor));
  assert.ok(ui.record({ ...first.reports.items[0], official_url: 'https://evil.example/#mypage/mysafereport/1' }).includes('href=') === false);
});

test('worker DTO refuses missing counts and nested objects disguised as public fields', async () => {
  const { projectCloudDto } = await import('../src/myReportsClient.js');
  const empty = fixture('search-empty');
  assert.equal(projectCloudDto(empty, 'search').summary.fine_amount.confirmed_sum_won, null);
  const missing = structuredClone(empty); delete missing.summary.status.accepted;
  assert.throws(() => projectCloudDto(missing, 'search'), /REQUEST_FAILED/);
  const leaked = fixture('search-vehicle-first-page'); leaked.reports.items[0].vehicle_number = { apiKey: 'PRIVATE' };
  assert.throws(() => projectCloudDto(leaked, 'search'), /REQUEST_FAILED/);
});
