import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const url=file=>pathToFileURL(resolve(file)).href;
const base=`${url('.')}/`;
const output=resolve('artifacts/ui-review');
await mkdir(output,{recursive:true});
// real my-reports-v1 responses (contracts/my-reports/fixtures)
const fx=name=>JSON.parse(readFileSync(resolve(`contracts/my-reports/fixtures/${name}.json`),'utf8'));
const data={first:fx('search-vehicle-first-page'),summary:fx('summary-first-page')};
const CHROME=process.env.CHROME_PATH||'/usr/bin/google-chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
try{
  for(const theme of ['light','dark']){
    const popup=await browser.newPage({viewport:{width:460,height:570}});
    await popup.addInitScript(({base,data,theme})=>{
      window.chrome.runtime={getURL:name=>base+name,lastError:null,
        sendMessage:(message,respond)=>respond({data:message.type==='STATUS'?{backendMode:'cloud',signedIn:true,name:'시험 사용자'}:message.type==='SUMMARY'?data.summary:data.first}),
        onMessage:{addListener(){}},openOptionsPage(){}};
      window.chrome.storage={sync:{get:(_key,respond)=>respond({theme}),onChanged:{addListener(){}}},onChanged:{addListener(){}}};
    },{base,data,theme});
    await popup.goto(url('popup.html'));
    await popup.locator('.sr-record-key').first().waitFor();
    await popup.locator('.sr-popup').screenshot({path:resolve(output,`action-${theme}.png`)});
    await popup.close();
    for(const kind of ['vehicle','address']){
      const page=await browser.newPage({viewport:{width:kind==='vehicle'?800:500,height:800}});
      await page.addInitScript(({base,data,theme})=>{
        const attachShadow=Element.prototype.attachShadow;
        Element.prototype.attachShadow=function(options){return attachShadow.call(this,{...options,mode:'open'});};
        window.chrome.runtime={getURL:name=>base+name,lastError:null,
          sendMessage:(_message,respond)=>respond({data:data.first}),onMessage:{addListener(){}}};
        window.chrome.storage={sync:{get:(_key,respond)=>respond({theme}),onChanged:{addListener(){}}},onChanged:{addListener(){}}};
      },{base,data,theme});
      await page.goto(url('tests/fixture.html'));
      await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
      if(kind==='vehicle'){await page.locator('#VHRNO').fill('12가3456');await page.locator('#VHRNO').click();}
      else await page.locator('#add1').evaluate(el=>{el.textContent='서울특별시 종로구 예시로 1';});
      const host=page.locator(`#sr-${kind}-panel-host`);
      await host.locator('.sr-record-key').first().waitFor();
      await host.screenshot({path:resolve(output,`${kind}-${theme}.png`)});
      await page.close();
    }
  }
  console.log(output);
}finally{await browser.close();}
