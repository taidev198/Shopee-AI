import {validateCategoryUrl, inspectCategoryPage} from './category.js';
import {inspectShopPage, isAllowedAppUrl, validateShopUrl} from './collector.js';
import {inspectProductPage, validateProductUrl} from './product-detail.js';
import {validateListingDraft, validateTarget, targetForUrl, TARGETS, IMAGE_URL, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_CHUNK_BYTES} from './listing.js';
import {inspectSearchPage, inspectProductSeller, inspectShopProfile, validateDiscoveryQuery, validateSellerLink} from './discovery.js';

const MAX_PAGES = 5;
const MAX_PRODUCTS = 150;
const MAX_DURATION_MS = 150000;
// Queue every category, but bound browser work so product pages have time to render.
const MAX_PARALLEL_CATEGORY = 4;
const PRODUCT_DETAIL_TIMEOUT_MS = 90000;
let activeCollections = 0;
let exclusiveCollection = false;
const inspectionTabs = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function beginCollection(parallelAllowed) {
  if (exclusiveCollection || (!parallelAllowed && activeCollections > 0) || (parallelAllowed && activeCollections >= MAX_PARALLEL_CATEGORY)) {
    throw Object.assign(new Error('Chrome đang thu thập dữ liệu. Hãy chờ một tác vụ đang chạy hoàn tất rồi tiếp tục.'),
      {code: 'chrome_collection_busy', retryable: true, maxParallel: MAX_PARALLEL_CATEGORY,
        activeCollections, busyReason: exclusiveCollection || !parallelAllowed ? 'exclusive' : 'capacity'});
  }
  activeCollections++;
  if (!parallelAllowed) exclusiveCollection = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCollections--;
    if (!parallelAllowed) exclusiveCollection = false;
  };
}

// Chrome rejects tab edits while its tab strip is being dragged. Only this
// specific rejection is safe to retry: it means no tab edit was performed.
async function editChromeTab(operation, deadline = Infinity, retryWindowMs = 6000) {
  const until = Math.min(deadline, Date.now() + retryWindowMs);
  const busyError = () => Object.assign(new Error(
    'Chrome đang khóa thao tác tab. Hãy thả tab đang kéo, đóng menu quản lý tab nếu đang mở, rồi bấm tiếp tục. Tiến độ đã lưu được giữ nguyên.'
  ), {code: 'chrome_tabs_busy', retryable: true});
  let delay = 300;
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0 && Date.now() >= until) throw busyError();
    try { return await operation(); }
    catch (error) {
      if (!/Tabs cannot be edited right now|user may be dragging a tab/i.test(String(error?.message || error))) throw error;
      const remaining = until - Date.now();
      if (remaining <= 0 || attempt >= 8) throw busyError();
      await pause(Math.min(delay, remaining));
      delay = Math.min(1200, delay * 2);
    }
  }
}

function safeShopeeUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(u.hostname) || u.port || u.username || u.password) return null;
    return u;
  } catch { return null; }
}

function isVerificationRoute(value) {
  const u = safeShopeeUrl(value);
  return !!u && /\/(?:verify|captcha|(?:buyer\/)?login)(?:\/|$)/i.test(u.pathname);
}

// Work tabs open in the background; only a tab that needs the seller's verification/login is brought to the front.
function bringToFront(tabId) {
  try {
    Promise.resolve(chrome.tabs.update(tabId, {active: true}))
      .then(tab => tab && chrome.windows.update(tab.windowId, {focused: true})).catch(() => {});
  } catch { /* focusing is best effort */ }
}

function manualVerificationError(message, tabId, url) {
  const u = safeShopeeUrl(url);
  if (!u) return Object.assign(new Error(message), {blocked: true});
  if (tabId !== undefined) bringToFront(tabId);
  return Object.assign(new Error(`${message || 'Shopee yêu cầu xác minh.'} Tab Shopee được giữ mở. Hãy hoàn tất xác minh hoặc đăng nhập thủ công, rồi quay lại MarketLens bấm tiếp tục.`), {
    blocked: true, verificationRequired: true, verificationTabId: tabId,
    // Return a descriptive route only; never expose tracking/session parameters.
    verificationUrl: `${u.origin}${u.pathname}`,
  });
}

