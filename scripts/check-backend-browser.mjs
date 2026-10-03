// Real unpacked extension / service worker / content scripts, with a local mock server.
// Only the test manifest pregrants this exact mock origin and notifications.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
const executable=process.env.SR_CHROMIUM_PATH || chromium.executablePath();
const dir=await mkdtemp(join(tmpdir(),'sr-backend-browser-'));
const logs=[];let running=false,done=false,doneRead,serverVersion='3.0.0.0-dev',protocols=[3],failure=0;
const record={id:'9100000001',신고번호:'SPP-2026-123456',차량번호:'12가3456',신고일:'2026-09-29',답변일:'2026-09-30',처리상태:'일부수용',범칙금_과태료:'과태료 40,000원',위반장소:'서울특별시 종로구 예시로 1',처리기관:'서울시 예시기관',담당자:'김담당',위반법규:'도로교통법',별점:5,신고내용:'EXCLUDED_PRIVATE_BODY'};
const server=createServer((request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname;
  // Never print or persist secret headers.
  logs.push({path,client:request.headers['x-safetyreport-client'],version:request.headers['x-safetyreport-version'],protocol:request.headers['x-safetyreport-protocol'],keyValid:request.headers['x-api-key']==='browser-mock-key'});
  response.setHeader('Content-Type','application/json');
  if(failure){response.writeHead(failure);response.end(JSON.stringify({status:'error',code:failure===409?'CLIENT_PROTOCOL_UNSUPPORTED':'AUTH_REQUIRED'}));return;}
  let data;
  if(path.endsWith('/server/version'))data={status:'success',version:serverVersion,protocol_version:3,supported_client_protocols:protocols,minimum_server_major:3};
  else if(path.endsWith('/summary'))data={status:'success',data:{total:2,acceptCount:0,partialCount:1,rejectCount:0,processingCount:1,tFineCount:1,tPenaltyCount:0,tRejectCount:0,tUnconfirmedCount:0,recent_answers:[record],last_crawl_time:'2026-10-03'}};
  else if(path.endsWith('/crawl/status'))data={status:'success',running,pending:0};
  else if(path.endsWith('/crawl/start')){running=true;data={status:'success'};}
  else if(path.endsWith('/crawl/kill')){running=false;done=true;data={status:'success'};}
  else if(path.endsWith('/crawl/done/ext')){data=done?{status:'success',done:true,changed_count:1,changes:[{신고번호:record.신고번호}]}:{status:'success',done:false};if(done)doneRead?.();done=false;}
  else data={status:'success',count:2,data:[record,{id:'9100000002',신고번호:null,차량번호:'12가3456',처리상태:'처리중',위반장소:record.위반장소}]};
  response.end(JSON.stringify(data));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const extension=join(dir,'extension'),profile=join(dir,'profile'),artifacts=resolve('artifacts/backend-browser');
await cp(resolve('build'),extension,{recursive:true});await mkdir(artifacts,{recursive:true});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
manifest.host_permissions.push(origin+'/*');manifest.permissions.push('notifications');
await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
let context;
const launch=async()=>{
  const result=await chromium.launchPersistentContext(profile,{executablePath:executable,headless:true,args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let worker=result.serviceWorkers()[0];if(!worker)worker=await result.waitForEvent('serviceworker');
  return {context:result,id:new URL(worker.url()).host,worker};
};
const status=async page=>page.evaluate(()=>new Promise(resolve=>chrome.runtime.sendMessage({type:'STATUS'},resolve)));
const workerEval=async(page,id,expression)=>{
  const cdp=await page.context().newCDPSession(page);
  try{
    const {targetInfos}=await cdp.send('Target.getTargets');
    const target=targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(`chrome-extension://${id}/`));assert.ok(target);
    const attached=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
    const reply=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('worker inspection timed out')),5000);
      cdp.on('Target.receivedMessageFromTarget',message=>{if(message.sessionId!==attached.sessionId)return;const data=JSON.parse(message.message);if(data.id===1){clearTimeout(timeout);resolve(data);}});
    });
    await cdp.send('Target.sendMessageToTarget',{sessionId:attached.sessionId,message:JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})});
    return (await reply).result.result.value;
  }finally{await cdp.detach();}
};
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
try{
  let launched=await launch();context=launched.context;const id=launched.id;
  const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  await options.locator('#backendMode').waitFor();await options.waitForFunction(()=>document.getElementById('modeStatus').textContent.includes('모드를 선택'));
  assert.equal(await options.locator('#cloudSettings').isVisible(),false);assert.equal(await options.locator('#selfhostSettings').isVisible(),false);assert.equal(logs.length,0);
  await options.locator('#backendMode').selectOption('selfhost');await options.locator('#serverUrl').fill(origin);await options.locator('#apiKey').fill('browser-mock-key');
  await options.locator('#btnSave').click();await options.waitForFunction(()=>document.getElementById('saveResult').textContent==='저장되었습니다.');
  await options.locator('#btnTest').click();await options.waitForFunction(()=>document.getElementById('testResult').textContent.includes('연결 성공'));
  for(const theme of ['light','dark']){
    await options.locator('#theme').selectOption(theme);await options.screenshot({path:join(artifacts,`options-${theme}.png`),fullPage:true});
  }
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator('#crawlStart').waitFor();
  assert.ok((await popup.locator('#accountState').textContent()).includes('셀프호스팅 · 연결됨'));
  assert.ok((await popup.locator('.sr-record a').getAttribute('href')).startsWith(origin+'/data/all?open='));
  await popup.locator('#crawlStart').click();await popup.waitForFunction(()=>document.getElementById('crawlState').textContent==='크롤링 실행 중');
  await popup.locator('#crawlStop').click();await popup.waitForFunction(()=>document.getElementById('crawlState').textContent==='크롤링 대기 중');
  const crawlButton=await popup.locator('#crawlStart').boundingBox();assert.ok(crawlButton.y+crawlButton.height<570);
  for(const theme of ['light','dark']){await options.locator('#theme').selectOption(theme);await popup.waitForFunction(t=>document.documentElement.dataset.srTheme===t,theme);await popup.locator('#content').evaluate(el=>el.scrollTop=0);await popup.screenshot({path:join(artifacts,`popup-${theme}.png`)});}
  await context.route(/^https?:\/\/www\.safetyreport\.go\.kr\//,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><html lang="ko"><body style="margin:30px"><label>차량번호 <input id="VHRNO"></label><p>주소 <span id="add1"></span></p><button style="position:fixed;right:20px;bottom:20px" id="native">원래 버튼</button><script>window.events=[];document.addEventListener("click",e=>events.push(e.target.id));document.addEventListener("input",e=>events.push("input:"+e.target.id));</script></body></html>'}));
  await context.grantPermissions(['clipboard-read'],{origin:'https://www.safetyreport.go.kr'});
  const page=await context.newPage();await page.goto('https://www.safetyreport.go.kr/#report');await page.bringToFront();
  await page.locator('#VHRNO').fill('12가3');await page.waitForTimeout(700);
  assert.equal(logs.filter(x=>x.path.includes('/vehicle/')).length,0);
  await page.locator('#VHRNO').fill('12가3456');await page.locator('#VHRNO').click();await page.locator('#sr-vehicle-panel-host').waitFor({state:'visible'});await page.waitForTimeout(900);
  assert.ok((await shadow(page,'sr-vehicle-panel-host','this.textContent')).includes('처리중'));assert.ok(!(await shadow(page,'sr-vehicle-panel-host','this.textContent')).includes('EXCLUDED_PRIVATE_BODY'));
  await page.screenshot({path:join(artifacts,'vehicle-dark.png')});
  await options.bringToFront();await page.bringToFront();assert.equal(await page.locator('#sr-vehicle-panel-host').isVisible(),true);
  await page.locator('#VHRNO').evaluate(el=>{el.blur();el.focus();});await page.keyboard.press('Alt+Tab');
  await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});assert.equal(await page.locator('#sr-vehicle-panel-host').isVisible(),true);
  await page.locator('#VHRNO').click();assert.equal(await page.locator('#sr-vehicle-panel-host').isVisible(),true);
  const copyRect=await shadow(page,'sr-vehicle-panel-host',`this.querySelector('[data-action="copy"]').getBoundingClientRect().toJSON()`);
  await page.mouse.click(copyRect.x+copyRect.width/2,copyRect.y+copyRect.height/2);await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'SPP-2026-123456');
  assert.equal(await page.locator('#sr-vehicle-panel-host').isVisible(),true);
  await page.evaluate(()=>{const old=document.getElementById('VHRNO'),fresh=old.cloneNode();fresh.value='12가3456';old.replaceWith(fresh);});await page.waitForTimeout(100);await page.locator('#VHRNO').click();await page.waitForTimeout(700);assert.equal(await page.locator('#sr-vehicle-panel-host').isVisible(),true);
  await page.locator('#native').click();assert.equal(await page.locator('#sr-vehicle-panel-host').isVisible(),false);assert.ok((await page.evaluate(()=>window.events)).includes('native'));assert.ok((await page.evaluate(()=>window.events)).includes('input:VHRNO'));
  await page.locator('#add1').evaluate(el=>{el.textContent='서울특별시 종로구 예시로 1';});await page.locator('#sr-address-panel-host').waitFor({state:'visible'});await page.waitForTimeout(850);
  assert.ok((await shadow(page,'sr-address-panel-host','this.textContent')).includes('김담당'));await page.screenshot({path:join(artifacts,'address-dark.png')});
  await page.evaluate(()=>{window.__addressNode=document.getElementById('add1');location.hash='another-report';});
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>window.__addressNode===document.getElementById('add1')),true);
  assert.equal(await page.locator('#sr-address-panel-host').isVisible(),true);
  assert.ok((await shadow(page,'sr-address-panel-host','this.textContent')).includes('김담당'));
  // Real content-script injection and worker dispatch on the HTTP document too.
  const httpPage=await context.newPage();await httpPage.goto('http://www.safetyreport.go.kr/#report');
  assert.ok(httpPage.url().startsWith('http://www.safetyreport.go.kr/'),'fixture must remain HTTP to verify both schemes');
  await httpPage.locator('#VHRNO').fill('12가3456');await httpPage.locator('#VHRNO').click();await httpPage.waitForTimeout(900);
  assert.equal(await httpPage.locator('#sr-vehicle-panel-host').isVisible(),true);
  assert.ok((await shadow(httpPage,'sr-vehicle-panel-host','this.textContent')).includes('일부수용'));
  const font=await shadow(httpPage,'sr-vehicle-panel-host',"getComputedStyle(this.querySelector('.sr-record-agency')).fontSize");
  assert.equal(font,'14px','HTTP Shadow DOM must load extension styles');
  assert.ok(!(await shadow(httpPage,'sr-vehicle-panel-host','this.textContent')).includes('browser-mock-key'));
  await httpPage.screenshot({path:join(artifacts,'vehicle-http.png')});await httpPage.close();
  const twin=await context.newPage();await twin.goto(`chrome-extension://${id}/options.html`);
  await twin.waitForFunction(()=>document.getElementById('backendMode').value==='selfhost');
  await options.locator('#backendMode').selectOption('cloud');await options.waitForFunction(()=>document.getElementById('cloudSettings').hidden===false);
  await twin.waitForFunction(()=>document.getElementById('backendMode').value==='cloud');assert.equal(await twin.locator('#selfhostSettings').isVisible(),false);
  assert.equal(await page.locator('#sr-address-panel-host').isVisible(),false);
  await popup.reload();await popup.waitForFunction(()=>document.getElementById('accountState').textContent.includes('클라우드'));
  assert.equal(await popup.locator('#crawlStart').count(),0);assert.equal(await options.locator('#selfhostSettings').isVisible(),false);
  const before=logs.length;await page.locator('#VHRNO').click();await page.waitForTimeout(850);assert.equal(logs.length,before,'cloud must make zero selfhost requests');
  await options.locator('#backendMode').selectOption('selfhost');await options.waitForFunction(()=>!document.getElementById('selfhostSettings').hidden);
  await twin.waitForFunction(()=>document.getElementById('backendMode').value==='selfhost');await twin.close();
  assert.equal(await options.locator('#serverUrl').inputValue(),origin);
  serverVersion='2.9.0';await options.locator('#btnTest').click();await options.waitForFunction(()=>document.getElementById('testResult').textContent.includes('v3 이상'));
  serverVersion='3.0.0.0-dev';protocols=[4];await options.locator('#btnTest').click();await options.waitForFunction(()=>document.getElementById('testResult').textContent.includes('protocol을 지원하지'));
  protocols=[3];failure=401;await options.locator('#btnTest').click();await options.waitForFunction(()=>document.getElementById('testResult').textContent.includes('API 키가 유효하지'));
  failure=0;await options.locator('#btnTest').click();await options.waitForFunction(()=>document.getElementById('testResult').textContent.includes('연결 성공'));
  // Complete an external crawl entirely between polls; trigger the real alarm dispatch.
  await options.evaluate(async()=>{for(const id of Object.keys(await chrome.notifications.getAll()))await chrome.notifications.clear(id);});
  done=true;
  const consumed=new Promise(resolve=>{doneRead=resolve;});
  await options.evaluate(()=>chrome.alarms.create('safetyreport_poll',{when:Date.now()+100,periodInMinutes:5}));
  const timeout=setTimeout(()=>doneRead?.('timeout'),10000);
  assert.notEqual(await consumed,'timeout','real alarm must consume the new completion');clearTimeout(timeout);doneRead=null;
  await options.waitForFunction(async()=>Object.keys(await chrome.notifications.getAll()).some(id=>id.startsWith('sr-crawl-done-')));
  await options.waitForFunction(async()=>await chrome.action.getBadgeText({})==='1');
  assert.equal(done,false);
  await workerEval(options,id,"globalThis.__srTestWorkerMarker='old'");
  const cdp=await context.newCDPSession(options);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();
  await page.bringToFront();await page.locator('#VHRNO').click();await page.waitForTimeout(1100);
  assert.equal(await page.locator('#sr-vehicle-panel-host').isVisible(),true,'first search that wakes a worker must stay open');
  assert.ok((await shadow(page,'sr-vehicle-panel-host','this.textContent')).includes('일부수용'));
  assert.equal((await status(options)).data.backendMode,'selfhost');
  assert.equal(await workerEval(options,id,'globalThis.__srTestWorkerMarker'),undefined,'worker must actually restart');
  assert.equal(await options.evaluate(()=>chrome.action.getBadgeText({})),'1','same server badge survives an actual worker restart');
  await context.close();context=null;
  launched=await launch();context=launched.context;let restarted=await context.newPage();await restarted.goto(`chrome-extension://${launched.id}/options.html`);
  await restarted.waitForFunction(()=>document.getElementById('backendMode').value==='selfhost');
  assert.equal(await restarted.locator('#serverUrl').inputValue(),origin);assert.equal((await status(restarted)).data.connected,true);
  assert.equal(await restarted.evaluate(()=>chrome.action.getBadgeText({})),'1','same server badge survives a browser restart');
  assert.ok(logs.every(x=>x.client==='chromeextension'&&x.version===manifest.version&&x.protocol==='3'&&x.keyValid));
  // Cold-start migrations with persisted legacy settings/sessions.
  for(const scenario of ['legacyServer','cloudSession','ambiguous','explicitCloud']){
    await restarted.evaluate(async({scenario,origin})=>{
      await chrome.storage.local.clear();await chrome.storage.sync.clear();
      const selfhost={serverUrl:origin,apiKey:'browser-mock-key',notifyCrawlDone:false,pollInterval:5};
      const session={'sb-existing-auth-token':JSON.stringify({user:{id:'existing'},refresh_token:'mock-refresh'})};
      if(scenario!=='cloudSession')await chrome.storage.sync.set(selfhost);
      if(scenario!=='legacyServer')await chrome.storage.local.set(session);
      if(scenario==='explicitCloud')await chrome.storage.local.set({backendMode:'cloud'});
    },{scenario,origin});
    await context.close();context=null;launched=await launch();context=launched.context;
    const migrated=await context.newPage();await migrated.goto(`chrome-extension://${launched.id}/options.html`);
    const settings=await migrated.evaluate(()=>new Promise(resolve=>chrome.runtime.sendMessage({type:'GET_SETTINGS'},r=>resolve(r.data))));
    const expected={legacyServer:'selfhost',cloudSession:'cloud',ambiguous:null,explicitCloud:'cloud'}[scenario];
    assert.equal(settings.backendMode,expected,scenario);
    if(scenario!=='cloudSession')assert.equal(settings.selfhost.serverUrl,origin);
    await migrated.waitForFunction(value=>document.getElementById('backendMode').value===(value||''),expected);
    await migrated.screenshot({path:join(artifacts,`migration-${scenario}.png`),fullPage:true});
    // Keep a live options tab for the next cold-start scenario.
    await migrated.evaluate(()=>{window.__migrationReady=true;});
    restarted=migrated;
  }
  await restarted.locator('#backendMode').selectOption('selfhost');await restarted.waitForFunction(()=>!document.getElementById('selfhostSettings').hidden);
  // Offline result is distinct from authentication/version failures.
  await new Promise(r=>server.close(r));await restarted.locator('#btnTest').click();await restarted.waitForFunction(()=>document.getElementById('testResult').textContent.includes('연결할 수 없습니다'));
  const report={browser:await context.browser()?.version(),newInstall:true,selfhost:true,cloudSelfhostRequests:0,focusTabSwitch:true,syntheticBlurFocus:true,altTabKeyChord:true,osAltTab:"headless: not tested",coldStartMigrations:true,closedShadow:true,copy:true,nodeReplacement:true,nativeEvents:true,workerStop:true,browserRestart:true,oldServer:true,unsupportedProtocol:true,authFailure:true,offline:true,unchangedNodeNavigation:true,optionsTabSync:true,betweenAlarmCompletion:true,badgeWorkerAndBrowserRestart:true,popupCrawlControlsFirst:true,httpAndHttpsContentScripts:true,httpShadowStyles:true,serverRequests:logs.length,kakao:'not tested',productionServer:'not tested',hostPermissionDialog:'test manifest pregranted exact mock origin'};
  await writeFile(join(artifacts,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{if(context)await context.close();server.close();await rm(dir,{recursive:true,force:true});}
