export function validateProductUrl(value) {
  let url;
  try { url = new URL(typeof value === 'string' ? value.trim() : ''); }
  catch { throw new Error('URL sản phẩm Shopee không hợp lệ.'); }
  const ids = url.pathname.match(/^\/product\/([1-9]\d*)\/([1-9]\d*)\/?$/)?.slice(1) ||
    url.pathname.match(/^\/[^/]+-i\.([1-9]\d*)\.([1-9]\d*)\/?$/)?.slice(1);
  if (url.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(url.hostname) ||
      url.port || url.username || url.password || !ids) {
    throw new Error('Chỉ hỗ trợ URL trang sản phẩm công khai trên shopee.vn.');
  }
  return `https://shopee.vn/product/${ids[0]}/${ids[1]}`;
}

// chrome.scripting serializes this function: all helpers must remain inside it.
// Read rendered product content only; never inspect page state, requests, or cookies.
export function inspectProductPage(options) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const label = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
  const parse = value => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(url.hostname) || url.port || url.username || url.password) return null;
      return url.pathname.match(/^\/product\/([1-9]\d*)\/([1-9]\d*)\/?$/)?.slice(1) ||
        url.pathname.match(/^\/[^/]+-i\.([1-9]\d*)\.([1-9]\d*)\/?$/)?.slice(1) || null;
    } catch { return null; }
  };
  const visible = element => {
    if (!element || element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return style.display === 'contents' ? [...element.children].some(visible) : element.getClientRects().length > 0;
  };
  const text = element => visible(element) ? clean(element.innerText) : '';
  // Third-party extensions sometimes append buttons to Shopee headings. Ignore
  // those controls instead of treating their labels as product content.
  const headingText = element => {
    const visit = node => {
      if (node.nodeType === 3) return node.textContent || '';
      if (node.nodeType !== 1 || /^(BUTTON|SCRIPT|STYLE)$/.test(node.tagName) ||
          node.getAttribute('role') === 'button' || !visible(node)) return '';
      return [...node.childNodes].map(visit).join(' ');
    };
    return clean(visit(element));
  };
  const fail = (status, error) => ({status, error});
  let current;
  try { current = new URL(location.href); }
  catch { return fail('blocked', 'Tab không còn ở trang sản phẩm Shopee.'); }
  if (current.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(current.hostname)) {
    return fail('blocked', 'Tab đã rời Shopee; lượt đọc chi tiết đã dừng.');
  }
  if (/\/(?:verify|captcha)(?:\/|$)/i.test(current.pathname) ||
      [...document.querySelectorAll('iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha-container" i]')].some(visible)) {
    return fail('blocked', 'Shopee yêu cầu xác minh hoặc chặn lưu lượng. Lượt đọc chi tiết đã dừng.');
  }
  if (/\/(?:buyer\/)?login(?:\/|$)/i.test(current.pathname) ||
      [...document.querySelectorAll('input[type="password"]')].some(visible)) {
    return fail('blocked', 'Shopee yêu cầu đăng nhập; hãy đăng nhập trong Chrome rồi quét lại.');
  }
  const expectedIds = parse(options.productUrl);
  const actualIds = parse(current.href);
  if (!expectedIds || !actualIds || actualIds.join('.') !== expectedIds.join('.')) {
    return fail('wrong_product', 'Shopee không mở đúng sản phẩm đã yêu cầu; dữ liệu trang khác không được lưu.');
  }
  const title = [...document.querySelectorAll('h1')].find(element => visible(element) && text(element));
  if (!title) return {status: 'loading'};
  const name = headingText(title).slice(0, 300);
  if (!name) return {status: 'loading'};
  let summary = title.closest('.product-briefing') || title.closest('section');
  if (!summary) {
    summary = title.parentElement;
    for (let depth = 0; summary?.parentElement && depth < 6; depth++) {
      if (/[₫đ]|\bVND\b/.test(text(summary)) && summary.querySelector('button')) break;
      if (summary.parentElement === document.body) break;
      summary = summary.parentElement;
    }
  }
  summary ||= title.parentElement;
  const detail = {url: `https://shopee.vn/product/${actualIds[0]}/${actualIds[1]}`, name,
    description: '', images: [], attributes: [], variants: [], categories: [],
    price_text: '', rating_text: '', review_count_text: '', sold_text: '', stock_text: ''};
  const price = [...summary.querySelectorAll('section[aria-live="polite"], [data-sqe="price"], .product-price, .product-price-value')]
    .find(element => visible(element) && /[₫đ]|\bVND\b/.test(text(element)));
  if (price) detail.price_text = text(price).slice(0, 200);
  const summaryButtons = [...summary.querySelectorAll('button')].filter(visible);
  detail.rating_text = summaryButtons.map(text).find(value => /^[0-5](?:[.,]\d+)?$/.test(value)) || '';
  detail.review_count_text = (summaryButtons.map(text).find(value => /^(?:[\d.,kKmM+]+\s*(?:ratings?|reviews?|danh gia)|danh gia\s*[\d.,kKmM+]+)$/i.test(label(value))) || '').slice(0, 120);
  for (const element of summary.querySelectorAll('div, span')) {
    const value = text(element);
    if (/^(?:[\d.,kKmM+]+\s*(?:sold|da ban)|da ban\s*[\d.,kKmM+]+)$/i.test(label(value))) {
      detail.sold_text = value.slice(0, 120); break;
    }
  }
  const headings = [...document.querySelectorAll('h2, h3')].filter(visible);
  const specHeading = headings.find(element => /^(?:product specifications|chi tiet san pham|thong tin san pham)$/.test(label(headingText(element))));
  const descHeading = headings.find(element => /^(?:product description|mo ta san pham)$/.test(label(headingText(element))));
  const followingContent = heading => {
    let currentElement = heading;
    for (let depth = 0; currentElement && depth < 3; depth++, currentElement = currentElement.parentElement) {
      const sibling = currentElement.nextElementSibling;
      if (sibling && visible(sibling) && !/^H[1-6]$/.test(sibling.tagName) && text(sibling)) return sibling;
      if (currentElement.tagName === 'SECTION') break;
    }
    return null;
  };
  if (descHeading) {
    const content = followingContent(descHeading);
    if (content && !content.contains(specHeading) && !content.querySelector('h1, h2')) {
      detail.description = String(content.innerText || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, 20000);
    }
  }
  if (specHeading) {
    const specSection = specHeading.closest('section') || specHeading.parentElement;
    const used = new Set();
    for (const heading of specSection.querySelectorAll('h3')) {
      if (!visible(heading)) continue;
      const attributeName = headingText(heading).slice(0, 120);
      const valueElement = followingContent(heading);
      const value = text(valueElement).slice(0, 2000);
      if (!attributeName || !value || used.has(label(attributeName))) continue;
      used.add(label(attributeName));
      detail.attributes.push({name: attributeName, value});
      if (/^(?:category|categories|danh muc)$/.test(label(attributeName))) {
        const links = [...valueElement.querySelectorAll('a')].map(text).filter(Boolean);
        detail.categories = (links.length ? links : value.split(/\s*[›>]\s*/)).slice(0, 10).map(value => value.slice(0, 200));
      }
      if (/^(?:stock|availability|ton kho|tinh trang kho|kho hang)$/.test(label(attributeName))) detail.stock_text = value.slice(0, 200);
      if (detail.attributes.length >= 50) break;
    }
  }
  if (!detail.categories.length) {  // fallback: the breadcrumb above the title (Shopee > Category > ... > product)
    const crumbs = [...document.querySelectorAll('nav a, [class*="breadcrumb" i] a')].filter(visible).map(text)
      .filter(value => value && !/^(?:shopee|trang chu|home)$/.test(label(value)) && value.length <= 200);
    if (crumbs.length) detail.categories = [...new Set(crumbs)].slice(0, 10);
  }
  if (!detail.stock_text) {
    detail.stock_text = (text(summary).match(/(?:\b(?:out of stock|in stock|sold out)\b|hết hàng|còn hàng|het hang|con hang)/i)?.[0] || '').slice(0, 200);
  }
  // A product's gallery is a sibling of its summary section. Stay inside that
  // briefing card so recommendations, reviewer avatars, and shop logos stay out.
  let gallery = title.closest('.product-briefing') || summary.parentElement;
  if (!gallery || gallery === document.body || gallery.querySelectorAll('h1').length > 1) gallery = summary;
  const gallerySibling = [...gallery.children].find(element => !element.contains(title) && element.querySelector('img'));
  if (gallerySibling) gallery = gallerySibling;
  const imageSet = new Set();
  for (const img of gallery.querySelectorAll('img')) {
    if (!visible(img) || /avatar|logo|icon/i.test(`${img.getAttribute('class') || ''} ${img.getAttribute('alt') || ''}`)) continue;
    let url;
    // Shopee's responsive currentSrc can be a 48px thumbnail even when the DOM
    // src contains its original public image URL. Preserve that supplied URL.
    try { url = new URL(img.getAttribute('src') || img.currentSrc || '', current.href); }
    catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || !/\.(?:susercontent\.com|shopee\.(?:vn|sg)|shopeemobile\.com)$/i.test(url.hostname) ||
        !/\/file\//.test(url.pathname)) continue;
    url.hash = '';
    if (!imageSet.has(url.href)) { imageSet.add(url.href); detail.images.push(url.href); }
    if (detail.images.length >= 20) break;
  }
  const groups = new Set();
  for (const heading of summary.querySelectorAll('h2, h3')) {
    if (!visible(heading)) continue;
    const group = heading.closest('section') || heading.parentElement;
    if (!group || group === summary) continue;
    const choices = [...group.querySelectorAll('button[class*="selection-box"], .product-variation')].filter(visible);
    const groupLabel = headingText(heading).slice(0, 120);
    if (!choices.length || !groupLabel || groups.has(label(groupLabel))) continue;
    const values = [...new Set(choices.map(button => text(button) || clean(button.getAttribute('aria-label'))).filter(Boolean))]
      .slice(0, 100).map(value => value.slice(0, 200));
    if (values.length) { groups.add(label(groupLabel)); detail.variants.push({name: groupLabel, options: values}); }
    if (detail.variants.length >= 10) break;
  }
  for (const button of summary.querySelectorAll('.product-variation, button[aria-label]')) {
    if (!visible(button)) continue;
    let group = button.parentElement;
    for (let depth = 0; group && depth < 3; depth++, group = group.parentElement) {
      const choices = [...group.querySelectorAll('.product-variation')].filter(visible);
      if (!choices.length) continue;
      const groupLabel = [...group.querySelectorAll('h3, label')].map(headingText).find(Boolean) ||
        clean(group.getAttribute('aria-label')) ||
        clean(group.previousElementSibling?.innerText);
      if (groupLabel && groupLabel.length <= 120 && !groups.has(label(groupLabel))) {
        const values = [...new Set(choices.map(text).filter(Boolean))].slice(0, 100).map(value => value.slice(0, 200));
        if (values.length) { groups.add(label(groupLabel)); detail.variants.push({name: groupLabel, options: values}); }
      }
      break;
    }
    if (detail.variants.length >= 10) break;
  }
  if (options.action === 'scroll') {
    const target = descHeading || specHeading;
    if (target) target.scrollIntoView({block: 'center', behavior: 'instant'});
    else window.scrollBy({top: Math.max(window.innerHeight * 0.85, 600), behavior: 'instant'});
  }
  // Title often appears before Shopee finishes rendering its price and ratings.
  // A title alone must not end the service worker's wait for product content.
  return {status: detail.price_text || /(?:out of stock|sold out|het hang)/i.test(label(detail.stock_text)) ? 'ready' : 'loading', detail};
}
