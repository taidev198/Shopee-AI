export function validateDiscoveryQuery(value) {
  if (typeof value !== 'string') throw new Error('Từ khóa tìm đối thủ không hợp lệ.');
  const query = value.replace(/\s+/g, ' ').trim();
  if (query.length < 2 || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new Error('Từ khóa tìm đối thủ phải dài từ 2 đến 100 ký tự.');
  }
  return query;
}

// Only a public seller link rendered on a product page may supply a shop URL.
// Numeric shop links must be followed normally; never guess a seller username.
export function validateSellerLink(value, sellerId) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Liên kết shop không hợp lệ.'); }
  if (url.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(url.hostname) ||
      url.port || url.username || url.password) throw new Error('Liên kết shop phải ở trên Shopee VN.');
  const path = url.pathname.replace(/\/+$/, '');
  if (/^\/shop\/[1-9]\d*$/.test(path)) {
    if (path !== `/shop/${sellerId}`) throw new Error('Liên kết shop không trùng người bán của sản phẩm.');
    return `https://shopee.vn${path}`;
  }
  const username = path.slice(1);
  const reserved = new Set(['search', 'mall', 'buyer', 'seller', 'product', 'api', 'cart', 'login', 'verify', 'captcha', 'checkout']);
  if (!/^[a-z0-9_.-]{2,80}$/i.test(username) || reserved.has(username.toLowerCase())) {
    throw new Error('Chưa đọc được liên kết trang chủ shop.');
  }
  return `https://shopee.vn/${username}`;
}

// Injected functions deliberately contain every helper. They read rendered DOM
// only and never query private endpoints, cookies, page stores, or network logs.
export function inspectSearchPage(options) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return style.display === 'contents' ? [...element.children].some(visible) : element.getClientRects().length > 0;
  };
  const current = new URL(location.href);
  const fail = (status, error) => ({status, error, cards: []});
  if (current.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(current.hostname) || current.port || current.username || current.password) {
    return fail('blocked', 'Tab tìm đối thủ đã rời Shopee.');
  }
  const bodyText = clean(document.body?.innerText).slice(0, 12000);
  if (/\/(?:verify|captcha)(?:\/|$)/i.test(current.pathname) ||
      /(?:unusual traffic|verify you are human|xác minh bạn là con người|lưu lượng truy cập bất thường)/i.test(bodyText) ||
      [...document.querySelectorAll('iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha-container" i]')].some(visible)) {
    return fail('blocked', 'Shopee yêu cầu xác minh hoặc chặn lưu lượng. Đã dừng tìm đối thủ.');
  }
  if (/\/(?:buyer\/)?login(?:\/|$)/i.test(current.pathname) || [...document.querySelectorAll('input[type="password"]')].some(visible)) {
    return fail('blocked', 'Shopee yêu cầu đăng nhập. Hãy đăng nhập trong Chrome rồi tìm đối thủ lại.');
  }
  if (current.pathname.replace(/\/+$/, '') !== '/search' ||
      clean(current.searchParams.get('keyword')).toLowerCase() !== clean(options.query).toLowerCase()) {
    return fail('wrong_search', 'Shopee chưa mở đúng từ khóa tìm đối thủ.');
  }
  const parse = value => {
    try {
      const url = new URL(value, current.href);
      if (url.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(url.hostname) || url.port || url.username || url.password) return null;
      const ids = url.pathname.match(/^\/product\/([1-9]\d*)\/([1-9]\d*)\/?$/)?.slice(1) ||
        url.pathname.match(/^\/[^/]+-i\.([1-9]\d*)\.([1-9]\d*)\/?$/)?.slice(1);
      return ids ? {url: `https://shopee.vn/product/${ids[0]}/${ids[1]}`, seller_id: ids[0], product_id: ids[1]} : null;
    } catch { return null; }
  };
  const useful = value => {
    const result = clean(value).replace(/^Product card\s*:?\s*/i, '');
    return result.length > 1 && /\p{L}/u.test(result) && !/^(?:shopee|logo|avatar|voucher|icon)\b/i.test(result) ? result.slice(0, 300) : '';
  };
  const selector = '.shopee-search-item-result__items, .shopee-search-item-result, [data-sqe="search-results"], [data-sqe="search-result"]';
  const listingRoots = [...document.querySelectorAll(selector)].filter(visible);
  if (!listingRoots.length) return {status: 'loading', query: options.query, cards: []};
  const roots = listingRoots;
  const cards = [];
  const seen = new Set();
  for (const root of roots) for (const link of root.querySelectorAll('a[href]')) {
    const product = parse(link.getAttribute('href'));
    if (!product || !visible(link) || seen.has(product.url) ||
        link.closest('[class*="recommend" i], [data-sqe="recommendation"], aside, header, footer, nav')) continue;
    const card = link.closest('[role="group"][aria-label^="Product card:"], [data-sqe="item"], .shopee-search-item-result__item') || link;
    if (/^(?:Ad|Ads|Quảng cáo)\s*$/i.test(String(card.innerText || '').split('\n').map(clean).find(Boolean) || '')) continue;
    let name = useful(card.getAttribute('aria-label')) || useful(link.getAttribute('aria-label')) || useful(link.getAttribute('title'));
    if (!name) for (const image of card.querySelectorAll('img[alt]')) {
      name = useful(image.getAttribute('alt')); if (name) break;
    }
    if (!name) for (const title of card.querySelectorAll('[data-sqe="name"], h2, h3, [class*="line-clamp"], [title]')) {
      name = useful(title.getAttribute('title') || title.innerText); if (name) break;
    }
    if (!name) name = String(card.innerText || '').split('\n').map(useful).find(value => value && !/[₫đ]|\bVND\b|^giảm\b|^đánh giá\b/i.test(value)) || '';
    if (!name || !clean(card.innerText)) continue;
    seen.add(product.url);
    cards.push({...product, name});
    if (cards.length >= 6) break;
  }
  if (options.action === 'scroll') window.scrollBy({top: Math.max(500, window.innerHeight * 0.7), behavior: 'instant'});
  return {status: cards.length ? 'ready' : 'loading', query: options.query, cards: cards.slice(0, 6)};
}