async function closeOwnedTab(tabId, keepForVerification) {
  if (tabId === undefined) return true;
  if (keepForVerification) {
    try {
      const current = await chrome.tabs.get(tabId);
      if (safeShopeeUrl(current.url || current.pendingUrl)) return false;
    } catch { return true; /* The user already closed this request's tab. */ }
  }
  try { await editChromeTab(() => chrome.tabs.remove(tabId), Infinity, 2000); return true; }
  catch { return false; /* A failed cleanup must not discard a successfully read product. */ }
}

// Keep a small diagnostic sample when category pages time out. These are only
// tabs created by our own requests; never close a user tab or a tab they have
// since navigated elsewhere (including to login/verification).
async function retainInspectionTab(tabId) {
  let current;
  try { current = await chrome.tabs.get(tabId); } catch { return; }
  const url = safeShopeeUrl(current.url || current.pendingUrl);
  if (!url || isVerificationRoute(url.href)) return;
  inspectionTabs.set(tabId, url.href);
  // Bound cleanup work as well, and keep failed removals tracked for next time.
  const excess = [...inspectionTabs].slice(0, Math.min(2, Math.max(0, inspectionTabs.size - MAX_PARALLEL_CATEGORY)));
  for (const [oldId, oldUrl] of excess) {
    let old;
    try { old = await chrome.tabs.get(oldId); } catch { inspectionTabs.delete(oldId); continue; }
    if ((old.url || old.pendingUrl) !== oldUrl || isVerificationRoute(oldUrl)) inspectionTabs.delete(oldId);
    else if (await closeOwnedTab(oldId, false)) inspectionTabs.delete(oldId);
  }
}

