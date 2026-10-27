// Real unpacked 1.3.0 extension in Chromium, upgraded from storage that 1.2.6 left behind.
// A local mock "PC server" is seeded as the old selfhost server: it must see zero requests.
// The test manifest adds that exact mock origin to host_permissions, so this run does NOT prove the
// optional-permission removal (that is covered by the worker harness); it proves storage/alarm
// cleanup, the absence of PC requests and the cloud-only UI in a real service worker.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
const executable=process.env.SR_CHROMIUM_PATH || chromium.executablePath();
const dir=await mkdtemp(join(tmpdir(),'sr-backend-browser-'));
const requests=[];
const server=createServer((request,response)=>{requests.push(new URL(request.url,'http://localhost').pathname);response.setHeader('Content-Type','application/json');response.end('{"status":"success"}');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const extension=join(dir,'extension'),artifacts=resolve('artifacts/backend-browser');
await cp(resolve('build'),extension,{recursive:true});await mkdir(artifacts,{recursive:true});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
assert.equal(manifest.host_permissions?.length,1,'build with SR_SUPABASE_URL and SR_SUPABASE_PUBLISHABLE_KEY first');
assert.deepEqual(manifest.permissions,['storage','identity','clipboardWrite']);
assert.equal(manifest.optional_permissions,undefined);assert.equal(manifest.optional_host_permissions,undefined);
const authKey=`sb-${new URL(manifest.host_permissions[0].replace('/*','')).hostname.split('.')[0]}-auth-token`;
manifest.host_permissions.push(origin+'/*');
await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
let context;
const launch=async profile=>{
  const result=await chromium.launchPersistentContext(profile,{executablePath:executable,headless:true,args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let worker=result.serviceWorkers()[0];if(!worker)worker=await result.waitForEvent('serviceworker');
  return {context:result,id:new URL(worker.url()).host};
};
const status=page=>page.evaluate(()=>new Promise(resolve=>chrome.runtime.sendMessage({type:'STATUS'},resolve)));
const shadow=async(page,hostId,expression)=>{
  const cdp=await page.context().newCDPSession(page);
  try{
    const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
    const find=node=>node.attributes?.some((s,i)=>s==='id'&&node.attributes[i+1]===hostId)?node:
      [...(node.children||[]),...(node.shadowRoots||[])].map(find).find(Boolean);
    const host=find(root);assert.ok(host?.shadowRoots?.[0],`missing closed shadow ${hostId}`);
    const remote=await cdp.send('DOM.resolveNode',{nodeId:host.shadowRoots[0].nodeId});
    const value=await cdp.send('Runtime.callFunctionOn',{objectId:remote.object.objectId,functionDeclaration:`function(){return ${expression}}`,returnByValue:true});
    return value.result.value;
  }finally{await cdp.detach();}
};
const session=JSON.stringify({access_token:'mock-access',refresh_token:'mock-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'existing',user_metadata:{full_name:'시험 사용자'}}});
const legacy={backendMode:'selfhost',backendMigration:1,selfhost:{serverUrl:origin,apiKey:'browser-mock-key',notifyCrawlDone:true,pollInterval:5},
  srCrawlState:{identity:'x',running:true,processingCount:3},selfhostBlocked:'CLIENT_PROTOCOL_UNSUPPORTED',wasCrawling:true,serverUrl:origin,apiKey:'browser-mock-key'};
const legacyKeys=[...Object.keys(legacy),'notifyCrawlDone','pollInterval'];
const scenarios={selfhostOnly:{cloud:false},mixed:{cloud:true},cloudOnly:{cloud:true,onlyCloud:true},loggedOut:{cloud:false,onlyCloud:true}};
const results={};
try{
  const html='<!doctype html><meta charset="utf-8"><html lang="ko"><body style="margin:30px"><label>차량번호 <input id="VHRNO"></label><p>주소 <span id="add1"></span></p></body></html>';
  for(const [name,scenario] of Object.entries(scenarios)){
    const profile=join(dir,`profile-${name}`);
    // First launch = a fresh 1.3.0 install; then rewind its storage to what 1.2.6 left and restart the browser.
    let launched=await launch(profile);context=launched.context;
    let options=await context.newPage();await options.goto(`chrome-extension://${launched.id}/options.html`);
    await options.evaluate(async({legacy,scenario,authKey,session,origin})=>{
      await chrome.storage.local.remove('srMigration');
      if(!scenario.onlyCloud)await chrome.storage.local.set(legacy);
      else await chrome.storage.local.set({backendMode:'cloud',backendMigration:1});
      await chrome.storage.sync.set({theme:'dark',...(scenario.onlyCloud?{}:{serverUrl:origin,apiKey:'browser-mock-key',backendMode:'selfhost',pollInterval:5})});
      if(scenario.cloud)await chrome.storage.local.set({[authKey]:session});
      await chrome.alarms?.create?.('safetyreport_poll',{periodInMinutes:5});
    },{legacy,scenario,authKey,session,origin});
    await context.close();context=null;
    launched=await launch(profile);context=launched.context;
    options=await context.newPage();await options.goto(`chrome-extension://${launched.id}/options.html`);
    await options.waitForFunction(()=>document.getElementById('status').textContent!=='계정 확인 중…');
    const state=await options.evaluate(async()=>({local:await chrome.storage.local.get(null),sync:await chrome.storage.sync.get(null),alarms:typeof chrome.alarms,notifications:typeof chrome.notifications,manifest:chrome.runtime.getManifest()}));
    for(const key of legacyKeys)assert.equal(state.local[key],undefined,`${name}: local.${key}`);
    for(const key of ['serverUrl','apiKey','backendMode','pollInterval'])assert.equal(state.sync[key],undefined,`${name}: sync.${key}`);
    assert.equal(state.sync.theme,'dark');assert.equal(state.local.srMigration,1);
    assert.equal(state.alarms,'undefined');assert.equal(state.notifications,'undefined');
    assert.deepEqual(state.manifest.permissions,['storage','identity','clipboardWrite']);
    if(scenario.cloud)assert.equal(state.local[authKey],session,`${name}: the cloud session is kept`);
    assert.equal((await status(options)).data.signedIn,scenario.cloud);
    for(const id of ['backendMode','selfhostSettings','serverUrl','apiKey'])assert.equal(await options.locator('#'+id).count(),0,id);
    assert.ok((await options.locator('#pcNotice').textContent()).includes('PC에만 있던 신고는 모바일 앱에서 가져와'));
    assert.equal(await options.locator(scenario.cloud?'#logout':'#login').isVisible(),true);
    if(name==='loggedOut')for(const theme of ['light','dark']){await options.locator('#theme').selectOption(theme);await options.screenshot({path:join(artifacts,`options-${theme}.png`),fullPage:true});}
    if(!scenario.cloud){
      // Content script on every official host variant: login guidance only, never a PC request.
      for(const site of ['https://www.safetyreport.go.kr/','http://www.safetyreport.go.kr/','https://safetyreport.go.kr/','http://safetyreport.go.kr/']){
        await context.route(site+'**',route=>route.fulfill({contentType:'text/html',body:html}));
        const page=await context.newPage();await page.goto(site+'#report');
        await page.locator('#VHRNO').fill('12가3456');await page.locator('#VHRNO').click();await page.locator('#sr-vehicle-panel-host').waitFor({state:'visible'});await page.waitForTimeout(900);
        assert.ok((await shadow(page,'sr-vehicle-panel-host','this.textContent')).includes('로그인'),`${name} ${site}`);
        if(site==='https://www.safetyreport.go.kr/'&&name==='loggedOut')await page.screenshot({path:join(artifacts,'vehicle-login.png')});
        await page.close();
      }
      const popup=await context.newPage();await popup.goto(`chrome-extension://${launched.id}/popup.html`);await popup.locator('#login').waitFor();
      for(const id of ['crawlStart','serverHome','modeBadge'])assert.equal(await popup.locator('#'+id).count(),0,id);
      if(name==='loggedOut')for(const theme of ['light','dark']){await options.locator('#theme').selectOption(theme);await popup.waitForFunction(t=>document.documentElement.dataset.srTheme===t,theme);await popup.screenshot({path:join(artifacts,`popup-${theme}.png`)});}
      await popup.close();
    }
    // A real worker restart must neither redo the migration nor resurrect PC state.
    const cdp=await context.newCDPSession(options);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();
    assert.equal((await status(options)).data.signedIn,scenario.cloud);
    assert.equal(await options.evaluate(async()=>(await chrome.storage.local.get('selfhost')).selfhost),undefined);
    results[name]={signedIn:scenario.cloud,cleaned:true};
    await context.close();context=null;
  }
  assert.deepEqual(requests,[],'the old PC server must never be contacted');
  context=null;
  const loaded=await readFile('build/content.js','utf8');
  const report={version:manifest.version,buildSource:resolve('build'),contentSha256:createHash('sha256').update(loaded).digest('hex'),browser:chromium.name(),scenarios:results,
    pcServerRequests:requests.length,permissions:manifest.permissions,optionalPermissionRemoval:'not tested in a real browser; worker harness only',
    productionSite:'not tested; routed fixture',kakao:'not tested',osAltTab:'not tested',
    addressPersistenceWithData:'not run here (needs a Supabase session); tests/address-panel-persistence.test.mjs covers it with a mock worker'};
  await writeFile(join(artifacts,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{if(context)await context.close();server.close();await rm(dir,{recursive:true,force:true});}
