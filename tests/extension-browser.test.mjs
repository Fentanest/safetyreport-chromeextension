import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root=resolve('.');
const url=file=>pathToFileURL(resolve(root,file)).href;
import { readFileSync } from 'node:fs';
const CHROME=process.env.CHROME_PATH||'/usr/bin/google-chrome';
// real my-reports-v1 responses (contracts/my-reports/fixtures, captured from the map repo's local stack)
const fx=name=>JSON.parse(readFileSync(resolve(root,`contracts/my-reports/fixtures/${name}.json`),'utf8'));
const FIXTURES={first:fx('search-vehicle-first-page'),next:fx('search-vehicle-next-page'),managers:fx('search-managers-page'),
  summary:fx('summary-first-page'),summaryNext:fx('summary-next-page'),numbers1:fx('numbers-first-page'),numbers2:fx('numbers-last-page'),
  empty:fx('search-empty')};

async function setup(page) {
  await page.addInitScript(({base,data})=>{
    const attachShadow=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){return attachShadow.call(this,{...options,mode:'open'});};
    const calls=[];
    window.__calls=calls;
    window.__clip=null;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__clip=text;}}});
    window.__searchDelay=30;
    window.__searchFirst={}; // optional per-kind override of the first SEARCH page, e.g. {address:data.empty}
    const pick=message=>message.type==='SUMMARY'?(message.cursor?data.summaryNext:data.summary)
      :message.type==='NUMBERS'?(message.cursor?(window.__numbers2||data.numbers2):(window.__numbers1||data.numbers1))
      :message.part==='managers'?data.managers:message.cursor?data.next:(window.__searchFirst[message.kind]||data.first);
    const runtime={id:'abcdefghijklmnopabcdefghijklmnop',lastError:null,
      getURL:name=>`${base}${name}`,onMessage:{addListener(){}},
      sendMessage(message,respond){calls.push(message);if(message.type==='STATUS')respond({data:{backendMode:'cloud',signedIn:true,name:'시험 사용자'}});
        else setTimeout(()=>respond({data:pick(message)}),message.type==='SEARCH'?window.__searchDelay:0);},
      openOptionsPage(){}};
    window.chrome.runtime=runtime;
    window.chrome.storage={sync:{get(_key,cb){cb({theme:'light'});},onChanged:{addListener(){}},set:async()=>{}},
      onChanged:{addListener(){}}};
  },{base:`${url('')}/`,data:FIXTURES});
}

test('vehicle search opens automatically at four characters and survives 20 DOM replacements',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:800,height:600}});
    await setup(page);await page.goto(url('tests/fixture.html'));
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    const input=page.locator('#VHRNO');
    await input.fill('590');await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>window.__calls.filter(x=>x.type==='SEARCH').length),0);
    await input.fill('5902');
    await page.locator('#sr-vehicle-panel-host .sr-record-key').first().waitFor();
    for(let i=0;i<20;i++){
      await page.evaluate(()=>{const old=document.getElementById('VHRNO');const fresh=old.cloneNode();fresh.value='12가3456';old.replaceWith(fresh);});
      await page.waitForTimeout(40);
      assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),false);
    }
    await page.locator('#VHRNO').fill('590');
    assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),true);
    const calls=await page.evaluate(()=>window.__calls.filter(x=>x.type==='SEARCH'));
    assert.ok(calls.length>=1);assert.ok(calls.every(x=>[...x.query].length>=4));
    await page.evaluate(()=>{window.__searchDelay=250;});
    await page.locator('#VHRNO').fill('12가3456');
    await page.waitForTimeout(650);
    await page.locator('#VHRNO').fill('590');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),true);
    await page.locator('#VHRNO').fill('12가3456');
    await page.locator('#VHRNO').click();
    await page.locator('#sr-vehicle-panel-host .sr-record-key').first().waitFor();
    await page.locator('body').click({position:{x:400,y:50}});
    assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),true);
    await page.locator('#VHRNO').click();
    assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),false);
    await page.close();
  }finally{await browser.close();}
});