async function collect(url, sender) {
  const shopUrl = validateShopUrl(url);
  const release = beginCollection(false);
  let tabId;
  let keepForVerification = false;
  const deadline = Date.now() + MAX_DURATION_MS;
  try {
    const tab = await editChromeTab(() => chrome.tabs.create({url: shopUrl, active: false, ...(sender.tab?.windowId ? {windowId: sender.tab.windowId} : {})}), deadline);
    tabId = tab.id;
    const read = async action => {
      if (Date.now() >= deadline) throw new Error('Lượt quét đã hết thời gian chờ. Hãy mở shop kiểm tra rồi quét lại.');
      const currentTab = await chrome.tabs.get(tabId);
      const currentUrl = currentTab.url || currentTab.pendingUrl;
      if (currentUrl && !/^https:\/\/(?:www\.)?shopee\.vn\//i.test(currentUrl)) {
        throw new Error('Tab đã rời Shopee. Lượt quét dừng và không lưu sản phẩm.');
      }
      if (isVerificationRoute(currentUrl)) {
        keepForVerification = true;
        throw manualVerificationError('Shopee yêu cầu xác minh hoặc đăng nhập.', tabId, currentUrl);
      }
      if (currentTab.status !== 'complete') return null;
      const injections = await chrome.scripting.executeScript({target: {tabId}, func: inspectShopPage, args: [{shopUrl, action}]});
      const snapshot = injections[0]?.result;
      if (!snapshot) throw new Error('Không đọc được trang Shopee. Hãy tải lại tiện ích rồi quét lại.');
      if (snapshot.status === 'blocked') {
        const error = manualVerificationError(snapshot.error, tabId, currentUrl);
        keepForVerification = error.verificationRequired === true;
        throw error;
      }
      if (snapshot.status === 'wrong_shop') throw new Error(snapshot.error);
      return snapshot;
    };
    const waitForCards = async previousSignature => {
      const until = Math.min(deadline, Date.now() + 25000);
      let candidateSignature = '';
      while (Date.now() < until) {
        let snapshot;
        try { snapshot = await read('read'); }
        catch (error) {
          // A regular page navigation can destroy the isolated script context.
          // Retry only this DOM read, never reload or change the shop URL.
          if (!/(?:frame.*removed|context.*invalidated|document.*unloaded|frame.*navigat)/i.test(error.message)) throw error;
        }
        if (snapshot?.cards.length && (!previousSignature || snapshot.signature !== previousSignature)) {
          // Give an SPA render two consecutive observations before collecting;
          // a spinner/partial card replacement is not a finished page change.
          if (candidateSignature === snapshot.signature) return snapshot;
          candidateSignature = snapshot.signature;
        } else candidateSignature = '';
        await pause(450);
      }
      throw new Error(previousSignature ?
        'Shopee chưa tải trang sản phẩm tiếp theo. Không lưu lại dữ liệu cũ của trang trước.' :
        'Không thấy thẻ sản phẩm công khai của shop trong Chrome. Hãy kiểm tra trang shop hoặc đăng nhập, rồi bấm Quét lại.');
    };
    let snapshot = await waitForCards();
    const pages = [];
    const seen = new Set();
    const productKey = card => new URL(card.href).pathname.match(/-i\.(\d+)\.(\d+)(?:\b|\/)/)?.slice(1).join('.') ||
      new URL(card.href).pathname.match(/^\/product\/(\d+)\/(\d+)(?:\b|\/)/)?.slice(1).join('.') || card.href;
    for (let pageIndex = 0; pageIndex < MAX_PAGES && seen.size < MAX_PRODUCTS; pageIndex++) {
      const pageCards = new Map();
      const addCards = current => {
        for (const card of current.cards) {
          const key = productKey(card);
          if (!seen.has(key) && (pageCards.has(key) || pageCards.size + seen.size < MAX_PRODUCTS)) pageCards.set(key, card);
        }
      };
      addCards(snapshot);
      let stable = 0;
      for (let scroll = 0; scroll < 8 && stable < 3 && pageCards.size + seen.size < MAX_PRODUCTS; scroll++) {
        const previousCount = pageCards.size;
        await read('scroll');
        await pause(450);
        const updated = await read('read');
        if (updated) { snapshot = updated; addCards(updated); }
        stable = pageCards.size === previousCount ? stable + 1 : 0;
      }
      if (pageCards.size) {
        const cards = [...pageCards.values()];
        for (const card of cards) seen.add(productKey(card));
        pages.push({url: snapshot.url, cards});
      }
      if (pageIndex + 1 >= MAX_PAGES || seen.size >= MAX_PRODUCTS || !snapshot.hasNext) break;
      const previousSignature = snapshot.signature;
      const clicked = await read('next');
      if (!clicked?.clicked) break;
      snapshot = await waitForCards(previousSignature);
    }
    if (!pages.length) throw new Error('Không đọc được sản phẩm nào từ shop. Chưa lưu dữ liệu.');
    return {pages};
  } finally {
    try { await closeOwnedTab(tabId, keepForVerification); } finally { release(); }
  }
}

