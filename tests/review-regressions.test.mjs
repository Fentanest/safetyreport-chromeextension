import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const url = file => pathToFileURL(resolve(file)).href;
const fixture = name => JSON.parse(readFileSync(`contracts/my-reports/fixtures/${name}.json`, 'utf8'));
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
async function withPage(run, viewport = { width: 900, height: 900 }) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try { await run(await browser.newPage({ viewport })); } finally { await browser.close(); }
}
async function content(page, reportDelay = 30, managerDelay = 150) {
  const data = { first: fixture('search-vehicle-first-page'), next: fixture('search-vehicle-next-page'), managers: fixture('search-managers-page') };
  // Supply a mock manager cursor for UI paging; server signature validation is tested separately.
  data.first.managers.next_cursor = 'manager-next.signature'; data.first.managers.total_managers = 12;
  await page.addInitScript(({ base, data, reportDelay, managerDelay }) => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return original.call(this, { ...options, mode: 'open' }); };
    window.__calls = []; window.__data = data; window.__clock = Date.now(); Date.now = () => window.__clock;
    chrome.storage = { sync: { get(_key, callback) { callback({ theme: 'light' }); } }, onChanged: { addListener() {} } };
    chrome.runtime = { lastError: null, getURL: name => base + name, onMessage: { addListener() {} }, sendMessage(message, callback) {
      window.__calls.push(message);
      const value = structuredClone(message.part === 'managers' ? window.__data.managers : message.cursor ? window.__data.next : window.__data.first);
      setTimeout(() => callback({ data: value }), message.part === 'managers' ? managerDelay : message.cursor ? reportDelay : 10);
    } };
  }, { base: url('.') + '/', data, reportDelay, managerDelay });
  await page.goto(url('tests/fixture.html')); await page.addScriptTag({ url: url('shared-ui.js') }); await page.addScriptTag({ url: url('content.js') });
  return data;
}
async function address(page) {
  await page.locator('#add1').evaluate(el => { el.textContent = '서울특별시 종로구 예시로 1'; });
  await page.locator('#sr-address-panel-host .sr-record-key').first().waitFor();
}
for (const [reportDelay, managerDelay] of [[30, 250], [250, 30]]) {
  test(`panels: simultaneous pages merge in either response order (${reportDelay}/${managerDelay}) without duplicate requests`, async () => withPage(async page => {
    const data = await content(page, reportDelay, managerDelay); await address(page);
    await page.evaluate(() => {
      const root = document.getElementById('sr-address-panel-host').shadowRoot;
      root.querySelector('details').open = true;
      root.querySelector('[data-action="more"]').click(); root.querySelector('[data-action="more-managers"]').click();
      root.querySelector('[data-action="more"]').click(); root.querySelector('[data-action="more-managers"]').click();
    });
    await page.waitForFunction(({ reports, managers }) => {
      const root = document.getElementById('sr-address-panel-host').shadowRoot;
      return root.querySelectorAll('.sr-record').length === reports && root.querySelectorAll('.sr-officer').length === managers;
    }, { reports: data.first.reports.items.length + data.next.reports.items.length, managers: data.first.managers.items.length + data.managers.managers.items.length });
    const calls = await page.evaluate(() => window.__calls.filter(c => c.cursor));
    assert.equal(calls.length, 2); assert.equal(calls.filter(c => c.part === 'managers').length, 1);
  }));
}
test('panels: same vehicle reuses fresh data, then fetches updated data after expiry', async () => withPage(async page => {
  await content(page); await page.locator('#VHRNO').fill('12가3456'); await page.locator('#VHRNO').click();
  await page.locator('#sr-vehicle-panel-host .sr-record-key').first().waitFor();
  const close = () => page.locator('#sr-vehicle-panel-host [data-action="close"]').click();
  await close(); await page.locator('#VHRNO').click();
  assert.equal(await page.evaluate(() => window.__calls.length), 1);
  await close(); await page.evaluate(() => { window.__clock += 120000; window.__data.first.summary.total = 99; });
  await page.locator('#VHRNO').click();
  await page.waitForFunction(() => document.getElementById('sr-vehicle-panel-host').shadowRoot.querySelector('.sr-plain-count').textContent === '99건');
  assert.equal(await page.evaluate(() => window.__calls.length), 2);
}));
test('panels: hash navigation re-reads unchanged nodes; dismissed address can reopen and expire', async () => withPage(async page => {
  await content(page); await address(page);
  await page.evaluate(() => { window.__addressNode = document.getElementById('add1'); location.hash = 'next-report'; });
  await page.waitForFunction(() => window.__calls.length === 2);
  await page.locator('#sr-address-panel-host .sr-record-key').first().waitFor();
  assert.equal(await page.evaluate(() => window.__addressNode === document.getElementById('add1')), true);
  await page.locator('#sr-address-panel-host [data-action="close"]').click(); await page.locator('#add1').click();
  assert.equal(await page.locator('#sr-address-panel-host').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__calls.length), 2);
  await page.locator('#sr-address-panel-host [data-action="close"]').click();
  await page.evaluate(() => { window.__clock += 120000; window.__data.first.summary.total = 99; }); await page.locator('#add1').click();
  await page.waitForFunction(() => document.getElementById('sr-address-panel-host').shadowRoot.querySelector('.sr-plain-count').textContent === '99건');
  assert.equal(await page.evaluate(() => window.__calls.length), 3);
}));
async function options(page, backendMode = 'selfhost') {
  await page.addInitScript(({ backendMode }) => {
    window.__settings = { backendMode, selfhost: { serverUrl: 'http://localhost:6819', apiKey: 'test-only-key', notifyCrawlDone: false, pollInterval: 5 } };
    window.__calls = []; window.__runtime = []; window.__storage = []; window.__tests = [];
    window.__signedIn = false; window.__failure = false; window.__holdPermission = false;
    window.__broadcast = () => window.__runtime.forEach(fn => fn({ type: 'AUTH_CHANGED' }));
    chrome.storage = { sync: { get(_key, cb) { cb({ theme: 'light' }); }, set: async () => {} }, onChanged: { addListener(fn) { window.__storage.push(fn); } } };
    chrome.permissions = { request(_request, cb) { if (window.__holdPermission) window.__permission = cb; else cb(true); } };
    chrome.runtime = { lastError: null, onMessage: { addListener(fn) { window.__runtime.push(fn); } }, sendMessage(message, callback) {
      window.__calls.push(message.type);
      if (message.type === 'GET_SETTINGS') callback({ data: structuredClone(window.__settings) });
      if (message.type === 'STATUS') callback({ data: { backendMode: window.__settings.backendMode, signedIn: window.__signedIn, connected: !window.__failure, error: window.__failure ? 'SERVER_OFFLINE' : null, version: '3.0.0.0' } });
      if (message.type === 'SET_MODE') { window.__settings.backendMode = message.backendMode; window.__broadcast(); callback({ data: {} }); }
      if (message.type === 'SAVE_SERVER') {
        const { type, ...config } = message; window.__settings.selfhost = config;
        window.__broadcast(); callback({ data: {} });
      }
      if (message.type === 'TEST_SERVER') window.__tests.push(() => callback({ data: { version: '3.0.0.0', active: true } }));
      if (message.type === 'LOGIN' || message.type === 'LOGOUT') callback({ error: 'REQUEST_FAILED' });
      if (message.type === 'TEST_CLOUD') window.__cloudTest = () => callback({ data: { connected: true } });
    } };
  }, { backendMode });
  await page.goto(url('options.html')); await page.waitForFunction(expected => document.getElementById('backendMode').value === expected, backendMode);
  await page.waitForFunction(() => !document.getElementById('serverStatus').textContent.includes('중…'));
}
test('options: active mode cannot become blank; runtime/storage changes synchronize and preserve edits', async () => withPage(async page => {
  await options(page);
  assert.equal(await page.locator('#backendMode option[value=""]').isDisabled(), true);
  await page.evaluate(() => { const mode = document.getElementById('backendMode'); mode.value = ''; mode.dispatchEvent(new Event('change')); });
  assert.equal(await page.locator('#backendMode').inputValue(), 'selfhost');
  await page.locator('#serverUrl').fill('http://localhost:9999');
  await page.evaluate(() => { window.__settings.backendMode = 'cloud'; window.__broadcast(); });
  await page.waitForFunction(() => document.getElementById('backendMode').value === 'cloud');
  assert.equal(await page.locator('#selfhostSettings').isVisible(), false);
  await page.evaluate(() => { window.__settings.backendMode = 'selfhost'; window.__storage.forEach(fn => fn({ backendMode: {} }, 'local')); });
  await page.waitForFunction(() => document.getElementById('backendMode').value === 'selfhost');
  assert.equal(await page.locator('#serverUrl').inputValue(), 'http://localhost:9999');
}));
test('options: edits, mode round trips and delayed permission discard stale test results', async () => withPage(async page => {
  await options(page); await page.locator('#btnTest').click(); await page.waitForFunction(() => window.__tests.length === 1);
  await page.locator('#serverUrl').fill('http://localhost:9999'); await page.evaluate(() => window.__tests.shift()());
  assert.equal(await page.locator('#testResult').textContent(), '');
  assert.ok(!(await page.locator('#serverStatus').textContent()).includes('9999'));
  await page.locator('#btnTest').click(); await page.waitForFunction(() => window.__tests.length === 1);
  await page.locator('#apiKey').fill('another-test-key'); await page.evaluate(() => window.__tests.shift()());
  assert.equal(await page.locator('#testResult').textContent(), '');
  await page.locator('#btnTest').click(); await page.waitForFunction(() => window.__tests.length === 1);
  await page.locator('#backendMode').selectOption('cloud'); await page.waitForFunction(() => document.getElementById('backendMode').value === 'cloud' && !document.getElementById('backendMode').disabled);
  await page.locator('#backendMode').selectOption('selfhost'); await page.waitForFunction(() => document.getElementById('backendMode').value === 'selfhost');
  await page.evaluate(() => window.__tests.shift()()); assert.equal(await page.locator('#testResult').textContent(), '');
  await page.evaluate(() => { window.__holdPermission = true; }); await page.locator('#btnTest').click();
  await page.waitForFunction(() => typeof window.__permission === 'function');
  await page.locator('#serverUrl').fill('http://localhost:8888'); await page.evaluate(() => window.__permission(true));
  assert.equal(await page.evaluate(() => window.__tests.length), 0);
  assert.equal(await page.locator('#testResult').textContent(), '');
}));
test('options: saving an offline server keeps save success separate from connection failure', async () => withPage(async page => {
  await options(page); await page.locator('#serverUrl').fill('http://localhost:9999/'); await page.locator('#apiKey').fill('  test-only-key  '); await page.evaluate(() => { window.__failure = true; });
  await page.locator('#btnSave').click(); await page.waitForFunction(() => document.getElementById('saveResult').textContent === '저장되었습니다.');
  await page.waitForFunction(() => document.getElementById('serverStatus').textContent.includes('연결할 수 없습니다'));
  assert.equal(await page.locator('#testResult').textContent(), '');
  assert.equal(await page.locator('#serverUrl').inputValue(), 'http://localhost:9999');
  assert.equal(await page.locator('#apiKey').inputValue(), 'test-only-key');
}));
test('options: a rapid external mode round trip invalidates a pending test even when refresh sees the same mode', async () => withPage(async page => {
  await options(page); await page.locator('#btnTest').click(); await page.waitForFunction(() => window.__tests.length === 1);
  await page.evaluate(() => {
    window.__settings.backendMode = 'cloud'; window.__broadcast();
    window.__settings.backendMode = 'selfhost'; window.__broadcast();
    window.__tests.shift()();
  });
  await page.waitForFunction(() => document.getElementById('backendMode').value === 'selfhost' && !document.getElementById('btnTest').disabled);
  assert.equal(await page.locator('#testResult').textContent(), '');
}));
test('options: login/logout failure survives refresh; obsolete cloud test cannot update a new mode', async () => withPage(async page => {
  await options(page, 'cloud'); await page.locator('#login').click();
  await page.waitForFunction(() => document.getElementById('authError').textContent.includes('로그인하지 못했습니다'));
  await page.waitForFunction(() => document.getElementById('status').textContent === '로그인하지 않았습니다.');
  assert.ok((await page.locator('#authError').textContent()).includes('로그인하지 못했습니다'));
  await page.evaluate(() => { window.__signedIn = true; window.__broadcast(); }); await page.locator('#logout').waitFor({ state: 'visible' });
  await page.locator('#logout').click(); await page.waitForFunction(() => document.getElementById('authError').textContent.includes('로그아웃하지 못했습니다'));
  await page.locator('#testCloud').click(); await page.waitForFunction(() => typeof window.__cloudTest === 'function');
  await page.locator('#backendMode').selectOption('selfhost'); await page.waitForFunction(() => document.getElementById('backendMode').value === 'selfhost');
  await page.evaluate(() => window.__cloudTest()); assert.equal(await page.locator('#cloudTestResult').textContent(), '');
}));
test('options: same-account token rotation keeps a cloud test; an account change invalidates it', async () => withPage(async page => {
  await options(page, 'cloud'); await page.locator('#testCloud').click(); await page.waitForFunction(() => typeof window.__cloudTest === 'function');
  await page.evaluate(() => {
    window.__storage.forEach(fn => fn({ 'sb-test-auth-token': {
      oldValue: JSON.stringify({ user: { id: 'a' }, access_token: 'old-mock-token' }),
      newValue: JSON.stringify({ user: { id: 'a' }, access_token: 'new-mock-token' }),
    } }, 'local'));
    window.__cloudTest(); window.__cloudTest = null;
  });
  await page.waitForFunction(() => document.getElementById('cloudTestResult').textContent === '클라우드 조회 연결 성공');
  await page.locator('#testCloud').click(); await page.waitForFunction(() => typeof window.__cloudTest === 'function');
  await page.evaluate(() => {
    window.__storage.forEach(fn => fn({ 'sb-test-auth-token': { oldValue: { user: { id: 'a' } }, newValue: { user: { id: 'b' } } } }, 'local'));
    window.__cloudTest();
  });
  assert.equal(await page.locator('#cloudTestResult').textContent(), '');
}));
test('popup: selfhost crawl controls precede 200 recent reports and stay visible in both themes', async () => withPage(async page => {
  await page.addInitScript(() => {
    const row = { report_number: 'TEST-1', vehicle_number: '12가3456', status: 'accepted' };
    chrome.storage = { sync: { get(_key, cb) { cb({ theme: 'light' }); } }, onChanged: { addListener() {} } };
    chrome.runtime = { lastError: null, onMessage: { addListener() {} }, sendMessage(message, cb) {
      const data = message.type === 'STATUS' ? { backendMode: 'selfhost', connected: true, version: '3.0.0.0' }
        : message.type === 'CRAWL_STATUS' ? { running: false }
        : { backend: 'selfhost', stats: { total: 200, processingCount: 1 }, recent: Array.from({ length: 200 }, () => row), recent_limit: 200 };
      cb({ data });
    } };
  });
  await page.goto(url('popup.html')); await page.locator('#crawlStart').waitFor();
  assert.equal(await page.locator('.sr-record').count(), 200);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.srTheme = value; }, theme);
    const button = await page.locator('#crawlStart').boundingBox();
    assert.ok(button && button.y >= 0 && button.y + button.height < 570);
    assert.ok(button.y < (await page.locator('.sr-record').first().boundingBox()).y);
  }
}, { width: 460, height: 570 }));
