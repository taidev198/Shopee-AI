// Draft handoff from MarketLens to the user's own Seller Centre (banhang.shopee.vn).
export const SELLER_NEW_PRODUCT_URL = 'https://banhang.shopee.vn/portal/product/new';
// Seller Centres a draft can be handed to (host + path prefix are also the content-script match).
export const TARGETS = {
  shopee: {label: 'Kênh Người Bán Shopee', url: SELLER_NEW_PRODUCT_URL, host: 'banhang.shopee.vn', path: '/portal/product/'},
  tiktok: {label: 'TikTok Shop Seller Center', url: 'https://seller-vn.tiktok.com/product/create', host: 'seller-vn.tiktok.com', path: '/product/'},
};
export function validateTarget(value) {
  const target = value === undefined || value === null || value === '' ? 'shopee' : String(value);
  if (!Object.hasOwn(TARGETS, target)) throw new Error('Nền tảng đăng bán không được hỗ trợ.');
  return target;
}
export function targetForUrl(value) {
  try {
    const url = new URL(value);
    return Object.keys(TARGETS).find(key => url.protocol === 'https:' && url.hostname === TARGETS[key].host && url.pathname.startsWith(TARGETS[key].path)) || null;
  } catch { return null; }
}
export const IMAGE_URL = /^https:\/\/[a-z0-9.-]+\.(?:susercontent\.com|shopee\.(?:vn|sg)|shopeemobile\.com)\//i;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const text = (value, max) => String(value ?? '').slice(0, max);
const count = value => Math.max(0, Math.min(1_000_000, Math.round(Number(value) || 0)));

// Only a plain, bounded draft ever reaches the Seller Centre tab.
export function validateListingDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Bản nháp đăng bán không hợp lệ.');
  const name = text(value.name, 120).trim();
  if (!name) throw new Error('Bản nháp cần có tên sản phẩm.');
  const images = [...new Set((Array.isArray(value.images) ? value.images : []).map(item => String(item || '').trim())
    .filter(item => IMAGE_URL.test(item)))].slice(0, 9);
  const pairs = (list, a, b) => (Array.isArray(list) ? list : []).slice(0, 50)
    .map(item => ({[a]: text(item?.[a], 200).trim(), [b]: text(item?.[b], 2000).trim()})).filter(item => item[a] && item[b]);
  const variants = (Array.isArray(value.variants) ? value.variants : []).slice(0, 10).map(item => ({
    name: text(item?.name, 120).trim(),
    options: (Array.isArray(item?.options) ? item.options : []).slice(0, 50).map(option => text(option, 200).trim()).filter(Boolean),
  })).filter(item => item.name && item.options.length);
  return {
    id: text(value.id, 80), name, description: text(value.description, 5000), category: text(value.category, 300),
    price: Number.isFinite(Number(value.price)) && Number(value.price) > 0 ? Math.round(Number(value.price)) : 0,
    stock: count(value.stock), weight_g: count(value.weight_g), images,
    attributes: pairs(value.attributes, 'name', 'value'), variants,
  };
}
