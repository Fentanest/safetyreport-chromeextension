import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Run the actual content controller with deterministic DOM/event/timer doubles.
// No browser process or socket is needed; these tests cover behavior, not layout.
function content({ vehicle = '', address = '', addressInput = false, checked = false, hold = false } = {}) {
  const ids = new Map(), timers = new Map(), observers = [], calls = [], pending = [];
  let now = 0, serial = 0;
  class Node {
    constructor(id, value) {
      this.id = id; this.isConnected = true; this.listeners = new Map();
      this.textContent = ''; this.dataset = {}; this.style = { removeProperty() {} };
      this.classList = { toggle() {} }; this.children = [];
      if (value !== undefined) this.value = value;
    }
    addEventListener(type, fn, options = {}) {
      const handlers = this.listeners.get(type) || [];
      handlers.push({ fn, signal: options.signal }); this.listeners.set(type, handlers);
    }
    emit(type, event = {}) {
      for (const { fn, signal } of this.listeners.get(type) || []) if (!signal?.aborted) fn({ target: this, ...event });
    }
    append(node) { this.children.push(node); if (node.id) ids.set(node.id, node); }
    attachShadow() { return this.root = new Node(); }
    setAttribute() {}
    querySelector() { return null; }
    getBoundingClientRect() { return { left: 30, top: 100, right: 270, bottom: 135 }; }
  }
  const document = new Node(), window = new Node();
  document.body = new Node(); document.documentElement = new Node(); document.hidden = false;
  document.createElement = () => new Node(); document.getElementById = id => ids.get(id) || null;
  const input = new Node('VHRNO', vehicle), addr = new Node('add1', addressInput ? address : undefined);
  if (!addressInput) addr.textContent = address;
  const checkbox = new Node('chkNoVhrNo'); checkbox.checked = checked;
  for (const node of [input, addr, checkbox]) ids.set(node.id, node);
  const schedule = (fn, delay, repeat = false) => { const id = ++serial; timers.set(id, { fn, at: now + delay, delay, repeat }); return id; };
  const data = JSON.parse(readFileSync('contracts/my-reports/fixtures/search-empty.json', 'utf8'));
  const context = vm.createContext({ document, window, AbortController, innerWidth: 1200, innerHeight: 900,
    Date: class extends Date { static now() { return now; } },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(node) { this.node = node; } disconnect() { this.node = null; } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: fn => schedule(fn, 16), setTimeout: schedule, clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    chrome: { storage: { sync: { get: (_key, cb) => cb({}) }, onChanged: { addListener() {} } },
      runtime: { getURL: name => name, onMessage: { addListener() {} }, sendMessage(message, cb) {
        calls.push(message); if (hold) pending.push(cb); else cb({ data });
      } } },
  });
  vm.runInContext(readFileSync('shared-ui.js', 'utf8'), context);
  vm.runInContext(readFileSync('content.js', 'utf8'), context);
  const app = {
    input, addr, checkbox, calls, pending, document, window,
    visible: kind => ids.get(`sr-${kind}-panel-host`)?.hidden === false,
    html: kind => ids.get(`sr-${kind}-panel-host`)?.root.children.at(-1).innerHTML || '',
    close(kind) { ids.get(`sr-${kind}-panel-host`).root.emit('click', { target: { closest: () => ({ dataset: { action: 'close' } }) } }); },
    mutate(node) { for (const observer of observers) if (observer.node === node || observer.node === document.documentElement) observer.fn(); },
    replace(id, value, asInput = true) {
      ids.get(id).isConnected = false;
      const node = new Node(id, asInput ? value : undefined); if (!asInput) node.textContent = value;
      ids.set(id, node); app.mutate(document.documentElement); return node;
    },
    async tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, t] = next; now = t.at; timers.delete(id);
        if (t.repeat) timers.set(id, { ...t, at: now + t.delay });
        t.fn(); await Promise.resolve(); await Promise.resolve();
      }
      now = end; await Promise.resolve();
    },
  };
  return app;
}

test('content: 3/4 normalized characters open without a second click; debounce sends only final query and shows real zero', async () => {
  const app = content(); app.input.emit('focus');
  app.input.value = '590'; app.input.emit('input'); await app.tick(800);
  assert.equal(app.visible('vehicle'), false); assert.equal(app.calls.length, 0);
  app.input.value = ' 5 902 '; app.input.emit('input');
  assert.equal(app.visible('vehicle'), true); await app.tick(400);
  app.input.value = '5903'; app.input.emit('input'); await app.tick(599);
  assert.equal(app.calls.length, 0); await app.tick(1);
  assert.deepEqual(app.calls.map(c => c.query), ['5903']);
  assert.match(app.html('vehicle'), /이 차량으로 내 신고가 없습니다/);
  await app.tick(3000); assert.equal(app.calls.length, 1);
});