test('address input picker silently changes value after close and both panels reopen on changed values',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage();await setup(page);await page.goto(url('tests/fixture.html'));
    await page.evaluate(()=>document.getElementById('add1').replaceWith(Object.assign(document.createElement('input'),{id:'add1'})));
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    await page.locator('#add1').fill('서울 종로구 예시로 1');
    await page.locator('#sr-address-panel-host .sr-record-key').first().waitFor();
    await page.locator('#sr-address-panel-host [data-action="close"]').click();
    await page.waitForTimeout(900);assert.equal(await page.locator('#sr-address-panel-host').isVisible(),false);
    await page.locator('#add1').evaluate(el=>{el.value='서울 종로구 예시로 2';});
    await page.locator('#sr-address-panel-host .sr-record-key').first().waitFor();
    await page.locator('#VHRNO').fill('5902');
    await page.locator('#sr-vehicle-panel-host .sr-record-key').first().waitFor();
    await page.locator('#sr-vehicle-panel-host [data-action="close"]').click();
    await page.locator('#VHRNO').evaluate(el=>{el.value='5903';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#sr-vehicle-panel-host .sr-record-key').first().waitFor();
    assert.equal(await page.locator('#sr-address-panel-host').isVisible(),true);
    assert.deepEqual(await page.evaluate(()=>window.__calls.filter(c=>c.type==='SEARCH').map(c=>c.query)),['서울 종로구 예시로 1','서울 종로구 예시로 2','5902','5903']);
  }finally{await browser.close();}
});

test('address panel stays in viewport at narrow width with readable ShadowRoot typography',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:390,height:600}});
    await setup(page);await page.goto(url('tests/fixture.html'));
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    await page.locator('#add1').evaluate(el=>{el.textContent='서울특별시 종로구 예시로 1';});
    await page.locator('#sr-address-panel-host .sr-record-key').first().waitFor();
    const info=await page.locator('#sr-address-panel-host').evaluate(host=>{
      const rect=host.getBoundingClientRect(),shell=host.shadowRoot.querySelector('.sr-panel');
      return {right:rect.right,width:rect.width,scrollWidth:shell.scrollWidth,clientWidth:shell.clientWidth,
        font:getComputedStyle(host.shadowRoot.querySelector('.sr-record-agency')).fontSize};
    });
    assert.ok(info.right<=391&&info.width<=366&&info.scrollWidth<=info.clientWidth+1,JSON.stringify(info));
    assert.equal(info.font,'14px');
  }finally{await browser.close();}
});

test('popup uses a single scroll body and hides excluded fields in light and dark',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:460,height:570}});
    await setup(page);await page.goto(url('popup.html'));
    await page.locator('.sr-record-key').first().waitFor();
    for(const theme of ['light','dark']){
      await page.evaluate(value=>{document.documentElement.dataset.srTheme=value;},theme);
      const sizes=await page.evaluate(()=>({root:document.documentElement.scrollWidth,body:document.body.scrollWidth,
        content:document.getElementById('content').scrollWidth,client:document.getElementById('content').clientWidth,
        footer:document.querySelector('footer').getBoundingClientRect().bottom}));
      assert.ok(sizes.root<=460&&sizes.body<=460&&sizes.content<=sizes.client+1,JSON.stringify(sizes));
      assert.ok(sizes.footer<=571,JSON.stringify(sizes));
      assert.equal(await page.getByText('신고 본문').count(),0);
      assert.equal(await page.getByText('처리중').count(),0);
    }
  }finally{await browser.close();}
});

test('popup and vehicle panel fit a 390px viewport',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    const popup=await browser.newPage({viewport:{width:390,height:600}});
    await setup(popup);await popup.goto(url('popup.html'));await popup.locator('.sr-record-key').first().waitFor();
    const popupSizes=await popup.evaluate(()=>({root:document.documentElement.scrollWidth,body:document.body.scrollWidth,
      content:document.getElementById('content').scrollWidth,client:document.getElementById('content').clientWidth}));
    assert.ok(popupSizes.root<=390&&popupSizes.body<=390&&popupSizes.content<=popupSizes.client+1,JSON.stringify(popupSizes));
    const page=await browser.newPage({viewport:{width:390,height:600}});
    await setup(page);await page.goto(url('tests/fixture.html'));
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    await page.locator('#VHRNO').fill('12가3456');await page.locator('#VHRNO').click();
    await page.locator('#sr-vehicle-panel-host .sr-record-key').first().waitFor();
    const panel=await page.locator('#sr-vehicle-panel-host').evaluate(host=>({rect:host.getBoundingClientRect().toJSON(),
      scroll:host.shadowRoot.querySelector('.sr-panel').scrollWidth,
      client:host.shadowRoot.querySelector('.sr-panel').clientWidth}));
    assert.ok(panel.rect.left>=0&&panel.rect.right<=390&&panel.scroll<=panel.client+1,JSON.stringify(panel));
  }finally{await browser.close();}
});

