'use strict';
(() => {
  const el = id => document.getElementById(id);
  const status = el('status'), login = el('login'), logout = el('logout');
  const theme = el('theme'), mode = el('backendMode');
  let generation = 0, activeMode = null, modeEpoch = 0, contextGeneration = 0, dirty = false;
  let serverRevision = 0, serverOperation = 0, serverBusy = null;
  let cloudOperation = 0, refreshTimer;
  const send = message => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(new Error('REQUEST_FAILED'));
    else if (response?.error) reject(new Error(response.error));
    else resolve(response?.data);
  }));
  const applyTheme = choice => {
    document.documentElement.dataset.srTheme = choice === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : choice;
  };
  chrome.storage.sync.get('theme', value => { theme.value = value.theme || 'system'; applyTheme(theme.value); });
  theme.addEventListener('change', async () => { await chrome.storage.sync.set({ theme: theme.value }); applyTheme(theme.value); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(theme.value));

  function finishServer(token) {
    if (serverBusy !== token) return;
    serverBusy = null;
    el('btnSave').disabled = el('btnTest').disabled = false;
  }
  function invalidateServer() {
    serverRevision++; serverOperation++;
    if (serverBusy) finishServer(serverBusy);
    el('testResult').textContent = ''; el('saveResult').textContent = '';
  }
  function displayMode(value) {
    if (activeMode !== value) {
      modeEpoch++; activeMode = value; invalidateServer(); cloudOperation++;
      el('cloudTestResult').textContent = ''; el('authError').textContent = '';
      el('testCloud').disabled = false;
    }
    mode.value = value || '';
    mode.querySelector('option[value=""]').disabled = !!value;
    el('selfhostSettings').hidden = value !== 'selfhost'; el('cloudSettings').hidden = value !== 'cloud';
    el('modeStatus').textContent = value === 'selfhost' ? '셀프호스팅 · 내 서버의 신고 / 크롤링'
      : value === 'cloud' ? '클라우드 · 내가 공유한 답변 완료 신고'
      : '모드를 선택하면 연결합니다. 두 모드 설정은 각각 보존됩니다.';
  }
  function fillServer(config) {
    if (dirty || !config) return;
    const changed = el('serverUrl').value !== config.serverUrl || el('apiKey').value !== config.apiKey
      || el('notifyCrawlDone').checked !== config.notifyCrawlDone || Number(el('pollInterval').value) !== config.pollInterval;
    if (changed) invalidateServer();
    el('serverUrl').value = config.serverUrl; el('apiKey').value = config.apiKey;
    el('notifyCrawlDone').checked = config.notifyCrawlDone; el('pollInterval').value = config.pollInterval;
  }
  async function refresh(loadSettings = false) {
    const run = ++generation;
    try {
      if (loadSettings) {
        const config = await send({ type: 'GET_SETTINGS' }); if (run !== generation) return;
        displayMode(config.backendMode || null); fillServer(config.selfhost);
      }
      if (activeMode === 'selfhost') el('serverStatus').textContent = '저장된 서버 연결 확인 중…';
      const state = await send({ type: 'STATUS' }); if (run !== generation) return;
      const value = state.backendMode || null; displayMode(value);
      if (value === 'selfhost') {
        el('serverStatus').textContent = '저장된 서버: ' + (state.connected ? `연결됨 · 서버 ${state.version}` : SRUI.errorText(state.error));
        return;
      }
      status.textContent = state.signedIn ? (state.name ? `${state.name} 계정으로 로그인됨` : '카카오 계정으로 로그인됨')
        : state.error === 'NOT_CONFIGURED' ? '배포용 Supabase 공개 설정이 필요합니다.' : '로그인하지 않았습니다.';
      login.hidden = state.signedIn || state.error === 'NOT_CONFIGURED'; logout.hidden = !state.signedIn;
    } catch {
      if (run !== generation) return;
      if (activeMode === 'selfhost') el('serverStatus').textContent = '저장된 서버 연결 상태를 확인하지 못했습니다.';
      else status.textContent = '계정 상태를 확인하지 못했습니다.';
    }
  }
  function scheduleRefresh() {
    // Invalidate a slow STATUS immediately; coalesce runtime/storage notifications.
    generation++; contextGeneration++;
    el('testResult').textContent = ''; el('cloudTestResult').textContent = '';
    if (serverBusy?.test) finishServer(serverBusy);
    cloudOperation++; el('testCloud').disabled = false;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh(true), 0);
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'AUTH_CHANGED' || message?.type === 'WORKER_RESTARTED') scheduleRefresh();
  });
  function accountIdentity(value) {
    try { return (typeof value === 'string' ? JSON.parse(value) : value)?.user?.id || null; }
    catch { return null; }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.entries(changes).some(([key, value]) => key === 'backendMode' || key === 'selfhost'
      || (/^sb-.+-auth-token$/.test(key) && accountIdentity(value.oldValue) !== accountIdentity(value.newValue)))) scheduleRefresh();
  });
  mode.addEventListener('change', async () => {
    const selected = mode.value;
    if (!selected) { mode.value = activeMode || ''; return; }
    generation++; mode.disabled = true;
    try { await send({ type: 'SET_MODE', backendMode: selected }); }
    catch (error) { mode.value = activeMode || ''; el('modeStatus').textContent = SRUI.errorText(error.message); }
    finally { mode.disabled = false; }
    await refresh(true);
  });
  for (const id of ['serverUrl', 'apiKey', 'notifyCrawlDone', 'pollInterval']) {
    el(id).addEventListener('input', () => { dirty = true; invalidateServer(); });
    el(id).addEventListener('change', () => { dirty = true; invalidateServer(); });
  }
  function save(test) {
    const target = el(test ? 'testResult' : 'saveResult');
    let origin;
    try {
      const url = new URL(el('serverUrl').value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) throw new Error();
      origin = url.origin;
    } catch { target.textContent = SRUI.errorText('INVALID_SERVER_URL'); return; }
    const config = { type: 'SAVE_SERVER', serverUrl: origin, apiKey: el('apiKey').value.trim(),
      notifyCrawlDone: el('notifyCrawlDone').checked, pollInterval: Number(el('pollInterval').value) };
    if (!config.apiKey) { target.textContent = SRUI.errorText('INVALID_API_KEY'); return; }
    const token = { test, operation: ++serverOperation, revision: serverRevision, epoch: modeEpoch, context: contextGeneration };
    const current = () => token.operation === serverOperation && token.revision === serverRevision && token.epoch === modeEpoch
      && (!test || token.context === contextGeneration) && activeMode === 'selfhost';
    serverBusy = token; el('btnSave').disabled = el('btnTest').disabled = true;
    target.textContent = '';
    // Request only the entered origin, directly within the click gesture.
    chrome.permissions.request({ origins: [origin + '/*'], ...(!test && config.notifyCrawlDone ? { permissions: ['notifications'] } : {}) }, async granted => {
      try {
        if (!current()) return;
        if (!granted) {
          target.textContent = !test && config.notifyCrawlDone ? '서버 접근 또는 알림 권한이 허용되지 않았습니다. 알림이 필요 없다면 체크를 해제하고 다시 저장해 주세요.' : SRUI.errorText('SERVER_PERMISSION_REQUIRED');
          return;
        }
        if (test) {
          target.textContent = `입력값 테스트 중 · ${origin}`;
          const state = await send({ ...config, type: 'TEST_SERVER' }); if (!current()) return;
          target.textContent = `입력값 연결 성공 · ${origin} · 서버 ${state.version} · protocol 3${state.active ? '' : ' · 저장하면 적용됩니다.'}`;
        } else {
          await send(config); if (!current()) return;
          el('serverUrl').value = origin; el('apiKey').value = config.apiKey;
          dirty = false; target.textContent = '저장되었습니다.';
          await refresh(true);
        }
      } catch (error) { if (current()) target.textContent = SRUI.errorText(error.message); }
      finally { finishServer(token); }
    });
  }
  el('btnSave').addEventListener('click', () => save(false)); el('btnTest').addEventListener('click', () => save(true));
  el('testCloud').addEventListener('click', async () => {
    const operation = ++cloudOperation, epoch = modeEpoch;
    const current = () => operation === cloudOperation && epoch === modeEpoch && activeMode === 'cloud';
    el('testCloud').disabled = true; el('cloudTestResult').textContent = '연결 테스트 중…';
    try { await send({ type: 'TEST_CLOUD' }); if (current()) el('cloudTestResult').textContent = '클라우드 조회 연결 성공'; }
    catch (error) { if (current()) el('cloudTestResult').textContent = SRUI.errorText(error.message); }
    finally { if (current()) el('testCloud').disabled = false; }
  });
  for (const [button, type, failure] of [[login, 'LOGIN', '로그인하지 못했습니다. 다시 시도해 주세요.'], [logout, 'LOGOUT', '로그아웃하지 못했습니다. 다시 시도해 주세요.']]) {
    button.addEventListener('click', async () => {
      const epoch = modeEpoch;
      button.disabled = true; el('authError').textContent = '';
      if (type === 'LOGIN') status.textContent = '카카오 로그인 중…';
      try { await send({ type }); }
      catch { if (epoch === modeEpoch && activeMode === 'cloud') el('authError').textContent = failure; }
      finally { button.disabled = false; await refresh(true); }
    });
  }
  refresh(true);
})();
