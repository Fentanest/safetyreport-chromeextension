'use strict';
(() => {
  const content=document.getElementById('content');
  const account=document.getElementById('accountState');
  const send=message=>new Promise((resolve,reject)=>chrome.runtime.sendMessage(message,response=>{
    if(chrome.runtime.lastError)reject(new Error('REQUEST_FAILED'));
    else if(response?.error)reject(new Error(response.error));
    else resolve(response?.data);
  }));
  let generation=0, data=null, backendMode=null;
  function applyTheme(){chrome.storage.sync.get('theme',value=>{const choice=value.theme||'system';document.documentElement.dataset.srTheme=choice==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):choice;});}
  applyTheme();
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='sync'&&changes.theme)applyTheme();});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
  function loginPrompt(message='카카오 계정으로 로그인하면 본인이 공유한 완료 신고를 볼 수 있습니다.',available=true){
    account.textContent='클라우드 · 로그인 필요';
    content.innerHTML=`<section class="sr-account-box"><h2>내 완료 신고 확인</h2><p>${SRUI.esc(message)}</p><button id="login" class="sr-kakao" aria-label="카카오로 로그인" ${available?'':'hidden'}><img src="assets/kakao_login_kr_medium.svg" alt="" width="224" height="46"></button></section>`;
    document.getElementById('login').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;account.textContent='로그인 중…';
      try{await send({type:'LOGIN'});await load();}
      catch{account.textContent='로그인 실패';button.disabled=false;}
    });
  }
  // data = my-reports-v1 summary response; data.recent.items accumulate across "더 보기" (same window: the cursor keeps it)
  function render(){
    if(!data)return;
    if(data.backend==='selfhost'){content.innerHTML=SRUI.serverDashboard(data)+`<section class="sr-section"><p id="crawlState" role="status">크롤링 상태 확인 중…</p><div class="sr-options-actions"><button id="crawlStart" class="sr-button">크롤링 시작</button><button id="crawlStop" class="sr-button" hidden>크롤링 중지</button></div><p id="crawlResult" role="status"></p></section>`;refreshCrawl();return;}
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
    const run=++generation;data=null;account.textContent='계정 확인 중…';document.getElementById('serverHome').hidden=true;
    content.innerHTML='<p class="sr-status-message" role="status">내 신고를 확인하는 중…</p>';
    let status;
    try{status=await send({type:'STATUS'});}catch{content.innerHTML='<p class="sr-status-message">확장 상태를 확인하지 못했습니다.</p>';return;}
    if(run!==generation)return;
    backendMode=status.backendMode||null;
    if(!backendMode){account.textContent='모드 선택 필요';content.innerHTML=`<p class="sr-status-message">${SRUI.errorText('MODE_REQUIRED')}</p>`;return;}
    if(backendMode==='selfhost'){document.getElementById('serverHome').hidden=false;account.textContent=status.connected?`셀프호스팅 · 연결됨 · ${status.version}`:'셀프호스팅 · 연결 안 됨';if(!status.connected){content.innerHTML=`<p class="sr-status-message" role="alert">${SRUI.esc(SRUI.errorText(status.error))}</p>`;return;}}
    if(backendMode==='cloud'&&!status.signedIn){loginPrompt(status.error==='NOT_CONFIGURED'?'확장 연결 설정이 필요합니다. 배포용 공개 설정을 확인해 주세요.':undefined,status.error!=='NOT_CONFIGURED');return;}
    if(backendMode==='cloud')account.textContent=status.name?`클라우드 · ${status.name} · 로그인됨`:'클라우드 · 로그인됨';
    try{const result=await send({type:'SUMMARY',fresh});if(run!==generation)return;data=result;if(backendMode==='cloud')account.textContent=status.name?`클라우드 · ${status.name} · 조회 연결됨`:'클라우드 · 조회 연결됨';render();}
    catch(error){if(run!==generation)return;account.textContent=`${backendMode==='cloud'?'클라우드':'셀프호스팅'} · 조회 연결 실패`;if(backendMode==='cloud'&&error.message==='AUTH_REQUIRED')loginPrompt('로그인이 만료됐습니다. 다시 로그인해 주세요.');else content.innerHTML=`<p class="sr-status-message" role="alert">${SRUI.esc(SRUI.errorText(error.message))}</p>`;}
  }
  async function refreshCrawl(){
    const run=generation;
    try{const state=await send({type:'CRAWL_STATUS'});if(run!==generation||backendMode!=='selfhost')return;
      document.getElementById('crawlState').textContent=state.running?'크롤링 실행 중':'크롤링 대기 중';
      document.getElementById('crawlStart').hidden=state.running;document.getElementById('crawlStop').hidden=!state.running;
      for(const [id,type] of [['crawlStart','CRAWL_START'],['crawlStop','CRAWL_STOP']])document.getElementById(id).onclick=async event=>{
        event.currentTarget.disabled=true;
        try{await send({type});if(run!==generation)return;document.getElementById('crawlResult').textContent=type==='CRAWL_START'?'크롤링 시작 요청 완료':'크롤링 중지 요청 완료';await refreshCrawl();}
        catch(error){if(run===generation)document.getElementById('crawlResult').textContent=SRUI.errorText(error.message);}
        finally{if(run===generation)document.getElementById(id).disabled=false;}
      };
    }catch(error){if(run===generation&&document.getElementById('crawlState'))document.getElementById('crawlState').textContent=SRUI.errorText(error.message);}
  }
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='AUTH_CHANGED'||message?.type==='WORKER_RESTARTED')load();});
  document.getElementById('refresh').addEventListener('click',()=>load(true));
  document.getElementById('serverHome').addEventListener('click',async()=>{try{await send({type:'OPEN_SERVER'});}catch(error){account.textContent=SRUI.errorText(error.message);}});
  document.getElementById('settings').addEventListener('click',()=>chrome.runtime.openOptionsPage());
  load();
})();
