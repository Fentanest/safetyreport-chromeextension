'use strict';
(() => {
  const normalizeVehicle = value => String(value || '').normalize('NFC').replace(/\s/gu, '');
  const normalizeAddress = value => String(value || '').normalize('NFC').trim().replace(/\s+/gu, ' ');
  const send = message => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(new Error('REQUEST_FAILED'));
    else if (response?.error) reject(new Error(response.error));
    else resolve(response?.data);
  }));
  const states = Object.fromEntries(['vehicle','address'].map(kind => [kind, {
    kind, node: null, controller: null, observer: null, query: '', generation: 0,
    timer: null, open: false, dismissed: false, data: null, copying: false, cancelCopy: false, managerOpen: false,
  }]));
  const panels = {};
  let theme = 'system', scanQueued = false, positionQueued = false;
  const themeValue = () => theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  const updateTheme = () => Object.values(panels).forEach(panel => { panel.host.dataset.srTheme = themeValue(); });
  chrome.storage.sync.get('theme', values => { theme = values.theme || 'system'; updateTheme(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.theme) { theme = changes.theme.newValue || 'system'; updateTheme(); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);

  function panel(kind) {
    if (panels[kind]) return panels[kind];
    const host = document.createElement('div');
    host.id = `sr-${kind}-panel-host`;
    host.className = 'sr-extension-host';
    host.dataset.srTheme = themeValue();
    host.hidden = true;
    const root = host.attachShadow({ mode: 'closed' });
    for (const filename of ['ui-tokens.css','ui-components.css']) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = chrome.runtime.getURL(filename); root.append(link);
    }
    const style = document.createElement('style');
    style.textContent = ':host{all:initial;display:block}.sr-ui{width:100%;height:100%}.sr-panel{width:100%;height:100%}.sr-panel-header{align-items:flex-start}.sr-panel-content{overflow-x:hidden}';
    root.append(style);
    const shell = document.createElement('div');
    shell.className = 'sr-ui sr-panel';
    shell.setAttribute('role','dialog');
    shell.setAttribute('aria-label',kind === 'vehicle' ? '이 차량의 내 완료 신고' : '이 주소의 내 완료 신고');
    root.append(shell);
    document.body.append(host);
    root.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.action;
      if (action === 'close') hide(kind,true);
      if (action === 'more') loadMore(kind);
      if (action === 'copy') copyNumbers(kind);
      if (action === 'cancel-copy') states[kind].cancelCopy = true;
    });
    if (kind === 'address') root.addEventListener('toggle', event => {
      if (event.target.matches('details')) states.address.managerOpen = event.target.open;
    }, true);
    return panels[kind] = { host, root, shell };
  }
  function position() {
    const vp = window.visualViewport;
    const vw = vp?.width || innerWidth, vh = vp?.height || innerHeight;
    const ox = vp?.offsetLeft || 0, oy = vp?.offsetTop || 0;
    if (panels.address) {
      const width = Math.min(400,vw-24), height = Math.min(700,vh-24);
      Object.assign(panels.address.host.style,{width:`${width}px`,height:`${height}px`,
        left:`${ox+vw-width-12}px`,top:`${oy+Math.min(70,Math.max(12,vh-height-12))}px`});
    }
    const s = states.vehicle;
    if (panels.vehicle && s.open && s.node?.isConnected) {
      const rect = s.node.getBoundingClientRect();
      const width = Math.min(640,vw-24), height = Math.min(520,vh-24);
      const left = Math.min(Math.max(rect.left,ox+12),ox+vw-width-12);
      const proposed = oy+vh-rect.bottom >= Math.min(height,300) ? rect.bottom+6 : rect.top-height-6;
      const top = Math.min(Math.max(proposed,oy+12),oy+vh-height-12);
      Object.assign(panels.vehicle.host.style,{width:`${width}px`,height:`${height}px`,left:`${left}px`,top:`${top}px`});
    }
  }
  function queuePosition() {
    if (positionQueued) return;
    positionQueued = true;
    requestAnimationFrame(() => { positionQueued = false; position(); });
  }
  function refreshVisibility() {
    if (panels.vehicle) panels.vehicle.host.hidden = !states.vehicle.open;
    if (panels.address) panels.address.host.hidden = !states.address.open || states.vehicle.open;
    queuePosition();
  }
  function hide(kind,dismissed=false) {
    const s = states[kind]; s.open = false;
    if (dismissed) { s.dismissed = true; s.generation++; s.cancelCopy = true; }
    refreshVisibility();
  }
  function invalidate(kind) {
    const s = states[kind]; clearTimeout(s.timer); s.generation++; s.data = null; s.cancelCopy = true; s.managerOpen = false;
  }
  function show(kind) {
    states[kind].open = true; states[kind].dismissed = false; panel(kind); refreshVisibility();
  }
  function render(kind,message='') {
    const s = states[kind], p = panel(kind), data = s.data;
    const heading = kind === 'vehicle' ? '이 차량의 내 신고' : '이 주소의 내 신고';
    p.shell.innerHTML = `<header class="sr-panel-header"><div class="sr-header-copy"><div class="sr-header-title">${heading}<span class="sr-plain-count">${data ? `${SRUI.count(data.total)}건` : ''}</span></div><p class="sr-header-caption">${SRUI.esc(s.query)}</p></div><div class="sr-header-actions">${data && Number(data.total)>Number(data.missing_numbers||0) ? '<button class="sr-button" data-action="copy">신고번호 복사</button>' : ''}<button class="sr-icon-button" data-action="close" aria-label="닫기">✕</button></div></header><div class="sr-panel-content">${data ? `${SRUI.summary(data)}${kind==='address'?SRUI.managers(data,s.managerOpen):''}${SRUI.records(data)}${data.next_offset!==null?'<button class="sr-button sr-more" data-action="more">신고 더 보기</button>':''}` : `<p class="sr-section sr-note" role="status">${SRUI.esc(message||'조회 중…')}</p>`}</div><footer class="sr-panel-footer"><span>${s.copying?'신고번호를 모으는 중…':'내 계정으로 공유한 완료 신고'}</span>${s.copying?'<button class="sr-text-button" data-action="cancel-copy">취소</button>':''}</footer>`;
  }
  async function search(kind) {
    const s=states[kind], query=s.query, generation=s.generation;
    if (!s.open || s.dismissed || !query) return;
    render(kind);
    try {
      const result=await send({type:'SEARCH',kind,query,offset:0});
      if (generation!==s.generation || query!==s.query || !s.open || s.dismissed || !s.node?.isConnected) return;
      s.data=result; render(kind);
    } catch(error) {
      if (generation!==s.generation || !s.open) return;
      render(kind,error.message==='AUTH_REQUIRED'?'확장 아이콘에서 카카오 로그인 후 조회해 주세요.':
        error.message==='ACCESS_DENIED'?'이 계정의 공유 동의 또는 접근 상태를 확인해 주세요.':
        error.message==='NOT_CONFIGURED'?'확장 연결 설정이 필요합니다.':'조회 실패. 입력칸을 다시 누르면 재시도합니다.');
    }
  }
  async function loadMore(kind) {
    const s=states[kind], data=s.data;
    if (!data || data.next_offset===null) return;
    const generation=s.generation;
    try {
      const next=await send({type:'SEARCH',kind,query:s.query,offset:data.next_offset,expectedVersion:data.version});
      if (generation!==s.generation || !s.open) return;
      s.data={...data,items:[...data.items,...next.items],next_offset:next.next_offset}; render(kind);
    } catch { if (generation===s.generation) { s.data=null; render(kind,'목록을 이어서 불러오지 못했습니다. 다시 조회해 주세요.'); } }
  }
  async function copyNumbers(kind) {
    const s=states[kind]; if (s.copying || !s.data) return;
    const version=s.data.version, count=Number(s.data.total)-Number(s.data.missing_numbers||0);
    if (count<=0) return;
    if (count>5000) { const b=panels[kind].root.querySelector('[data-action="copy"]'); if(b)b.textContent='5,000건 초과 · 복사 불가'; return; }
    const generation=s.generation, query=s.query;
    s.copying=true; s.cancelCopy=false; render(kind);
    try {
      const numbers=[]; let offset=0;
      do {
        if (s.cancelCopy || generation!==s.generation) throw new Error('CANCELLED');
        const page=await send({type:'NUMBERS',kind,query,offset,expectedVersion:version});
        if (page.version!==version) throw new Error('DATASET_CHANGED');
        if (page.next_offset!==null && (!Number.isInteger(page.next_offset) || page.next_offset<=offset))
          throw new Error('INVALID_PAGE');
        numbers.push(...page.items.map(item=>item.report_number).filter(Boolean));
        if (numbers.length>count) throw new Error('INVALID_PAGE');
        offset=page.next_offset;
      } while(offset!==null);
      if (numbers.length!==count || s.cancelCopy || generation!==s.generation) throw new Error('DATASET_CHANGED');
      await navigator.clipboard.writeText(numbers.join('\n'));
      s.copyResult=`복사됨 · 번호 없는 ${s.data.missing_numbers||0}건 제외`;
    } catch(error) { if(error.message!=='CANCELLED')s.copyResult='복사 실패 · 다시 시도'; }
    finally { s.copying=false; if(generation===s.generation) { render(kind); const b=panels[kind].root.querySelector('[data-action="copy"]'); if(b&&s.copyResult)b.textContent=s.copyResult; } }
  }
  function vehicleChanged(reopen=false) {
    const s=states.vehicle;
    if (!s.node?.isConnected || s.node.isComposing) return;
    const query=normalizeVehicle(s.node.value);
    if(query!==s.query){invalidate('vehicle');s.query=query;s.dismissed=false;}
    if([...query].length<6 || document.getElementById('chkNoVhrNo')?.checked){hide('vehicle');return;}
    if(reopen)show('vehicle');
    if(!s.open || s.dismissed)return;
    if(s.data){render('vehicle');return;}
    clearTimeout(s.timer);s.timer=setTimeout(()=>search('vehicle'),600);
  }
  function addressChanged() {
    const s=states.address, query=normalizeAddress(s.node?.textContent);
    if(query===s.query)return;
    invalidate('address');s.query=query;s.dismissed=false;
    if([...query].length<5){hide('address');return;}
    show('address');s.timer=setTimeout(()=>search('address'),700);
  }
  function rebind() {
    const input=document.getElementById('VHRNO'), v=states.vehicle;
    if(input!==v.node){
      v.controller?.abort();invalidate('vehicle');hide('vehicle');v.node=input;v.query='';
      if(input){
        v.controller=new AbortController();const signal=v.controller.signal;
        input.addEventListener('input',()=>vehicleChanged(),{signal});
        input.addEventListener('focus',()=>vehicleChanged(true),{signal});
        input.addEventListener('click',()=>vehicleChanged(true),{signal});
        input.addEventListener('compositionend',()=>vehicleChanged(true),{signal});
      }
    }
    const address=document.getElementById('add1'), a=states.address;
    if(address!==a.node){
      a.observer?.disconnect();invalidate('address');hide('address');a.node=address;a.query='';
      if(address){a.observer=new MutationObserver(addressChanged);a.observer.observe(address,{childList:true,characterData:true,subtree:true});addressChanged();}
    }
  }
  function queueScan(){if(scanQueued)return;scanQueued=true;requestAnimationFrame(()=>{scanQueued=false;rebind();});}
  new MutationObserver(queueScan).observe(document.documentElement,{childList:true,subtree:true});
  rebind();
  document.addEventListener('pointerdown',event=>{
    const path=event.composedPath();
    for(const kind of ['vehicle','address']){
      const s=states[kind];
      if(s.open && !path.includes(s.node) && !(panels[kind]&&path.includes(panels[kind].host)))hide(kind,true);
    }
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(states.vehicle.open)hide('vehicle',true);else if(states.address.open)hide('address',true);}});
  document.addEventListener('scroll',queuePosition,true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)queuePosition();});
  window.addEventListener('focus',queuePosition);
  document.addEventListener('change',event=>{if(event.target?.id==='chkNoVhrNo'&&event.target.checked)hide('vehicle',true);},true);
  window.addEventListener('resize',queuePosition);
  window.visualViewport?.addEventListener('resize',queuePosition);
  window.visualViewport?.addEventListener('scroll',queuePosition);
  window.addEventListener('hashchange',()=>{for(const kind of ['vehicle','address']){invalidate(kind);hide(kind);states[kind].query='';}queueScan();});
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='AUTH_CHANGED')for(const kind of ['vehicle','address']){invalidate(kind);hide(kind);}});
})();
