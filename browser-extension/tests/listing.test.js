import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {validateListingDraft, validateTarget, targetForUrl, TARGETS} from '../listing.js';

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
  const result = await window.MarketLensChrome.listing({name: 'A'}, 'tiktok');
  assert.deepEqual(result, {opened: true});
  assert.equal(sent.action, 'listing');
  assert.deepEqual(sent.draft, {name: 'A'});
  assert.equal(sent.target, 'tiktok');
});

test('manifest limits Seller Centre access to the add-product pages', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const seller = manifest.content_scripts.find(item => item.js.includes('seller-fill.js'));
  assert.deepEqual(seller.matches, ['https://banhang.shopee.vn/portal/product/*', 'https://seller-vn.tiktok.com/product/*']);
  assert.ok(manifest.host_permissions.includes('https://seller-vn.tiktok.com/*'));
  assert.ok(manifest.permissions.includes('storage'));
});

test('copy screen embeds the shared Chrome shop scan as market data with details enabled', async () => {
  const source = await readFile(new URL('../../static/listing-clone.js', import.meta.url), 'utf8');
  assert.match(source, /<form class="form" data-crawl data-lc-scan>/);
  assert.match(source, /name="role" value="market"/);
  assert.match(source, /name="browser_mode" value="chrome"/);
  assert.equal((source.match(/name="read_details"/g) || []).length, 1);
  for (const id of ['crawlFeedback', 'crawlDetailProgress', 'stopCrawlDetails']) assert.ok(source.includes(`id="${id}"`));
});

test('targets are whitelisted and recognised by seller-centre url', () => {
  assert.equal(validateTarget(undefined), 'shopee');
  assert.equal(validateTarget('tiktok'), 'tiktok');
  assert.throws(() => validateTarget('lazada'), /không được hỗ trợ/);
  assert.throws(() => validateTarget('__proto__'), /không được hỗ trợ/);
  assert.equal(targetForUrl('https://seller-vn.tiktok.com/product/create'), 'tiktok');
  assert.equal(targetForUrl('https://banhang.shopee.vn/portal/product/new'), 'shopee');
  assert.equal(targetForUrl('https://seller-vn.tiktok.com.evil.example/product/create'), null);
  assert.equal(targetForUrl('http://banhang.shopee.vn/portal/product/new'), null);
  assert.equal(targetForUrl('https://banhang.shopee.vn/portal/order'), null);
  assert.ok(TARGETS.tiktok.url.startsWith('https://seller-vn.tiktok.com/'));
});

test('draft video is kept only from Shopee hosts', () => {
  assert.equal(validateListingDraft({name: 'a', video: 'https://down-vn.vod.susercontent.com/v/a.mp4'}).video, 'https://down-vn.vod.susercontent.com/v/a.mp4');
  assert.equal(validateListingDraft({name: 'a', video: 'https://evil.example/a.mp4'}).video, '');
  assert.equal(validateListingDraft({name: 'a'}).video, '');
});
