import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {validateListingDraft} from '../listing.js';

const IMG = 'https://down-vn.img.susercontent.com/file/abc';

test('draft validation bounds fields and keeps only Shopee image hosts', () => {
  const draft = validateListingDraft({name: ' Hộp cơm ', description: 'x'.repeat(9000), price: '99000.4', stock: -5,
    images: [IMG, IMG, 'https://evil.example/a.jpg', 'http://down-vn.img.susercontent.com/file/x', ...Array.from({length: 20}, (_, i) => `${IMG}${i}`)],
    attributes: [{name: 'Chất liệu', value: 'Nhựa'}, {name: '', value: 'x'}], variants: [{name: 'Màu', options: ['Đỏ', '', 'Xanh']}, {name: 'Rỗng', options: []}]});
  assert.equal(draft.name, 'Hộp cơm');
  assert.equal(draft.description.length, 5000);
  assert.equal(draft.price, 99000);
  assert.equal(draft.stock, 0);
  assert.equal(draft.images.length, 9);
  assert.ok(draft.images.every(url => url.startsWith('https://down-vn.img.susercontent.com/')));
  assert.deepEqual(draft.attributes, [{name: 'Chất liệu', value: 'Nhựa'}]);
  assert.deepEqual(draft.variants, [{name: 'Màu', options: ['Đỏ', 'Xanh']}]);
});

test('draft validation rejects missing names and non-objects', () => {
  assert.throws(() => validateListingDraft(null));
  assert.throws(() => validateListingDraft([]));
  assert.throws(() => validateListingDraft({name: '   '}), /tên sản phẩm/);
});

test('listing request travels through the content bridge with its draft', async () => {
  const listeners = [];
  let sent;
  const window = {location: {origin: 'http://127.0.0.1:8000'},
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    postMessage(data, origin) { queueMicrotask(() => listeners.forEach(fn => fn({data, origin, source: window}))); }};
  window.top = window;
  const chrome = {runtime: {sendMessage: async message => { sent = message; return {ok: true, result: {opened: true}}; }}};
  const context = vm.createContext({window, chrome, location: window.location, crypto: {randomUUID}, setTimeout, clearTimeout, Map, Set, Error});
  vm.runInContext(await readFile(new URL('../bridge.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../../static/chrome-client.js', import.meta.url), 'utf8'), context);
  const result = await window.MarketLensChrome.listing({name: 'A'});
  assert.deepEqual(result, {opened: true});
  assert.equal(sent.action, 'listing');
  assert.deepEqual(sent.draft, {name: 'A'});
});

test('manifest limits Seller Centre access to the add-product pages', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const seller = manifest.content_scripts.find(item => item.js.includes('seller-fill.js'));
  assert.deepEqual(seller.matches, ['https://banhang.shopee.vn/portal/product/*']);
  assert.ok(manifest.permissions.includes('storage'));
});
