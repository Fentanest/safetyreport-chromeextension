import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const url=file=>pathToFileURL(resolve(file)).href;
const base=`${url('.')}/`;
const output=resolve('artifacts/ui-review');
await mkdir(output,{recursive:true});
const item={report_number:'SPP-2026-123456',source_report_id:'80000001',vehicle_number:'12가3456',
  report_date:'2026-09-26',completed_date:'2026-09-29',status:'accepted',disposition:'fine',
  amount_kind:'fine',confirmed_amount_won:40000,agency_name_original:'가상시청 교통행정과',
  agency_name_current:'가상시청 교통행정과',manager_name:'담당자 가',
  address:'가상시 예시구 테스트로 12',violation_law:'도로교통법 제5조',rating:4};
const data={version:'a'.repeat(32),total:1,missing_numbers:0,next_offset:null,
  summary:{total:1,recent_count:1,accepted:1,partial:0,rejected:0,completed_unknown:0,
    fine:1,warning:0,penalty:0,disposition_none:0,disposition_unknown:0,
    confirmed_fine_won:40000,confirmed_fine_count:1},
  managers:[{agency_name_current:'가상시청 교통행정과',manager_name:'담당자 가',total:1,
    accepted:1,partial:0,fine:1,confirmed_fine_won:40000}],items:[item]};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
  for(const theme of ['light','dark']){
    const popup=await browser.newPage({viewport:{width:460,height:570}});
    await popup.addInitScript(({base,data,theme})=>{
      window.chrome.runtime={getURL:name=>base+name,lastError:null,
        sendMessage:(message,respond)=>respond({data:message.type==='STATUS'?{signedIn:true,name:'시험 사용자'}:data}),
        onMessage:{addListener(){}},openOptionsPage(){}};
      window.chrome.storage={sync:{get:(_key,respond)=>respond({theme}),onChanged:{addListener(){}}},onChanged:{addListener(){}}};
    },{base,data,theme});
    await popup.goto(url('popup.html'));
    await popup.locator('.sr-record-key').waitFor();
    await popup.locator('.sr-popup').screenshot({path:resolve(output,`action-${theme}.png`)});
    await popup.close();
    for(const kind of ['vehicle','address']){
      const page=await browser.newPage({viewport:{width:kind==='vehicle'?800:500,height:800}});
      await page.addInitScript(({base,data,theme})=>{
        const attachShadow=Element.prototype.attachShadow;
        Element.prototype.attachShadow=function(options){return attachShadow.call(this,{...options,mode:'open'});};
        window.chrome.runtime={getURL:name=>base+name,lastError:null,
          sendMessage:(_message,respond)=>respond({data}),onMessage:{addListener(){}}};
        window.chrome.storage={sync:{get:(_key,respond)=>respond({theme}),onChanged:{addListener(){}}},onChanged:{addListener(){}}};
      },{base,data,theme});
      await page.goto(url('tests/fixture.html'));
      await page.addScriptTag({url:url('shared-ui.js')});await page.addScriptTag({url:url('content.js')});
      if(kind==='vehicle'){await page.locator('#VHRNO').fill('12가3456');await page.locator('#VHRNO').click();}
      else await page.locator('#add1').evaluate(el=>{el.textContent='가상시 예시구 테스트로 12';});
      const host=page.locator(`#sr-${kind}-panel-host`);
      await host.locator('.sr-record-key').waitFor();
      await host.screenshot({path:resolve(output,`${kind}-${theme}.png`)});
      await page.close();
    }
  }
  console.log(output);
}finally{await browser.close();}