test('content: no-vehicle checkbox cancels pending search; clearing it reopens the current value', async () => {
  const app = content({ vehicle: '5902', checked: true }); await app.tick(1000);
  assert.equal(app.visible('vehicle'), false); assert.equal(app.calls.length, 0);
  app.checkbox.checked = false; app.document.emit('change', { target: app.checkbox });
  assert.equal(app.visible('vehicle'), true); await app.tick(200);
  app.checkbox.checked = true; app.document.emit('change', { target: app.checkbox });
  await app.tick(1000); assert.equal(app.calls.length, 0); assert.equal(app.visible('vehicle'), false);
  app.checkbox.checked = false; await app.tick(1000);
  assert.equal(app.visible('vehicle'), true); assert.equal(app.calls.length, 1);
});

for (const kind of ['vehicle', 'address']) test(`content: ${kind} dismissal persists for same normalized value, changes reopen, fresh cache is reused`, async () => {
  const app = content(kind === 'vehicle' ? { vehicle: '5902' } : { address: '서울 종로구 예시로 1', addressInput: true });
  const node = kind === 'vehicle' ? app.input : app.addr;
  await app.tick(1000); app.close(kind);
  node.value = ` ${node.value} `; node.emit('input'); await app.tick(1000);
  assert.equal(app.visible(kind), false); assert.equal(app.calls.length, 1);
  node.emit('click'); assert.equal(app.visible(kind), true); await app.tick(1000);
  assert.equal(app.calls.length, 1);
  app.close(kind); node.value += '2'; node.emit('input');
  assert.equal(app.visible(kind), true); await app.tick(1000); assert.equal(app.calls.length, 2);
});

test('content: address text mutation, input/change events and silent picker value assignment all reopen', async () => {
  const app = content(); app.addr.textContent = '서울 종로구 예시로 1'; app.mutate(app.addr);
  assert.equal(app.visible('address'), true); await app.tick(1000); app.close('address');
  app.addr.textContent += '2'; app.mutate(app.addr); assert.equal(app.visible('address'), true);
  await app.tick(1000);
  const input = app.replace('add1', '부산 중구 예시로 1'); await app.tick(1000);
  app.close('address'); input.value = '부산 중구 예시로 2'; input.emit('change');
  assert.equal(app.visible('address'), true); await app.tick(1000);
  app.close('address'); input.value = '부산 중구 예시로 3'; await app.tick(300);
  assert.equal(app.visible('address'), true); await app.tick(700);
  assert.deepEqual(app.calls.map(c => c.query), ['서울 종로구 예시로 1', '서울 종로구 예시로 12', '부산 중구 예시로 1', '부산 중구 예시로 2', '부산 중구 예시로 3']);
});

test('content: SPA replacement and hash navigation reread both prefilled nodes without focus', async () => {
  const app = content({ vehicle: '5902', address: '서울 종로구 예시로 1' }); await app.tick(1000);
  app.close('vehicle'); app.close('address'); app.window.emit('hashchange'); await app.tick(1000);
  assert.equal(app.visible('vehicle'), true); assert.equal(app.visible('address'), true);
  const old = app.input;
  app.replace('VHRNO', '5903'); app.replace('add1', '부산 중구 예시로 1', false); await app.tick(1000);
  assert.equal(app.visible('vehicle'), true); assert.equal(app.visible('address'), true);
  assert.equal(app.calls.length, 6);
  old.value = '9999'; old.emit('input'); await app.tick(1000); assert.equal(app.calls.length, 6);
});

test('content: IME composition waits for completion, silent value changes and visibility restoration are detected', async () => {
  const app = content(); app.input.emit('compositionstart'); app.input.value = '5902'; app.input.emit('input');
  await app.tick(1000); assert.equal(app.calls.length, 0);
  app.input.emit('compositionend'); await app.tick(600); assert.equal(app.calls.length, 1);
  app.close('vehicle'); app.document.hidden = true; app.input.value = '5903'; await app.tick(1000);
  assert.equal(app.visible('vehicle'), false);
  app.document.hidden = false; app.document.emit('visibilitychange'); await app.tick(1000);
  assert.equal(app.visible('vehicle'), true); assert.equal(app.calls.length, 2);
});

test('content: late responses cannot reopen a dismissed or newly ineligible vehicle', async () => {
  const app = content({ vehicle: '5902', hold: true }); await app.tick(600);
  app.close('vehicle'); app.pending.shift()({ data: { summary: { total: 99 } } }); await app.tick(1);
  assert.equal(app.visible('vehicle'), false); assert.doesNotMatch(app.html('vehicle'), /99건/);
  app.input.value = '5903'; app.input.emit('input'); await app.tick(600);
  app.input.value = '590'; app.input.emit('input');
  app.pending.shift()({ data: { summary: { total: 99 } } }); await app.tick(1);
  assert.equal(app.visible('vehicle'), false); assert.doesNotMatch(app.html('vehicle'), /99건/);
});
