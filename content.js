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
    collapsed: false, // address-only, changed exclusively by the manual fold button
    clearTimer: null, loading: false, status: '', // independent of the current source DOM node
  }]));
  const panels = {};
  const DATA_TTL = 60_000;
  const EDGE = 12, GAP = 10;
  const ADDRESS_WIDTH = 364, FOLDED_ADDRESS_WIDTH = 220, VEHICLE_WIDTH = 420, MIN_VEHICLE_WIDTH = 280;
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
      link.addEventListener('load', queuePosition);
      link.rel = 'stylesheet'; link.href = chrome.runtime.getURL(filename); root.append(link);
    }
    // Content-script-only density/sizing overrides (closed ShadowRoot): popup.html/options.html load the same
    // ui-tokens.css/ui-components.css directly in light DOM and never see this stylesheet, so these rules only
    // ever affect the two website panels, never the popup or the options page.
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;display:block;--sr-font-body:13px;--sr-font-meta:12px;--sr-font-title:15px;--sr-font-key:14px;--sr-font-metric:20px}
.sr-ui{width:100%;line-height:1.4}
.sr-panel{width:100%;height:auto}
.sr-panel-header{align-items:flex-start;padding:10px 12px}
.sr-panel-content{overflow-x:hidden}
.sr-header-title{line-height:21px}
.sr-header-caption{line-height:18px}
.sr-icon-badge{width:24px;height:24px}
.sr-icon-badge svg{width:14px;height:14px}
.sr-plain-count{height:19px;padding:0 7px}
.sr-button{min-height:28px;padding:4px 8px}
.sr-icon-button{width:28px;height:28px}
.sr-section{padding:10px 12px}
.sr-section-heading{margin-bottom:8px}
.sr-section-title{line-height:19px}
.sr-section.sr-tile{margin:8px 12px;padding:10px}
.sr-section.sr-tile:last-child{margin-bottom:8px}
.sr-bar{height:6px;margin-bottom:8px}
.sr-legend-item,.sr-disposition,.sr-amount-line,.sr-note,.sr-officer-agency,.sr-officer-results,.sr-record-meta,.sr-record-agency,.sr-record-address,.sr-record-foot,.sr-panel-footer{line-height:18px}
.sr-amount-line{margin-top:8px;padding-top:8px}
.sr-officer{padding:8px 0}
.sr-record-list{padding:0 12px 8px;gap:6px}
.sr-record{padding:9px}
.sr-record-key{line-height:19px}
.sr-record-law{line-height:19px;margin-bottom:4px}
.sr-record-top{margin-bottom:5px}
.sr-badge{min-height:22px;line-height:18px;padding:1px 7px}
.sr-list-heading{padding:10px 12px 6px}
.sr-panel-footer{padding:7px 12px}
.sr-more{margin:8px 12px 10px}
.sr-ui details>summary{min-height:26px}
.sr-ui details>summary.sr-officer-summary{min-height:28px;line-height:21px}
.sr-panel-content>p.sr-note{margin:10px!important;padding:10px;line-height:18px}
.sr-panel-collapsed .sr-panel-content,.sr-panel-collapsed .sr-panel-footer{display:none}`;
    root.append(style);
    const shell = document.createElement('div');
    shell.className = 'sr-ui sr-panel';
    shell.setAttribute('role','dialog');
    shell.setAttribute('aria-label',kind === 'vehicle' ? '이 차량의 내 신고' : '이 주소의 내 신고');
    root.append(shell);
    document.body.append(host);
    root.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.action;
      if (action === 'close') hide(kind,true);
      if (action === 'more') loadMore(kind);
      if (action === 'more-managers') loadMoreManagers(kind);
      if (action === 'copy') copyNumbers(kind);
      if (action === 'cancel-copy') states[kind].cancelCopy = true;
      if (action === 'toggle-collapse') {
        const st = states[kind];
        st.collapsed = !st.collapsed;
        render(kind); queuePosition();
      }
    });
    if (kind === 'address') root.addEventListener('toggle', event => {
      if (event.target.matches('details')) states.address.managerOpen = event.target.open;
    }, true);
    return panels[kind] = { host, root, shell };
  }
  // Layout owns geometry only. It never changes open/collapsed or the address body DOM.
  // At narrow widths split the available height and scroll each panel internally.
  function position() {
    const vp = window.visualViewport;
    const vw = vp?.width || innerWidth, vh = vp?.height || innerHeight;
    const ox = vp?.offsetLeft || 0, oy = vp?.offsetTop || 0;
    const availableHeight = Math.max(0, vh - EDGE*2);
    const a = panels.address, v = panels.vehicle;
    const both = a && states.address.open && v && states.vehicle.open;
    const aw = Math.max(0, Math.min(states.address.collapsed ? FOLDED_ADDRESS_WIDTH : ADDRESS_WIDTH, vw-EDGE*2));
    const sideRoom = vw - EDGE*2 - aw - GAP;
    const stacked = both && sideRoom < MIN_VEHICLE_WIDTH;
    const addressTop = oy + (stacked || vh < 700 ? EDGE : Math.min(70, vh-EDGE));
    const place = (p, width, left, top, maxHeight) => {
      Object.assign(p.host.style,{width:`${width}px`,left:`${left}px`,top:`${top}px`});
      p.host.style.removeProperty('height');
      p.shell.style.maxHeight = `${Math.max(0,maxHeight)}px`;
    };
    if (a) {
      const height = stacked ? Math.floor((availableHeight-GAP)*0.55) : oy+vh-EDGE-addressTop;
      place(a, aw, ox+vw-aw-EDGE, addressTop, height);
    }
    if (v && states.vehicle.open && states.vehicle.node?.isConnected) {
      const rect = states.vehicle.node.getBoundingClientRect();
      let width = Math.min(VEHICLE_WIDTH, vw-EDGE*2);
      let left = Math.min(Math.max(rect.left,ox+EDGE), ox+vw-width-EDGE);
      let top, maxHeight;
      if (stacked) {
        // Use actual content height for short/zero-result/manual-folded address panels.
        top = a.host.getBoundingClientRect().bottom + GAP;
        maxHeight = oy+vh-EDGE-top;
        left = ox+vw-width-EDGE;
      } else {
        if (both) { width = Math.min(width,sideRoom); left = ox+EDGE; }
        const below = Math.max(0,oy+vh-EDGE-(rect.bottom+6));
        const above = Math.max(0,rect.top-6-(oy+EDGE));
        maxHeight = Math.min(availableHeight,Math.max(below,above,160));
        top = below >= Math.min(above,200) ? rect.bottom+6 : rect.top-6-maxHeight;
        top = Math.max(oy+EDGE,Math.min(top,oy+vh-EDGE-maxHeight));
      }
      place(v,width,left,top,maxHeight);
    }
  }
  function queuePosition() {
    if (positionQueued) return;
    positionQueued = true;
    requestAnimationFrame(() => { positionQueued = false; position(); });
  }
  function refreshVisibility() {
    if (panels.vehicle) panels.vehicle.host.hidden = !states.vehicle.open;
    if (panels.address) panels.address.host.hidden = !states.address.open;
    queuePosition();
  }
  function hide(kind,dismissed=false) {
    const s = states[kind]; s.open = false;
    if (dismissed) {
      clearTimeout(s.timer); s.dismissed = true; s.generation++; s.cancelCopy = true; s.loading = s.reportsLoading = s.managersLoading = false;
      clearTimeout(s.clearTimer); s.clearTimer = null;
    }
    refreshVisibility();
  }
  function invalidate(kind) {
    const s = states[kind]; clearTimeout(s.timer); s.generation++; s.data = null; s.cancelCopy = true; s.managerOpen = false;
    s.loadedAt = 0; s.loading = s.reportsLoading = s.managersLoading = false; s.message = ''; s.status = '';
  }
  function show(kind) {
    states[kind].open = true; states[kind].dismissed = false;
    const p = panel(kind);
    if (!p.host.isConnected && document.body) document.body.append(p.host);
    refreshVisibility();
  }
  // s.data = { summary, reports: ReportPage (items accumulated), managers: ManagerPage (items accumulated) } — my-reports-v1
  function render(kind,message='') {
    const s = states[kind], p = panel(kind), data = s.data;
    if (message) s.status = message;
    const heading = kind === 'vehicle' ? '이 차량의 내 신고' : '이 주소의 내 신고';
    const scope = '클라우드 · 내가 공유한 완료 신고';
    const total = Number(data?.summary?.total || 0), missing = Number(data?.summary?.report_number_missing || 0);
    // a search that genuinely matched nothing doesn't need the result/disposition tiles or an empty-list box;
    // one line says so. This only changes the content-script panels — shared-ui.js's summary()/records() (used
    // by popup.js/options.js too) are untouched.
    const zeroState = !!data && total === 0;
    const collapsible = kind === 'address';
    const collapsed = collapsible && s.collapsed;
    const collapseButton = collapsible
      ? `<button class="sr-icon-button" data-action="toggle-collapse" aria-expanded="${!collapsed}" aria-label="${collapsed ? '패널 펼치기' : '패널 접기'}">${SRUI.icon(collapsed ? 'chevronDown' : 'chevronUp')}</button>`
      : '';
    const body = !data ? `<p class="sr-section sr-note" role="status">${SRUI.esc(s.status || (kind === 'address' && !s.query ? '주소를 선택해 주세요.' : '조회 중…'))}</p>`
      : zeroState ? `<p class="sr-section sr-note" role="status">${SRUI.esc(kind === 'vehicle' ? '이 차량으로 내 신고가 없습니다.' : '이 주소로 내 신고가 없습니다.')}</p>`
      : `${s.message?`<p class="sr-section sr-note" role="status">${SRUI.esc(s.message)}</p>`:''}${SRUI.summary(data.summary)}${kind==='address'?SRUI.managers(data.managers,s.managerOpen):''}${SRUI.records(data.reports)}${data.reports?.next_cursor?`<button class="sr-button sr-more" data-action="more" ${s.reportsLoading?'disabled':''}>${s.reportsLoading?'불러오는 중…':'신고 더 보기'}</button>`:''}`;
    p.shell.innerHTML = `<header class="sr-panel-header"><div class="sr-header-copy"><div class="sr-header-title"><span class="sr-icon-badge">${SRUI.icon(kind === 'vehicle' ? 'car' : 'pin')}</span>${heading}<span class="sr-plain-count">${data ? `${SRUI.count(total)}건` : ''}</span></div><p class="sr-header-caption">${SRUI.queryBadge(kind, s.query)}</p></div><div class="sr-header-actions">${data && total>missing ? `<button class="sr-button" data-action="copy">${SRUI.icon('copy','sr-icon-sm')}신고번호 복사</button>` : ''}${collapseButton}<button class="sr-icon-button" data-action="close" aria-label="닫기">${SRUI.icon('close')}</button></div></header><div class="sr-panel-content">${body}</div><footer class="sr-panel-footer"><span>${s.copying?'신고번호를 모으는 중…':SRUI.esc(scope)}</span>${s.copying?'<button class="sr-text-button" data-action="cancel-copy">취소</button>':''}</footer>`;
    p.shell.classList.toggle('sr-panel-collapsed', collapsed);
    queuePosition();
    const managerButton = p.shell.querySelector('[data-action="more-managers"]');
    if (managerButton) { managerButton.disabled = !!s.managersLoading; if (s.managersLoading) managerButton.textContent = '불러오는 중…'; }
  }
  const failureText = SRUI.errorText;
  async function search(kind,retried=false) {
    const s=states[kind], query=s.query, generation=s.generation;
    if (!s.open || s.dismissed || !query || s.loading || s.composing) return;
    s.loading = true; s.status = '';
    render(kind);
    try {
      const result=await send({type:'SEARCH',kind,query,fresh:retried});
      if (generation!==s.generation || query!==s.query || !s.open || s.dismissed || (kind === 'vehicle' && !s.node?.isConnected)) return;
      s.data={summary:result.summary,reports:result.reports,managers:result.managers}; s.loadedAt=Date.now(); render(kind);
    } catch(error) {
      if (generation!==s.generation || !s.open) return;
      if (error.message==='DATASET_CHANGED' && !retried) { s.loading=false; return await search(kind,true); }
      render(kind,failureText(error.message));
    } finally { if (generation===s.generation) s.loading=false; }
  }
  // the next page of the same search; a data change restarts from page 1 (the server refuses a stale cursor)
  const loadMore = kind => loadPage(kind,'reports');
  const loadMoreManagers = kind => loadPage(kind,'managers');
  async function loadPage(kind,part) {
    const s=states[kind], cursor=s.data?.[part]?.next_cursor, flag=part+'Loading';
    if (!cursor || s[flag]) return;
    const generation=s.generation; s[flag]=true; s.message=''; render(kind);
    try {
      const next=await send({type:'SEARCH',kind,query:s.query,cursor,...(part==='managers'?{part}: {})});
      if (generation!==s.generation || !s.open || s.data?.[part]?.next_cursor!==cursor) return;
      // The other list may have advanced while this request was pending.
      s.data={...s.data,[part]:{...next[part],items:[...s.data[part].items,...next[part].items]}};
      if (part==='managers') s.managerOpen=true;
    } catch(error) {
      if (generation!==s.generation || !s.open) return;
      if (error.message==='DATASET_CHANGED') { invalidate(kind); return search(kind,true); }
      s.message=(part==='managers'?'담당자':'신고')+' 목록을 이어서 불러오지 못했습니다. 더 보기를 눌러 다시 시도해 주세요.';
    } finally { if (generation===s.generation) { s[flag]=false; if(s.open)render(kind); } }
  }
  // every page of /numbers (500 per page) before the clipboard; any change or cancel copies nothing
  async function copyNumbers(kind) {
    const s=states[kind]; if (s.copying || !s.data) return;
    const generation=s.generation, query=s.query;
    s.copying=true; s.cancelCopy=false; s.copyResult=''; render(kind);
    try {
      const numbers=[]; let cursor=null, expected=null, missing=0, seen=new Set();
      do {
        if (s.cancelCopy || generation!==s.generation) throw new Error('CANCELLED');
        const page=await send({type:'NUMBERS',kind,query,cursor});
        if (expected===null) { expected=page.unique_numbers; missing=page.without_number; }
        if (page.unique_numbers!==expected || !Array.isArray(page.items)) throw new Error('DATASET_CHANGED');
        for (const n of page.items) { if (seen.has(n)) throw new Error('INVALID_PAGE'); seen.add(n); numbers.push(n); }
        if (numbers.length>expected) throw new Error('INVALID_PAGE');
        cursor=page.next_cursor;
        if (cursor===null && !page.complete) throw new Error('INVALID_PAGE');
      } while(cursor!==null);
      if (numbers.length!==expected || s.cancelCopy || generation!==s.generation) throw new Error('DATASET_CHANGED');
      await navigator.clipboard.writeText(numbers.join('\n'));
      s.copyResult=missing?`${SRUI.count(numbers.length)}건 복사됨 · 번호 없는 ${SRUI.count(missing)}건 제외`:`${SRUI.count(numbers.length)}건 복사됨`;
    } catch(error) {
      if(error.message==='NUMBERS_LIMIT_EXCEEDED')s.copyResult='한 번에 복사할 수 없는 양입니다';
      else if(error.message==='DATASET_CHANGED')s.copyResult='자료가 바뀌었습니다 · 다시 시도';
      else if(error.message!=='CANCELLED')s.copyResult='복사 실패 · 다시 시도';
    }
    finally { s.copying=false; if(generation===s.generation) { render(kind); const b=panels[kind].root.querySelector('[data-action="copy"]'); if(b&&s.copyResult)b.textContent=s.copyResult; } }
  }
  function vehicleChanged(reopen=false) {
    const s=states.vehicle;
    if (!s.node?.isConnected) return;
    const disabled=!!document.getElementById('chkNoVhrNo')?.checked;
    if(s.composing && !disabled)return;
    const query=normalizeVehicle(s.node.value);
    const changed=query!==s.query, availabilityChanged=disabled!==s.disabled;
    if(changed || availabilityChanged){invalidate('vehicle');s.query=query;s.disabled=disabled;}
    if(!changed && !availabilityChanged && !reopen)return;
    if([...query].length<4 || disabled){hide('vehicle');return;}
    show('vehicle');
    if(s.data && Date.now()-s.loadedAt>=DATA_TTL)invalidate('vehicle');
    if(s.data){render('vehicle');return;}
    render('vehicle');
    clearTimeout(s.timer);s.timer=setTimeout(()=>search('vehicle'),600);
  }
  const readAddress = node => normalizeAddress(node && ('value' in node ? node.value : node.textContent));
  function addressChanged(reopen=false, allowSelectionOpen=true) {
    const s=states.address;
    if(!s.node?.isConnected || s.composing)return;
    // The report address is #add1 only; C_ADD1/C_ADD2 can contain the reporter's address.
    const query=readAddress(s.node);
    if([...query].length<5){
      // A missing node is a binding gap, not a cleared selection. A short value must settle
      // on a connected node before retiring the last confirmed query/results.
      if(s.query && !s.clearTimer) s.clearTimer=setTimeout(()=>{
        s.clearTimer=null;
        if(!s.node?.isConnected || [...readAddress(s.node)].length>=5)return;
        invalidate('address');s.query='';
        if(s.open)render('address');
      },900);
      return;
    }
    clearTimeout(s.clearTimer);s.clearTimer=null;
    if(query===s.query && !reopen)return;
    if(query!==s.query || (s.data && Date.now()-s.loadedAt>=DATA_TTL))invalidate('address');
    s.query=query;
    // Rebinding and focus restoration cannot undo X. An actual new selection or
    // an explicit address click can. Preserve the user's manual fold choice throughout.
    if(s.dismissed && !reopen && !allowSelectionOpen)return;
    show('address');render('address');if(s.data)return;
    clearTimeout(s.timer);s.timer=setTimeout(()=>search('address'),700);
  }
  function rebind() {
    const input=document.getElementById('VHRNO'), v=states.vehicle;
    if(input!==v.node){
      v.controller?.abort();invalidate('vehicle');hide('vehicle');v.node=input;v.query='';v.composing=false;
      if(input){
        v.controller=new AbortController();const signal=v.controller.signal;
        input.addEventListener('input',()=>vehicleChanged(),{signal});
        input.addEventListener('change',()=>vehicleChanged(),{signal});
        input.addEventListener('focus',()=>vehicleChanged(true),{signal});
        input.addEventListener('click',()=>vehicleChanged(true),{signal});
        input.addEventListener('compositionstart',()=>{v.composing=true;clearTimeout(v.timer);},{signal});
        input.addEventListener('compositionend',()=>{v.composing=false;vehicleChanged(true);},{signal});
      }
    }
    const address=document.getElementById('add1'), a=states.address;
    if(address!==a.node){
      a.controller?.abort();a.observer?.disconnect();
      clearTimeout(a.clearTimer);a.clearTimer=null;a.node=address;a.composing=false;
      if(address){
        a.controller=new AbortController();const signal=a.controller.signal;
        address.addEventListener('click',()=>addressChanged(true),{signal});
        address.addEventListener('input',()=>addressChanged(),{signal});
        address.addEventListener('change',()=>addressChanged(),{signal});
        address.addEventListener('compositionstart',()=>{a.composing=true;clearTimeout(a.timer);},{signal});
        address.addEventListener('compositionend',()=>{a.composing=false;addressChanged();},{signal});
        a.observer=new MutationObserver(()=>addressChanged());a.observer.observe(address,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['value']});
      }
      addressChanged(false,!a.dismissed);
    }
    // Restore the same host/root only while the user still has this panel open.
    const ap=panels.address;
    if(a.open && ap && !ap.host.isConnected && document.body){document.body.append(ap.host);queuePosition();}
    // Also read prefilled/reused nodes, without relying on focus after SPA navigation.
    vehicleChanged();addressChanged();
  }
  function queueScan(){if(scanQueued)return;scanQueued=true;requestAnimationFrame(()=>{scanQueued=false;rebind();});}
  new MutationObserver(queueScan).observe(document.documentElement,{childList:true,subtree:true});
  rebind();
  // Setting input.value (including jQuery.val) emits neither an event nor a DOM mutation.
  // Compare two values only; unchanged values do not render, reset debounce, or send requests.
  setInterval(()=>{if(!document.hidden)rebind();},300);
  document.addEventListener('pointerdown',event=>{
    const path=event.composedPath();
    // Outside-click dismissal belongs to the vehicle panel only, regardless of map DOM.
    const insideTracked=['vehicle','address'].some(kind => {
      const s=states[kind];
      return (s.node && path.includes(s.node)) || (panels[kind] && path.includes(panels[kind].host));
    });
    if(insideTracked)return;
    if(states.vehicle.open)hide('vehicle',true);
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(states.vehicle.open)hide('vehicle',true);}});
  document.addEventListener('scroll',queuePosition,true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){queueScan();queuePosition();}});
  window.addEventListener('focus',queuePosition);
  document.addEventListener('change',event=>{if(event.target?.id==='chkNoVhrNo')vehicleChanged();},true);
  window.addEventListener('resize',queuePosition);
  window.visualViewport?.addEventListener('resize',queuePosition);
  window.visualViewport?.addEventListener('scroll',queuePosition);
  window.addEventListener('hashchange',()=>{invalidate('vehicle');hide('vehicle');states.vehicle.query='';states.vehicle.composing=false;queueScan();queuePosition();});
  chrome.runtime.onMessage.addListener(message=>{
    if(!['AUTH_CHANGED','DATA_INVALIDATED','WORKER_RESTARTED'].includes(message?.type))return;
    for(const kind of ['vehicle','address']){
      invalidate(kind); // Erase prior-account data immediately, including hidden/collapsed DOM.
      const s=states[kind];
      if(panels[kind])render(kind,message.type==='AUTH_CHANGED' ? '로그인 및 계정 상태를 확인하는 중…' : '현재 연결을 다시 확인하는 중…');
      if(s.open && !s.dismissed && s.query)s.timer=setTimeout(()=>search(kind),0);
    }
  });
})();
