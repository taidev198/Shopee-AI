export function isAllowedAppUrl(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password &&
      ['http://127.0.0.1:8000', 'http://localhost:8000'].includes(url.origin);
  } catch { return false; }
}

export function validateShopUrl(value) {
  let url;
  try { url = new URL(typeof value === 'string' ? value.trim() : ''); }
  catch { throw new Error('URL phải có dạng https://shopee.vn/ten_shop.'); }
  const username = url.pathname.replace(/^\/+|\/+$/g, '');
  const reserved = new Set(['search', 'mall', 'buyer', 'seller', 'product', 'api', 'cart', 'login', 'verify', 'captcha', 'checkout']);
  if (url.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash ||
      !/^[a-z0-9_.-]{2,80}$/i.test(username) || reserved.has(username.toLowerCase())) {
    throw new Error('Chỉ hỗ trợ trang chủ shop dạng https://shopee.vn/ten_shop, không kèm tham số.');
  }
  return `https://shopee.vn/${username}`;
}

// Chrome serializes this function when injecting it. Keep every DOM helper inside
// the function, and do not read network responses, page internals, or cookies.
export function inspectShopPage(options) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const expected = new URL(options.shopUrl);
  const current = new URL(location.href);
  const result = {url: current.href, cards: [], signature: '', hasNext: false};
  const failure = (status, error) => ({...result, status, error});
  const visible = element => {
    if (!element || element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // Shopee product links use `display: contents`: their children have layout
    // boxes, but the link itself deliberately has no client rectangles.
    if (style.display === 'contents') return [...element.children].some(visible);
    return element.getClientRects().length > 0;
  };
  if (current.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(current.hostname)) {
    return failure('blocked', 'Tab đã rời Shopee. Lượt quét dừng và không lưu sản phẩm.');
  }
  const bodyText = clean(document.body?.innerText).slice(0, 12000);
  if (/\/(?:verify|captcha)(?:\/|$)/i.test(current.pathname) ||
      /(?:unusual traffic|verify you are human|xác minh bạn là con người|lưu lượng truy cập bất thường)/i.test(bodyText) ||
      [...document.querySelectorAll('iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha-container" i]')].some(visible)) {
    return failure('blocked', 'Shopee yêu cầu xác minh hoặc chặn lưu lượng ngay trong Chrome. Hãy xử lý trên Shopee rồi quét lại; tiện ích đã dừng.');
  }
  if (/\/(?:buyer\/)?login(?:\/|$)/i.test(current.pathname) ||
      [...document.querySelectorAll('input[type="password"]')].some(visible)) {
    return failure('blocked', 'Shopee yêu cầu đăng nhập. Hãy đăng nhập bằng Chrome thường dùng rồi bấm Quét lại.');
  }
  if (current.pathname.replace(/\/+$/g, '').toLowerCase() !== expected.pathname.toLowerCase()) {
    return failure('wrong_shop', 'Shopee không mở đúng shop đã chọn. Lượt quét dừng để tránh lưu sản phẩm từ trang khác.');
  }
  const itemId = href => {
    try {
      const url = new URL(href, current.href);
      if (url.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(url.hostname)) return null;
      return url.pathname.match(/-i\.(\d+)\.(\d+)(?:\b|\/)/)?.slice(1) ||
        url.pathname.match(/^\/product\/(\d+)\/(\d+)(?:\b|\/)/)?.slice(1) || null;
    } catch { return null; }
  };
  const usefulName = value => {
    const name = clean(value).replace(/^Product card\s*:?\s*/i, '');
    return name.length > 1 && /\p{L}/u.test(name) &&
      !/^(?:shopee\b|logo\b|avatar\b|voucher\b|icon\b|đã bán\b|sold\b)/i.test(name) ? name.slice(0, 300) : '';
  };
  const listingSelector = '.shop-search-result-view, .shop-all-product-view, .shop-page__all-products-section, [data-sqe="shop-products"]';
  const listingRoots = [...document.querySelectorAll(listingSelector)].filter(visible);
  const roots = listingRoots.length ? listingRoots : [document];
  const seen = new Set();
  for (const root of roots) for (const link of root.querySelectorAll('a[href]')) {
    const ids = itemId(link.getAttribute('href'));
    if (!ids || !visible(link) || seen.has(ids.join('.'))) continue;
    if (link.closest('[class*="recommend" i], [data-sqe="recommendation"], aside')) continue;
    let card = link;
    const parent = link.closest('[role="group"][aria-label^="Product card:"], [data-sqe="item"], .shop-search-result-view__item, .shopee-search-item-result__item, .shopee-search-item-result');
    if (parent) {
      const distinct = new Set([...parent.querySelectorAll('a[href]')].map(a => itemId(a.getAttribute('href'))?.join('.')).filter(Boolean));
      if (distinct.size === 1) card = parent;
    }
    const namedGroup = link.closest('[role="group"][aria-label^="Product card:"]');
    let name = usefulName(namedGroup?.getAttribute('aria-label')) ||
      usefulName(link.getAttribute('aria-label')) || usefulName(card.getAttribute('aria-label'));
    if (!name) for (const img of card.querySelectorAll('img[alt]')) {
      name = usefulName(img.getAttribute('alt'));
      if (name) break;
    }
    if (!name) for (const element of [link, ...card.querySelectorAll('[data-sqe="name"], [class*="line-clamp"], [title]')]) {
      name = usefulName(element.getAttribute('title') || (element === link ? '' : element.innerText));
      if (name) break;
    }
    const text = clean(card.innerText);
    if (!name) name = (card.innerText || '').split('\n').map(usefulName)
      .find(line => line && !/[₫đ]|\bVND\b|^giảm\b|^đánh giá\b/i.test(line)) || '';
    if (!name || !text) continue;
    seen.add(ids.join('.'));
    const href = new URL(link.getAttribute('href'), current.href);
    href.hash = '';
    result.cards.push({href: href.href, name, text: text.slice(0, 5000)});
    if (result.cards.length >= 150) break;
  }
  result.signature = result.cards.map(card => itemId(card.href).join('.')).sort().join('|');

  const disabled = button => button.disabled || button.hasAttribute('disabled') ||
    button.getAttribute('aria-disabled') === 'true' || /(?:^|\s)[\w-]*disabled[\w-]*(?:\s|$)/i.test(button.className || '');
  const controls = [...document.querySelectorAll('.shopee-page-controller, .shopee-mini-page-controller, nav[aria-label*="pagination" i], [role="navigation"][aria-label*="pagination" i], [data-testid*="pagination" i]')].filter(visible);
  const pageCounter = controls.map(controller => clean(controller.innerText).match(/^(\d+)\s*\/\s*(\d+)$/)).find(Boolean);
  const atLastPage = pageCounter && Number(pageCounter[1]) >= Number(pageCounter[2]);
  // Unknown wrappers qualify only when they contain multiple numbered page
  // buttons and an explicitly labelled next control, never a general shop CTA.
  for (const button of document.querySelectorAll('button[aria-label], button[title]')) {
    if (!/^(?:next(?: page)?|trang (?:sau|tiếp)|kế tiếp|sau)$/i.test(clean(button.getAttribute('aria-label') || button.getAttribute('title')))) continue;
    let parent = button.parentElement;
    for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
      const numbers = [...parent.querySelectorAll('button')].filter(b => /^\d+$/.test(clean(b.innerText)));
      if (numbers.length >= 2 && visible(parent)) { controls.push(parent); break; }
    }
  }
  let next = null;
  for (const controller of atLastPage ? [] : controls) {
    const buttons = [...controller.querySelectorAll('button, a[href], [role="button"]')].filter(visible);
    const active = buttons.find(button => button.getAttribute('aria-current') === 'page' ||
      button.getAttribute('aria-selected') === 'true' || /(?:shopee-button-solid--primary|(?:^|\s)active(?:\s|$))/.test(button.className || ''));
    const pageNumber = Number(clean(active?.innerText));
    next = buttons.find(button => !disabled(button) && pageNumber > 0 && clean(button.innerText) === String(pageNumber + 1)) ||
      buttons.find(button => !disabled(button) && /^(?:next(?: page)?|trang (?:sau|tiếp)|kế tiếp|sau)$/i.test(clean(button.getAttribute('aria-label') || button.getAttribute('title') || button.innerText))) ||
      buttons.find(button => !disabled(button) && /(?:shopee-icon-button--right|shopee-mini-page-controller__next-btn)/.test(button.className || ''));
    if (!next && controller.matches('.shopee-page-controller, .shopee-mini-page-controller')) {
      const last = buttons.at(-1);
      if (last && !disabled(last) && !clean(last.innerText) && last.querySelector('svg') &&
          (buttons.some(b => /^\d+$/.test(clean(b.innerText))) || controller.matches('.shopee-mini-page-controller'))) next = last;
    }
    if (next) break;
  }
  result.hasNext = !!next;
  result.status = result.cards.length ? 'ready' : 'loading';
  if (options.action === 'scroll') {
    window.scrollBy({top: Math.max(window.innerHeight * 0.85, 600), behavior: 'instant'});
    return {...result, scrolled: true};
  }
  if (options.action === 'next') {
    if (!next) return {...result, clicked: false};
    next.click();
    return {...result, clicked: true};
  }
  return result;
}