// Each product is a separate, bounded message. A long shop scan therefore does
// not depend on a single service-worker event staying alive for every product.
async function collectDetail(url, sender) {
  const productUrl = validateProductUrl(url);
  const release = beginCollection(true);
  let tabId;
  let keepForVerification = false;
  const deadline = Date.now() + PRODUCT_DETAIL_TIMEOUT_MS;
  try {
    const tab = await editChromeTab(() => chrome.tabs.create({url: productUrl, active: false,
      ...(sender.tab?.windowId ? {windowId: sender.tab.windowId} : {})}), deadline);
    tabId = tab.id;
    let previous = '';
    let stable = 0;
    let scrolled = false;
    let candidate;
    while (Date.now() < deadline) {
      const current = await chrome.tabs.get(tabId);
      const currentUrl = current.url || current.pendingUrl;
      // A newly created tab can briefly have an empty initial document.
      if (!currentUrl || (currentUrl === 'about:blank' && safeShopeeUrl(current.pendingUrl))) {
        previous = ''; stable = 0;
        await pause(500); continue;
      }
      if (currentUrl && !/^https:\/\/(?:www\.)?shopee\.vn\//i.test(currentUrl)) {
        throw Object.assign(new Error('Tab sản phẩm đã rời Shopee. Đã dừng đọc chi tiết.'), {blocked: true});
      }
      if (isVerificationRoute(currentUrl)) {
        keepForVerification = true;
        throw manualVerificationError('Shopee yêu cầu xác minh hoặc đăng nhập.', tabId, currentUrl);
      }
      // Read the rendered DOM even while images/auxiliary resources are loading.
      // The inspector verifies product IDs and the stable summary below guards
      // against saving an incomplete product skeleton.
      let snapshot;
      try {
        snapshot = (await chrome.scripting.executeScript({target: {tabId}, func: inspectProductPage,
          args: [{productUrl, action: scrolled ? 'read' : 'scroll'}]}))[0]?.result;
      } catch (error) {
        if (!/(?:frame.*removed|context.*invalidated|document.*unloaded|frame.*navigat)/i.test(error.message)) throw error;
        previous = ''; stable = 0;
        await pause(500);
        continue;
      }
      if (!snapshot) throw new Error('Không đọc được trang chi tiết sản phẩm.');
      if (snapshot.status === 'blocked') {
        const error = manualVerificationError(snapshot.error, tabId, currentUrl);
        keepForVerification = error.verificationRequired === true;
        throw error;
      }
      if (snapshot.status === 'wrong_product') throw new Error(snapshot.error || 'Shopee không tải đúng sản phẩm.');
      if (snapshot.status === 'ready' && snapshot.detail?.name) {
        candidate = snapshot.detail;
        if (!scrolled) { scrolled = true; await pause(700); continue; }
        const signature = JSON.stringify(candidate);
        stable = signature === previous ? stable + 1 : 0;
        previous = signature;
        // The h1/description can render before price/rating. Require repeated
        // observations of the product summary rather than capturing a skeleton.
        if (stable >= 2 && (candidate.price_text || /(?:hết hàng|out of stock|sold out|unavailable|không tồn tại)/i.test(candidate.stock_text))) {
          return {detail: candidate};
        }
      } else { previous = ''; stable = 0; }
      await pause(700);
    }
    throw Object.assign(new Error(candidate?.name ? 'Trang đã có tên sản phẩm nhưng giá hoặc tình trạng hàng chưa tải xong sau 90 giây. Chưa lưu chi tiết thiếu.' :
      'Shopee chưa tải trang chi tiết sản phẩm trong thời gian cho phép (90 giây).'), {
      code: 'product_detail_timeout', retryable: true,
    });
  } finally {
    try { await closeOwnedTab(tabId, keepForVerification); } finally { release(); }
  }
}