test('status and disposition badges meet text contrast in both themes',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  const luminance=color=>{
    const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>value/255)
      .map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  };
  try{
    const page=await browser.newPage({viewport:{width:460,height:570}});
    await setup(page);await page.goto(url('popup.html'));await page.locator('.sr-record-key').first().waitFor();
    for(const theme of ['light','dark']){
      const colors=await page.evaluate(value=>{
        document.documentElement.dataset.srTheme=value;
        return ['accept','partial','reject','fine','penalty','unknown'].map(tone=>{
          const sample=document.createElement('span');sample.className=`sr-badge sr-badge--${tone}`;document.body.append(sample);
          const style=getComputedStyle(sample),pair=[style.color,style.backgroundColor];sample.remove();return {tone,pair};
        });
      },theme);
      for(const {tone,pair} of colors){
        const [a,b]=pair.map(luminance),ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
        assert.ok(ratio>=4.5,`${theme} ${tone}: ${ratio}`);
      }
    }
  }finally{await browser.close();}
});

test('v1 paging: more reports and more managers append; copy collects every numbers page before the clipboard',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:500,height:900}});
    await setup(page);await page.goto(url('tests/fixture.html'));
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    await page.locator('#add1').evaluate(el=>{el.textContent='서울특별시 종로구 예시로 1';});
    const host=page.locator('#sr-address-panel-host');
    await host.locator('.sr-record-key').first().waitFor();
    const first=FIXTURES.first, next=FIXTURES.next;
    assert.equal(await host.locator('.sr-record').count(),first.reports.items.length);
    await host.locator('[data-action="more"]').click();
    await page.waitForFunction(n=>document.getElementById('sr-address-panel-host').shadowRoot.querySelectorAll('.sr-record').length===n,
      first.reports.items.length+next.reports.items.length);
    const more=await page.evaluate(()=>window.__calls.filter(c=>c.type==='SEARCH'&&c.cursor));
    assert.equal(more[0].cursor,first.reports.next_cursor);
    assert.ok(more.every(c=>!('offset' in c)&&!('expectedVersion' in c)));
    if(first.managers.next_cursor){
      await host.locator('summary.sr-officer-summary').click();
      await host.locator('[data-action="more-managers"]').click();
      await page.waitForFunction(n=>document.getElementById('sr-address-panel-host').shadowRoot.querySelectorAll('.sr-officer').length===n,
        first.managers.items.length+FIXTURES.managers.managers.items.length);
      const m=await page.evaluate(()=>window.__calls.find(c=>c.part==='managers'));
      assert.equal(m.cursor,first.managers.next_cursor);
    }
    // the real fixtures are pages 1 and 3 of 9 numbers: an incomplete set is never copied
    await host.locator('[data-action="copy"]').click();
    await page.waitForFunction(()=>document.getElementById('sr-address-panel-host').shadowRoot.querySelector('[data-action="copy"]')?.textContent.includes('자료가 바뀌었습니다'));
    assert.equal(await page.evaluate(()=>window.__clip),null);
    // a consistent two-page set (same unique_numbers on both pages) is copied whole
    const expected=[...FIXTURES.numbers1.items,...FIXTURES.numbers2.items];
    await page.evaluate(({a,b,n})=>{window.__numbers1={...a,unique_numbers:n};window.__numbers2={...b,unique_numbers:n};window.__calls.length=0;},
      {a:FIXTURES.numbers1,b:FIXTURES.numbers2,n:expected.length});
    await host.locator('[data-action="copy"]').click();
    await page.waitForFunction(()=>window.__clip!==null);
    const clip=await page.evaluate(()=>window.__clip);
    assert.equal(clip,expected.join('\n'));
    const copyText=await host.locator('[data-action="copy"]').textContent();
    assert.ok(copyText.includes(`${expected.length}건 복사됨`)&&copyText.includes('번호 없는'),copyText);
    const n=await page.evaluate(()=>window.__calls.filter(c=>c.type==='NUMBERS'));
    assert.deepEqual(n.map(c=>c.cursor??null),[null,FIXTURES.numbers1.next_cursor]);
  }finally{await browser.close();}
});

