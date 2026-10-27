import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const url = file => pathToFileURL(resolve(file)).href;
const fixture = name => JSON.parse(readFileSync(`contracts/my-reports/fixtures/${name}.json`, 'utf8'));
const shots = resolve('artifacts/fine-rate');

function firstPage() {
  const data = fixture('search-vehicle-first-page');
  data.managers.items = [{ ...data.managers.items[0], manager_name: '시험담당자', total: 10,
    status: { accepted: 8, partial: 1, rejected: 0, completed_unknown: 1 }, accept_rate: 80,
    disposition: { fine: 3, warning: 1, penalty: 0, none: 5, unknown: 1 },
    fine_amount: { fine_count: 3, confirmed_count: 1, confirmed_sum_won: 40000, unconfirmed_count: 2, other_count: 0 } }];
  data.managers.total_managers = 2;
  data.managers.next_cursor = 'fine-manager.signature';
  return data;
}

async function setup(page, data) {
  const next = fixture('search-vehicle-next-page'), managers = fixture('search-managers-page');
  await page.addInitScript(({ base, data, next, managers }) => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
    window.__calls = []; window.__data = data; window.__runtime = [];
    window.__clock = Date.now(); Date.now = () => window.__clock;
    chrome.storage = { sync: { get(_key, cb) { cb({ theme: 'light' }); } }, onChanged: { addListener() {} } };
    chrome.runtime = { lastError: null, getURL: name => base + name, onMessage: { addListener(fn) { window.__runtime.push(fn); } },
      sendMessage(message, respond) {
        window.__calls.push(message);
        if (message.type === 'STATUS') return respond({ data: { connected: true, signedIn: true } });
        const value = structuredClone(message.part === 'managers' ? managers : message.cursor ? next : window.__data);
        setTimeout(() => respond({ data: value }), 10);
      } };
  }, { base: url('.') + '/', data, next, managers });
  await page.goto(url('tests/fixture.html'));
  await page.addScriptTag({ url: url('shared-ui.js') });
  await page.addScriptTag({ url: url('content.js') });
  await page.locator('#add1').evaluate(el => { el.textContent = '서울특별시 종로구 예시로 1'; });
  const host = page.locator('#sr-address-panel-host');
  await host.locator('.sr-record-key').first().waitFor();
  await host.locator('summary.sr-officer-summary').click();
  return host;
}

async function withPage(run) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try { await run(await browser.newPage({ viewport: { width: 900, height: 1100 } })); }
  finally { await browser.close(); }
}

{
  test('364px address panel keeps rates, zero/unknown and long names visible in light/dark', async () => withPage(async page => {
    const data = firstPage(), p = data.managers.items[0];
    const variant = (name, total, fine) => ({ ...structuredClone(p), manager_name: name, total, disposition: { ...p.disposition, fine } });
    data.managers.items.push(variant('실제 0건', 10, 0), variant('집계 미제공', 10, undefined), variant('분모 0건', 0, 0),
      variant('담당자이름이매우길어서줄바꿈을확인하는시험담당자', 99999999, 99999999));
    data.managers.total_managers = data.managers.items.length;
    data.managers.next_cursor = null;
    const host = await setup(page, data);
    assert.ok((await host.locator('.sr-officer-rates').first().textContent()).includes('과태료처분율 30.0% (3/10건)'));
    assert.ok((await host.locator('.sr-officer-rates').nth(1).textContent()).includes('과태료처분율 0.0% (0/10건)'));
    assert.ok((await host.locator('.sr-officer-rates').nth(2).textContent()).includes('과태료처분율 —'));
    assert.ok((await host.locator('.sr-officer-rates').nth(3).textContent()).includes('과태료처분율 —'));
    mkdirSync(shots, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await host.evaluate((el, theme) => { el.dataset.srTheme = theme; }, theme);
      await host.locator('.sr-officer-section').scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const sizes = await host.evaluate(el => {
        const root = el.shadowRoot, content = root.querySelector('.sr-panel-content');
        return { width: el.getBoundingClientRect().width, scroll: content.scrollWidth, client: content.clientWidth,
          clipped: [...root.querySelectorAll('.sr-officer-rates span')].some(span => span.scrollWidth > span.clientWidth + 1 || span.getBoundingClientRect().right > content.getBoundingClientRect().right) };
      });
      assert.equal(sizes.width, 364);
      assert.ok(sizes.scroll <= sizes.client + 1 && !sizes.clipped, JSON.stringify(sizes));
      await host.screenshot({ path: resolve(shots, `cloud-364-${theme}.png`) });
    }
    assert.equal(await page.evaluate(() => window.__calls.filter(c => c.type === 'SEARCH').length), 1);
  }));

  test('address changes, cached reopening, TTL and invalidation refresh the manager rate without extra requests', async () => withPage(async page => {
    const host = await setup(page, firstPage());
    const rate = () => host.locator('.sr-officer-rates').first().textContent();
    assert.ok((await rate()).includes('80.0% (8/10건)'));
    assert.ok((await rate()).includes('30.0% (3/10건)'));
    {
      await host.locator('[data-action="more"]').click();
      await page.waitForFunction(() => document.getElementById('sr-address-panel-host').shadowRoot.querySelectorAll('.sr-record').length === 6);
      assert.ok((await rate()).includes('30.0% (3/10건)'));
      await host.locator('[data-action="more-managers"]').click();
      await page.waitForFunction(() => document.getElementById('sr-address-panel-host').shadowRoot.querySelectorAll('.sr-officer').length === 2);
      assert.ok((await rate()).includes('30.0% (3/10건)'));
      assert.ok((await host.locator('.sr-officer-rates').nth(1).textContent()).includes('50.0% (1/2건)'));
      assert.ok((await host.locator('.sr-officer').nth(1).textContent()).includes('확정 과태료 금액 없음'));
    }
    const expected = 3;
    assert.equal(await page.evaluate(() => window.__calls.filter(c => c.type === 'SEARCH').length), expected);
    await host.locator('[data-action="close"]').click(); await page.locator('#add1').click();
    assert.ok((await rate()).includes('30.0% (3/10건)'));
    assert.equal(await page.evaluate(() => window.__calls.filter(c => c.type === 'SEARCH').length), expected);
    await page.evaluate(() => {
      window.__data.managers.items[0].disposition.fine = 4;
      document.getElementById('add1').textContent = '서울특별시 종로구 변경된주소 2';
    });
    await page.waitForFunction(() => document.getElementById('sr-address-panel-host').shadowRoot.querySelector('.sr-officer-rates')?.textContent.includes('40.0% (4/10건)'));
    await host.locator('[data-action="close"]').click();
    await page.evaluate(() => {
      window.__clock += 60001;
      window.__data.managers.items[0].disposition.fine = 0;
    });
    await page.locator('#add1').click();
    await page.waitForFunction(() => document.getElementById('sr-address-panel-host').shadowRoot.querySelector('.sr-officer-rates')?.textContent.includes('0.0% (0/10건)'));
    await page.evaluate(() => {
      window.__data.managers.items[0].disposition.fine = 6;
      window.__runtime.forEach(fn => fn({ type: 'DATA_INVALIDATED' }));
    });
    await page.locator('#add1').click();
    await page.waitForFunction(() => document.getElementById('sr-address-panel-host').shadowRoot.querySelector('.sr-officer-rates')?.textContent.includes('60.0% (6/10건)'));
    const calls = await page.evaluate(() => window.__calls.filter(c => c.type === 'SEARCH'));
    assert.equal(calls.length, expected + 3);
    assert.ok(calls.slice(expected).every(c => !c.cursor && !c.part));
  }));
}
