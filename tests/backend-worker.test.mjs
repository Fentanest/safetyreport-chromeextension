import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { worker, session, authKey, SUPA } from './worker-harness.mjs';
const fixture = name => JSON.parse(readFileSync(`contracts/my-reports/fixtures/${name}.json`,'utf8'));
const config = { serverUrl:'http://localhost:6819', apiKey:'private-server-key', notifyCrawlDone:true, pollInterval:5 };
test('worker: durable migration, trusted storage, explicit selection and distinct logout',async()=>{
  const app=await worker({sync:config});
  assert.equal(app.stores.local.backendMode,'selfhost');assert.deepEqual(app.stores.local.selfhost,config);
  assert.equal(app.stores.sync.apiKey,undefined);assert.equal(app.calls[0].accessLevel.accessLevel,'TRUSTED_CONTEXTS');
  app.stores.local[authKey]=session('a');
  await app.send({type:'SET_MODE',backendMode:'cloud'});
  assert.equal(app.alarms.size,0);assert.deepEqual(app.stores.local.selfhost,config);assert.ok(app.stores.local[authKey]);
  await app.send({type:'SET_MODE',backendMode:'selfhost'});
  assert.equal(app.calls.filter(call=>call.auth).length,0);assert.equal(app.alarms.size,1);
  await assert.rejects(app.send({type:'LOGOUT'}),/MODE_UNSUPPORTED/);
  await app.send({type:'SET_MODE',backendMode:'cloud'});await app.send({type:'LOGOUT'});
  assert.equal(app.stores.local[authKey],undefined);
  const restarted=await worker({local:app.stores.local,sync:app.stores.sync});
  assert.equal((await restarted.send({type:'GET_SETTINGS'})).backendMode,'cloud');assert.equal(restarted.calls.filter(call=>call.url).length,0);
});
test('worker: content cannot read settings or control crawl; unknown destination never proxies',async()=>{
  const app=await worker({local:{backendMode:'cloud',[authKey]:session('a')}});
  for(const type of ['GET_SETTINGS','SAVE_SERVER','SET_MODE','CRAWL_START','SUMMARY','LOGIN','LOGOUT'])await assert.rejects(app.send({type},'content'),/FORBIDDEN/);
  await assert.rejects(app.send({type:'SEARCH',kind:'vehicle',query:'12가3',url:'http://evil'},'content'),/INVALID_QUERY/);
  await assert.rejects(app.send({type:'FETCH_URL',url:'http://evil'},'content'),/FORBIDDEN/);
  assert.equal(app.calls.filter(call=>call.url).length,0);
});
test('worker: cloud requests only Supabase, allowlist DTO, own account cache and late response discarded on switch',async()=>{
  let release;
  const raw=fixture('search-vehicle-first-page');raw.secret='PRIVATE';raw.reports.items[0].apiKey='PRIVATE';
  const app=await worker({local:{backendMode:'cloud',selfhost:config,[authKey]:session('a')},fetchImpl:async(url,options)=>{
    assert.ok(url.startsWith(SUPA));assert.equal(options.headers['X-API-Key'],undefined);assert.equal(options.headers['X-SafetyReport-Protocol'],undefined);
    if(release===undefined)return new Response(JSON.stringify(raw));
    return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify(raw)));});
  }});
  const query={type:'SEARCH',kind:'vehicle',query:'12가3456'};
  const data=await app.send(query,'content');assert.equal(data.secret,undefined);assert.equal(data.reports.items[0].apiKey,undefined);
  await app.send(query);assert.equal(app.calls.filter(call=>call.url).length,1);
  await app.chrome.storage.local.set({[authKey]:session('b')});await app.send(query);assert.equal(app.calls.filter(call=>call.url).length,2);
  release=null;const late=app.send({...query,fresh:true});const handled=assert.rejects(late,/STALE_SESSION/);
  while(typeof release!=='function')await new Promise(r=>setTimeout(r,0));
  await app.send({type:'SET_MODE',backendMode:'selfhost'});release();await handled;
  assert.equal(app.calls.filter(call=>call.url&&!call.url.startsWith(SUPA)).length,0);
  assert.equal(app.calls.filter(call=>call.auth==='signOut').length,0);
});
test('worker: cloud expiry refresh once, gateway 401 retry once, offline and forbidden are errors',async()=>{
  let count=0;
  const app=await worker({local:{backendMode:'cloud',[authKey]:session('a')},fetchImpl:async()=>{
    count++;return count===1?new Response(JSON.stringify({error:{code:'SESSION_EXPIRED'}}),{status:401}):new Response(JSON.stringify(fixture('summary-first-page')));
  }});
  await app.send({type:'SUMMARY'});assert.equal(count,2);assert.equal(app.calls.filter(c=>c.auth==='refreshSession').length,1);
  const blocked=await worker({local:{backendMode:'cloud',[authKey]:session('a')},fetchImpl:async()=>new Response(JSON.stringify({error:{code:'ACCOUNT_INELIGIBLE'}}),{status:403})});
  await assert.rejects(blocked.send({type:'SUMMARY'}),/ACCESS_DENIED/);
});
const probe={status:'success',version:'3.0.0.0-dev',protocol_version:3,supported_client_protocols:[3],minimum_server_major:3};
const selfRows=[{id:'9100000001',신고번호:'SPP-2026-123456',차량번호:'12가3456',처리상태:'수용'},{id:'9100000002',신고번호:null,처리상태:'처리중'}];
const mockSelfhost=(url)=>new Response(JSON.stringify(url.endsWith('/server/version')?probe:url.endsWith('/crawl/status')?{status:'success',running:false,pending:0}:url.endsWith('/summary')?{status:'success',data:{total:2,processingCount:1,recent_answers:selfRows}}:url.endsWith('/crawl/done/ext')?{status:'success',done:true,changes:[{notification_kind:'duplicate',duplicate_change_type:'group_added',representative_report_number:'SPP-2026-123456'}]}:{status:'success',count:selfRows.length,data:selfRows}));
test('worker: selfhost bypasses cloud auth/expiry, slow responses cannot survive a mode/server change',async()=>{
  let release=null, slow=false;
  const expired={...session('a'),expires_at:0};
  const app=await worker({local:{backendMode:'selfhost',selfhost:config,[authKey]:expired},fetchImpl:async(url,options)=>{
    assert.ok(!url.startsWith(SUPA));
    if(slow&&url.includes('/vehicle/'))return new Promise(resolve=>{release=()=>resolve(mockSelfhost(url));});
    return mockSelfhost(url);
  }});
  await app.send({type:'STATUS'});await app.send({type:'SEARCH',kind:'vehicle',query:'12가3456'},'content');
  await app.send({type:'SUMMARY'});assert.equal(app.calls.filter(c=>c.auth).length,0);
  await assert.rejects(app.send({type:'SEARCH',kind:'vehicle',query:'12가3'},'content'),/INVALID_QUERY/);
  slow=true;const query={type:'SEARCH',kind:'vehicle',query:'13가3456'};
  const old=app.send(query,'content'),checked=assert.rejects(old,/STALE_SESSION/);
  while(!release)await new Promise(r=>setTimeout(r,0));
  await app.send({type:'SET_MODE',backendMode:'cloud'});assert.equal(app.alarms.size,0);
  await app.send({type:'SET_MODE',backendMode:'selfhost'});
  await app.send({type:'SAVE_SERVER',...config,serverUrl:'http://192.168.1.2:6819',apiKey:'new-private-key'});
  release();await checked;slow=false;
  await app.send(query,'content');
  assert.ok(app.calls.filter(c=>c.url?.includes('/vehicle/')).at(-1).url.startsWith('http://192.168.1.2:6819'));
  assert.equal(app.calls.filter(c=>c.auth).length,0);
});
test('worker: polling dedupes, persistent transitions restore, notifications and badges stop in cloud',async()=>{
  let running=false, done=false;
  const app=await worker({local:{backendMode:'selfhost',selfhost:config,[authKey]:session('a')},fetchImpl:async(url)=>{
    if(url.endsWith('/crawl/status'))return new Response(JSON.stringify({status:'success',running,pending:0}));
    if(url.endsWith('/crawl/done/ext')){const available=done;done=false;return available?mockSelfhost(url):Response.json({status:'success',done:false});}
    return mockSelfhost(url);
  }});
  const poll=()=>app.chrome.alarms.onAlarm.emit({name:'safetyreport_poll'});
  poll();poll();await new Promise(r=>setTimeout(r,30));
  assert.equal(app.calls.filter(c=>c.url?.endsWith('/crawl/status')).length,1);assert.equal(app.notices.size,0);
  assert.equal(app.badges.at(-1),'1');assert.equal(app.stores.local.srCrawlState.running,false);
  running=true;poll();await new Promise(r=>setTimeout(r,30));assert.equal(app.notices.size,1);
  running=false;done=true;poll();await new Promise(r=>setTimeout(r,30));assert.ok([...app.notices.values()].some(x=>x.message.includes('신규 중복군')));
  await app.send({type:'SET_MODE',backendMode:'cloud'});const count=app.calls.filter(c=>c.url).length;
  poll();await new Promise(r=>setTimeout(r,20));assert.equal(app.calls.filter(c=>c.url).length,count);assert.equal(app.notices.size,0);assert.equal(app.badges.at(-1),'');
});
test('worker: a crawl completed between alarms is consumed once; disabled notifications never consume it',async()=>{
  let done=false;
  const app=await worker({local:{backendMode:'selfhost',selfhost:config},fetchImpl:async url=>{
    if(url.endsWith('/crawl/done/ext')){const available=done;done=false;return available?mockSelfhost(url):Response.json({status:'success',done:false});}
    return mockSelfhost(url);
  }});
  const poll=()=>vm.runInContext('pollCrawlStatus()',app.context);
  await poll();assert.equal(app.notices.size,0);
  done=true;await Promise.all([poll(),poll()]);
  assert.equal(app.notices.size,1);assert.ok([...app.notices.values()][0].title.startsWith('크롤링 완료'));
  const notice=[...app.notices.values()][0];await poll();assert.equal([...app.notices.values()][0],notice);
  assert.equal(app.calls.filter(c=>c.url?.endsWith('/crawl/done/ext')).length,3);
  done=true;app.chrome.permissions.contains=async request=>!request.permissions?.includes('notifications');
  await poll();assert.equal(done,true);
  await app.send({type:'SAVE_SERVER',...config,notifyCrawlDone:false});app.chrome.permissions.contains=async()=>true;
  await poll();assert.equal(done,true);
  await app.send({type:'SET_MODE',backendMode:'cloud'});const calls=app.calls.length;await poll();assert.equal(app.calls.length,calls);
});
test('worker: restart restores only the last successful badge for the same server credential',async()=>{
  const app=await worker({local:{backendMode:'selfhost',selfhost:{...config,notifyCrawlDone:false}},fetchImpl:mockSelfhost});
  await vm.runInContext('pollCrawlStatus()',app.context);assert.equal(app.badges.at(-1),'1');
  const restarted=await worker({local:app.stores.local,fetchImpl:mockSelfhost});
  assert.equal(restarted.badges.at(-1),'1');assert.equal(restarted.calls.filter(c=>c.url).length,0);
  for(const local of [
    {...app.stores.local,backendMode:'cloud'},
    {...app.stores.local,selfhost:{...config,apiKey:'different-key'}},
    {...app.stores.local,selfhost:{...config,serverUrl:'http://localhost:6820'}},
    {...app.stores.local,selfhostBlocked:'CLIENT_PROTOCOL_UNSUPPORTED'},
  ]){const changed=await worker({local,fetchImpl:mockSelfhost});assert.equal(changed.badges.at(-1),'');}
});
test('worker: failed polling clears the durable badge so a restart cannot restore a stale count',async()=>{
  let offline=false;
  const app=await worker({local:{backendMode:'selfhost',selfhost:{...config,notifyCrawlDone:false}},fetchImpl:async url=>{
    if(offline)throw new TypeError('offline');return mockSelfhost(url);
  }});
  await vm.runInContext('pollCrawlStatus()',app.context);assert.equal(app.badges.at(-1),'1');
  offline=true;await vm.runInContext('pollCrawlStatus()',app.context);assert.equal(app.badges.at(-1),'');
  const restarted=await worker({local:app.stores.local,fetchImpl:mockSelfhost});assert.equal(restarted.badges.at(-1),'');
});
test('worker: HTTP 409 disables periodic retries across restart until an explicit probe succeeds',async()=>{
  let rejected=true;
  const app=await worker({local:{backendMode:'selfhost',selfhost:config},fetchImpl:async(url)=>url.endsWith('/server/version')?mockSelfhost(url):rejected?new Response(JSON.stringify({status:'error',code:'CLIENT_PROTOCOL_UNSUPPORTED'}),{status:409}):mockSelfhost(url)});
  await assert.rejects(app.send({type:'SUMMARY'}),/CLIENT_PROTOCOL_UNSUPPORTED/);assert.equal(app.alarms.size,0);
  const restart=await worker({local:app.stores.local,fetchImpl:mockSelfhost});assert.equal(restart.alarms.size,0);
  rejected=false;await app.send({type:'TEST_SERVER'});assert.equal(app.alarms.size,1);
});
test('real Supabase SDK: inactive selfhost never refreshes an expired persisted cloud session',async()=>{
  const expired=JSON.stringify({...session('a'),expires_at:1});
  const app=await worker({realSdk:true,local:{backendMode:'selfhost',selfhost:config,[authKey]:expired},fetchImpl:mockSelfhost});
  await app.send({type:'STATUS'});await app.send({type:'SUMMARY'});
  assert.equal(app.calls.filter(c=>c.url?.startsWith(SUPA)).length,0);assert.equal(app.stores.local[authKey],expired);
});
test('real Supabase SDK: abort + rapid mode round trip does not let old refresh retries send or log out',async()=>{
  let release;
  const expired=JSON.stringify({...session('a'),expires_at:1});
  const app=await worker({realSdk:true,local:{backendMode:'cloud',selfhost:config,[authKey]:expired},fetchImpl:async(url)=>{
    if(url.includes('/auth/v1/token'))return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({...session('a'),expires_in:3600,token_type:'bearer'})));});
    return mockSelfhost(url);
  }});
  const pending=app.send({type:'SUMMARY'}),rejection=assert.rejects(pending,/STALE_SESSION/);
  while(!release)await new Promise(r=>setTimeout(r,0));
  await app.send({type:'SET_MODE',backendMode:'selfhost'});await app.send({type:'SET_MODE',backendMode:'cloud'});release();await rejection;
  assert.equal(app.calls.filter(c=>c.url?.includes('/auth/v1/token')).length,1);assert.equal(app.stores.local[authKey],expired);
});
test('worker: explicit offline logout clears own local session; mode selection preserves it',async()=>{
  const app=await worker({local:{backendMode:'cloud',[authKey]:JSON.stringify(session('a'))},auth:{signOut:async()=>({error:{message:'offline'}})}});
  await app.send({type:'LOGOUT'});assert.equal(app.stores.local[authKey],undefined);
});
test('worker: testing an unsaved server does not overwrite settings or resume its blocked poller',async()=>{
  const app=await worker({local:{backendMode:'selfhost',selfhost:config,selfhostBlocked:'CLIENT_PROTOCOL_UNSUPPORTED'},fetchImpl:mockSelfhost});
  const state=await app.send({type:'TEST_SERVER',...config,serverUrl:'http://192.168.1.9:6819'});
  assert.equal(state.active,false);assert.deepEqual(app.stores.local.selfhost,config);assert.equal(app.alarms.size,0);
});
test('real Supabase SDK: a late response body cannot persist refreshed tokens after a mode round trip',async()=>{
  let release;
  const expired=JSON.stringify({...session('a'),expires_at:1});
  const app=await worker({realSdk:true,local:{backendMode:'cloud',selfhost:config,[authKey]:expired},fetchImpl:async(url)=>{
    assert.ok(url.includes('/auth/v1/token'));
    const response=new Response('{}');
    response.json=()=>new Promise(resolve=>{release=()=>resolve({...session('a'),access_token:'late-new-access',refresh_token:'late-new-refresh',expires_in:3600,token_type:'bearer'});});
    return response;
  }});
  const pending=app.send({type:'SUMMARY'}),rejection=assert.rejects(pending,/STALE_SESSION/);
  while(!release)await new Promise(r=>setTimeout(r,0));
  await app.send({type:'SET_MODE',backendMode:'selfhost'});await app.send({type:'SET_MODE',backendMode:'cloud'});release();await rejection;
  assert.equal(app.stores.local[authKey],expired);assert.equal(app.calls.filter(c=>c.url).length,1);
});