test('popup: whole-scope summary, recent window label, more recent via cursor',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:460,height:570}});
    await setup(page);await page.goto(url('popup.html'));
    await page.locator('.sr-record-key').first().waitFor();
    const s=FIXTURES.summary;
    assert.equal(await page.locator('.sr-total strong').textContent(),String(s.summary.total));
    assert.ok((await page.locator('.sr-list-heading').first().textContent()).includes('09.27~09.29'));
    assert.equal(await page.locator('.sr-record').count(),s.recent.items.length);
    await page.locator('#more').click();
    await page.waitForFunction(n=>document.querySelectorAll('.sr-record').length===n,s.recent.items.length+FIXTURES.summaryNext.recent.items.length);
    const call=await page.evaluate(()=>window.__calls.find(c=>c.type==='SUMMARY'&&c.cursor));
    assert.equal(call.cursor,s.recent.next_cursor);
  }finally{await browser.close();}
});

test('options shows only the button that fits the account state (login xor logout)',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    for(const signedIn of [false,true]){
      const page=await browser.newPage({viewport:{width:420,height:640}});
      await page.addInitScript(({base,signedIn})=>{
        window.chrome.runtime={getURL:n=>base+n,lastError:null,onMessage:{addListener(){}},
          sendMessage:(m,r)=>r({data:m.type==='STATUS'?(signedIn?{backendMode:'cloud',signedIn:true,name:'시험 사용자'}:{backendMode:'cloud',signedIn:false}):{}})};
        window.chrome.storage={sync:{get:(_k,cb)=>cb({theme:'light'}),set:async()=>{}},onChanged:{addListener(){}}};
      },{base:`${url('')}/`,signedIn});
      await page.goto(url('options.html'));
      await page.waitForFunction(()=>document.getElementById('status').textContent!=='계정 확인 중…');
      assert.equal(await page.locator('#login').isVisible(),!signedIn,`login visible, signedIn=${signedIn}`);
      assert.equal(await page.locator('#logout').isVisible(),signedIn,`logout visible, signedIn=${signedIn}`);
      await page.close();
    }
  }finally{await browser.close();}
});

test('address and vehicle panels show at the same time, sized to content and not overlapping, at 1366/1920 widths',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    for(const width of [1366,1920]){
      const page=await browser.newPage({viewport:{width,height:900}});
      await setup(page);await page.goto(url('tests/fixture.html'));
      await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
      await page.locator('#add1').evaluate(el=>{el.textContent='서울특별시 종로구 예시로 1';});
      await page.locator('#sr-address-panel-host .sr-record-key').first().waitFor();
      await page.locator('#VHRNO').fill('12가3456');await page.locator('#VHRNO').click();
      await page.locator('#sr-vehicle-panel-host .sr-record-key').first().waitFor();
      const info=await page.evaluate(()=>{
        const a=document.getElementById('sr-address-panel-host').getBoundingClientRect();
        const v=document.getElementById('sr-vehicle-panel-host').getBoundingClientRect();
        return {
          addressHidden:document.getElementById('sr-address-panel-host').hidden,
          vehicleHidden:document.getElementById('sr-vehicle-panel-host').hidden,
          a:a.toJSON(),v:v.toJSON(),
          overlap:a.left<v.right&&a.right>v.left&&a.top<v.bottom&&a.bottom>v.top,
        };
      });
      assert.equal(info.addressHidden,false,`address hidden at ${width}`);
      assert.equal(info.vehicleHidden,false,`vehicle hidden at ${width}`);
      assert.equal(info.overlap,false,`panels overlap at ${width}: ${JSON.stringify(info)}`);
      // both panels fit on screen (content-sized, clamped by viewport) instead of spilling past it
      assert.ok(info.a.bottom<=901&&info.v.bottom<=901,`panel overflows viewport at ${width}: ${JSON.stringify(info)}`);
      assert.ok(info.a.right<=width&&info.v.right<=width,JSON.stringify(info));
      await page.close();
    }
  }finally{await browser.close();}
});

