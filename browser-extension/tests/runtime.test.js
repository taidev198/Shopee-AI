import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {inspectShopPage, isAllowedAppUrl, validateShopUrl} from '../collector.js';

test('extension accepts only local app origins and canonical public shops', () => {
  assert.equal(isAllowedAppUrl('http://127.0.0.1:8000/'), true);
  assert.equal(isAllowedAppUrl('https://evil.test/'), false);
  assert.equal(isAllowedAppUrl('http://127.0.0.1:9000/'), false);
  assert.equal(validateShopUrl('https://shopee.vn/test_shop'), 'https://shopee.vn/test_shop');
  for (const url of ['https://shopee.vn/verify', 'https://shopee.vn/login', 'https://shopee.vn/test_shop?next=evil', 'http://shopee.vn/test_shop']) {
    assert.throws(() => validateShopUrl(url));
  }
});

test('real Shopee display-contents links are read when their children are visible', () => {
  const previous = {document: globalThis.document, location: globalThis.location, getComputedStyle: globalThis.getComputedStyle};
  const child = {hidden: false, children: [], closest: () => null, getClientRects: () => [{}], display: 'block'};
  const link = {hidden: false, children: [child], closest: () => null, getClientRects: () => [], display: 'contents',
    getAttribute: name => ({href: '/product/1/2', 'aria-label': 'Áo thun'})[name] || null,
    innerText: 'Áo thun\n₫89.000\n39 sold', querySelectorAll: () => []};
  const root = {hidden: false, children: [link], closest: () => null, display: 'block', getClientRects: () => [{}],
    querySelectorAll: selector => selector === 'a[href]' ? [link] : []};
  let pageCounter = '1/2';
  const arrow = {...child, disabled: false, className: 'shopee-mini-page-controller__next-btn', innerText: '',
    hasAttribute: () => false, getAttribute: () => null};
  const pagination = {...child, get innerText() { return pageCounter; }, querySelectorAll: () => [arrow]};
  globalThis.document = {body: {innerText: 'Shop sản phẩm'}, querySelectorAll: selector =>
    selector.startsWith('.shop-search-result-view,') ? [root] :
      selector.startsWith('.shopee-page-controller,') ? [pagination] : []};
  globalThis.location = {href: 'https://shopee.vn/test_shop'};
  globalThis.getComputedStyle = element => ({display: element.display, visibility: 'visible'});
  try {
    const result = inspectShopPage({shopUrl: 'https://shopee.vn/test_shop', action: 'read'});
    assert.equal(result.status, 'ready');
    assert.equal(result.cards.length, 1);
    assert.equal(result.cards[0].name, 'Áo thun');
    assert.equal(result.cards[0].href, 'https://shopee.vn/product/1/2');
    assert.equal(result.hasNext, true);
    // Shopee's bottom arrow can remain enabled at the last page. The visible
    // page counter must win so a completed capture does not time out on page 3.
    pageCounter = '2/2';
    assert.equal(inspectShopPage({shopUrl: 'https://shopee.vn/test_shop', action: 'read'}).hasNext, false);
  } finally { Object.assign(globalThis, previous); }
});

