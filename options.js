'use strict';
(() => {
  const status=document.getElementById('status'), login=document.getElementById('login'), logout=document.getElementById('logout');
  const theme=document.getElementById('theme');
  const send=message=>new Promise((resolve,reject)=>chrome.runtime.sendMessage(message,response=>{
    if(chrome.runtime.lastError)reject(new Error('REQUEST_FAILED'));
    else if(response?.error)reject(new Error(response.error));
    else resolve(response?.data);
  }));
  const applyTheme=choice=>{document.documentElement.dataset.srTheme=choice==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):choice;};
  chrome.storage.sync.get('theme',value=>{theme.value=value.theme||'system';applyTheme(theme.value);});
  theme.addEventListener('change',async()=>{await chrome.storage.sync.set({theme:theme.value});applyTheme(theme.value);});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>applyTheme(theme.value));
  async function refresh(){
    try{const state=await send({type:'STATUS'});status.textContent=state.signedIn?(state.name?`${state.name} 계정으로 로그인됨`:'카카오 계정으로 로그인됨'):
      state.error==='NOT_CONFIGURED'?'배포용 Supabase 공개 설정이 필요합니다.':'로그인하지 않았습니다.';
      login.hidden=state.signedIn||state.error==='NOT_CONFIGURED';logout.hidden=!state.signedIn;
    }catch{status.textContent='계정 상태를 확인하지 못했습니다.';}
  }
  login.addEventListener('click',async()=>{login.disabled=true;status.textContent='카카오 로그인 중…';try{await send({type:'LOGIN'});}catch{status.textContent='로그인하지 못했습니다. 다시 시도해 주세요.';}finally{login.disabled=false;await refresh();}});
  logout.addEventListener('click',async()=>{logout.disabled=true;try{await send({type:'LOGOUT'});}catch{status.textContent='로그아웃하지 못했습니다.';}finally{logout.disabled=false;await refresh();}});
  refresh();
})();
