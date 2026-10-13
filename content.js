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
    collapsed: null, autoFold: false, // address-only: collapsed null=auto(follow autoFold), true/false=user override
  }]));
  const panels = {};
  const DATA_TTL = 60_000;
  const EDGE = 12, GAP = 10;
  const ADDRESS_WIDTH = 364, FOLDED_ADDRESS_WIDTH = 220, VEHICLE_WIDTH = 420, MIN_VEHICLE_WIDTH = 280;
  let backendMode = null;
  let theme = 'system', scanQueued = false, positionQueued = false, refreshInputs = false;
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
        const current = st.collapsed === null ? st.autoFold : st.collapsed;
        st.collapsed = !current;
        render(kind); queuePosition();
      }
    });
    if (kind === 'address') root.addEventListener('toggle', event => {
      if (event.target.matches('details')) states.address.managerOpen = event.target.open;
    }, true);
    return panels[kind] = { host, root, shell };
  }
  // Both panels can be visible together. Each panel sizes to its own content (CSS max-height + the panel's own
  // internal scroll handles overflow, see panel()'s injected stylesheet) instead of a fixed box. The address
  // panel stays anchored top-right; the vehicle panel tries to avoid overlapping it by shifting left / shrinking,
  // and only as a last resort folds the address panel down to its header (still user-toggleable; see "collapsed").
  function rectOverlap(a,b) {
    return a.left < b.right-0.5 && a.right > b.left+0.5 && a.top < b.bottom-0.5 && a.bottom > b.top+0.5;
  }
  function position() {
    const vp = window.visualViewport;
    const vw = vp?.width || innerWidth, vh = vp?.height || innerHeight;
    const ox = vp?.offsetLeft || 0, oy = vp?.offsetTop || 0;
    const as = states.address;
    // Folding also narrows the address panel (not just its height): a vertical-only shrink never helps a purely
    // horizontal conflict, and the address panel's own width is comfortably spared since its header still wraps.
    const layoutAddress = fold => {
      const p = panels.address;
      const header = p.shell.querySelector('.sr-panel-header');
      const width = Math.min(fold ? FOLDED_ADDRESS_WIDTH : ADDRESS_WIDTH, vw-EDGE*2);
      const top = oy + Math.min(70, Math.max(EDGE, vh-EDGE-40));
      const maxHeight = fold ? (header?.offsetHeight || 52) : Math.max(120, oy+vh-EDGE-top);
      Object.assign(p.host.style,{width:`${width}px`,left:`${ox+vw-width-EDGE}px`,top:`${top}px`});
      p.host.style.removeProperty('height');
      p.shell.style.maxHeight = `${maxHeight}px`;
      p.shell.classList.toggle('sr-panel-collapsed', fold);
      return as.open ? p.host.getBoundingClientRect() : null;
    };
    let addressRect = null;
    if (panels.address) addressRect = layoutAddress(as.collapsed === null ? false : as.collapsed);

    const s = states.vehicle;
    if (panels.vehicle && s.open && s.node?.isConnected) {
      const rect = s.node.getBoundingClientRect();
      let width = Math.min(VEHICLE_WIDTH, vw-EDGE*2);
      let left = Math.min(Math.max(rect.left,ox+EDGE), ox+vw-width-EDGE);
      const belowRoom = oy+vh-EDGE - (rect.bottom+6), aboveRoom = (rect.top-6) - (oy+EDGE);
      let top, maxHeight;
      if (belowRoom >= Math.min(aboveRoom,200)) { maxHeight = Math.max(160,belowRoom); top = rect.bottom+6; }
      else { maxHeight = Math.max(160,aboveRoom); top = Math.max(oy+EDGE, rect.top-6-maxHeight); }

      // Try to dodge the address panel by shifting/shrinking left of it; returns whether it still overlaps.
      const avoidAddress = floor => {
        if (!addressRect || !rectOverlap({left,right:left+width,top,bottom:top+maxHeight}, addressRect)) return false;
        const avail = addressRect.left - GAP - (ox+EDGE);
        if (avail < floor) return true;
        width = Math.min(width, avail); left = ox+EDGE;
        return rectOverlap({left,right:left+width,top,bottom:top+maxHeight}, addressRect);
      };
      let fold = false;
      if (avoidAddress(MIN_VEHICLE_WIDTH)) {
        if (as.collapsed === null) {
          fold = true;
          addressRect = layoutAddress(true);
          width = Math.min(VEHICLE_WIDTH, vw-EDGE*2);
          left = Math.min(Math.max(rect.left,ox+EDGE), ox+vw-width-EDGE);
          avoidAddress(MIN_VEHICLE_WIDTH); // best effort against the now-narrower, shorter address panel
        } else {
          // The user explicitly forced the address panel open (or closed) — folding it is not our call to make.
          // Still avoid a full overlap if at all possible, even below the usual comfortable floor.
          avoidAddress(180);
        }
      }
      as.autoFold = fold;
      Object.assign(panels.vehicle.host.style,{width:`${width}px`,left:`${left}px`,top:`${top}px`});
      panels.vehicle.host.style.removeProperty('height');
      panels.vehicle.shell.style.maxHeight = `${maxHeight}px`;
    } else {
      as.autoFold = false;
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
      if (kind === 'address') { s.collapsed = null; s.autoFold = false; }
    }
    refreshVisibility();
  }
  function invalidate(kind) {
    const s = states[kind]; clearTimeout(s.timer); s.generation++; s.data = null; s.cancelCopy = true; s.managerOpen = false;
    s.loadedAt = 0; s.loading = s.reportsLoading = s.managersLoading = false; s.message = '';
  }
  function show(kind) {
    states[kind].open = true; states[kind].dismissed = false; panel(kind); refreshVisibility();
  }
  // s.data = { summary, reports: ReportPage (items accumulated), managers: ManagerPage (items accumulated) } — my-reports-v1
  function render(kind,message='') {
    const s = states[kind], p = panel(kind), data = s.data;
    const heading = kind === 'vehicle' ? '이 차량의 내 신고' : '이 주소의 내 신고';
    const scope = data?.backend === 'selfhost' ? '내 서버의 신고 · 처리중 포함' : backendMode === 'selfhost' ? '셀프호스팅 · 내 서버' : backendMode === 'cloud' ? '클라우드 · 내가 공유한 완료 신고' : '현재 선택한 백엔드로 조회';
    const total = Number(data?.summary?.total || 0), missing = Number(data?.summary?.report_number_missing || 0);
    // a search that genuinely matched nothing doesn't need the result/disposition tiles or an empty-list box;
    // one line says so. This only changes the content-script panels — shared-ui.js's summary()/records() (used
    // by popup.js/options.js too) are untouched.
    const zeroState = !!data && total === 0;
    const collapsible = kind === 'address';
    const collapsed = collapsible && (s.collapsed === null ? s.autoFold : s.collapsed);
    const collapseButton = collapsible
      ? `<button class="sr-icon-button" data-action="toggle-collapse" aria-expanded="${!collapsed}" aria-label="${collapsed ? '패널 펼치기' : '패널 접기'}">${SRUI.icon(collapsed ? 'chevronDown' : 'chevronUp')}</button>`
      : '';
    const body = !data ? `<p class="sr-section sr-note" role="status">${SRUI.esc(message||'조회 중…')}</p>`
      : zeroState ? `<p class="sr-section sr-note" role="status">${SRUI.esc(kind === 'vehicle' ? '이 차량으로 내 신고가 없습니다.' : '이 주소로 내 신고가 없습니다.')}</p>`
      : `${s.message?`<p class="sr-section sr-note" role="status">${SRUI.esc(s.message)}</p>`:''}${SRUI.summary(data.summary)}${kind==='address'?SRUI.managers(data.managers,s.managerOpen):''}${SRUI.records(data.reports)}${data.reports?.next_cursor?`<button class="sr-button sr-more" data-action="more" ${s.reportsLoading?'disabled':''}>${s.reportsLoading?'불러오는 중…':'신고 더 보기'}</button>`:''}`;
    p.shell.innerHTML = `<header class="sr-panel-header"><div class="sr-header-copy"><div class="sr-header-title"><span class="sr-icon-badge">${SRUI.icon(kind === 'vehicle' ? 'car' : 'pin')}</span>${heading}<span class="sr-plain-count">${data ? `${SRUI.count(total)}건` : ''}</span></div><p class="sr-header-caption">${SRUI.queryBadge(kind, s.query)}</p></div><div class="sr-header-actions">${data && total>missing ? `<button class="sr-button" data-action="copy">${SRUI.icon('copy','sr-icon-sm')}신고번호 복사</button>` : ''}${collapseButton}<button class="sr-icon-button" data-action="close" aria-label="닫기">${SRUI.icon('close')}</button></div></header><div class="sr-panel-content">${body}</div><footer class="sr-panel-footer"><span>${s.copying?'신고번호를 모으는 중…':SRUI.esc(scope)}</span>${s.copying?'<button class="sr-text-button" data-action="cancel-copy">취소</button>':''}</footer>`;
    const managerButton = p.shell.querySelector('[data-action="more-managers"]');
    if (managerButton) { managerButton.disabled = !!s.managersLoading; if (s.managersLoading) managerButton.textContent = '불러오는 중…'; }
  }
  const failureText = SRUI.errorText;
  async function search(kind,retried=false) {
    const s=states[kind], query=s.query, generation=s.generation;
    if (!s.open || s.dismissed || !query || s.loading) return;
    s.loading = true;
    render(kind);
    try {
      const result=await send({type:'SEARCH',kind,query,fresh:retried});
      if (generation!==s.generation || query!==s.query || !s.open || s.dismissed || !s.node?.isConnected) return;
      backendMode=result.backend || 'cloud';
      s.data={backend:backendMode,summary:result.summary,reports:result.reports,managers:result.managers}; s.loadedAt=Date.now(); render(kind);
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
    if (!s.node?.isConnected || s.node.isComposing) return;
    const query=normalizeVehicle(s.node.value);
    if(query!==s.query){invalidate('vehicle');s.query=query;s.dismissed=false;}
    if([...query].length<6 || document.getElementById('chkNoVhrNo')?.checked){hide('vehicle');return;}
    if(reopen)show('vehicle');
    if(!s.open || s.dismissed)return;
    if(s.data && Date.now()-s.loadedAt>=DATA_TTL)invalidate('vehicle');
    if(s.data){render('vehicle');return;}
    render('vehicle');
    clearTimeout(s.timer);s.timer=setTimeout(()=>search('vehicle'),600);
  }
  function addressChanged(reopen=false) {
    const s=states.address, query=normalizeAddress(s.node?.textContent);
    if(query===s.query && !reopen)return;
    if(query!==s.query || (s.data && Date.now()-s.loadedAt>=DATA_TTL))invalidate('address');
    s.query=query;s.dismissed=false;
    if([...query].length<5){hide('address');return;}
    show('address');render('address');if(s.data)return;
    clearTimeout(s.timer);s.timer=setTimeout(()=>search('address'),700);
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
      a.controller?.abort();a.observer?.disconnect();invalidate('address');hide('address');a.node=address;a.query='';
      if(address){
        a.controller=new AbortController();const signal=a.controller.signal;
        address.addEventListener('click',()=>addressChanged(true),{signal});
        address.addEventListener('focus',()=>addressChanged(true),{signal});
        a.observer=new MutationObserver(()=>addressChanged());a.observer.observe(address,{childList:true,characterData:true,subtree:true});addressChanged();
      }
    }
    if(refreshInputs){refreshInputs=false;addressChanged();if(document.activeElement===v.node)vehicleChanged(true);}
  }
  function queueScan(){if(scanQueued)return;scanQueued=true;requestAnimationFrame(()=>{scanQueued=false;rebind();});}
  new MutationObserver(queueScan).observe(document.documentElement,{childList:true,subtree:true});
  rebind();
  document.addEventListener('pointerdown',event=>{
    const path=event.composedPath();
    // A click on either tracked input or either panel is never "outside" — it's the user actively using one of
    // the two features, which must not blow away the other's panel. Only a click away from all of them dismisses.
    const insideTracked=['vehicle','address'].some(kind => {
      const s=states[kind];
      return (s.node && path.includes(s.node)) || (panels[kind] && path.includes(panels[kind].host));
    });
    if(insideTracked)return;
    for(const kind of ['vehicle','address']){ if(states[kind].open)hide(kind,true); }
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(states.vehicle.open)hide('vehicle',true);else if(states.address.open)hide('address',true);}});
  document.addEventListener('scroll',queuePosition,true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)queuePosition();});
  window.addEventListener('focus',queuePosition);
  document.addEventListener('change',event=>{if(event.target?.id==='chkNoVhrNo'&&event.target.checked)hide('vehicle',true);},true);
  window.addEventListener('resize',queuePosition);
  window.visualViewport?.addEventListener('resize',queuePosition);
  window.visualViewport?.addEventListener('scroll',queuePosition);
  window.addEventListener('hashchange',()=>{for(const kind of ['vehicle','address']){invalidate(kind);hide(kind);states[kind].query='';}refreshInputs=true;queueScan();});
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.type==='AUTH_CHANGED'||message?.type==='DATA_INVALIDATED'){backendMode=null;for(const kind of ['vehicle','address']){invalidate(kind);hide(kind);}}
    if(message?.type==='WORKER_RESTARTED'){
      backendMode=null;
      for(const kind of ['vehicle','address']){
        invalidate(kind);
        if(states[kind].open&&!states[kind].dismissed){render(kind,'현재 연결을 다시 확인하는 중…');states[kind].timer=setTimeout(()=>search(kind),0);}
      }
    }
  });
})();
