import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSelfhostClient, searchDto, dashboardDto } from '../src/selfhostClient.js';
import { productMajor, verifyCompatibility, compatibilityError } from '../src/selfhostCompat.js';
const vectors = JSON.parse(readFileSync('contracts/selfhost-compat/vectors.json','utf8'));
export const probe = {status:'success',version:'3.0.0.0-dev',latest_version:null,up_to_date:true,protocol_version:3,supported_client_protocols:[3],minimum_server_major:3};
const config = {serverUrl:'http://localhost:6819',apiKey:'private-key'};
export const rows = [
  {id:'9100000001',신고번호:'SPP-2026-123456',차량번호:'12가3456',신고일:'2026-09-29',답변일:'2026-09-30',처리상태:'수용',범칙금_과태료:'과태료 40,000원',위반장소:'서울특별시 종로구 예시로 1',처리기관:'기관',담당자:'담당자',별점:'5',위반법규:'도로교통법',신고내용:'PRIVATE',apiKey:'PRIVATE'},
  {id:'9100000002',신고번호:null,차량번호:'12가3456',처리상태:'처리중'},
];
test('PC canonical contract snapshot stays byte-identical',()=>{
  const expected={}; // Snapshot hashes are updated only by copying the PC canonical files.
  expected['README.md']='e316079f01cbcb2a2f4b37d0be732b198587b9c36ca7a5abe5b4cb9ded428a24';expected['vectors.json']='c618527719c7a54790b051a632a2093e697499596742fe5028f94b149e85bd6f';
  for(const [name,hash] of Object.entries(expected))assert.equal(createHash('sha256').update(readFileSync(`contracts/selfhost-compat/${name}`)).digest('hex'),hash,name);
});
test('PC vectors: server majors and actual product 1.x are independent; HTTP refusals surface without retry',()=>{
  for(const v of vectors.cases){
    if(v.code==='SERVER_UPGRADE_REQUIRED')assert.throws(()=>verifyCompatibility({...probe,version:v.server}),new RegExp(v.code),v.name);
    else assert.equal(verifyCompatibility({...probe,version:v.server}).version,v.server,v.name);
    if(v.code)assert.equal(compatibilityError(409,{status:'error',code:v.code}),v.code,v.name);
  }
  assert.equal(productMajor('v3.0.0.0-dev+local'),3);assert.equal(productMajor('10.0.0'),10);
  for(const body of [{...probe,protocol_version:undefined},{...probe,supported_client_protocols:undefined},{...probe,minimum_server_major:undefined}])assert.throws(()=>verifyCompatibility(body),/COMPAT_INFO_MISSING/);
  assert.throws(()=>verifyCompatibility({...probe,supported_client_protocols:[4]}),/CLIENT_PROTOCOL_UNSUPPORTED/);
});
test('selfhost: version handshake before every data/control request, exact headers, no Supabase; query length stops network',async()=>{
  const calls=[];
  const client=createSelfhostClient({version:'1.1.0',permission:async()=>true,fetchImpl:async(url,options)=>{
    calls.push({url,options});assert.ok(url.startsWith(config.serverUrl));assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    assert.deepEqual({...options.headers},{'X-API-Key':'private-key','X-SafetyReport-Client':'chromeextension','X-SafetyReport-Version':'1.1.0','X-SafetyReport-Protocol':'3',...(options.method==='POST'?{'Content-Type':'application/json'}:{})});
    return new Response(JSON.stringify(url.endsWith('/server/version')?probe:url.endsWith('/summary')?{status:'success',data:{total:2,processingCount:1,recent_answers:rows}}:url.endsWith('/crawl/status')?{status:'success',running:false,pending:0}:url.includes('/crawl/')?{status:'success'}:{status:'success',count:rows.length,data:rows}));
  }});
  for(const [operation,message] of [['search',{kind:'vehicle',query:' 12 가3456 '}],['numbers',{kind:'address',query:'서울 종로구 예시로 1'}],['summary',{}],['crawl-start',{}],['crawl-stop',{}],['crawl-status',{}]]){
    const begin=calls.length;await client(config,operation,message);assert.equal(calls[begin].url,config.serverUrl+'/api/v1/server/version');assert.equal(calls.length,begin+2);
  }
  const before=calls.length;
  // Validate before probing too: 6-character minimum applies at the trust boundary.
  await assert.rejects(client(config,'search',{kind:'vehicle',query:'12가3'}),/INVALID_QUERY/);
  assert.equal(calls.length,before);
});
test('selfhost: unauthorized, old server, absent metadata, HTTP409 and offline never fall back or retry',async()=>{
  for(const [body,status,error]of [[null,0,'SERVER_OFFLINE'],[{},401,'SERVER_AUTH_REQUIRED'],[{},403,'SERVER_ACCESS_DENIED'],[{...probe,version:'2.9.0'},200,'SERVER_UPGRADE_REQUIRED'],[{status:'success',version:'3.0.0.0'},200,'COMPAT_INFO_MISSING'],[{status:'error',code:'CLIENT_UPGRADE_REQUIRED'},409,'CLIENT_UPGRADE_REQUIRED'],[{status:'error',code:'CLIENT_PROTOCOL_UNSUPPORTED'},409,'CLIENT_PROTOCOL_UNSUPPORTED']]){
    let calls=0;const client=createSelfhostClient({version:'1.1.0',permission:async()=>true,fetchImpl:async()=>{calls++;if(status===0)throw new Error('secret-key-must-not-leak');return new Response(JSON.stringify(body),{status});}});
    await assert.rejects(client(config,'summary'),new RegExp(error));assert.equal(calls,1);
  }
  let calls=0;const denied=createSelfhostClient({version:'1.1.0',permission:async()=>false,fetchImpl:async()=>{calls++;}});
  await assert.rejects(denied(config,'summary'),/SERVER_PERMISSION_REQUIRED/);assert.equal(calls,0);
});
test('selfhost DTO retains processing, official vs server detail meanings and excludes secret/body fields',()=>{
  const search=searchDto({status:'success',count:2,data:rows},config.serverUrl);
  assert.equal(search.summary.statuses.처리중,1);assert.equal(search.reports.items[0].official_url,'https://www.safetyreport.go.kr/#mypage/mysafereport/9100000001');
  assert.equal(search.reports.items[0].detail_url,null);assert.equal(search.reports.items[0].apiKey,undefined);assert.equal(search.reports.items[0].신고내용,undefined);
  const summary=dashboardDto({status:'success',data:{total:2,recent_answers:rows}},config.serverUrl);
  assert.ok(summary.recent[0].detail_url.startsWith('http://localhost:6819/data/all?open='));assert.equal(summary.stats.processingCount,undefined);
});