test('app and content bridge return fresh results on each click, rejecting other origins', async () => {
  const listeners = [];
  const calls = [];
  let livePrice = 89000;
  const window = {
    location: {origin: 'http://127.0.0.1:8000'},
    addEventListener(type, callback) { if (type === 'message') listeners.push(callback); },
    postMessage(data, origin) {
      queueMicrotask(() => listeners.forEach(callback => callback({data, origin, source: window})));
    },
  };
  window.top = window;
  const chrome = {runtime: {sendMessage: async message => {
    calls.push(message);
    if (message.action === 'detail') return livePrice < 0 ? {ok: false, blocked: true, error: 'Shopee yêu cầu xác minh'} :
      {ok: true, result: {detail: {url: message.url, name: 'Áo thun', price_text: `₫${livePrice}`, description: 'Mô tả đang hiển thị'}}};
    return message.action === 'ping' ? {ok: true, result: {version: '1.0.0'}} :
      {ok: true, result: {pages: [{url: message.url, cards: [{href: '/product/1/2', name: 'Áo thun', text: `₫${livePrice}`}]}]}};
  }}};
  const context = vm.createContext({window, chrome, location: window.location, crypto: {randomUUID}, setTimeout, clearTimeout, Map, Set, Error});
  vm.runInContext(await readFile(new URL('../bridge.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../../static/chrome-client.js', import.meta.url), 'utf8'), context);
  assert.equal((await window.MarketLensChrome.ping()).version, '1.0.0');
  const first = await window.MarketLensChrome.collect('https://shopee.vn/test_shop');
  livePrice = 97000;
  const second = await window.MarketLensChrome.collect('https://shopee.vn/test_shop');
  assert.equal(first.pages[0].cards[0].text, '₫89000');
  assert.equal(second.pages[0].cards[0].text, '₫97000');
  const detail = await window.MarketLensChrome.detail('https://shopee.vn/product/1/2');
  assert.equal(detail.detail.price_text, '₫97000');
  livePrice = -1;
  await assert.rejects(window.MarketLensChrome.detail('https://shopee.vn/product/1/2'), error => error.blocked && error.code === 'blocked');
  const before = calls.length;
  for (const listener of listeners) listener({source: window, origin: 'https://evil.test', data: {source: 'marketlens-app', requestId: 'bad', action: 'collect'}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, before);
});

test('each detail request closes successful task tabs, retains manual verification, and allows explicit resume', async () => {
  let listener;
  let created = 100;
  let blocked = false;
  const tabs = new Map();
  const removed = [];
  const injections = [];
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {id: 'detail-extension', onMessage: {addListener(callback) { listener = callback; }}},
    tabs: {
      async create({url}) { const id = ++created; tabs.set(id, url); return {id}; },
      async get(id) { return {id, status: 'complete', url: tabs.get(id)}; },
      async remove(id) { removed.push(id); tabs.delete(id); },
    },
    scripting: {async executeScript({target, func, args}) {
      injections.push({name: func.name, url: args[0].productUrl, action: args[0].action});
      return [{result: blocked ? {status: 'blocked', error: 'Shopee yêu cầu xác minh'} : {
        status: 'ready', detail: {url: tabs.get(target.tabId), name: 'Sản phẩm ' + target.tabId,
          price_text: '94.000₫', description: 'Mô tả đọc trực tiếp'},
      }}];
    }},
  };
  try {
    await import(`../background.js?details=${randomUUID()}`);
    const sender = {id: 'detail-extension', frameId: 0, url: 'http://127.0.0.1:8000/', tab: {windowId: 1}};
    const detail = url => new Promise(resolve => {
      assert.equal(listener({source: 'marketlens-bridge', requestId: randomUUID(), action: 'detail', url}, sender, resolve), true);
    });
    const first = await detail('https://shopee.vn/product/173/541');
    const second = await detail('https://shopee.vn/product/173/542');
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.notEqual(first.result.detail.name, second.result.detail.name);
    assert.equal(first.result.detail.url, 'https://shopee.vn/product/173/541');
    assert.equal(second.result.detail.url, 'https://shopee.vn/product/173/542');
    assert.ok(injections.every(x => x.name === 'inspectProductPage'));
    assert.deepEqual(injections.filter(x => x.action === 'scroll').map(x => x.url),
      ['https://shopee.vn/product/173/541', 'https://shopee.vn/product/173/542']);
    blocked = true;
    const failure = await detail('https://shopee.vn/product/173/543');
    assert.equal(failure.ok, false);
    assert.equal(failure.blocked, true);
    assert.equal(failure.verificationRequired, true);
    assert.equal(failure.verificationTabId, 103);
    assert.equal(failure.verificationUrl, 'https://shopee.vn/product/173/543');
    assert.match(failure.error, /Tab Shopee được giữ mở/);
    assert.deepEqual(removed, [101, 102]);
    assert.equal(tabs.has(103), true);
    blocked = false;
    const resumed = await detail('https://shopee.vn/product/173/543');
    assert.equal(resumed.ok, true);
    assert.deepEqual(removed, [101, 102, 104]);
    assert.equal(tabs.has(103), true);
    const invalid = await detail('https://evil.test/product/173/541');
    assert.equal(invalid.ok, false);
    assert.equal(created, 104);
  } finally { globalThis.chrome = originalChrome; }
});

test('service worker traverses pages anew per request and closes only its task tabs', async () => {
  let listener;
  let page = 0;
  let livePrice = 89000;
  let created = 0;
  const removed = [];
  const url = 'https://shopee.vn/test_shop';
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {id: 'test-extension', onMessage: {addListener(callback) { listener = callback; }}},
    tabs: {
      async create() { page = 0; return {id: ++created}; },
      async get(id) { return {id, status: 'complete', url}; },
      async remove(id) { removed.push(id); },
    },
    scripting: {async executeScript({args}) {
      const action = args[0].action;
      const snapshot = {status: 'ready', url, cards: [{href: `https://shopee.vn/product/1/${page + 1}`, name: 'Áo thun', text: `₫${livePrice}`}], signature: `page-${page}`, hasNext: page === 0};
      if (action === 'next') { page++; return [{result: {...snapshot, clicked: true}}]; }
      return [{result: snapshot}];
    }},
  };
  try {
    await import(`../background.js?test=${randomUUID()}`);
    const sender = {id: 'test-extension', frameId: 0, url: 'http://127.0.0.1:8000/', tab: {windowId: 1}};
    const collect = () => new Promise(resolve => {
      assert.equal(listener({source: 'marketlens-bridge', requestId: randomUUID(), action: 'collect', url}, sender, resolve), true);
    });
    const first = await collect();
    assert.equal(first.ok, true);
    assert.equal(first.result.pages.length, 2);
    livePrice = 97000;
    const second = await collect();
    assert.equal(second.ok, true);
    assert.equal(second.result.pages[0].cards[0].text, '₫97000');
    assert.deepEqual(removed, [1, 2]);
  } finally { globalThis.chrome = originalChrome; }
});

test('isAllowedAppUrl accepts the Render deployment only over https with the exact host', () => {
  assert.equal(isAllowedAppUrl('https://shopee-ai.onrender.com/user'), true);
  assert.equal(isAllowedAppUrl('http://shopee-ai.onrender.com/'), false);
  assert.equal(isAllowedAppUrl('https://shopee-ai.onrender.com.evil.example/'), false);
});
