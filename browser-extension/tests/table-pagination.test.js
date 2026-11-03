import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../static/table-pagination.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../static/table-pagination.css', import.meta.url), 'utf8');
const camel = value => value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase(); this.attrs = {...attrs}; this.children = []; this.dataset = {};
    this.listeners = {}; this.hidden = false; this.disabled = false; this.value = '';
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[camel(key.slice(5))] = value;
    this.classList = {contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, on) => {const set = new Set(this.className.split(/\s+/).filter(Boolean)); if (on ?? !set.has(name)) set.add(name); else set.delete(name); this.className = [...set].join(' ');},
      remove: name => this.classList.toggle(name, false)};
    this.append(...children);
  }
  get className() {return this.attrs.class || '';}
  set className(value) {this.attrs.class = value;}
  get id() {return this.attrs.id || '';}
  get isConnected() {return !!this.connected || !!this.parentElement?.isConnected;}
  get textContent() {return (this._text || '') + this.children.map(child => child.textContent).join('');}
  set textContent(value) {this._text = String(value); this.children.forEach(child => child.parentElement = null); this.children = [];}
  get tBodies() {return this.children.filter(child => child.tagName === 'TBODY');}
  get rows() {return this.children.filter(child => child.tagName === 'TR');}
  get cells() {return this.children.filter(child => child.tagName === 'TD' || child.tagName === 'TH');}
  get colSpan() {return Number(this.attrs.colspan) || 1;}
  getAttribute(name) {return this.attrs[name] ?? (name.startsWith('data-') ? this.dataset[camel(name.slice(5))] : null) ?? null;}
  setAttribute(name, value) {this.attrs[name] = String(value); if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = String(value);}
  hasAttribute(name) {return this.getAttribute(name) !== null;}
  append(...children) {for (const child of children) {child.parentElement = this; this.children.push(child);}}
  replaceChildren(...children) {this.children.forEach(child => child.parentElement = null); this.children = []; this.append(...children);}
  after(child) {const siblings = this.parentElement.children; child.parentElement = this.parentElement; siblings.splice(siblings.indexOf(this) + 1, 0, child);}
  remove() {if (this.parentElement) {const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null;}}
  contains(node) {return node === this || this.children.some(child => child.contains(node));}
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      const terms = part.split(/\s+(?![^[]*\])/);
      if (terms.length > 1) return this.matches(terms.pop()) && !!this.parentElement?.closest(terms.join(' '));
      const tag = part.match(/^[a-z][a-z0-9]*/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      for (const name of part.match(/\.[a-z_-][a-z0-9_-]*/gi) || []) if (!this.classList.contains(name.slice(1))) return false;
      for (const [, name, expected] of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(name) || (expected !== undefined && this.getAttribute(name) !== expected)) return false;
      }
      return true;
    });
  }
  closest(selector) {for (let item = this; item; item = item.parentElement) if (item.matches(selector)) return item; return null;}
  querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  addEventListener(name, listener) {(this.listeners[name] ||= []).push(listener);}
  removeEventListener(name, listener) {this.listeners[name] = (this.listeners[name] || []).filter(item => item !== listener);}
}
const el = (tag, attrs = {}, ...children) => new Element(tag, attrs, children);
const text = (tag, value, attrs = {}) => {const node = el(tag, attrs); node.textContent = value; return node;};
function table(count, attrs = {}) {
  const body = el('tbody', {}, ...Array.from({length: count}, (_, index) =>
    el('tr', {'data-pagination-id': String(index + 1)}, text('td', `Sản phẩm ${index + 1}`), text('td', 'Đang chờ'))));
  return el('table', {class: 'data-table', 'data-pagination-key': 'products', ...attrs},
    el('thead', {}, el('tr', {}, text('th', 'Tên'), text('th', 'Trạng thái'))), body);
}
function setup(...contents) {
  const root = el('div', {id: 'viewContainer', 'data-pagination-view': 'products', 'data-pagination-scope': 'own'}, ...contents);
  root.connected = true;
  const document = {readyState: 'complete', createElement: tag => el(tag), getElementById: id => id === 'viewContainer' ? root : null,
    querySelector: () => null, addEventListener() {}};
  const observers = [];
  class Observer {constructor(callback) {this.callback = callback; observers.push(this);} disconnect() {} observe() {}}
  const window = {};
  const context = vm.createContext({window, document, MutationObserver: Observer, queueMicrotask, Map, Set, Array, Number, JSON, String, Math});
  vm.runInContext(source, context);
  const refresh = () => window.MarketLensPagination.refresh();
  const event = (type, target) => {let prevented = false; for (const listener of root.listeners[type] || []) listener({target, preventDefault() {prevented = true;}}); return prevented;};
  const click = action => event('click', root.querySelector(`[data-pagination-action="${action}"]`));
  const visible = target => target.tBodies[0].rows.filter(row => !row.classList.contains('ml-pagination-hidden'));
  return {root, context, window, refresh, event, click, visible, observers};
}

