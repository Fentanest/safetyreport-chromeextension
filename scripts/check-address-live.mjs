// Opt-in smoke check on the actual public report form, with an unmodified unpacked build.
// No login, report submission, or production account data. NOT part of offline npm test.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const extension=resolve('build'),profile=await mkdtemp(join(tmpdir(),'sr-live-'));
const artifacts=resolve('artifacts/address-live');await mkdir(artifacts,{recursive:true});
const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.SR_CHROMIUM_PATH||chromium.executablePath(),headless:true,viewport:{width:1366,height:900},args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const steps=[];
try {
  let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
  const version=await settings.evaluate(()=>chrome.runtime.getManifest().version);
  const loaded=await settings.evaluate(()=>fetch(chrome.runtime.getURL('content.js')).then(r=>r.text()));
  assert.equal(version,(await readFile('VERSION','utf8')).trim());assert.equal(loaded,await readFile('content.js','utf8'));
  await settings.locator('#backendMode').selectOption('cloud');
  const page=await context.newPage();page.on('dialog',d=>d.dismiss());
  await page.goto('https://www.safetyreport.go.kr/#safereport/safereport3',{waitUntil:'domcontentloaded'});
  await page.locator('#map').waitFor();await page.locator('#map').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  const cdp=await context.newCDPSession(page);
  const inspect=async(expression)=>{
    const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
    const find=node=>node.attributes?.some((s,i)=>s==='id'&&node.attributes[i+1]==='sr-address-panel-host')?node:[...(node.children||[]),...(node.shadowRoots||[])].map(find).find(Boolean);
    const host=find(root);assert.ok(host?.shadowRoots?.[0],'actual content script must create a closed shadow');
    const remote=await cdp.send('DOM.resolveNode',{nodeId:host.shadowRoots[0].nodeId});
    const value=await cdp.send('Runtime.callFunctionOn',{objectId:remote.object.objectId,functionDeclaration:`function(){return ${expression}}`,returnByValue:true});return value.result.value;
  };
  const visible=async(step)=>{
    const info=await inspect(`(()=>{const body=this.querySelector('.sr-panel-content'),head=this.querySelector('.sr-panel-header'),b=body.getBoundingClientRect(),h=head.getBoundingClientRect(),r=this.host.getBoundingClientRect();return {hidden:this.host.hidden,closed:this.host.shadowRoot===null,collapsed:this.querySelector('.sr-panel').classList.contains('sr-panel-collapsed'),visible:body.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),height:b.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,uncovered:[b,h].every(x=>document.elementFromPoint(x.x+20,x.y+20)===this.host)}})()`);
    assert.ok(!info.hidden&&info.closed&&!info.collapsed&&info.visible&&info.height>20&&info.inside&&info.uncovered,`${step}: ${JSON.stringify(info)}`);steps.push(step);
  };
  const map=await page.locator('#map').boundingBox();
  await page.mouse.click(map.x+100,map.y+100);
  await page.waitForFunction(()=>document.querySelector('#add1')?.textContent.trim().length>=5,{},{timeout:20000});
  await page.locator('#sr-address-panel-host').waitFor();await page.waitForTimeout(1000);await visible('actual SDK location selection');
  await page.mouse.move(map.x+130,map.y+130);await page.mouse.down();await visible('map pointer down');
  for(let i=1;i<=4;i++){await page.mouse.move(map.x+130+i*25,map.y+130+i*10,{steps:4});await visible(`map drag step ${i}`);}
  await page.mouse.up();await visible('map pointer up');
  for(const title of ['확대','축소']){await page.locator(`#map button[title="${title}"]`).last().click();await visible(`SDK ${title}`);}
  for(const selector of ['#VHRNO','label[for="VHRNO"]','#chkNoVhrNo','label[for="chkNoVhrNo"] span','#C_A_TITLE','#C_A_CONTENTS']){
    await page.locator(selector).click();await visible(selector);
  }
  await page.locator('#chkNoVhrNo').uncheck();await page.locator('#VHRNO').fill('12가3456');await page.waitForTimeout(900);await visible('vehicle query unauthenticated response');
  await page.locator('#VHRNO').fill('');await visible('vehicle clear');
  await settings.bringToFront();await page.bringToFront();await visible('tab return');await page.keyboard.press('Escape');await visible('escape');
  for(const zoom of [1.25,1.5,2,1]){
    await page.bringToFront();await settings.evaluate(async zoom=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(tab.id,zoom);},zoom);
    await page.waitForTimeout(150);await visible(`browser zoom ${zoom}`);
  }
  await page.screenshot({path:join(artifacts,'actual-site.png')});
  const close=await inspect(`this.querySelector('[data-action="close"]').getBoundingClientRect().toJSON()`);await page.mouse.click(close.x+close.width/2,close.y+close.height/2);
  await settings.bringToFront();await page.bringToFront();await page.waitForTimeout(1000);assert.equal(await page.locator('#sr-address-panel-host').isVisible(),false);steps.push('X remains closed');
  const report={version,extensionId:id,loadedPath:extension,contentSha256:createHash('sha256').update(loaded).digest('hex'),browser:await context.browser().version(),site:page.url(),steps,backend:'cloud, unauthenticated login guidance only',notTested:['logged-in production report results','production selfhost data','OS Alt+Tab']};
  await writeFile(join(artifacts,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