async function discover(queryValue, ownShopValue, sender) {
  const query = validateDiscoveryQuery(queryValue);
  const ownShopUrl = validateShopUrl(ownShopValue);
  const release = beginCollection(false);
  let tabId;
  let keepForVerification = false;
  const deadline = Date.now() + 120000;
  const result = {query, candidates: [], errors: []};
  const transientNavigation = error => /(?:frame.*removed|context.*invalidated|document.*unloaded|frame.*navigat)/i.test(error.message);
  try {
    const tab = await editChromeTab(() => chrome.tabs.create({url: `https://shopee.vn/search?keyword=${encodeURIComponent(query)}`, active: false,
      ...(sender.tab?.windowId ? {windowId: sender.tab.windowId} : {})}), deadline);
    tabId = tab.id;
    const inspect = async (func, options) => {
      if (Date.now() >= deadline) throw new Error('Đã hết thời gian tìm đối thủ cho từ khóa này.');
      const current = await chrome.tabs.get(tabId);
      const currentUrl = current.url || current.pendingUrl;
      if (currentUrl && !/^https:\/\/(?:www\.)?shopee\.vn\//i.test(currentUrl)) {
        throw Object.assign(new Error('Tab tìm đối thủ đã rời Shopee; đã dừng.'), {blocked: true});
      }
      if (isVerificationRoute(currentUrl)) {
        keepForVerification = true;
        throw manualVerificationError('Shopee yêu cầu xác minh hoặc đăng nhập.', tabId, currentUrl);
      }
      if (current.status !== 'complete') return null;
      let snapshot;
      try { snapshot = (await chrome.scripting.executeScript({target: {tabId}, func, args: [options]}))[0]?.result; }
      catch (error) { if (transientNavigation(error)) return null; throw error; }
      if (snapshot?.status === 'blocked') {
        const error = manualVerificationError(snapshot.error || 'Shopee yêu cầu xác minh.', tabId, currentUrl);
        keepForVerification = error.verificationRequired === true;
        throw error;
      }
      return snapshot;
    };
    let search;
    let previousSignature = '';
    const searchUntil = Math.min(deadline, Date.now() + 25000);
    while (Date.now() < searchUntil) {
      const snapshot = await inspect(inspectSearchPage, {query, action: 'read'});
      if (snapshot?.status === 'ready' && snapshot.cards?.length) {
        const signature = snapshot.cards.map(card => card.url).join('|');
        if (signature === previousSignature) { search = snapshot; break; }
        previousSignature = signature;
      }
      await pause(700);
    }
    if (!search) throw new Error('Shopee chưa hiển thị kết quả sản phẩm cho từ khóa này. Chưa tìm được đối thủ.');
    const sellers = new Set();
    const products = [];
    for (const card of search.cards.slice(0, 6)) {
      let productUrl;
      try { productUrl = validateProductUrl(card.url); } catch { continue; }
      const sellerId = new URL(productUrl).pathname.split('/')[2];
      if (!sellers.has(sellerId)) { sellers.add(sellerId); products.push({...card, url: productUrl, seller_id: sellerId}); }
      if (products.length >= 3) break;
    }
    const found = new Set();
    for (const product of products) {
      try {
        await editChromeTab(() => chrome.tabs.update(tabId, {url: product.url}), deadline);
        let seller;
        const sellerUntil = Math.min(deadline, Date.now() + 25000);
        let reads = 0;
        while (Date.now() < sellerUntil) {
          const snapshot = await inspect(inspectProductSeller, {productUrl: product.url, action: reads++ > 2 ? 'scroll' : 'read'});
          if (snapshot?.status === 'ready') { seller = snapshot; break; }
          await pause(700);
        }
        if (!seller) throw new Error('Trang sản phẩm chưa hiển thị liên kết Xem shop của người bán.');
        let shopUrl = validateSellerLink(seller.shop_url, product.seller_id);
        let name = seller.name;
        if (/^https:\/\/shopee\.vn\/shop\//.test(shopUrl)) {
          await editChromeTab(() => chrome.tabs.update(tabId, {url: shopUrl}), deadline);
          let profile;
          const profileUntil = Math.min(deadline, Date.now() + 12000);
          while (Date.now() < profileUntil) {
            const snapshot = await inspect(inspectShopProfile, {sellerId: product.seller_id});
            if (snapshot?.status === 'ready') { profile = snapshot; break; }
            await pause(700);
          }
          if (!profile) throw new Error('Shopee chưa chuyển liên kết số sang trang chủ shop; không đoán tên shop.');
          shopUrl = validateShopUrl(profile.shop_url);
          name ||= profile.name;
        } else shopUrl = validateShopUrl(shopUrl);
        const key = shopUrl.toLowerCase();
        if (key === ownShopUrl.toLowerCase() || found.has(key)) continue;
        found.add(key);
        result.candidates.push({url: shopUrl, name: String(name || new URL(shopUrl).pathname.slice(1)).slice(0, 120),
          product_url: product.url, product_name: String(product.name || '').slice(0, 300), query});
      } catch (error) {
        if (error.code === 'chrome_tabs_busy') throw error;
        if (error.blocked) {
          if (!result.candidates.length) throw error;
          result.blocked = true;
          if (error.verificationRequired) Object.assign(result, {
            verificationRequired: true, verificationTabId: error.verificationTabId, verificationUrl: error.verificationUrl,
          });
          result.errors.push(error.message);
          break;
        }
        result.errors.push(String(error.message || error).slice(0, 300));
        if (Date.now() >= deadline) break;
      }
    }
    return result;
  } finally {
    try { await closeOwnedTab(tabId, keepForVerification); } finally { release(); }
  }
}