test('range and state handle empty, final, changed dataset and remembered custom size', () => {
  const {context} = setup();
  const state = (previous, ids, filter = '', size) => {Object.assign(context, {previous, ids, filter, size}); return vm.runInContext('marketPaginationState(previous,ids,filter,size)', context);};
  const ids = Array.from({length: 43}, (_, i) => String(i));
  let current = state(null, ids);
  assert.equal(current.size, 20); assert.equal(current.pages, 3);
  current.page = 3; context.current = current;
  assert.equal(vm.runInContext('marketPaginationRange(current).label', context), '41–43 / 43');
  assert.equal(state(current, ids).page, 3);
  assert.equal(state(current, ids, 'filtered').page, 1);
  assert.equal(state(current, ids.slice(0, 20)).page, 1);
  current.size = 50;
  assert.equal(state(current, ids, '', 10).size, 50);
  const empty = state(null, []); context.empty = empty;
  assert.equal(vm.runInContext('marketPaginationRange(empty).label', context), '0–0 / 0');
});

test('table navigation hides rows, disables bounds and preserves the underlying action DOM', () => {
  const target = table(43), ui = setup(el('div', {class: 'table-wrap'}, target));
  assert.equal(ui.visible(target).length, 20);
  assert.equal(ui.root.querySelector('[data-pagination-action="first"]').disabled, true);
  assert.equal(ui.click('last'), true);
  assert.deepEqual(ui.visible(target).map(row => row.dataset.paginationId), ['41', '42', '43']);
  assert.equal(ui.root.querySelector('[data-pagination-action="next"]').disabled, true);
  ui.click('prev'); assert.equal(ui.visible(target)[0].dataset.paginationId, '21');
  ui.click('first'); assert.equal(ui.visible(target)[0].dataset.paginationId, '1');
  assert.equal(target.tBodies[0].rows.length, 43);
  assert.match(css, /\.ml-pagination-hidden\{display:none!important\}/);
});

test('rerender and tab switching remember page/size while changing row status does not reset the page', () => {
  let target = table(65); const wrap = el('div', {class: 'table-wrap'}, target), ui = setup(wrap);
  ui.click('next');
  target.tBodies[0].rows[0].cells[1].textContent = 'Đã lưu 10/20 sản phẩm';
  ui.refresh(); assert.equal(ui.visible(target)[0].dataset.paginationId, '21');
  target = table(65); wrap.replaceChildren(target); ui.refresh();
  assert.equal(ui.visible(target)[0].dataset.paginationId, '21');
  const select = ui.root.querySelector('[data-pagination-size]'); select.value = '50'; ui.event('change', select);
  assert.equal(ui.visible(target).length, 50);
  ui.click('next'); assert.equal(ui.visible(target).length, 15);
  ui.root.dataset.paginationView = 'imports'; ui.root.replaceChildren(table(4)); ui.refresh();
  ui.root.dataset.paginationView = 'products'; target = table(65); ui.root.replaceChildren(target); ui.refresh();
  assert.equal(ui.visible(target)[0].dataset.paginationId, '51');
  assert.equal(ui.root.querySelector('[data-pagination-size]').value, '50');
});