export function inspectProductSeller(options) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const label = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const visible = element => {
    if (!element || element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return style.display === 'contents' ? [...element.children].some(visible) : element.getClientRects().length > 0;
  };
  const current = new URL(location.href);
  const fail = (status, error) => ({status, error});
  if (current.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(current.hostname) || current.port || current.username || current.password) {
    return fail('blocked', 'Trang sản phẩm tìm đối thủ đã rời Shopee.');
  }
  const bodyText = clean(document.body?.innerText).slice(0, 12000);
  if (/\/(?:verify|captcha)(?:\/|$)/i.test(current.pathname) ||
      /(?:unusual traffic|verify you are human|xác minh bạn là con người|lưu lượng truy cập bất thường)/i.test(bodyText) ||
      [...document.querySelectorAll('iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha-container" i]')].some(visible)) {
    return fail('blocked', 'Shopee yêu cầu xác minh hoặc chặn lưu lượng. Đã dừng tìm đối thủ.');
  }
  if (/\/(?:buyer\/)?login(?:\/|$)/i.test(current.pathname) || [...document.querySelectorAll('input[type="password"]')].some(visible)) {
    return fail('blocked', 'Shopee yêu cầu đăng nhập. Hãy đăng nhập trong Chrome rồi tìm đối thủ lại.');
  }
  const ids = current.pathname.match(/^\/product\/([1-9]\d*)\/([1-9]\d*)\/?$/)?.slice(1) ||
    current.pathname.match(/^\/[^/]+-i\.([1-9]\d*)\.([1-9]\d*)\/?$/)?.slice(1);
  const expected = new URL(options.productUrl).pathname.match(/^\/product\/([1-9]\d*)\/([1-9]\d*)\/?$/)?.slice(1);
  if (!ids || !expected || ids.join('.') !== expected.join('.')) return fail('wrong_product', 'Shopee chưa mở đúng sản phẩm dùng để xác minh đối thủ.');
  if (![...document.querySelectorAll('h1')].some(element => visible(element) && clean(element.innerText))) return {status: 'loading'};
  const validLink = anchor => {
    try {
      const url = new URL(anchor.getAttribute('href'), current.href);
      if (url.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(url.hostname) || url.port || url.username || url.password) return null;
      const path = url.pathname.replace(/\/+$/, '');
      if (/^\/shop\/[1-9]\d*$/.test(path)) return path === `/shop/${ids[0]}` ? `https://shopee.vn${path}` : null;
      const username = path.slice(1);
      if (!/^[a-z0-9_.-]{2,80}$/i.test(username) || /^(?:search|mall|buyer|seller|product|api|cart|login|verify|captcha|checkout)$/i.test(username)) return null;
      return `https://shopee.vn/${username}`;
    } catch { return null; }
  };
  const shopRoots = [...document.querySelectorAll('.page-product__shop, .product-shop, [data-sqe="shop-info"], [data-sqe="seller-info"], .qUOitL')].filter(visible);
  const roots = shopRoots.length ? shopRoots : [document];
  for (const root of roots) for (const anchor of root.querySelectorAll('a[href]')) {
    if (!visible(anchor) || anchor.closest('[class*="recommend" i], [data-sqe="recommendation"], aside, header, footer, nav')) continue;
    const anchorLabel = label(anchor.innerText || anchor.getAttribute('aria-label'));
    const hasShopLabel = /^(?:view shop|visit shop|shop now|xem shop|xem cua hang|tham quan shop)$/.test(anchorLabel);
    if (!hasShopLabel && !shopRoots.length) continue;
    const shopUrl = validLink(anchor);
    if (!shopUrl) continue;
    let sellerRoot = root === document ? anchor.closest('section') || anchor.parentElement?.parentElement : root;
    if (sellerRoot?.querySelector('h1')) sellerRoot = anchor.parentElement?.parentElement;
    if (sellerRoot?.querySelector('h1')) sellerRoot = anchor.parentElement;
    if (!sellerRoot) continue;
    let name = [...sellerRoot.querySelectorAll('.page-product__shop-name, .shopee-seller-portrait__name, .KBEZs0, h2, h3')]
      .filter(visible).map(element => clean(element.innerText)).find(value => value && !/^(?:view shop|xem shop)$/i.test(value)) || '';
    if (!name) for (const candidate of sellerRoot.querySelectorAll('a[href]')) {
      const value = clean(candidate.innerText);
      if (visible(candidate) && validLink(candidate) === shopUrl && value &&
          !/^(?:view shop|visit shop|shop now|xem shop|xem cua hang|chat now|chat ngay)$/i.test(label(value))) { name = value; break; }
    }
    if (!name) name = String(sellerRoot.innerText || '').split(/\n/).map(clean).find(value => value &&
      !/^(?:view shop|visit shop|chat now|xem shop|chat ngay|active\b|online\b|hoạt động\b|ratings?\b|products?\b|response\b|followers?\b|following\b|joined\b|đánh giá\b|sản phẩm\b)/i.test(label(value))) || '';
    return {status: 'ready', seller_id: ids[0], shop_url: shopUrl, name: name.slice(0, 120)};
  }
  if (options.action === 'scroll') window.scrollBy({top: Math.max(500, window.innerHeight * 0.6), behavior: 'instant'});
  return {status: 'loading'};
}

