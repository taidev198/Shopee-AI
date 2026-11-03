import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

function fakeDom() {
  const nodes = new Map();
  const document = {
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    getElementById: id => nodes.get(id) || null,
    createElement() {
      const node = {attrs: {}, handlers: {}, removed: false, innerHTML: '',
        setAttribute(name, value) { this.attrs[name] = value; },
        addEventListener(type, fn) { this.handlers[type] = fn; },
        querySelector: () => null,
        remove() { this.removed = true; nodes.delete(this.id); }};
      return node;
    },
    body: {appendChild(node) { nodes.set(node.id, node); }},
  };
  return {document, nodes};
}

test('a blocked or verification reply from the extension opens the alert dialog with the next steps', async () => {
  const listeners = {};
  const {document, nodes} = fakeDom();
  const window = {location: {origin: 'http://127.0.0.1:8000'},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { (listeners[event.type] || []).forEach(fn => fn(event)); return true; },
    postMessage(data, origin) { queueMicrotask(() => (listeners.message || []).forEach(fn => fn({data, origin, source: window}))); }};
  window.top = window;
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const chrome = {runtime: {sendMessage: async () => ({ok: false, blocked: true, verificationRequired: true,
    error: 'Shopee yêu cầu xác minh hoặc đăng nhập.'})}};
  const context = vm.createContext({window, document, chrome, CustomEvent, location: window.location,
    crypto: {randomUUID}, setTimeout, clearTimeout, Map, Set, Error});
  vm.runInContext(await readFile(new URL('../bridge.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../../static/chrome-client.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../../static/verification-alert.js', import.meta.url), 'utf8'), context);
  await assert.rejects(window.MarketLensChrome.detail('https://shopee.vn/product/1/2'), error => error.blocked);
  const dialog = nodes.get('shopeeVerificationAlert');
  assert.ok(dialog, 'dialog is shown');
  assert.match(dialog.innerHTML, /tab Shopee đang được giữ mở/);
  assert.match(dialog.innerHTML, /bấm lại nút thu thập/);
  assert.equal(dialog.attrs.role, 'alertdialog');
});

test('ordinary extension errors do not open the verification dialog', async () => {
  const listeners = {};
  const {document, nodes} = fakeDom();
  const window = {location: {origin: 'http://127.0.0.1:8000'},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { (listeners[event.type] || []).forEach(fn => fn(event)); return true; },
    postMessage(data, origin) { queueMicrotask(() => (listeners.message || []).forEach(fn => fn({data, origin, source: window}))); }};
  window.top = window;
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const chrome = {runtime: {sendMessage: async () => ({ok: false, error: 'Trang chưa tải xong.'})}};
  const context = vm.createContext({window, document, chrome, CustomEvent, location: window.location,
    crypto: {randomUUID}, setTimeout, clearTimeout, Map, Set, Error});
  vm.runInContext(await readFile(new URL('../bridge.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../../static/chrome-client.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../../static/verification-alert.js', import.meta.url), 'utf8'), context);
  await assert.rejects(window.MarketLensChrome.detail('https://shopee.vn/product/1/2'));
  assert.equal(nodes.size, 0);
});