async function collectCategory(url, sender, home = false) {
  const target = home ? 'https://shopee.vn/' : validateCategoryUrl(url);
  const release = beginCollection(!home);
  let tabId;
  let keepForVerification = false;
  let keepForInspection = false;
  const deadline = Date.now() + 35000;
  try {
    const tab = await editChromeTab(() => chrome.tabs.create({url: target, active: false, ...(sender.tab?.windowId ? {windowId: sender.tab.windowId} : {})}), deadline);
    tabId = tab.id;
    const urls = new Set();
    const categories = new Map();
    let homeStable = 0;
    let previousCarousel = null, carouselStable = 0;
    let stable = 0, hasNext = false;
    let loadingReason = '';
    while (Date.now() < deadline) {
      const current = await chrome.tabs.get(tabId);
      const currentUrl = current.url || current.pendingUrl;
      if (currentUrl && !/^https:\/\/(?:www\.)?shopee\.vn\//i.test(currentUrl)) throw new Error('Tab đã rời Shopee. Chưa lưu dữ liệu ngành hàng.');
      if (isVerificationRoute(currentUrl)) {
        keepForVerification = true;
        throw manualVerificationError('Shopee yêu cầu xác minh hoặc đăng nhập.', tabId, currentUrl);
      }
      if (current.status !== 'complete') { await pause(600); continue; }
      let snapshot;
      try {
        snapshot = (await chrome.scripting.executeScript({target: {tabId}, func: inspectCategoryPage,
          args: [{home, url: target, action: 'scroll'}]}))[0]?.result;
      } catch (error) {
        if (!/(?:frame.*removed|context.*invalidated|document.*unloaded|frame.*navigat)/i.test(error.message)) throw error;
        await pause(600);
        continue;
      }
      if (snapshot?.status === 'blocked') {
        const error = manualVerificationError(snapshot.error, tabId, currentUrl);
        keepForVerification = error.verificationRequired === true;
        throw error;
      }
      loadingReason = snapshot?.loading_reason || loadingReason;
      if (home && snapshot?.status === 'ready') {
        const before = categories.size;
        for (const category of snapshot.categories) categories.set(category.url, category);
        homeStable = before === categories.size ? homeStable + 1 : 0;
        carouselStable = previousCarousel === snapshot.carousel_signature ? carouselStable + 1 : 0;
        previousCarousel = snapshot.carousel_signature;
        if (homeStable >= 3 && snapshot.catalog_end) return {categories: [...categories.values()], catalog_complete: true};
        // Some Shopee carousel arrows remain enabled at the final position.
        // Preserve the inventory already read instead of timing out forever;
        // callers can disclose that the carousel's end could not be verified.
        if (homeStable >= 8 || (homeStable >= 6 && carouselStable >= 3)) return {
          categories: [...categories.values()], catalog_complete: false,
          note: 'Đã đọc danh mục đang hiển thị; Shopee không xác nhận điểm cuối của thanh danh mục.',
        };
        await pause(1000);
        continue;
      }
      if (snapshot?.status === 'ready') {
        const count = urls.size;
        for (const value of snapshot.urls) urls.add(value);
        hasNext = snapshot.has_next;
        stable = count === urls.size ? stable + 1 : 0;
        if ((snapshot.empty && stable >= 2) || stable >= 5 || urls.size >= 100) return {urls: [...urls].slice(0, 100), has_next: hasNext};
      }
      await pause(1000);
    }
    if (home && categories.size) return {categories: [...categories.values()], catalog_complete: false,
      note: 'Đã lưu danh mục đọc được; trang chủ chưa tải xong toàn bộ trong thời gian chờ.'};
    const reasons = {
      wrong_category: 'Shopee đang hiển thị ngành khác với ngành cần quét.',
      wrong_page_url: 'Shopee chưa mở đúng số trang cần quét.',
      pagination_mismatch: 'Số trang hiển thị chưa khớp với trang cần quét.',
      no_product_cards: 'Chưa đọc được thẻ sản phẩm trong vùng danh sách ngành hàng.',
    };
    let current;
    try { current = await chrome.tabs.get(tabId); } catch {}
    if (isVerificationRoute(current?.url || current?.pendingUrl)) {
      keepForVerification = true;
      throw manualVerificationError('Shopee yêu cầu xác minh hoặc đăng nhập.', tabId, current.url || current.pendingUrl);
    }
    const inspectionUrl = safeShopeeUrl(current?.url || current?.pendingUrl);
    keepForInspection = !!inspectionUrl;
    const page = home ? '' : ` Trang cần đọc: ${Number(new URL(target).searchParams.get('page') || 0) + 1}.`;
    throw Object.assign(new Error((reasons[loadingReason] || 'Trang ngành hàng chưa tải xong trong thời gian chờ.') + page +
      (keepForInspection ? ' Tab Shopee được giữ mở để bạn kiểm tra, rồi quay lại MarketLens bấm tiếp tục.' : ' Hàng đợi đã được giữ lại để tiếp tục.')), {
      code: 'category_page_timeout', inspectionRequired: keepForInspection,
      ...(keepForInspection ? {inspectionTabId: tabId, inspectionUrl: `${inspectionUrl.origin}${inspectionUrl.pathname}`} : {}),
    });
  } finally {
    try {
      if (keepForInspection && !keepForVerification) await retainInspectionTab(tabId);
      await closeOwnedTab(tabId, keepForVerification || keepForInspection);
    } finally { release(); }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source === 'marketlens-seller') return handleSellerMessage(message, sender, sendResponse);
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
      !isAllowedAppUrl(sender.url) || message?.source !== 'marketlens-bridge') return false;
  if (!['ping', 'collect', 'detail', 'discover', 'categories', 'category', 'listing'].includes(message.action) || typeof message.requestId !== 'string' || message.requestId.length > 128) {
    sendResponse({ok: false, error: 'Yêu cầu tiện ích không hợp lệ.'});
    return false;
  }
  if (message.action === 'ping') {
    sendResponse({ok: true, result: {version: chrome.runtime.getManifest().version, maxPages: MAX_PAGES, maxProducts: MAX_PRODUCTS, details: true, capabilities: {discover: true, categories: true, categoryCatalog: true, verificationPause: true, tabEditRetry: true, categoryCardsV2: true, categoryParallel: MAX_PARALLEL_CATEGORY, backgroundTabs: true}, mode: 'chrome_dom'}});
    return false;
  }
  if (message.action === 'listing') {
    startListing(message.draft, message.target).then(result => sendResponse({ok: true, result}),
      error => sendResponse({ok: false, error: error.message || String(error)}));
    return true;
  }
  const task = ['categories', 'category'].includes(message.action) ? collectCategory(message.url, sender, message.action === 'categories') : message.action === 'discover' ? discover(message.query, message.ownShopUrl, sender) :
    (message.action === 'detail' ? collectDetail : collect)(message.url, sender);
  task.then(result => sendResponse({ok: true, result}),
    error => sendResponse({ok: false, error: error.message || String(error), blocked: error.blocked === true,
      verificationRequired: error.verificationRequired === true,
      retryable: error.retryable === true, ...(error.code ? {code: error.code} : {}),
      ...(error.code === 'chrome_collection_busy' ? {maxParallel: error.maxParallel,
        activeCollections: error.activeCollections, busyReason: error.busyReason} : {}),
      inspectionRequired: error.inspectionRequired === true,
      ...(error.inspectionRequired ? {inspectionTabId: error.inspectionTabId, inspectionUrl: error.inspectionUrl} : {}),
      ...(error.verificationRequired ? {verificationTabId: error.verificationTabId, verificationUrl: error.verificationUrl} : {}),
    }));
  return true;
});

