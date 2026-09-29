import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context={};vm.runInNewContext(readFileSync('shared-ui.js','utf8'),context);
const ui=context.SRUI;

test('only verified numeric source IDs produce official detail links',()=>{
  assert.equal(ui.officialUrl('80000001'),'https://www.safetyreport.go.kr/#mypage/mysafereport/80000001');
  for(const invalid of ['javascript:alert(1)','80000001/evil','',null])assert.equal(ui.officialUrl(invalid),null);
});

test('private report rendering excludes content fields and escapes untrusted values',()=>{
  const html=ui.record({source_report_id:'javascript:alert(1)',report_number:'SPP-2026-123456',
    vehicle_number:'<img src=x onerror=alert(1)>',status:'accepted',disposition:'fine',
    amount_kind:'unknown',confirmed_amount_won:999999,report_title:'SECRET_TITLE',
    report_body:'SECRET_BODY',answer_body:'SECRET_ANSWER',attachment:'SECRET_ATTACHMENT'});
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href='));
  assert.ok(!html.includes('999,999원'));
  for(const secret of ['SECRET_TITLE','SECRET_BODY','SECRET_ANSWER','SECRET_ATTACHMENT'])assert.ok(!html.includes(secret));
});
