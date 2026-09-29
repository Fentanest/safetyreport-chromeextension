import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';

const executable=process.env.SR_CHROMIUM_PATH || chromium.executablePath();
if (!existsSync(executable)) throw new Error('Set SR_CHROMIUM_PATH to an unpacked-extension-capable Chromium binary.');
const dir=resolve('build');
if (!existsSync(join(dir,'manifest.json'))) throw new Error('Run npm run build first.');
const profile=await mkdtemp(join(tmpdir(),'sr-action-popup-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:executable,headless:true,
  args:['--no-sandbox','--window-size=1280,720',`--disable-extensions-except=${dir}`,`--load-extension=${dir}`]});
try{
  let worker=context.serviceWorkers()[0];
  if(!worker)worker=await context.waitForEvent('serviceworker',{timeout:15000});
  const id=new URL(worker.url()).host;
  const options=await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.evaluate(()=>chrome.action.openPopup());
  await options.waitForTimeout(700);
  const cdp=await context.newCDPSession(options);
  const targets=await cdp.send('Target.getTargets');
  const popup=targets.targetInfos.find(target=>target.url===`chrome-extension://${id}/popup.html`);
  assert.ok(popup,'Chrome did not create an action popup target');
  const attached=await cdp.send('Target.attachToTarget',{targetId:popup.targetId,flatten:false});
  const reply=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Popup inspection timed out')),5000);
    cdp.on('Target.receivedMessageFromTarget',message=>{
      if(message.sessionId!==attached.sessionId)return;
      const data=JSON.parse(message.message);
      if(data.id===1){clearTimeout(timeout);resolve(data);}
    });
  });
  await cdp.send('Target.sendMessageToTarget',{sessionId:attached.sessionId,message:JSON.stringify({id:1,
    method:'Runtime.evaluate',params:{returnByValue:true,expression:`JSON.stringify({
      viewportWidth:innerWidth,viewportHeight:innerHeight,
      bodyWidth:document.body.getBoundingClientRect().width,
      footerBottom:document.querySelector('footer').getBoundingClientRect().bottom,
      contentScroll:document.getElementById('content').scrollWidth,
      contentClient:document.getElementById('content').clientWidth
    })`}})});
  const result=JSON.parse((await reply).result.result.value);
  assert.equal(result.bodyWidth,460);
  assert.ok(result.viewportWidth>=460&&result.viewportWidth<=800,JSON.stringify(result));
  assert.ok(result.viewportHeight<=600&&result.footerBottom<=result.viewportHeight+1,JSON.stringify(result));
  assert.ok(result.contentScroll<=result.contentClient+1,JSON.stringify(result));
  console.log(JSON.stringify(result));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