// --- Seller Centre handoff: the draft waits in session storage until the user's own
// banhang.shopee.vn tab asks for it; images are fetched here (host permission), not in the page.
async function startListing(value, targetValue) {
  const target = validateTarget(targetValue);
  const draft = {...validateListingDraft(value), target};
  await chrome.storage.session.set({listingDraft: draft});
  await chrome.tabs.create({url: TARGETS[target].url});
  return {opened: true, images: draft.images.length, target};
}

const isSellerCentreUrl = value => targetForUrl(value) !== null;

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function handleSellerMessage(message, sender, sendResponse) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !isSellerCentreUrl(sender.url)) return false;
  (async () => {
    const {listingDraft} = await chrome.storage.session.get('listingDraft');
    if (message.action === 'draft') return {ok: true, draft: listingDraft || null};
    if (message.action === 'image') {
      const url = listingDraft?.images?.[Number(message.index)];
      if (!url || !IMAGE_URL.test(url)) return {ok: false, error: 'Không có ảnh này trong bản nháp.'};
      const response = await fetch(url, {credentials: 'omit'});
      if (!response.ok) return {ok: false, error: `Máy chủ ảnh trả lỗi ${response.status}.`};
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_IMAGE_BYTES) return {ok: false, error: 'Ảnh quá lớn.'};
      const type = (response.headers.get('content-type') || 'image/jpeg').split(';')[0];
      return {ok: true, type: /^image\/(?:png|jpeg|webp)$/.test(type) ? type : 'image/jpeg', base64: toBase64(bytes)};
    }
    if (message.action === 'video') {
      // Videos are large: hand them to the page in chunks (Range requests), never in one message.
      const url = listingDraft?.video;
      if (!url || !IMAGE_URL.test(url)) return {ok: false, error: 'Bản nháp không có video.'};
      const offset = Math.max(0, Math.floor(Number(message.offset) || 0));
      const response = await fetch(url, {credentials: 'omit', headers: {Range: `bytes=${offset}-${offset + VIDEO_CHUNK_BYTES - 1}`}});
      if (!response.ok) return {ok: false, error: `Máy chủ video trả lỗi ${response.status}.`};
      let bytes = new Uint8Array(await response.arrayBuffer());
      const range = /\/(\d+)\s*$/.exec(response.headers.get('content-range') || '');
      const total = range ? Number(range[1]) : response.status === 206 ? offset + bytes.length : bytes.length;
      if (response.status === 200) bytes = bytes.slice(offset, offset + VIDEO_CHUNK_BYTES);  // server ignored Range
      if (total > MAX_VIDEO_BYTES) return {ok: false, error: `Video ${Math.round(total / 1048576)}MB vượt giới hạn 30MB của Shopee.`};
      const type = (response.headers.get('content-type') || 'video/mp4').split(';')[0];
      return {ok: true, total, type: /^video\//.test(type) ? type : 'video/mp4', base64: toBase64(bytes)};
    }
    return {ok: false, error: 'Yêu cầu không hợp lệ.'};
  })().then(sendResponse, error => sendResponse({ok: false, error: error.message || String(error)}));
  return true;
}