test('automatic data refresh keeps the current page when new products arrive and clamps it when removed',()=>{
 const first=table(65), ui=setup(first);
 ui.click('next');
 const updated=table(70);ui.root.replaceChildren(updated);ui.refresh();
 assert.equal(ui.visible(updated)[0].dataset.paginationId,'21');
 ui.click('last');
 const shortened=table(25);ui.root.replaceChildren(shortened);ui.refresh();
 assert.equal(ui.visible(shortened)[0].dataset.paginationId,'21');
 assert.match(ui.root.querySelector('.ml-pagination-page').textContent,/Trang 2 \/ 2/);
});

test('dataset filters reset page without discarding the selected page size', async () => {
  const target = table(45), filter = el('input', {class: 'search', id: 'productSearch'}), ui = setup(filter, target);
  ui.click('last'); filter.value = 'Tên sản phẩm'; ui.event('input', filter);
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(ui.visible(target)[0].dataset.paginationId, '1');
  ui.click('last'); target.tBodies[0].replaceChildren(...target.tBodies[0].rows.slice(0, 8)); ui.refresh();
  assert.equal(ui.visible(target).length, 8);
  assert.match(ui.root.querySelector('.ml-pagination-count').textContent, /1–8 \/ 8/);
});

test('independent explicit lists paginate only marked cards and keep headings visible', () => {
  const heading = text('h4', 'Kết quả mô hình');
  const list = el('div', {'data-pagination-list': '', 'data-pagination-key': 'ml', 'data-pagination-size': '10'}, heading,
    ...Array.from({length: 12}, (_, index) => text('article', `Sản phẩm ${index}`, {'data-pagination-item': '', 'data-pagination-id': String(index)})));
  const ui = setup(list);
  assert.equal(list.children.filter(row => row.classList.contains('ml-pagination-hidden')).length, 2);
  assert.equal(heading.classList.contains('ml-pagination-hidden'), false);
  ui.click('next');
  assert.equal(list.children.filter(row => row.hasAttribute('data-pagination-item') && !row.classList.contains('ml-pagination-hidden')).length, 2);
  const select=ui.root.querySelector('select[data-pagination-size]'); select.value='50'; ui.event('change',select); ui.refresh();
  assert.equal(select.value,'50');
  assert.equal(list.children.filter(row => row.hasAttribute('data-pagination-item') && !row.classList.contains('ml-pagination-hidden')).length,12);
});

test('tables within one view have independent pagination and size controls', () => {
  const own=table(45,{'data-pagination-key':'own'}), market=table(35,{'data-pagination-key':'market'});
  const ui=setup(own,market), controls=ui.root.querySelectorAll('.ml-pagination');
  ui.event('click',controls[0].querySelector('[data-pagination-action="next"]'));
  assert.equal(ui.visible(own)[0].dataset.paginationId,'21');
  assert.equal(ui.visible(market)[0].dataset.paginationId,'1');
  const select=controls[1].querySelector('[data-pagination-size]'); select.value='10'; ui.event('change',select); ui.refresh();
  assert.equal(ui.visible(market).length,10);
  assert.equal(ui.visible(own)[0].dataset.paginationId,'21');
  assert.equal(ui.visible(own).length,20);
});

test('native competitor pagination and explicitly opted-out content are never enhanced', () => {
  const competitor = table(30, {class: 'data-table competitor-products'});
  const opted = table(30, {'data-pagination': 'off'});
  const nested = table(30), offPanel = el('section', {'data-pagination': 'off'}, nested);
  const ui = setup(competitor, opted, offPanel);
  assert.equal(ui.root.querySelectorAll('.ml-pagination').length, 0);
  assert.equal(ui.visible(competitor).length, 30);
  assert.equal(ui.visible(opted).length, 30);
  assert.equal(ui.visible(nested).length, 30);
});

test('init is safe to call repeatedly and refresh does not duplicate toolbars or observer work', () => {
  const target = table(1), ui = setup(target);
  ui.window.MarketLensPagination.init(); ui.refresh(); ui.refresh();
  assert.equal(ui.root.querySelectorAll('.ml-pagination').length, 1);
  assert.equal(ui.observers.length, 1);
  assert.equal(ui.root.listeners.click.length, 1);
  assert.equal(ui.root.querySelector('.ml-pagination').hidden, false);
});
