import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { worker, session, authKey, SUPA } from './worker-harness.mjs';
const fixture = name => JSON.parse(readFileSync(`contracts/my-reports/fixtures/${name}.json`,'utf8'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('worker: four-character cloud query reaches server, short-query rejection is explicit, and supported results share flight/cache', async () => {
  let supported = false;
  const app = await worker({ local: { [authKey]: session('a') }, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.query, '5902');
    return supported
      ? new Response(JSON.stringify({ ...fixture('search-empty'), kind: 'vehicle', query_normalized: '5902' }))
      : new Response(JSON.stringify({ error: { code: 'QUERY_LENGTH' } }), { status: 400 });
  } });
  const query = { type: 'SEARCH', kind: 'vehicle', query: '5902' };
  await assert.rejects(app.send(query, 'content'), /CLOUD_SHORT_VEHICLE_UNSUPPORTED/);
  assert.equal(app.calls.filter(c => c.url).length, 1);
  supported = true;
  const [first, second] = await Promise.all([app.send(query, 'content'), app.send(query, 'content')]);
  assert.equal(first.summary.total, 0); assert.deepEqual(first, second);
  await app.send(query, 'content'); assert.equal(app.calls.filter(c => c.url).length, 2);
});
test('worker: trusted storage and distinct logout; a restart keeps the session without any network call',async()=>{
  const app=await worker({local:{[authKey]:session('a')}});
  assert.equal(app.calls[0].accessLevel.accessLevel,'TRUSTED_CONTEXTS');
  await app.send({type:'LOGOUT'});
  assert.equal(app.stores.local[authKey],undefined);
  const restarted=await worker({local:{...app.stores.local,[authKey]:session('a')}});
  assert.equal((await restarted.send({type:'STATUS'})).signedIn,true);assert.equal(restarted.calls.filter(call=>call.url).length,0);
});
test('worker: content cannot control the extension; removed PC messages and unknown destinations never proxy',async()=>{
  const app=await worker({local:{[authKey]:session('a')}});
  for(const type of ['SUMMARY','LOGIN','LOGOUT','TEST_CLOUD'])await assert.rejects(app.send({type},'content'),/FORBIDDEN/);
  // The PC (selfhost) control messages no longer exist for anyone, including the trusted pages.
  for(const type of ['GET_SETTINGS','SET_MODE','SAVE_SERVER','TEST_SERVER','OPEN_SERVER','CRAWL_STATUS','CRAWL_START','CRAWL_STOP'])
    for(const role of ['trusted','content'])await assert.rejects(app.send({type,serverUrl:'http://192.168.0.2:6819',apiKey:'k'},role),/FORBIDDEN|UNKNOWN_MESSAGE/);
  await assert.rejects(app.send({type:'SEARCH',kind:'vehicle',query:'590',url:'http://evil'},'content'),/INVALID_QUERY/);
  await assert.rejects(app.send({type:'FETCH_URL',url:'http://evil'},'content'),/FORBIDDEN/);
  assert.equal(app.calls.filter(call=>call.url).length,0);
});
test('worker: cloud requests only Supabase, allowlist DTO, own account cache and late response discarded on account change',async()=>{
  let release;
  const raw=fixture('search-vehicle-first-page');raw.secret='PRIVATE';raw.reports.items[0].apiKey='PRIVATE';
  const app=await worker({local:{[authKey]:session('a')},fetchImpl:async(url,options)=>{
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
  await app.chrome.storage.local.set({[authKey]:session('c')});release();await handled;
  assert.equal(app.calls.filter(call=>call.url&&!call.url.startsWith(SUPA)).length,0);
  assert.equal(app.calls.filter(call=>call.auth==='signOut').length,0);
});
test('worker: cloud expiry refresh once, gateway 401 retry once, offline and forbidden are errors',async()=>{
  let count=0;
  const app=await worker({local:{[authKey]:session('a')},fetchImpl:async()=>{
    count++;return count===1?new Response(JSON.stringify({error:{code:'SESSION_EXPIRED'}}),{status:401}):new Response(JSON.stringify(fixture('summary-first-page')));
  }});
  await app.send({type:'SUMMARY'});assert.equal(count,2);assert.equal(app.calls.filter(c=>c.auth==='refreshSession').length,1);
  const blocked=await worker({local:{[authKey]:session('a')},fetchImpl:async()=>new Response(JSON.stringify({error:{code:'ACCOUNT_INELIGIBLE'}}),{status:403})});
  await assert.rejects(blocked.send({type:'SUMMARY'}),/ACCESS_DENIED/);
});
test('worker: STATUS after an account change starts a new flight and old completion cannot clear that flight', async () => {
  const old = deferred(), current = deferred(), entered = deferred();
  let reads = 0;
  const app = await worker({ local: { [authKey]: session('a') }, auth: {
    getSession() { reads++; entered.resolve(); return reads === 1 ? old.promise : current.promise; },
  } });
  const first = app.send({ type: 'STATUS' });
  await entered.promise;
  await app.chrome.storage.local.set({ [authKey]: session('b') });
  const second = app.send({ type: 'STATUS' });
  await new Promise(resolve => setTimeout(resolve, 0));
  old.resolve({ data: { session: session('a') } });
  await first;
  const third = app.send({ type: 'STATUS' });
  await new Promise(resolve => setTimeout(resolve, 0));
  current.resolve({ data: { session: session('b') } });
  assert.equal((await second).signedIn, true);
  assert.equal((await third).signedIn, true);
  assert.equal(reads, 2, 'new-generation calls share only their own flight, even after the old flight completes');
});
test('worker: STATUS shows the cached state instantly; it only re-checks when forced, stale, or the account changes',async()=>{
  const app=await worker({local:{[authKey]:session('a')}});
  const reads=()=>app.calls.filter(c=>c.auth==='getSession').length;
  const first=await app.send({type:'STATUS'});
  assert.equal(first.connected,true);assert.equal(first.signedIn,true);assert.equal(first.name,'테스트 계정');assert.equal(first.backendMode,undefined);
  assert.equal(reads(),1,'the first-ever check must still read the session once');
  const second=await app.send({type:'STATUS'});assert.equal(second.signedIn,true);assert.equal(reads(),1);
  await app.send({type:'STATUS',fresh:true});assert.equal(reads(),2);
  await app.chrome.storage.local.set({[authKey]:session('b')});
  await app.send({type:'STATUS'});assert.equal(reads(),3);
});
test('worker: a cached STATUS survives a worker restart without any network call; a changed account does not reuse it',async()=>{
  const app=await worker({local:{[authKey]:session('a')}});
  const first=await app.send({type:'STATUS'});assert.equal(first.signedIn,true);
  const restarted=await worker({local:app.stores.local,fetchImpl:async()=>{throw new Error('no network expected after a restart');}});
  const reads=()=>restarted.calls.filter(c=>c.auth==='getSession').length;
  assert.equal((await restarted.send({type:'STATUS'})).signedIn,true);assert.equal(reads(),0);assert.equal(restarted.calls.filter(c=>c.url).length,0);
  const other=await worker({local:{...app.stores.local,[authKey]:session('b')}});
  await other.send({type:'STATUS'});assert.equal(other.calls.filter(c=>c.auth==='getSession').length,1);
});
test('real Supabase SDK: abort + account change does not let an old refresh retry send or persist tokens',async()=>{
  let release;
  const expired=JSON.stringify({...session('a'),expires_at:1});
  const app=await worker({realSdk:true,local:{[authKey]:expired},fetchImpl:async(url)=>{
    if(url.includes('/auth/v1/token'))return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({...session('a'),access_token:'late-new-access',refresh_token:'late-new-refresh',expires_in:3600,token_type:'bearer'})));});
    return new Response('{}');
  }});
  const pending=app.send({type:'SUMMARY'}),rejection=assert.rejects(pending,/STALE_SESSION/);
  while(!release)await new Promise(r=>setTimeout(r,0));
  const other=JSON.stringify(session('b'));
  await app.chrome.storage.local.set({[authKey]:other});release();await rejection;
  assert.equal(app.calls.filter(c=>c.url?.includes('/auth/v1/token')).length,1);assert.equal(app.stores.local[authKey],other);
});
test('real Supabase SDK: a late response body cannot persist refreshed tokens after an account change',async()=>{
  let release;
  const expired=JSON.stringify({...session('a'),expires_at:1});
  const app=await worker({realSdk:true,local:{[authKey]:expired},fetchImpl:async(url)=>{
    assert.ok(url.includes('/auth/v1/token'));
    const response=new Response('{}');
    response.json=()=>new Promise(resolve=>{release=()=>resolve({...session('a'),access_token:'late-new-access',refresh_token:'late-new-refresh',expires_in:3600,token_type:'bearer'});});
    return response;
  }});
  const pending=app.send({type:'SUMMARY'}),rejection=assert.rejects(pending,/STALE_SESSION/);
  while(!release)await new Promise(r=>setTimeout(r,0));
  const other=JSON.stringify(session('b'));
  await app.chrome.storage.local.set({[authKey]:other});release();await rejection;
  assert.equal(app.stores.local[authKey],other);assert.equal(app.calls.filter(c=>c.url).length,1);
});
test('worker: explicit offline logout clears own local session',async()=>{
  const app=await worker({local:{[authKey]:JSON.stringify(session('a'))},auth:{signOut:async()=>({error:{message:'offline'}})}});
  await app.send({type:'LOGOUT'});assert.equal(app.stores.local[authKey],undefined);
});
test('worker: official HTTP and HTTPS pages can query but cannot access credentials or control the extension',async()=>{
  const app=await worker({local:{[authKey]:session('a')},fetchImpl:async()=>Response.json(fixture('search-vehicle-first-page'))});
  // The real site serves identical content on the bare host (no redirect either way); both must work.
  for(const url of ['http://www.safetyreport.go.kr/#report','https://www.safetyreport.go.kr/#report','http://safetyreport.go.kr/#report','https://safetyreport.go.kr/#report']){
    const result=await app.send({type:'SEARCH',kind:'vehicle',query:'12가3456'},'content',{url});
    assert.equal(result.summary.total,fixture('search-vehicle-first-page').summary.total);
    assert.equal(result.apiKey,undefined);assert.equal(result.access_token,undefined);
    for(const type of ['LOGIN','LOGOUT','TEST_CLOUD','SUMMARY'])await assert.rejects(app.send({type},'content',{url}),/FORBIDDEN/);
  }
  const networkCount=app.calls.filter(call=>call.url).length;
  for(const sender of [
    {url:'https://www.safetyreport.go.kr.evil.example/'},
    {url:'https://safetyreport.go.kr.evil.example/'},
    {url:'https://www.safetyreport.go.kr@evil.example/'},
    {url:'https://evil.example/www.safetyreport.go.kr/'},
    {url:'ftp://www.safetyreport.go.kr/'},
    {url:'ftp://safetyreport.go.kr/'},
    {url:'https://wwwsafetyreport.go.kr/'},
    {url:'https://www.safetyreport.go.kr:444/'},
    {url:'http://www.safetyreport.go.kr/',frameId:1},
    {url:'https://www.safetyreport.go.kr/',id:'another-extension'},
  ])await assert.rejects(app.send({type:'SEARCH',kind:'vehicle',query:'12가3456'},'content',sender),/MESSAGE_REJECTED/);
  assert.equal(app.calls.filter(call=>call.url).length,networkCount);
});
test('manifest: official HTTP/HTTPS injection and Shadow DOM resources share the same exact host scope',()=>{
  const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
  // The real site serves identical content with and without "www" (no redirect either way).
  const sites=['http://www.safetyreport.go.kr/*','https://www.safetyreport.go.kr/*','http://safetyreport.go.kr/*','https://safetyreport.go.kr/*'];
  assert.deepEqual(manifest.content_scripts[0].matches,sites);
  assert.deepEqual(manifest.web_accessible_resources[0].matches,sites);
  assert.equal(manifest.content_scripts[0].all_frames ?? false,false);
  assert.equal(manifest.permissions.includes('cookies'),false);
  assert.equal(manifest.permissions.includes('webRequest'),false);
});