test('address body stays expanded when vehicle needs the same space; only manual collapse hides it',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:600,height:700}});
    await setup(page);await page.goto(url('tests/fixture.html'));
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    // Move the vehicle input right under where the address panel (top-right) would render, forcing a conflict.
    await page.locator('#VHRNO').evaluate(el=>{el.style.left='260px';el.style.top='200px';});
    await page.locator('#add1').evaluate(el=>{el.textContent='서울특별시 종로구 예시로 1';});
    await page.locator('#sr-address-panel-host .sr-record-key').first().waitFor();
    await page.locator('#VHRNO').fill('12가3456');
    await page.locator('#sr-vehicle-panel-host .sr-record-key').first().waitFor();
    await page.waitForTimeout(80); // let the rAF-scheduled position() pass settle
    const info=await page.evaluate(()=>{
      const addrHost=document.getElementById('sr-address-panel-host'),vHost=document.getElementById('sr-vehicle-panel-host');
      const a=addrHost.getBoundingClientRect(),v=vHost.getBoundingClientRect();
      return {
        addressHidden:addrHost.hidden,vehicleHidden:vHost.hidden,
        collapsedClass:addrHost.shadowRoot.querySelector('.sr-panel').classList.contains('sr-panel-collapsed'),
        a:a.toJSON(),v:v.toJSON(),
        overlap:a.left<v.right&&a.right>v.left&&a.top<v.bottom&&a.bottom>v.top,
      };
    });
    assert.equal(info.addressHidden,false);assert.equal(info.vehicleHidden,false);
    assert.equal(info.overlap,false,`still overlapping: ${JSON.stringify(info)}`);
    assert.equal(info.collapsedClass,false,JSON.stringify(info));
    assert.ok(info.a.height>140,`address must retain its body: ${info.a.height}`);
    // Only the user's manual toggle may hide the body.
    await page.locator('#sr-address-panel-host').evaluate(host=>host.shadowRoot.querySelector('[data-action="toggle-collapse"]').click());
    const expanded=await page.evaluate(()=>document.getElementById('sr-address-panel-host').shadowRoot.querySelector('.sr-panel').classList.contains('sr-panel-collapsed'));
    assert.equal(expanded,true,'manual toggle should collapse the address panel');
    await page.locator('#sr-address-panel-host').evaluate(host=>host.shadowRoot.querySelector('[data-action="toggle-collapse"]').click());
    assert.equal(await page.locator('#sr-address-panel-host .sr-panel-content').isVisible(),true);
    await page.close();
  }finally{await browser.close();}
});

test('zero results collapse to a single line instead of empty result/disposition tiles, for both address and vehicle',async()=>{
  const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1366,height:900}});
    await setup(page);await page.goto(url('tests/fixture.html'));
    await page.evaluate(empty=>{window.__searchFirst={address:empty,vehicle:empty};},FIXTURES.empty);
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    await page.locator('#add1').evaluate(el=>{el.textContent='부산광역시 중구 예시로 7';});
    await page.locator('#VHRNO').fill('99가9999');await page.locator('#VHRNO').click();
    const resolved=id=>{
      const el=document.getElementById(id)?.shadowRoot?.querySelector('.sr-note');
      return !!el && !el.textContent.includes('조회 중');
    };
    await page.waitForFunction(resolved,'sr-address-panel-host');
    await page.waitForFunction(resolved,'sr-vehicle-panel-host');
    const info=await page.evaluate(()=>{
      const read=id=>{
        const root=document.getElementById(id).shadowRoot;
        return {
          text:root.querySelector('.sr-panel-content').textContent.trim(),
          tiles:root.querySelectorAll('.sr-tile').length,
          officerSections:root.querySelectorAll('.sr-officer-section').length,
          recordLists:root.querySelectorAll('.sr-record-list').length,
          height:document.getElementById(id).getBoundingClientRect().height,
        };
      };
      return {address:read('sr-address-panel-host'),vehicle:read('sr-vehicle-panel-host')};
    });
    assert.equal(info.address.text,'이 주소로 내 신고가 없습니다.');
    assert.equal(info.vehicle.text,'이 차량으로 내 신고가 없습니다.');
    for(const panel of [info.address,info.vehicle]){
      assert.equal(panel.tiles,0,JSON.stringify(panel));
      assert.equal(panel.officerSections,0,JSON.stringify(panel));
      assert.equal(panel.recordLists,0,JSON.stringify(panel));
      assert.ok(panel.height<180,`zero-result panel should be compact: ${JSON.stringify(panel)}`);
    }
    await page.close();
  }finally{await browser.close();}
});
