import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const url = file => pathToFileURL(resolve(file)).href;
const sourceRoot = process.env.SR_CONTENT_ROOT || '.';
const fixture = name => JSON.parse(readFileSync(`contracts/my-reports/fixtures/${name}.json`, 'utf8'));
const A = '서울특별시 종로구 테스트로 1', B = '서울특별시 종로구 테스트로 2';

async function setup(fn) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    await page.goto(url('tests/fixtures/address-panel.html'));
    await page.evaluate(({ base, data, empty }) => {
      // Test-only observation: keep actual closed mode. Nothing is added to shipping code.
      const attach = Element.prototype.attachShadow, roots = new Map();
      Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); roots.set(this.id, root); return root; };
      window.root = kind => roots.get(`sr-${kind}-panel-host`);
      document.querySelectorAll('.sr-extension-host').forEach(el => el.remove());
      window.calls = []; window.pending = []; window.hold = false; window.reply = 'records'; window.messages = [];
      window.mapEvents = []; for (const type of ['pointerdown','pointermove','pointerup']) document.querySelector('#map').addEventListener(type, e => window.mapEvents.push({type, prevented:e.defaultPrevented}));
      window.respond = (message, cb) => {
        const result = structuredClone(window.reply === 'empty' ? empty : data);
        if (result.reports?.items?.[0]) result.reports.items[0].vehicle_number = message.query;
        cb(window.reply === 'error' ? {error:'REQUEST_FAILED'} : window.reply === 'auth' ? {error:'AUTH_REQUIRED'} : {data:result});
      };
      window.chrome.runtime = { getURL:n=>base+n, onMessage:{addListener:f=>window.messages.push(f)}, sendMessage(m,cb){window.calls.push(m);if(window.hold)window.respond(m,r=>window.pending.push(()=>cb(r)));else window.respond(m,cb);} };
      window.chrome.storage = {sync:{get:(_,cb)=>cb({})},onChanged:{addListener(){}}};
      window.notify = type => window.messages.forEach(fn=>fn({type}));
    }, { base:url(sourceRoot)+'/', data:fixture('search-vehicle-first-page'), empty:fixture('search-empty') });
    await page.addScriptTag({url:url(`${sourceRoot}/shared-ui.js`)});
    // Capture controller snapshots in tests only, including call site and event target for diagnoses.
    let source = readFileSync(resolve(sourceRoot, 'content.js'), 'utf8');
    source = source.replace('const panels = {};', `const panels = {}; window.state = () => ({open:states.address.open, collapsed:states.address.collapsed, autoFold:states.address.autoFold, query:states.address.query, generation:states.address.generation}); window.transitions=[];`)
      .replace('const s = states[kind]; s.open = false;', `const s = states[kind]; window.transitions.push({kind, event:window.event?.type, target:window.event?.target?.id||window.event?.target?.tagName, stack:new Error().stack}); s.open = false;`);
    await page.addScriptTag({content:source});
    await fn(page);
  } finally { await browser.close(); }
}
async function select(page, query=A) { await page.locator('#add1').evaluate((el,q)=>{el.textContent=q;}, query); }
async function settled(page) { await page.waitForFunction(()=>window.root('address')?.querySelector('.sr-record,.sr-note') && !window.root('address').textContent.includes('조회 중…')); await page.waitForTimeout(60); }
async function visible(page, label='') {
  const s = await page.evaluate(()=>{
    const host=document.getElementById('sr-address-panel-host'), root=window.root('address'), body=root?.querySelector('.sr-panel-content'), head=root?.querySelector('.sr-panel-header');
    const rect=el=>el?.getBoundingClientRect().toJSON();
    const shown=el=>!!el&&el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    const b=rect(body), h=rect(head), r=rect(host);
    const topAt=(r)=>r&&document.elementFromPoint(r.x+Math.min(r.width/2,30),r.y+Math.min(r.height/2,20))===host;
    return {hidden:host?.hidden,closed:host?.shadowRoot===null,body:shown(body),head:shown(head),collapsed:root?.querySelector('.sr-panel').classList.contains('sr-panel-collapsed'),r,b,h,
      inside:r&&r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,uncovered:topAt(b)&&topAt(h),count:document.querySelectorAll('#sr-address-panel-host').length,state:window.state(),transitions:window.transitions};
  });
  assert.ok(!s.hidden && s.closed && s.body && s.head && !s.collapsed && s.b.height>20 && s.inside && s.uncovered && s.count===1, `${label}: ${JSON.stringify(s)}`);
}
async function clickAction(page, action) { await page.evaluate(action=>window.root('address').querySelector(`[data-action="${action}"]`).click(), action); }
async function drag(page, change=false) {
  const box=await page.locator('#map').boundingBox(); await page.mouse.move(box.x+30,box.y+50); await page.mouse.down(); await visible(page,'pointer down');
  for(let i=1;i<=4;i++){await page.mouse.move(box.x+30+i*40,box.y+50+i*10,{steps:3});if(change&&i===2)await select(page,B);await visible(page,`drag ${i}`);}
  await page.mouse.up();await visible(page,'pointer up');
  const events=await page.evaluate(()=>window.mapEvents);assert.ok(events.some(e=>e.type==='pointerdown')&&events.filter(e=>e.type==='pointermove').length>=4&&events.some(e=>e.type==='pointerup'));assert.ok(events.every(e=>!e.prevented));
}

  for(const result of ['records','empty']) test(`map drag continuously preserves ${result}, unchanged and changed address`,()=>setup(async page=>{
    await page.evaluate(value=>window.reply=value,result);await select(page);await settled(page);await drag(page);await drag(page,true);await settled(page);await visible(page);assert.equal(await page.evaluate(()=>window.state().query),B);
  }));
  for(const selector of ['#VHRNO','label[for="VHRNO"]','#vehicle-cell','#chkNoVhrNo','label[for="chkNoVhrNo"]','label[for="chkNoVhrNo"] span','#C_A_TITLE','#C_A_CONTENTS','#blank']) test(`independent outside target ${selector}`,()=>setup(async page=>{
    await select(page);await settled(page);await page.locator(selector).click(selector==='#vehicle-cell'?{position:{x:390,y:10}}:{});await visible(page,selector);
  }));
  for(const prefilled of [false,true]) test(`narrow direct vehicle click (prefilled=${prefilled}) never auto-folds address`,()=>setup(async page=>{
    await page.setViewportSize({width:600,height:700});
    await page.locator('#VHRNO').evaluate(el=>Object.assign(el.style,{position:'fixed',left:'25px',top:'440px',width:'150px'}));
    if(prefilled)await page.locator('#VHRNO').fill('12가3456');
    await select(page);await settled(page);await visible(page,'before direct click');
    await page.locator('#VHRNO').click();await visible(page,'direct click');
    if(!prefilled)await page.locator('#VHRNO').fill('12가3456');
    await page.waitForTimeout(750);await visible(page,'vehicle opens');
  }));
  test(`direct populated vehicle input, edits, completion and deletion preserve address and scroll`,()=>setup(async page=>{
    await select(page);await settled(page);
    await page.evaluate(()=>window.root('address').querySelector('.sr-panel-content').scrollTop=50);
    const before=await page.evaluate(()=>({state:window.state(),scroll:window.root('address').querySelector('.sr-panel-content').scrollTop,html:window.root('address').querySelector('.sr-panel-content').innerHTML}));
    await page.locator('#VHRNO').fill('12가3456');await page.locator('#VHRNO').click();await page.waitForTimeout(750);await visible(page,'vehicle response');
    await page.locator('#VHRNO').fill('12가3457');await page.waitForTimeout(750);await visible(page);await page.locator('#VHRNO').fill('');await visible(page);
    assert.deepEqual(await page.evaluate(()=>({state:window.state(),scroll:window.root('address').querySelector('.sr-panel-content').scrollTop,html:window.root('address').querySelector('.sr-panel-content').innerHTML})),before);
  }));
  test(`replacement, temporary missing node/value and detached handlers preserve query and results`,()=>setup(async page=>{
    await select(page);await settled(page);const calls=await page.evaluate(()=>window.calls.length);
    await page.evaluate(()=>{window.old=document.querySelector('#add1');window.old.replaceWith(window.old.cloneNode(true));});await page.waitForTimeout(400);await visible(page,'replacement');
    assert.equal(await page.evaluate(()=>window.calls.length),calls);
    await page.evaluate(()=>{window.current=document.querySelector('#add1');window.current.remove();});await page.waitForTimeout(400);await visible(page,'missing DOM');
    await page.evaluate(()=>document.querySelector('#frmSafeReport').prepend(window.current));await page.waitForTimeout(400);
    await select(page,'');await page.waitForTimeout(200);await visible(page,'temporary empty');await select(page);await page.waitForTimeout(900);
    await page.evaluate(()=>{window.old.textContent='오래된 테스트 주소';window.old.dispatchEvent(new Event('input'));});await page.waitForTimeout(800);
    assert.equal(await page.evaluate(()=>window.calls.length),calls);await visible(page);
    await select(page,'');await page.waitForTimeout(1200);await visible(page,'confirmed clear');assert.match(await page.evaluate(()=>window.root('address').textContent),/주소를 선택/);
  }));
  test(`late A cannot overwrite B; zero and errors stay inside panel`,()=>setup(async page=>{
    await page.evaluate(()=>window.hold=true);await select(page);await page.waitForTimeout(750);await visible(page,'A pending');await select(page,B);await page.waitForTimeout(750);await visible(page,'B pending');
    assert.equal(await page.evaluate(()=>window.root('address').querySelectorAll('.sr-record').length),0);
    await page.evaluate(()=>window.pending.pop()());await settled(page);assert.match(await page.evaluate(()=>window.root('address').querySelector('.sr-record-key').textContent),/테스트로 2/);const html=await page.evaluate(()=>window.root('address').innerHTML);
    await page.evaluate(()=>window.pending.shift()());await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>window.root('address').innerHTML),html);
    for(const reply of ['empty','error']){await page.evaluate(r=>{window.hold=false;window.reply=r;},reply);await select(page,A+reply);await settled(page);await visible(page,reply);assert.equal(await page.evaluate(()=>window.root('address').querySelectorAll('.sr-record').length),0);assert.match(await page.evaluate(()=>window.root('address').querySelector('.sr-note').textContent),reply==='empty'?/없습니다/:/연결|실패|다시/);}
  }));
  test(`layout, escape, focus, hash, messages and host restoration never close or fold`,()=>setup(async page=>{
    await select(page);await settled(page);await page.locator('#VHRNO').fill('12가3456');await page.waitForTimeout(750);
    for(const size of [{width:600,height:700},{width:390,height:600},{width:1100,height:850}]){await page.setViewportSize(size);await page.waitForTimeout(80);await visible(page,'resize');}
    await page.evaluate(()=>window.scrollTo(0,400));await page.waitForTimeout(60);await visible(page,'scroll');await page.keyboard.press('Escape');await visible(page,'escape');
    await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));location.hash='other-section';document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(200);await visible(page,'focus/hash');
    for(const type of ['DATA_INVALIDATED','WORKER_RESTARTED','AUTH_CHANGED']){await page.evaluate(type=>window.notify(type),type);await settled(page);await visible(page,type);}
    await page.evaluate(()=>document.getElementById('sr-address-panel-host').remove());await page.waitForTimeout(100);await visible(page,'host restore');
    await clickAction(page,'toggle-collapse');await page.setViewportSize({width:600,height:700});await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.state().collapsed),true);await clickAction(page,'toggle-collapse');await page.waitForTimeout(80);await visible(page,'manual expand');
  }));
  test(`X persists across pending response, replacements, focus, hash, invalidation and removed host`,()=>setup(async page=>{
    await page.evaluate(()=>window.hold=true);await select(page);await page.waitForTimeout(750);await clickAction(page,'close');
    await page.evaluate(()=>{window.pending.shift()();const a=document.querySelector('#add1');a.replaceWith(a.cloneNode(true));window.dispatchEvent(new Event('focus'));location.hash='another';document.querySelector('#add1').dispatchEvent(new Event('focus'));for(const t of ['AUTH_CHANGED','DATA_INVALIDATED','WORKER_RESTARTED'])window.notify(t);});
    await page.waitForTimeout(1000);assert.equal(await page.locator('#sr-address-panel-host').isVisible(),false);
    await page.evaluate(()=>document.querySelector('#sr-address-panel-host').remove());await page.waitForTimeout(400);assert.equal(await page.locator('#sr-address-panel-host').count(),0);
    await page.evaluate(()=>window.hold=false);await page.locator('#add1').click();await settled(page);await visible(page,'explicit reopen');
  }));
  test(`auth change immediately erases prior account data and rejects old responses`,()=>setup(async page=>{
    await select(page);await settled(page);await page.evaluate(()=>{window.hold=true;window.notify('DATA_INVALIDATED');});await page.waitForTimeout(50);
    await page.evaluate(()=>{window.reply='auth';window.notify('AUTH_CHANGED');});assert.equal(await page.evaluate(()=>window.root('address').querySelectorAll('.sr-record').length),0);await page.waitForTimeout(50);
    await page.evaluate(()=>{window.pending.reverse().forEach(f=>f());window.pending=[];});await page.waitForTimeout(100);await visible(page);assert.equal(await page.evaluate(()=>window.root('address').querySelectorAll('.sr-record').length),0);
  }));
