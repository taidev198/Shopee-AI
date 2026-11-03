import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectProductPage, validateProductUrl} from '../product-detail.js';

// Minimal rendered DOM fixture. Query matching is independent of the collector,
// and preserves the heading/section/sibling relationships used by Shopee.
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = attrs;
    this.hidden = !!attrs.hidden; this.style = attrs.style || {};
    this.childNodes = children.map(child => typeof child === 'string' ? {nodeType: 3, textContent: child} : child);
    for (const child of this.childNodes) child.parentElement = this;
  }
  get children() { return this.childNodes.filter(child => child.nodeType === 1); }
  get innerText() { return this.hidden ? '' : this.childNodes.map(child => child.nodeType === 3 ? child.textContent : child.innerText).join('\n'); }
  get textContent() { return this.innerText; }
  get previousElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) - 1] || null; }
  get nextElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  getClientRects() { return this.hidden || this.style.display === 'none' ? [] : [{}]; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      const tag = part.match(/^[a-z][a-z0-9]*/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      const classes = part.match(/\.[a-z_-][a-z0-9_-]*/gi) || [];
      if (classes.some(name => !String(this.attrs.class || '').split(/\s+/).includes(name.slice(1)))) return false;
      for (const [, name, operator, expected, insensitive] of part.matchAll(/\[([\w-]+)(?:(\*=|=)"([^"]*)"(?:\s+(i))?)?\]/g)) {
        let value = this.getAttribute(name);
        if (value === null) return false;
        value = String(value);
        const matchValue = insensitive ? value.toLowerCase() : value;
        const matchExpected = insensitive ? expected?.toLowerCase() : expected;
        if (operator === '=' && matchValue !== matchExpected) return false;
        if (operator === '*=' && !matchValue.includes(matchExpected)) return false;
      }
      return !!(tag || classes.length || part.startsWith('['));
    });
  }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) { if (child.matches(selector)) result.push(child); result.push(...child.querySelectorAll(selector)); }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element; return null; }
  contains(element) { for (; element; element = element.parentElement) if (element === this) return true; return false; }
  scrollIntoView() { this.scrolled = true; }
}
const el = (tag, attrs, ...children) => new Element(tag, attrs, children);
function fixture() {
  const price = el('section', {'aria-live': 'polite'}, '94.000₫');
  const desc = el('div', {}, el('p', {}, 'Inox 304, tay cầm dài.'), el('p', {}, 'Dùng lọc sữa và rây bột.'));
  const descHeading = el('h2', {}, 'Product Description', el('button', {}, 'Sao chép sản phẩm'));
  const summary = el('section', {}, el('div', {}, el('h1', {}, "[family’s house] Rây Inox 304")),
    el('div', {}, el('button', {}, '4.9'), el('button', {}, '119', 'ratings'), el('div', {}, '1k+ Sold')),
    price, el('section', {}, 'Shipping', el('div', {}, '0₫')),
    el('section', {}, el('h2', {}, 'màu sắc'), el('div', {},
      el('button', {class: 'lK5dVS selection-box-unselected', 'aria-label': 'xanh dương nhạt'}, 'xanh dương nhạt'),
      el('button', {class: 'lK5dVS selection-box-selected', 'aria-label': 'hồng'}, 'hồng'),
      el('button', {class: 'lK5dVS selection-box-unselected', hidden: true}, 'ẩn'))));
  const image = 'https://down-vn.img.susercontent.com/file/vn-real-product';
  const gallery = el('section', {}, el('img', {src: image}), el('img', {src: image}),
    el('img', {src: 'https://down-vn.img.susercontent.com/file/logo', alt: 'shop logo'}),
    el('img', {src: 'https://evil.test/file/image'}));
  const specHeading = el('h2', {}, 'Product Specifications', el('button', {}, 'Sao chép sản phẩm'));
  const body = el('body', {}, el('section', {}, gallery, summary),
    el('section', {}, specHeading,
      el('div', {}, el('div', {}, el('h3', {}, 'Category')), el('div', {}, el('a', {}, 'Home & Living'), el('a', {}, 'Kitchen'))),
      el('div', {}, el('div', {}, el('h3', {}, 'Stock')), el('div', {}, 'IN STOCK')),
      el('div', {}, el('div', {}, el('h3', {}, 'Material')), el('div', {}, 'Stainless Steel'))),
    el('section', {}, descHeading, desc),
    el('section', {}, el('h2', {}, 'Product Ratings'), el('p', {}, 'Reviewer private display name'), el('img', {src: 'https://down-vn.img.susercontent.com/file/review-image'})));
  return {body, price, descHeading};
}
function withPage(page, callback, url = 'https://shopee.vn/product/1732066009/54155297911') {
  const previous = {document: globalThis.document, location: globalThis.location, getComputedStyle: globalThis.getComputedStyle, window: globalThis.window};
  globalThis.document = {body: page.body, querySelectorAll: selector => page.body.querySelectorAll(selector)};
  globalThis.location = {href: url};
  globalThis.getComputedStyle = element => ({display: element.style.display || 'block', visibility: element.style.visibility || 'visible'});
  globalThis.window = {innerHeight: 900, scrollBy() {}};
  try { return callback(); } finally { Object.assign(globalThis, previous); }
}
const options = {productUrl: 'https://shopee.vn/product/1732066009/54155297911', action: 'read'};

