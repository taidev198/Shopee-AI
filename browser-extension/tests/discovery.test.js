import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {inspectSearchPage, inspectProductSeller, inspectShopProfile, validateDiscoveryQuery, validateSellerLink} from '../discovery.js';

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.hidden = !!attrs.hidden;
    this.children = children.filter(child => typeof child !== 'string');
    this.parts = children;
    for (const child of this.children) child.parentElement = this;
  }
  get innerText() { return this.hidden ? '' : this.parts.map(child => typeof child === 'string' ? child : child.innerText).join('\n'); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  getClientRects() { return this.hidden || this.attrs.display === 'contents' ? [] : [{}]; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      const tag = part.match(/^[a-z][a-z0-9]*/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      const classes = part.match(/\.[a-z_-][a-z0-9_-]*/gi) || [];
      if (classes.some(value => !String(this.attrs.class || '').split(/\s+/).includes(value.slice(1)))) return false;
      for (const [, name, operator, expected, insensitive] of part.matchAll(/\[([\w-]+)(?:(\*=|\^=|=)"([^"]*)"(?:\s+(i))?)?\]/g)) {
        let value = this.getAttribute(name);
        if (value === null) return false;
        value = insensitive ? String(value).toLowerCase() : String(value);
        const expectedValue = insensitive ? expected?.toLowerCase() : expected;
        if (operator === '=' && value !== expectedValue) return false;
        if (operator === '*=' && !value.includes(expectedValue)) return false;
        if (operator === '^=' && !value.startsWith(expectedValue)) return false;
      }
      return !!(tag || classes.length || part.startsWith('['));
    });
  }
  closest(selector) { for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element; return null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const el = (tag, attrs, ...children) => new Element(tag, attrs, children);
function withDOM(body, url, callback) {
  const previous = {document: globalThis.document, location: globalThis.location, getComputedStyle: globalThis.getComputedStyle, window: globalThis.window};
  globalThis.document = {body, querySelectorAll: selector => body.querySelectorAll(selector)};
  globalThis.location = {href: url};
  globalThis.getComputedStyle = element => ({display: element.attrs.display || 'block', visibility: 'visible'});
  globalThis.window = {innerHeight: 900, scrollBy() {}};
  try { return callback(); } finally { Object.assign(globalThis, previous); }
}
const searchUrl = 'https://shopee.vn/search?keyword=r%C3%A2y%20l%E1%BB%8Dc%20inox';
const query = 'rây lọc inox';
const productUrl = 'https://shopee.vn/product/644790874/53313728005';

test('discovery validates bounded query text and only public seller references', () => {
  assert.equal(validateDiscoveryQuery('  rây   lọc inox  '), query);
  for (const value of ['', 'a', 'x'.repeat(101), null, {query}, 'bad\u0000query']) assert.throws(() => validateDiscoveryQuery(value));
  assert.equal(validateSellerLink('https://shopee.vn/nhabepxinh?categoryId=0&entryPoint=ShopByPDP', '644790874'), 'https://shopee.vn/nhabepxinh');
  assert.equal(validateSellerLink('https://shopee.vn/shop/644790874?itemId=123', '644790874'), 'https://shopee.vn/shop/644790874');
  for (const url of ['https://shopee.vn/shop/999', 'https://shopee.vn/?itemId=123', 'https://shopee.vn/search?q=x', 'http://shopee.vn/shop_name',
    'https://shopee.vn.evil.test/shop_name', 'https://u:p@shopee.vn/shop_name', 'https://shopee.vn:8443/shop_name', 'javascript:alert(1)']) assert.throws(() => validateSellerLink(url, '644790874'));
});

test('search discovery reads displayed product cards, excludes ads, shop banners, recommendations and duplicate product IDs', () => {
  const card = (seller, id, name, extra = {}) => el('div', {class: 'shopee-search-item-result__item'},
    el('div', {role: 'group', 'aria-label': `Product card: ${name}`},
      el('a', {href: `/product/${seller}/${id}?tracking=1`, display: 'contents'},
        ...(extra.ad ? ['Ad'] : []), el('img', {alt: name}), el('h3', {}, name), '94.000₫')));
  const body = el('body', {},
    el('section', {}, el('a', {href: '/product/999/999'}, 'Shop quảng cáo ngoài kết quả')),
    el('section', {class: 'shopee-search-item-result'}, card(1, 1, 'Rây lọc quảng cáo', {ad: true}),
      card(644790874, 53313728005, 'Rây lọc inox 304'), card(644790874, 53313728005, 'Bản trùng'),
      el('aside', {}, card(2, 2, 'Gợi ý không liên quan')),
      el('a', {href: 'https://evil.test/product/3/3'}, 'Không phải Shopee')));
  withDOM(body, searchUrl, () => {
    const result = inspectSearchPage({query, action: 'read'});
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.cards, [{url: productUrl, seller_id: '644790874', product_id: '53313728005', name: 'Rây lọc inox 304'}]);
  });
});

test('search stops on verification/login and does not read products from another keyword', () => {
  const body = el('body', {}, el('p', {}, 'Đang tải'));
  withDOM(body, 'https://shopee.vn/verify/traffic/error', () => assert.equal(inspectSearchPage({query}).status, 'blocked'));
  withDOM(body, 'https://shopee.vn/buyer/login', () => assert.equal(inspectSearchPage({query}).status, 'blocked'));
  withDOM(body, 'https://shopee.vn/search?keyword=giay', () => assert.equal(inspectSearchPage({query}).status, 'wrong_search'));
  withDOM(body, searchUrl, () => assert.equal(inspectSearchPage({query}).status, 'loading'));
  withDOM(el('body', {}, el('a', {href: '/product/1/2'}, 'Sản phẩm ngoài vùng kết quả')), searchUrl,
    () => assert.equal(inspectSearchPage({query}).status, 'loading'));
});

function sellerDOM(href = '/nhabepxinh?categoryId=0&entryPoint=ShopByPDP&itemId=53313728005') {
  const link = el('a', {href}, el('img', {alt: 'icon shop'}), el('div', {}, 'view shop'));
  return {link, body: el('body', {}, el('section', {}, el('h1', {}, 'Rây lọc inox 304')),
    el('div', {class: 'qUOitL'}, el('div', {class: 'KBEZs0'}, 'Nhà Bếp Xinh'), el('p', {}, 'Active 1 hour ago'),
      el('div', {}, el('button', {}, 'Chat now'), link)),
    el('section', {class: 'recommendations'}, el('a', {href: '/unrelated'}, 'view shop')))};
}
test('seller discovery uses actual View Shop link and visible seller name from the product seller panel', () => {
  const {body} = sellerDOM();
  withDOM(body, productUrl, () => {
    const result = inspectProductSeller({productUrl, action: 'read'});
    assert.deepEqual(result, {status: 'ready', seller_id: '644790874', shop_url: 'https://shopee.vn/nhabepxinh', name: 'Nhà Bếp Xinh'});
  });
});

test('seller skeleton and wrong seller references are loading; unrelated products and blocked pages are rejected', () => {
  for (const href of ['/?categoryId=0&entryPoint=ShopByPDP', '/shop/12345', 'https://evil.test/nhabepxinh']) {
    withDOM(sellerDOM(href).body, productUrl, () => assert.equal(inspectProductSeller({productUrl}).status, 'loading'));
  }
  withDOM(sellerDOM('/shop/644790874?itemId=53313728005').body, productUrl, () => {
    assert.equal(inspectProductSeller({productUrl}).shop_url, 'https://shopee.vn/shop/644790874');
  });
  withDOM(sellerDOM().body, productUrl, () => assert.equal(inspectProductSeller({productUrl: 'https://shopee.vn/product/1/2'}).status, 'wrong_product'));
  withDOM(sellerDOM().body, 'https://shopee.vn/verify/traffic/error', () => assert.equal(inspectProductSeller({productUrl}).status, 'blocked'));
});

test('numeric seller URL waits for a real canonical profile after navigation', () => {
  const body = el('body', {}, el('h1', {}, 'Nhà Bếp Xinh'));
  withDOM(body, 'https://shopee.vn/shop/644790874', () => assert.equal(inspectShopProfile({sellerId: '644790874'}).status, 'loading'));
  withDOM(body, 'https://shopee.vn/nhabepxinh?categoryId=0', () => assert.deepEqual(inspectShopProfile({sellerId: '644790874'}),
    {status: 'ready', shop_url: 'https://shopee.vn/nhabepxinh', name: 'Nhà Bếp Xinh'}));
  withDOM(body, 'https://shopee.vn/verify/traffic/error', () => assert.equal(inspectShopProfile({sellerId: '644790874'}).status, 'blocked'));
});

test('app and content bridge forward each discovery query and preserve partial-block results', async () => {
  const listeners = [];
  const messages = [];
  const window = {location: {origin: 'http://127.0.0.1:8000'},
    addEventListener(type, callback) { if (type === 'message') listeners.push(callback); },
    postMessage(data, origin) { queueMicrotask(() => listeners.forEach(callback => callback({data, origin, source: window}))); }};
  window.top = window;
  const chrome = {runtime: {sendMessage: async message => {
    messages.push(message);
    return {ok: true, result: {query: message.query, candidates: [], errors: ['Xác minh'], blocked: true}};
  }}};
  const context = vm.createContext({window, chrome, location: window.location, crypto: {randomUUID}, setTimeout, clearTimeout, Map, Set, Error});
  vm.runInContext(await readFile(new URL('../bridge.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../../static/chrome-client.js', import.meta.url), 'utf8'), context);
  const result = await window.MarketLensChrome.discover(query, 'https://shopee.vn/familys_house');
  assert.equal(result.query, query);
  assert.equal(result.blocked, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, 'discover');
  assert.equal(messages[0].ownShopUrl, 'https://shopee.vn/familys_house');
});

test('discovery traverses bounded distinct sellers, excludes own shop and closes only its task tab', async () => {
  let listener;
  let created = 500;
  const tabs = new Map();
  const updates = [];
  const removed = [];
  const injected = [];
  let blockSeller = '';
  const previous = globalThis.chrome;
  globalThis.chrome = {
    runtime: {id: 'discovery-extension', getManifest: () => ({version: '1.2.0'}), onMessage: {addListener(callback) { listener = callback; }}},
    tabs: {
      async create({url}) { const id = ++created; tabs.set(id, url); return {id}; },
      async get(id) { return {id, status: 'complete', url: tabs.get(id)}; },
      async update(id, {url}) { updates.push(url); tabs.set(id, url); return {id}; },
      async remove(id) { removed.push(id); tabs.delete(id); },
    },
    scripting: {async executeScript({target, func}) {
      injected.push(func.name);
      const url = tabs.get(target.tabId);
      if (func.name === 'inspectSearchPage') return [{result: {status: 'ready', cards: [
        {url: 'https://shopee.vn/product/10/1', name: 'Rây của shop mình'},
        {url: 'https://shopee.vn/product/10/2', name: 'Trùng người bán'},
        {url: 'https://shopee.vn/product/20/1', name: 'Rây inox shop Hai'},
        {url: 'https://shopee.vn/product/30/1', name: 'Rây inox shop Ba'},
        {url: 'https://shopee.vn/product/40/1', name: 'Không đọc quá ba người bán'},
      ]}}];
      const seller = new URL(url).pathname.split('/')[2];
      if (seller === blockSeller) return [{result: {status: 'blocked', error: 'Shopee yêu cầu xác minh'}}];
      return [{result: {status: 'ready', seller_id: seller, shop_url: `https://shopee.vn/${seller === '10' ? 'own_shop' : `shop_${seller}`}`,
        name: `Shop ${seller}`}}];
    }},
  };
  try {
    await import(`../background.js?discover=${randomUUID()}`);
    const sender = {id: 'discovery-extension', frameId: 0, url: 'http://127.0.0.1:8000/', tab: {windowId: 1}};
    const request = data => new Promise(resolve => listener({source: 'marketlens-bridge', requestId: randomUUID(), ...data}, sender, resolve));
    assert.equal((await request({action: 'ping'})).result.capabilities.discover, true);
    const first = await request({action: 'discover', query, ownShopUrl: 'https://shopee.vn/own_shop'});
    assert.equal(first.ok, true);
    assert.deepEqual(first.result.candidates.map(candidate => candidate.url), ['https://shopee.vn/shop_20', 'https://shopee.vn/shop_30']);
    assert.equal(first.result.candidates[0].product_url, 'https://shopee.vn/product/20/1');
    assert.ok(first.result.candidates.every(candidate => candidate.query === query));
    assert.equal(updates.length, 3);
    assert.deepEqual(removed, [501]);
    blockSeller = '30';
    const partial = await request({action: 'discover', query, ownShopUrl: 'https://shopee.vn/own_shop'});
    assert.equal(partial.ok, true);
    assert.equal(partial.result.blocked, true);
    assert.equal(partial.result.candidates.length, 1);
    assert.equal(partial.result.verificationRequired, true);
    assert.equal(partial.result.verificationTabId, 502);
    assert.equal(partial.result.verificationUrl, 'https://shopee.vn/product/30/1');
    blockSeller = '10';
    const blocked = await request({action: 'discover', query, ownShopUrl: 'https://shopee.vn/own_shop'});
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.verificationRequired, true);
    assert.equal(blocked.verificationTabId, 503);
    const invalid = await request({action: 'discover', query: 'x', ownShopUrl: 'https://shopee.vn/own_shop'});
    assert.equal(invalid.ok, false);
    assert.equal(created, 503);
    assert.deepEqual(removed, [501]);
    assert.equal(tabs.has(502), true);
    assert.equal(tabs.has(503), true);
    assert.ok(injected.every(name => ['inspectSearchPage', 'inspectProductSeller'].includes(name)));
  } finally { globalThis.chrome = previous; }
});
