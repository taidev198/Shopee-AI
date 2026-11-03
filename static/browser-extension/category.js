export function validateCategoryUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(u.hostname) || u.port || u.username || u.password ||
      !/^\/[^/]+-cat\.\d+(?:\.\d+)*$/.test(u.pathname) || !/^\d{1,7}$/.test(u.searchParams.get('page') || '0')) {
    throw new Error('Link ngành hàng Shopee không hợp lệ.');
  }
  return `https://shopee.vn${u.pathname}?page=${Number(u.searchParams.get('page') || 0)}`;
}

// Self-contained DOM inspector for injection by chrome.scripting.
export function inspectCategoryPage(options) {
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
  const visible = e => {
    if (!e || e.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(e);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return style.display === 'contents' ? [...e.children].some(visible) : e.getClientRects().length > 0;
  };
  const u = new URL(location.href);
  if (u.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(u.hostname) || u.port || u.username || u.password) return {status: 'blocked', error: 'Tab đã rời Shopee.'};
  if (/\/(?:verify|captcha|(?:buyer\/)?login)(?:\/|$)/i.test(u.pathname) ||
      [...document.querySelectorAll('input[type="password"], iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha-container" i]')].some(visible) ||
      /unusual traffic|verify you are human|lưu lượng truy cập bất thường/i.test(document.body?.innerText || '')) {
    return {status: 'blocked', error: 'Shopee yêu cầu đăng nhập hoặc xác minh. Hàng đợi đã được giữ lại.'};
  }
  if (options.home) {
    if (u.pathname !== '/') return {status: 'loading'};
    // Read the public category section, not similarly shaped SEO links in the
    // footer. Clipped carousel items are still rendered DOM and may be read.
    const roots = [...document.querySelectorAll('.home-category-list, [data-sqe="home-category-list"], [data-testid="home-category-list"]')].filter(visible);
    const categories = new Map();
    for (const root of roots) for (const a of root.querySelectorAll('a[href]')) {
      if (!visible(a)) continue;
      const link = new URL(a.getAttribute('href'), u.href);
      if (link.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(link.hostname) || link.port || link.username || link.password || !/^\/[^/]+-cat\.\d+(?:\.\d+)*$/.test(link.pathname)) continue;
      const name = clean(a.innerText || a.querySelector('img')?.alt || a.getAttribute('aria-label')).slice(0, 200);
      if (name) categories.set(link.pathname, {name, url: `https://shopee.vn${link.pathname}`});
    }
    const carousel = roots.flatMap(root => [...root.querySelectorAll('.carousel-arrow--next, button[aria-label="Next"], button[aria-label="Trang tiếp theo"]')])
      .find(e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.classList.contains('carousel-arrow--disabled'));
    const carouselSignature = roots.flatMap(root => [...root.querySelectorAll('.image-carousel__item-list, [role="list"]')])
      .map(e => [e.style?.transform || '', e.style?.left || '', getComputedStyle(e).transform || '', e.scrollLeft || 0].join(':')).join('|');
    let advanced = false;
    if (options.action === 'scroll') {
      // Traverse the public category carousel as well as lazy-loaded page content.
      if (carousel) {carousel.click(); advanced = true;}
      window.scrollBy({top: Math.max(500, window.innerHeight * .8), behavior: 'instant'});
    }
    return {status: categories.size ? 'ready' : 'loading', categories: [...categories.values()], advanced,
      catalog_end: !carousel, carousel_signature: carouselSignature};
  }
  const expected = new URL(options.url);
  const categoryIds = value => value.pathname.match(/^\/[^/]+-cat\.(\d+(?:\.\d+)*)\/?$/)?.[1] || null;
  const pageNumber = value => /^\d{1,7}$/.test(value.searchParams.get('page') || '0') ? Number(value.searchParams.get('page') || 0) : null;
  const expectedIds = categoryIds(expected), requestedPage = pageNumber(expected);
  // Shopee may localize the category slug during normal navigation. Bind to
  // the complete category ID chain and page, never merely a matching name.
  if (!expectedIds || categoryIds(u) !== expectedIds) return {status: 'loading', loading_reason: 'wrong_category'};
  if (requestedPage === null || pageNumber(u) !== requestedPage) return {status: 'loading', loading_reason: 'wrong_page_url'};
  const roots = [...document.querySelectorAll('.shopee-search-item-result, .shopee-search-item-result__items, [data-sqe="search-results"], [data-sqe="search-result"], main [role="group"][aria-label^="Product card:"], main [role="group"][aria-label="Product card"], [role="main"] [role="group"][aria-label^="Product card:"], [role="main"] [role="group"][aria-label="Product card"]')].filter(visible);
  const urls = new Set();
  for (const root of roots) for (const a of root.querySelectorAll('a[href]')) {
    if (!visible(a) || a.closest('aside, header, footer, nav, [class*="recommend" i]')) continue;
    const card = a.closest('[role="group"][aria-label^="Product card:"], [data-sqe="item"], .shopee-search-item-result__item') || a;
    if (/^(?:Ad|Ads|Quảng cáo)\s*$/i.test(String(card.innerText || '').split('\n').map(clean).find(Boolean) || '')) continue;
    const link = new URL(a.getAttribute('href'), u.href);
    if (link.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(link.hostname) || link.port || link.username || link.password) continue;
    const ids = link.pathname.match(/^\/product\/([1-9]\d*)\/([1-9]\d*)\/?$/)?.slice(1) || link.pathname.match(/^\/[^/]+-i\.([1-9]\d*)\.([1-9]\d*)\/?$/)?.slice(1);
    if (ids) urls.add(`https://shopee.vn/product/${ids[0]}/${ids[1]}`);
  }
  const modernNav = [...document.querySelectorAll('main nav, main [role="navigation"], [role="main"] nav, [role="main"] [role="navigation"]')]
    .filter(e => visible(e) && !e.closest('aside, header, footer, [role="group"][aria-label^="Product card"]'));
  const pagination = [...document.querySelectorAll('.shopee-page-controller, .shopee-mini-page-controller, [aria-label="Pagination"], [aria-label="Phân trang"]'), ...modernNav].filter(visible);
  let currentPage = null, totalPages = null;
  for (const root of pagination) {
    const counter = clean(root.innerText).match(/^(\d+)\s*\/\s*(\d+)$/);
    if (counter) { currentPage = Number(counter[1]); totalPages = Number(counter[2]); break; }
    const active = [...root.querySelectorAll('[aria-current="page"], .shopee-button-solid--primary')].find(visible);
    if (active && /^\d+$/.test(clean(active.innerText))) currentPage = Number(clean(active.innerText));
  }
  // The current layout places its small "1/2" counter above the navigation.
  // Read exact counters only in main content, outside product/ad/footer text.
  for (const element of document.querySelectorAll('main *, [role="main"] *')) {
    const counter = clean(element.innerText).match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!counter || !visible(element) || element.closest('[role="group"][aria-label^="Product card"], aside, header, footer, nav, [role="navigation"], [class*="recommend" i]')) continue;
    currentPage = Number(counter[1]); totalPages = Number(counter[2]);
    break;
  }
  // SPA navigation can update location before replacing the previous page.
  if (currentPage !== null && currentPage !== requestedPage + 1) return {status: 'loading', loading_reason: 'pagination_mismatch'};
  const next = pagination.flatMap(root => [...root.querySelectorAll('.shopee-icon-button--right, .shopee-mini-page-controller__next-btn, button[aria-label="Next"], button[aria-label="Trang tiếp theo"]')])
    .find(e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.classList.contains('shopee-icon-button--disabled'));
  const nextLink = modernNav.flatMap(root => [...root.querySelectorAll('a[href]')]).find(a => {
    if (!visible(a) || a.disabled || a.getAttribute('aria-disabled') === 'true') return false;
    try {
      const link = new URL(a.getAttribute('href'), u.href);
      return link.protocol === 'https:' && ['shopee.vn', 'www.shopee.vn'].includes(link.hostname) && !link.port && !link.username && !link.password && categoryIds(link) === expectedIds && pageNumber(link) === requestedPage + 1;
    } catch { return false; }
  });
  const atEnd = currentPage !== null && totalPages !== null && currentPage >= totalPages;
  const empty = !urls.size && [...document.querySelectorAll('.shopee-search-empty-result-section, .shopee-search-empty-result, [data-sqe="no-results"]')]
    .some(e => visible(e) && /không (?:tìm thấy|có)|no (?:results|products)|0 (?:sản phẩm|products)/i.test(clean(e.innerText)));
  if (options.action === 'scroll') window.scrollBy({top: Math.max(500, window.innerHeight * .8), behavior: 'instant'});
  return {status: urls.size || empty ? 'ready' : 'loading', urls: [...urls].slice(0, 100), has_next: !empty && !atEnd && !!(next || nextLink), empty,
    ...(urls.size || empty ? {} : {loading_reason: 'no_product_cards'})};
}
