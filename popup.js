'use strict';
(() => {
  const content=document.getElementById('content');
  const account=document.getElementById('accountState');
  const send=message=>new Promise((resolve,reject)=>chrome.runtime.sendMessage(message,response=>{
    if(chrome.runtime.lastError)reject(new Error('REQUEST_FAILED'));
    else if(response?.error)reject(new Error(response.error));
    else resolve(response?.data);
  }));
  let generation=0, data=null;
  function applyTheme(){chrome.storage.sync.get('theme',value=>{const choice=value.theme||'system';document.documentElement.dataset.srTheme=choice==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):choice;});}
  applyTheme();
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='sync'&&changes.theme)applyTheme();});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
  function loginPrompt(message='카카오 계정으로 로그인하면 본인이 공유한 완료 신고를 볼 수 있습니다.'){
    account.textContent='로그인이 필요합니다';
    content.innerHTML=`<section class="sr-account-box"><h2>내 완료 신고 확인</h2><p>${SRUI.esc(message)}</p><button id="login" class="sr-kakao" aria-label="카카오로 로그인"><img src="assets/kakao_login_kr_medium.svg" alt="" width="224" height="46"></button></section>`;
    document.getElementById('login').addEventListener('click',async event=>{
      event.currentTarget.disabled=true;account.textContent='로그인 중…';
      try{await send({type:'LOGIN'});await load();}
      catch{account.textContent='로그인 실패';event.currentTarget.disabled=false;}
    });
  }
  // data = my-reports-v1 summary response; data.recent.items accumulate across "더 보기" (same window: the cursor keeps it)
  function render(){
    if(!data)return;
    const recent=data.recent, period=`${SRUI.esc(data.recent_start.slice(5).replace('-','.'))}~${SRUI.esc(data.recent_end.slice(5).replace('-','.'))}`;
    const none=data.account?.contributor==='none'?'앱에서 커뮤니티 공유를 켜면 공유한 완료 신고가 여기 표시됩니다.':data.account?.contributor==='revoked'?'공유 동의를 철회한 계정입니다.':'최근 답변이 없습니다.';
    content.innerHTML=`<section class="sr-section"><div class="sr-total">완료 신고 <strong class="sr-numeric">${SRUI.count(data.summary.total)}</strong><span>건</span></div></section>${SRUI.summary(data.summary)}<section><div class="sr-list-heading"><span>최근 3일 답변 <small>${period}</small></span><span>${SRUI.count(recent.total)}건</span></div><div class="sr-record-list">${recent.items.length?recent.items.map(SRUI.record).join(''):`<p class="sr-section sr-note">${SRUI.esc(none)}</p>`}</div>${recent.next_cursor?'<button id="more" class="sr-button sr-more">신고 더 보기</button>':''}</section>`;
    document.getElementById('more')?.addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;const run=generation;
      try{const next=await send({type:'SUMMARY',cursor:recent.next_cursor});if(run!==generation)return;data={...data,recent:{...next.recent,items:[...recent.items,...next.recent.items]}};render();}
      catch(error){if(run!==generation)return;if(error.message==='DATASET_CHANGED'){load(true);return;}button.textContent='다시 시도';button.disabled=false;}
    });
  }
  async function load(fresh=false){
    const run=++generation;data=null;account.textContent='계정 확인 중…';
    content.innerHTML='<p class="sr-status-message" role="status">내 신고를 확인하는 중…</p>';
    let status;
    try{status=await send({type:'STATUS'});}catch{content.innerHTML='<p class="sr-status-message">확장 상태를 확인하지 못했습니다.</p>';return;}
    if(run!==generation)return;
    if(!status.signedIn){loginPrompt(status.error==='NOT_CONFIGURED'?'확장 연결 설정이 필요합니다. 배포용 공개 설정을 확인해 주세요.':undefined);return;}
    account.textContent=status.name?`${status.name} · 내 완료 신고`:'내 완료 신고';
    try{const result=await send({type:'SUMMARY',fresh});if(run!==generation)return;data=result;render();}
    catch(error){if(run!==generation)return;if(error.message==='AUTH_REQUIRED')loginPrompt('로그인이 만료됐습니다. 다시 로그인해 주세요.');else content.innerHTML=`<p class="sr-status-message" role="alert">${error.message==='ACCESS_DENIED'?'이 계정의 공유 동의 또는 접근 상태를 확인해 주세요.':error.message==='RATE_LIMITED'?'요청이 많습니다. 잠시 후 새로고침해 주세요.':error.message==='NOT_CONFIGURED'?'확장 연결 설정이 필요합니다.':'조회하지 못했습니다. 새로고침을 눌러 다시 시도해 주세요.'}</p>`;}
  }
  document.getElementById('refresh').addEventListener('click',()=>load(true));
  document.getElementById('settings').addEventListener('click',()=>chrome.runtime.openOptionsPage());
  load();
})();