test('product URL validation preserves identity and removes tracking', () => {
  assert.equal(validateProductUrl('https://www.shopee.vn/Ray-Inox-i.1732066009.54155297911?tracking=1#reviews'), options.productUrl);
  for (const value of ['http://shopee.vn/product/1/2', 'https://shopee.vn:8443/product/1/2', 'https://u:p@shopee.vn/product/1/2',
    'https://shopee.vn.evil.test/product/1/2', 'https://shopee.vn/product/1/2/other', 'https://shopee.vn/familys_house', 'javascript:alert(1)']) assert.throws(() => validateProductUrl(value));
});

test('detail extraction scopes rendered fields to the requested product and ignores unrelated content', () => {
  withPage(fixture(), () => {
    const result = inspectProductPage(options);
    assert.equal(result.status, 'ready');
    const detail = result.detail;
    assert.equal(detail.name, '[family’s house] Rây Inox 304');
    assert.equal(detail.price_text, '94.000₫');
    assert.equal(detail.rating_text, '4.9');
    assert.equal(detail.review_count_text, '119 ratings');
    assert.equal(detail.sold_text, '1k+ Sold');
    assert.equal(detail.stock_text, 'IN STOCK');
    assert.equal(detail.description, 'Inox 304, tay cầm dài.\nDùng lọc sữa và rây bột.');
    assert.deepEqual(detail.images, ['https://down-vn.img.susercontent.com/file/vn-real-product']);
    assert.deepEqual(detail.categories, ['Home & Living', 'Kitchen']);
    assert.deepEqual(detail.attributes.map(item => item.name), ['Category', 'Stock', 'Material']);
    assert.deepEqual(detail.variants, [{name: 'màu sắc', options: ['xanh dương nhạt', 'hồng']}]);
    assert.doesNotMatch(JSON.stringify(detail), /Reviewer|review-image|Sao chép/);
  });
});

test('partial rendering waits for price and traffic/login/wrong-product pages do not produce detail', () => {
  const page = fixture(); page.price.hidden = true;
  withPage(page, () => assert.equal(inspectProductPage(options).status, 'loading'));
  withPage(fixture(), () => assert.equal(inspectProductPage(options).status, 'wrong_product'), 'https://shopee.vn/product/1732066009/999');
  for (const url of ['https://shopee.vn/verify/traffic/error?tracking=123', 'https://shopee.vn/buyer/login', 'https://evil.test/product/1732066009/54155297911']) {
    withPage(fixture(), () => { const result = inspectProductPage(options); assert.equal(result.status, 'blocked'); assert.equal(result.detail, undefined); }, url);
  }
});

test('Vietnamese labels and uppercase Đ retain product statistics', () => {
  const page = fixture();
  const replaceText = (element, value) => { element.childNodes = [{nodeType: 3, textContent: value, parentElement: element}]; };
  for (const element of page.body.querySelectorAll('div, button, h2, h3')) {
    if (element.innerText === '1k+ Sold') replaceText(element, 'Đã bán 1,2k');
    if (element.innerText === '119\nratings') replaceText(element, '119 Đánh giá');
    if (element.innerText.startsWith('Product Specifications')) replaceText(element, 'Chi tiết sản phẩm');
    if (element.innerText.startsWith('Product Description')) replaceText(element, 'Mô tả sản phẩm');
    if (element.tagName === 'H3' && element.innerText === 'Stock') replaceText(element, 'Kho hàng');
  }
  withPage(page, () => {
    const result = inspectProductPage(options);
    assert.equal(result.status, 'ready');
    assert.equal(result.detail.sold_text, 'Đã bán 1,2k');
    assert.equal(result.detail.review_count_text, '119 Đánh giá');
    assert.equal(result.detail.stock_text, 'IN STOCK');
    assert.match(result.detail.description, /Inox 304/);
  });
});

test('scrolling targets the description without activating variant or purchase controls', () => {
  const page = fixture();
  withPage(page, () => { inspectProductPage({...options, action: 'scroll'}); assert.equal(page.descHeading.scrolled, true); });
});
