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
test('panels: hash navigation preserves unchanged address results; dismissed address can reopen and expire', async () => withPage(async page => {
  await content(page); await address(page);
  await page.evaluate(() => { window.__addressNode = document.getElementById('add1'); location.hash = 'next-report'; });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__calls.length), 1);
  await page.locator('#sr-address-panel-host .sr-record-key').first().waitFor();
  assert.equal(await page.evaluate(() => window.__addressNode === document.getElementById('add1')), true);
  await page.locator('#sr-address-panel-host [data-action="close"]').click(); await page.locator('#add1').click();
  assert.equal(await page.locator('#sr-address-panel-host').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__calls.length), 1);
  await page.locator('#sr-address-panel-host [data-action="close"]').click();
  await page.evaluate(() => { window.__clock += 120000; window.__data.first.summary.total = 99; }); await page.locator('#add1').click();
  await page.waitForFunction(() => document.getElementById('sr-address-panel-host').shadowRoot.querySelector('.sr-plain-count').textContent === '99건');
  assert.equal(await page.evaluate(() => window.__calls.length), 2);
}));
async function options(page) {
  await page.addInitScript(() => {
    window.__calls = []; window.__runtime = []; window.__storage = [];
    window.__signedIn = false;
    window.__broadcast = () => window.__runtime.forEach(fn => fn({ type: 'AUTH_CHANGED' }));
    chrome.storage = { sync: { get(_key, cb) { cb({ theme: 'light' }); }, set: async () => {} }, onChanged: { addListener(fn) { window.__storage.push(fn); } } };
    chrome.runtime = { lastError: null, onMessage: { addListener(fn) { window.__runtime.push(fn); } }, sendMessage(message, callback) {
      window.__calls.push(message.type);
      if (message.type === 'STATUS') callback({ data: { connected: window.__signedIn, signedIn: window.__signedIn, error: null } });
      if (message.type === 'LOGIN' || message.type === 'LOGOUT') callback({ error: 'REQUEST_FAILED' });
      if (message.type === 'TEST_CLOUD') window.__cloudTest = () => callback({ data: { connected: true } });
    } };
  });
  await page.goto(url('options.html'));
  await page.waitForFunction(() => document.getElementById('status').textContent === '로그인하지 않았습니다.');
}
test('options: only the cloud account is configurable; the PC notice explains where PC-only reports went', async () => withPage(async page => {
  await options(page);
  for (const id of ['backendMode', 'selfhostSettings', 'serverUrl', 'apiKey', 'btnSave', 'btnTest', 'modeBadge']) assert.equal(await page.locator('#' + id).count(), 0, id);
  assert.equal(await page.locator('#cloudSettings').isVisible(), true);
  assert.ok((await page.locator('#pcNotice').textContent()).includes('PC에만 있던 신고는 모바일 앱에서 가져와'));
  assert.deepEqual(await page.evaluate(() => window.__calls), ['STATUS']);
}));
for (const notification of ['runtime', 'storage']) {
  test(`options: ${notification} status updates preserve pending and completed cloud connection tests`, async () => withPage(async page => {
    await options(page);
    const update = signedIn => page.evaluate(({ signedIn, notification }) => {
      window.__signedIn = signedIn;
      if (notification === 'runtime') window.__runtime.forEach(fn => fn({ type: 'STATUS_CHANGED' }));
      else window.__storage.forEach(fn => fn({ srStatusCache: { newValue: {} } }, 'local'));
    }, { signedIn, notification });
    await page.locator('#testCloud').click();
    await page.waitForFunction(() => typeof window.__cloudTest === 'function');
    await update(true);
    await page.waitForFunction(() => document.getElementById('headerStatus').textContent === '클라우드 · 로그인됨', null, { timeout: 2000 });
    assert.equal(await page.locator('#testCloud').isDisabled(), true);
    await page.evaluate(() => window.__cloudTest());
    await page.waitForFunction(() => document.getElementById('cloudTestResult').textContent === '클라우드 조회 연결 성공');
    await update(false);
    await page.waitForFunction(() => document.getElementById('headerStatus').textContent === '클라우드 · 로그인 필요', null, { timeout: 2000 });
    assert.equal(await page.locator('#cloudTestResult').textContent(), '클라우드 조회 연결 성공');
  }));
}
test('options: login/logout failure survives refresh', async () => withPage(async page => {
  await options(page); await page.locator('#login').click();
  await page.waitForFunction(() => document.getElementById('authError').textContent.includes('로그인하지 못했습니다'));
  await page.waitForFunction(() => document.getElementById('status').textContent === '로그인하지 않았습니다.');
  assert.ok((await page.locator('#authError').textContent()).includes('로그인하지 못했습니다'));
  await page.evaluate(() => { window.__signedIn = true; window.__broadcast(); }); await page.locator('#logout').waitFor({ state: 'visible' });
  await page.locator('#logout').click(); await page.waitForFunction(() => document.getElementById('authError').textContent.includes('로그아웃하지 못했습니다'));
}));
test('options: same-account token rotation keeps a cloud test; an account change invalidates it', async () => withPage(async page => {
  await options(page); await page.locator('#testCloud').click(); await page.waitForFunction(() => typeof window.__cloudTest === 'function');
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
test('popup: a signed-out account sees the login prompt and no crawl or server controls', async () => withPage(async page => {
  await page.addInitScript(() => {
    chrome.storage = { sync: { get(_key, cb) { cb({ theme: 'light' }); } }, onChanged: { addListener() {} } };
    chrome.runtime = { lastError: null, onMessage: { addListener() {} }, sendMessage(message, cb) {
      cb({ data: message.type === 'STATUS' ? { connected: false, signedIn: false, error: null } : {} });
    } };
  });
  await page.goto(url('popup.html')); await page.locator('#login').waitFor();
  for (const id of ['crawlStart', 'crawlStop', 'serverHome', 'modeBadge']) assert.equal(await page.locator('#' + id).count(), 0, id);
}, { width: 460, height: 570 }));
