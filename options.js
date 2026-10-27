'use strict';
(() => {
  const el = id => document.getElementById(id);
  const status = el('status'), login = el('login'), logout = el('logout');
  const theme = el('theme');
  // 섹션 제목·버튼에 아이콘을 붙인다. 아이콘은 shared-ui.js의 한 helper에만 둔다.
  const sectionIcon = { secCloud: 'user', secPc: 'info', secTheme: 'gear', secInfo: 'info' };
  for (const [id, name] of Object.entries(sectionIcon)) el(id).insertAdjacentHTML('afterbegin', SRUI.icon(name, 'sr-icon-sm'));
  el('testCloud').innerHTML = SRUI.icon('pulse') + '클라우드 연결 테스트';
  logout.innerHTML = SRUI.icon('logout') + '이 확장에서 로그아웃';
  let generation = 0, cloudOperation = 0, refreshTimer;
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

  async function refresh() {
    const run = ++generation;
    try {
      const state = await send({ type: 'STATUS' }); if (run !== generation) return;
      status.textContent = state.signedIn ? (state.name ? `${state.name} 계정으로 로그인됨` : '카카오 계정으로 로그인됨')
        : state.error === 'NOT_CONFIGURED' ? '배포용 Supabase 공개 설정이 필요합니다.' : '로그인하지 않았습니다.';
      login.hidden = state.signedIn || state.error === 'NOT_CONFIGURED'; logout.hidden = !state.signedIn;
      el('statusDot').className = 'sr-status-led sr-status-led--' + (state.signedIn ? 'ok' : 'warn');
      el('headerStatus').textContent = state.signedIn ? '클라우드 · 로그인됨' : '클라우드 · 로그인 필요';
    } catch {
      if (run !== generation) return;
      el('statusDot').className = 'sr-status-led sr-status-led--bad';
      status.textContent = '계정 상태를 확인하지 못했습니다.'; el('headerStatus').textContent = '계정 상태 확인 실패';
    }
  }
  function scheduleRefresh(resetTest = true) {
    // Invalidate a slow STATUS immediately; coalesce runtime/storage notifications.
    generation++;
    // A status-only event must not cancel this page's own connection test.
    if (resetTest) { el('cloudTestResult').textContent = ''; cloudOperation++; el('testCloud').disabled = false; }
    clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 0);
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'AUTH_CHANGED' || message?.type === 'WORKER_RESTARTED') scheduleRefresh();
    // Live status updates also come from this page's own test: preserve its result/token.
    else if (message?.type === 'STATUS_CHANGED') scheduleRefresh(false);
  });
  function accountIdentity(value) {
    try { return (typeof value === 'string' ? JSON.parse(value) : value)?.user?.id || null; }
    catch { return null; }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.entries(changes).some(([key, value]) => /^sb-.+-auth-token$/.test(key)
      && accountIdentity(value.oldValue) !== accountIdentity(value.newValue))) scheduleRefresh();
    else if (changes.srStatusCache) scheduleRefresh(false);
  });
  el('testCloud').addEventListener('click', async () => {
    const operation = ++cloudOperation;
    const current = () => operation === cloudOperation;
    el('testCloud').disabled = true; el('cloudTestResult').textContent = '연결 테스트 중…';
    try { await send({ type: 'TEST_CLOUD' }); if (current()) el('cloudTestResult').textContent = '클라우드 조회 연결 성공'; }
    catch (error) { if (current()) el('cloudTestResult').textContent = SRUI.errorText(error.message); }
    finally { if (current()) el('testCloud').disabled = false; }
  });
  for (const [button, type, failure] of [[login, 'LOGIN', '로그인하지 못했습니다. 다시 시도해 주세요.'], [logout, 'LOGOUT', '로그아웃하지 못했습니다. 다시 시도해 주세요.']]) {
    button.addEventListener('click', async () => {
      button.disabled = true; el('authError').textContent = '';
      if (type === 'LOGIN') status.textContent = '카카오 로그인 중…';
      try { await send({ type }); }
      catch { el('authError').textContent = failure; }
      finally { button.disabled = false; await refresh(); }
    });
  }
  refresh();
})();
