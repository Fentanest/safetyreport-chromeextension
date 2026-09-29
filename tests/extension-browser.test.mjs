import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root=resolve('.');
const url=file=>pathToFileURL(resolve(root,file)).href;
const fact={report_number:'SPP-2026-123456',source_report_id:'80000001',vehicle_number:'12가3456',
  report_date:'2026-09-25',completed_date:'2026-09-29',status:'accepted',disposition:'fine',
  amount_kind:'fine',confirmed_amount_won:40000,agency_name_current:'가상시청 교통행정과',
  manager_name:'담당자 가',address:'가상시 예시구 테스트로 12',rating:4,violation_law:'도로교통법 제5조'};
const result={version:'a'.repeat(32),total:1,missing_numbers:0,next_offset:null,
  summary:{total:1,accepted:1,partial:0,rejected:0,completed_unknown:0,fine:1,warning:0,
    penalty:0,disposition_none:0,disposition_unknown:0,confirmed_fine_won:40000,confirmed_fine_count:1,recent_count:1},
  managers:[],items:[fact]};

async function setup(page) {
  await page.addInitScript(({base,data})=>{
    const attachShadow=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){return attachShadow.call(this,{...options,mode:'open'});};
    const calls=[];
    window.__calls=calls;
    window.__searchDelay=30;
    const runtime={id:'abcdefghijklmnopabcdefghijklmnop',lastError:null,
      getURL:name=>`${base}${name}`,onMessage:{addListener(){}},
      sendMessage(message,respond){calls.push(message);if(message.type==='STATUS')respond({data:{signedIn:true,name:'시험 사용자'}});
        else if(message.type==='NUMBERS')respond({data:{...data,items:[{report_number:data.items[0].report_number}]}});
        else setTimeout(()=>respond({data}),message.type==='SEARCH'?window.__searchDelay:0);},
      openOptionsPage(){}};
    window.chrome.runtime=runtime;
    window.chrome.storage={sync:{get(_key,cb){cb({theme:'light'});},onChanged:{addListener(){}},set:async()=>{}},
      onChanged:{addListener(){}}};
  },{base:`${url('')}/`,data:result});
}

test('vehicle search waits for six characters and survives 20 DOM replacements',async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:800,height:600}});
    await setup(page);await page.goto(url('tests/fixture.html'));
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    const input=page.locator('#VHRNO');
    await input.fill('12가345');await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>window.__calls.filter(x=>x.type==='SEARCH').length),0);
    await input.fill('12가3456');await input.click();
    await page.locator('#sr-vehicle-panel-host .sr-record-key').waitFor();
    for(let i=0;i<20;i++){
      await page.evaluate(()=>{const old=document.getElementById('VHRNO');const fresh=old.cloneNode();fresh.value='12가3456';old.replaceWith(fresh);});
      await page.waitForTimeout(40);
      await page.locator('#VHRNO').click();
      assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),false);
    }
    await page.locator('#VHRNO').fill('12가3');
    assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),true);
    const calls=await page.evaluate(()=>window.__calls.filter(x=>x.type==='SEARCH'));
    assert.ok(calls.length>=1);assert.ok(calls.every(x=>[...x.query].length>=6));
    await page.evaluate(()=>{window.__searchDelay=250;});
    await page.locator('#VHRNO').fill('12가3456');
    await page.waitForTimeout(650);
    await page.locator('#VHRNO').fill('12가3');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),true);
    await page.locator('#VHRNO').fill('12가3456');
    await page.locator('#VHRNO').click();
    await page.locator('#sr-vehicle-panel-host .sr-record-key').waitFor();
    await page.locator('body').click({position:{x:400,y:50}});
    assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),true);
    await page.locator('#VHRNO').click();
    assert.equal(await page.locator('#sr-vehicle-panel-host').evaluate(el=>el.hidden),false);
    await page.close();
  }finally{await browser.close();}
});

test('address panel stays in viewport at narrow width with readable ShadowRoot typography',async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:390,height:600}});
    await setup(page);await page.goto(url('tests/fixture.html'));
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    await page.locator('#add1').evaluate(el=>{el.textContent='가상시 예시구 테스트로 12';});
    await page.locator('#sr-address-panel-host .sr-record-key').waitFor();
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
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:460,height:570}});
    await setup(page);await page.goto(url('popup.html'));
    await page.locator('.sr-record-key').waitFor();
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
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  try{
    const popup=await browser.newPage({viewport:{width:390,height:600}});
    await setup(popup);await popup.goto(url('popup.html'));await popup.locator('.sr-record-key').waitFor();
    const popupSizes=await popup.evaluate(()=>({root:document.documentElement.scrollWidth,body:document.body.scrollWidth,
      content:document.getElementById('content').scrollWidth,client:document.getElementById('content').clientWidth}));
    assert.ok(popupSizes.root<=390&&popupSizes.body<=390&&popupSizes.content<=popupSizes.client+1,JSON.stringify(popupSizes));
    const page=await browser.newPage({viewport:{width:390,height:600}});
    await setup(page);await page.goto(url('tests/fixture.html'));
    await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
    await page.locator('#VHRNO').fill('12가3456');await page.locator('#VHRNO').click();
    await page.locator('#sr-vehicle-panel-host .sr-record-key').waitFor();
    const panel=await page.locator('#sr-vehicle-panel-host').evaluate(host=>({rect:host.getBoundingClientRect().toJSON(),
      scroll:host.shadowRoot.querySelector('.sr-panel').scrollWidth,
      client:host.shadowRoot.querySelector('.sr-panel').clientWidth}));
    assert.ok(panel.rect.left>=0&&panel.rect.right<=390&&panel.scroll<=panel.client+1,JSON.stringify(panel));
  }finally{await browser.close();}
});

test('status and disposition badges meet text contrast in both themes',async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const luminance=color=>{
    const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>value/255)
      .map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  };
  try{
    const page=await browser.newPage({viewport:{width:460,height:570}});
    await setup(page);await page.goto(url('popup.html'));await page.locator('.sr-record-key').waitFor();
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