export function inspectShopProfile(options) {
  const current = new URL(location.href);
  const visible = element => {
    if (!element || element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return style.display === 'contents' ? [...element.children].some(visible) : element.getClientRects().length > 0;
  };
  if (current.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(current.hostname) || current.port || current.username || current.password) {
    return {status: 'blocked', error: 'Trang shop đã rời Shopee.'};
  }
  if (/\/(?:verify|captcha|(?:buyer\/)?login)(?:\/|$)/i.test(current.pathname) ||
      [...document.querySelectorAll('input[type="password"], iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha-container" i]')].some(visible)) {
    return {status: 'blocked', error: 'Shopee yêu cầu xác minh hoặc đăng nhập. Đã dừng tìm đối thủ.'};
  }
  const username = current.pathname.replace(/^\/|\/+$/g, '');
  if (!/^[a-z0-9_.-]{2,80}$/i.test(username) || /^(?:search|mall|buyer|seller|product|api|cart|login|verify|captcha|checkout)$/i.test(username)) return {status: 'loading'};
  const name = [...document.querySelectorAll('.section-seller-overview__item, .shopee-seller-portrait__name, .shop-page__seller-name, h1')]
    .filter(visible).map(element => String(element.innerText || '').replace(/\s+/g, ' ').trim()).find(Boolean) || username;
  return {status: 'ready', shop_url: `https://shopee.vn/${username}`, name: name.slice(0, 120)};
}

// Reads the displayed result cards of one Shopee keyword search with the public
// price and sold counter, so a product can be compared against the whole
// marketplace. Rendered DOM only; no private endpoints, cookies or network logs.
export function inspectSearchResults(options) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return style.display === 'contents' ? [...element.children].some(visible) : element.getClientRects().length > 0;
  };
  const current = new URL(location.href);
  const fail = (status, error) => ({status, error, cards: []});
  if (current.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(current.hostname) || current.port || current.username || current.password) {
    return fail('blocked', 'Tab tìm sản phẩm tương tự đã rời Shopee.');
  }
  const bodyText = clean(document.body?.innerText).slice(0, 12000);
  if (/\/(?:verify|captcha)(?:\/|$)/i.test(current.pathname) ||
      /(?:unusual traffic|verify you are human|xác minh bạn là con người|lưu lượng truy cập bất thường)/i.test(bodyText) ||
      [...document.querySelectorAll('iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha-container" i]')].some(visible)) {
    return fail('blocked', 'Shopee yêu cầu xác minh hoặc chặn lưu lượng. Đã dừng tìm sản phẩm tương tự.');
  }
  if (/\/(?:buyer\/)?login(?:\/|$)/i.test(current.pathname) || [...document.querySelectorAll('input[type="password"]')].some(visible)) {
    return fail('blocked', 'Shopee yêu cầu đăng nhập. Hãy đăng nhập trong Chrome rồi tìm lại.');
  }
  if (current.pathname.replace(/\/+$/, '') !== '/search' ||
      clean(current.searchParams.get('keyword')).toLowerCase() !== clean(options.query).toLowerCase()) {
    return fail('wrong_search', 'Shopee chưa mở đúng từ khóa tìm kiếm.');
  }
  const parse = value => {
    try {
      const url = new URL(value, current.href);
      if (url.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(url.hostname) || url.port || url.username || url.password) return null;
      const ids = url.pathname.match(/^\/product\/([1-9]\d*)\/([1-9]\d*)\/?$/)?.slice(1) ||
        url.pathname.match(/^\/[^/]+-i\.([1-9]\d*)\.([1-9]\d*)\/?$/)?.slice(1);
      return ids ? {url: `https://shopee.vn/product/${ids[0]}/${ids[1]}`, seller_id: ids[0], product_id: ids[1]} : null;
    } catch { return null; }
  };
  const useful = value => {
    const result = clean(value).replace(/^Product card\s*:?\s*/i, '');
    return result.length > 1 && /\p{L}/u.test(result) && !/^(?:shopee|logo|avatar|voucher|icon)\b/i.test(result) ? result.slice(0, 300) : '';
  };
  const amount = (digits, unit) => {
    if (!digits) return null;
    const multiplier = {k: 1e3, tr: 1e6, m: 1e6}[String(unit || '').toLowerCase()];
    const number = multiplier ? parseFloat(digits.replace(',', '.')) * multiplier : Number(digits.replace(/[.,]/g, ''));
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  };
  const priceOf = (text, name) => {
    // Per line, skipping the title: a title ending in a number must not merge with the price line below it.
    const lines = text.split('\n').map(clean).filter(line => line && line !== name && !line.includes(name));
    const prices = lines.flatMap(line => [...line.matchAll(/(?:₫\s*(\d{1,3}(?:\.\d{3})+|\d+)|(\d{1,3}(?:\.\d{3})+|\d+)\s*₫)/g)]
      .map(match => Number((match[1] || match[2]).replace(/\./g, '')))).filter(value => value > 0);
    return prices.length ? Math.min(...prices) : null;
  };
  const soldOf = text => {
    const match = text.match(/đã bán\s*([\d.,]+)\s*(k|tr|m)?\s*(\+)?/i) || text.match(/([\d.,]+)\s*(k|tr|m)?\s*(\+)?\s*đã bán/i);
    return match ? {sold_total: amount(match[1], match[2]), sold_text: clean(match[0]), sold_lower_bound: !!match[3]} : {sold_total: null, sold_text: '', sold_lower_bound: false};
  };
  const selector = '.shopee-search-item-result__items, .shopee-search-item-result, [data-sqe="search-results"], [data-sqe="search-result"]';
  const roots = [...document.querySelectorAll(selector)].filter(visible);
  if (!roots.length) return {status: 'loading', query: options.query, cards: []};
  const limit = Math.max(1, Math.min(40, Number(options.limit) || 24));
  const cards = [];
  const seen = new Set();
  for (const root of roots) for (const link of root.querySelectorAll('a[href]')) {
    const product = parse(link.getAttribute('href'));
    if (!product || !visible(link) || seen.has(product.url) ||
        link.closest('[class*="recommend" i], [data-sqe="recommendation"], aside, header, footer, nav')) continue;
    const card = link.closest('[role="group"][aria-label^="Product card:"], [data-sqe="item"], .shopee-search-item-result__item') || link;
    const text = String(card.innerText || '');
    if (/^(?:Ad|Ads|Quảng cáo)\s*$/i.test(text.split('\n').map(clean).find(Boolean) || '')) continue;
    let name = useful(card.getAttribute('aria-label')) || useful(link.getAttribute('aria-label')) || useful(link.getAttribute('title'));
    if (!name) for (const image of card.querySelectorAll('img[alt]')) { name = useful(image.getAttribute('alt')); if (name) break; }
    if (!name) for (const title of card.querySelectorAll('[data-sqe="name"], h2, h3, [class*="line-clamp"], [title]')) {
      name = useful(title.getAttribute('title') || title.innerText); if (name) break;
    }
    if (!name || !clean(text)) continue;
    seen.add(product.url);
    cards.push({...product, name, price: priceOf(text, name), ...soldOf(text)});
    if (cards.length >= limit) break;
  }
  if (options.action === 'scroll') window.scrollBy({top: Math.max(900, window.innerHeight * 1.2), behavior: 'instant'});
  return {status: cards.length ? 'ready' : 'loading', query: options.query, cards};
}
