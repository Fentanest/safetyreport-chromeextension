'use strict';
(() => {
  const el=id=>document.getElementById(id);
  const status=el('status'),login=el('login'),logout=el('logout'),theme=el('theme'),mode=el('backendMode');
  let generation=0;
  const send=message=>new Promise((resolve,reject)=>chrome.runtime.sendMessage(message,response=>{
    if(chrome.runtime.lastError)reject(new Error('REQUEST_FAILED'));
    else if(response?.error)reject(new Error(response.error));else resolve(response?.data);
  }));
  const applyTheme=choice=>{document.documentElement.dataset.srTheme=choice==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):choice;};
  chrome.storage.sync.get('theme',value=>{theme.value=value.theme||'system';applyTheme(theme.value);});
  theme.addEventListener('change',async()=>{await chrome.storage.sync.set({theme:theme.value});applyTheme(theme.value);});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>applyTheme(theme.value));
  function displayMode(value){
    mode.value=value||'';el('selfhostSettings').hidden=value!=='selfhost';el('cloudSettings').hidden=value!=='cloud';
    el('modeStatus').textContent=value==='selfhost'?'셀프호스팅 · 내 서버의 신고 / 크롤링':value==='cloud'?'클라우드 · 내가 공유한 답변 완료 신고':'모드를 선택하면 연결합니다. 두 모드 설정은 각각 보존됩니다.';
  }
  async function refresh(){
    const run=++generation;
    try{
      const state=await send({type:'STATUS'});if(run!==generation)return;
      const value=state.backendMode||null;displayMode(value);
      if(value==='selfhost'){el('serverStatus').textContent=state.connected?`연결됨 · 서버 ${state.version}`:SRUI.errorText(state.error);return;}
      status.textContent=state.signedIn?(state.name?`${state.name} 계정으로 로그인됨`:'카카오 계정으로 로그인됨'):state.error==='NOT_CONFIGURED'?'배포용 Supabase 공개 설정이 필요합니다.':'로그인하지 않았습니다.';
      login.hidden=state.signedIn||state.error==='NOT_CONFIGURED';logout.hidden=!state.signedIn;
    }catch{status.textContent='계정 상태를 확인하지 못했습니다.';}
  }
  mode.addEventListener('change',async()=>{
    if(!mode.value)return;mode.disabled=true;generation++;
    try{await send({type:'SET_MODE',backendMode:mode.value});el('testResult').textContent='';el('cloudTestResult').textContent='';await refresh();}
    catch(error){el('modeStatus').textContent=SRUI.errorText(error.message);}finally{mode.disabled=false;}
  });
  function save(test){
    const target=el(test?'testResult':'serverStatus');
    let origin;try{const url=new URL(el('serverUrl').value.trim());if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!/^\/*$/.test(url.pathname))throw new Error();origin=url.origin;}catch{target.textContent=SRUI.errorText('INVALID_SERVER_URL');return;}
    const config={type:'SAVE_SERVER',serverUrl:origin,apiKey:el('apiKey').value.trim(),notifyCrawlDone:el('notifyCrawlDone').checked,pollInterval:Number(el('pollInterval').value)};
    if(!config.apiKey){target.textContent=SRUI.errorText('INVALID_API_KEY');return;}
    // Request only the entered origin; execute directly inside the click gesture.
    chrome.permissions.request({origins:[origin+'/*'],...(!test&&config.notifyCrawlDone?{permissions:['notifications']}:{})},async granted=>{
      if(!granted){target.textContent=!test&&config.notifyCrawlDone?'서버 접근 또는 알림 권한이 허용되지 않았습니다. 알림이 필요 없다면 체크를 해제하고 다시 저장해 주세요.':SRUI.errorText('SERVER_PERMISSION_REQUIRED');return;}
      const run=++generation;el('btnSave').disabled=true;el('btnTest').disabled=true;
      try{if(!test)await send(config);if(run!==generation)return;target.textContent=test?'연결 테스트 중…':'저장되었습니다.';
        if(test){const state=await send({...config,type:'TEST_SERVER'});if(run!==generation)return;target.textContent=`연결 성공 · 서버 ${state.version} · protocol 3`;el('serverStatus').textContent=state.active?'연결됨':'테스트한 설정은 저장되지 않았습니다. 저장하면 적용됩니다.';}}
      catch(error){if(run===generation)target.textContent=SRUI.errorText(error.message);}
      finally{el('btnSave').disabled=false;el('btnTest').disabled=false;}
    });
  }
  el('btnSave').addEventListener('click',()=>save(false));el('btnTest').addEventListener('click',()=>save(true));
  el('testCloud').addEventListener('click',async()=>{const run=generation;el('cloudTestResult').textContent='연결 테스트 중…';try{await send({type:'TEST_CLOUD'});if(run===generation)el('cloudTestResult').textContent='클라우드 조회 연결 성공';}catch(error){if(run===generation)el('cloudTestResult').textContent=SRUI.errorText(error.message);}});
  login.addEventListener('click',async()=>{login.disabled=true;status.textContent='카카오 로그인 중…';try{await send({type:'LOGIN'});}catch{status.textContent='로그인하지 못했습니다. 다시 시도해 주세요.';}finally{login.disabled=false;await refresh();}});
  logout.addEventListener('click',async()=>{logout.disabled=true;try{await send({type:'LOGOUT'});}catch{status.textContent='로그아웃하지 못했습니다.';}finally{logout.disabled=false;await refresh();}});
  (async()=>{try{const config=await send({type:'GET_SETTINGS'});if(config.selfhost){el('serverUrl').value=config.selfhost.serverUrl;el('apiKey').value=config.selfhost.apiKey;el('notifyCrawlDone').checked=config.selfhost.notifyCrawlDone;el('pollInterval').value=config.selfhost.pollInterval;}displayMode(config.backendMode);}catch{}await refresh();})();
})();
