'use strict';
// "Sao chép sản phẩm": choose products collected from other shops, edit drafts, then export a
// Mass Upload spreadsheet or hand the draft to the Chrome extension for the user's Seller Centre.
(() => {
  const state = {shopId: null, sources: [], drafts: [], selected: new Set(), q: '', markup: 0, loading: false, error: '', message: '', busy: false, scheduled: false, page: 1, pageSize: 10, draftSel: new Set(), bulk: {}, bulkOpen: false, overwrite: false, autoRefresh: true};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const list = value => Array.isArray(value) ? value : [];
  const money = value => value == null ? '—' : new Intl.NumberFormat('vi-VN').format(value) + '₫';
  const redraw = () => { if (typeof S !== 'undefined' && S.view === 'listings' && typeof render === 'function') render(); };
  const json = (path, method, body) => api(path, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const query = extra => new URLSearchParams({shop_id: state.shopId, ...extra});
  const key = item => encodeURIComponent(item.source_shop) + '/' + encodeURIComponent(item.sku);  // survives an HTML attribute round trip

  async function load() {
    const shopId = state.shopId;
    state.loading = true; state.error = ''; redraw();
    try {
      const [sources, drafts] = await Promise.all([api('/api/listings/sources?' + query({q: state.q})), api('/api/listings/drafts?' + query())]);
      if (shopId !== state.shopId) return;
      state.sources = list(sources); state.drafts = list(drafts);
      state.page = Math.min(state.page, pageCount());
      state.draftSel = new Set([...state.draftSel].filter(id => state.drafts.some(item => item.id === id)));
    } catch (error) { state.error = error.message || 'Chưa tải được dữ liệu.'; }
    finally { if (shopId === state.shopId) { state.loading = false; redraw(); } }
  }

  function scanForm() {
    const run = typeof S !== 'undefined' ? S.crawlRun : null, busy = typeof S !== 'undefined' && S.crawlSubmitting;
    const allowed = window.MarketLensAuth?.canCrawlShop !== false;
    return `<section class="panel"><div class="panel-head"><div><h3>1. Quét shop cần sao chép</h3>
      <p class="panel-sub">Dán link shop, Chrome sẽ đọc toàn bộ sản phẩm kèm ảnh, mô tả, ảnh trong mô tả, thuộc tính, thương hiệu, phân loại. Quét lại shop sẽ ghi đè dữ liệu cũ của các sản phẩm đó. Cần cài tiện ích MarketLens trong Chrome và có thể mất vài phút.</p></div></div>
      <form class="form" data-crawl data-lc-scan><label>Link shop</label>
      <div class="lc-row"><input type="url" name="target_url" required placeholder="https://shopee.vn/ten_shop" style="flex:1;min-width:240px">
      <input type="hidden" name="role" value="market"><input type="hidden" name="browser_mode" value="chrome"><input type="hidden" name="detail_limit" value="1000">
      <button type="submit" class="btn btn-primary" ${!allowed || busy ? 'disabled' : ''}>${busy ? 'Đang quét...' : '◉ Quét toàn bộ sản phẩm →'}</button></div>
      <label class="check-control"><input type="checkbox" name="read_details" checked> <span>Đọc chi tiết từng sản phẩm (cần để có ảnh và mô tả)</span></label>
      <label class="check-control"><input type="checkbox" data-lc-autorefresh ${state.autoRefresh ? 'checked' : ''}> <span>Quét xong tự ghi đè nội dung mới vào các bản nháp đã có (giữ giá, kho, cân nặng, trạng thái)</span></label></form>
      <div class="crawl-progress"><p id="crawlFeedback" role="status" aria-live="polite">${esc(run?.message || '')}</p><progress id="crawlDetailProgress" class="${run?.detailPhase ? '' : 'hidden'}" max="${Math.max(1, run?.total || 1)}" value="${(run?.completed || 0) + (run?.failed || 0)}" aria-label="Tiến độ đọc chi tiết sản phẩm"></progress><button type="button" id="stopCrawlDetails" class="btn btn-soft btn-sm ${busy && run?.detailPhase ? '' : 'hidden'}" ${run?.stopRequested ? 'disabled' : ''}>${run?.stopRequested ? 'Đang dừng sau sản phẩm hiện tại...' : 'Dừng sau sản phẩm hiện tại'}</button></div></section>`;
  }

  // What the scan captured for a product: images, variants, category, attributes, description.
  function coverage(item) {
    const c = item.coverage || {};
    const parts = item.has_detail
      ? [`${c.images || 0} ảnh`, c.description_images ? `${c.description_images} ảnh mô tả` : '', `${c.variants || 0} phân loại`, `${c.attributes || 0} thuộc tính`, c.brand ? 'có thương hiệu' : '', c.category ? 'có ngành hàng' : '', c.description ? 'có mô tả' : ''].filter(Boolean)
      : [];
    const missing = item.has_detail ? [!c.images && 'ảnh', !c.variants && 'phân loại', !c.brand && 'thương hiệu', !c.category && 'ngành hàng', !c.description && 'mô tả'].filter(Boolean) : [];
    return `${item.draft_id ? '<span class="badge">Đã có bản nháp</span> ' : ''}` +
      (item.has_detail ? `<small>${esc(parts.join(' · '))}</small>${missing.length ? `<br><small class="lc-missing">Thiếu: ${esc(missing.join(', '))}</small>` : ''}` : '<span class="badge">Thiếu chi tiết</span>');
  }

  function sourceTable() {
    const rows = state.sources.map(item => `<tr><td><input type="checkbox" data-lc-pick="${esc(key(item))}" ${state.selected.has(key(item)) ? 'checked' : ''} aria-label="Chọn ${esc(item.name)}"></td>
      <td class="product-name">${esc(item.name)}</td><td>${esc(item.source_shop)}</td><td>${money(item.price)}</td>
      <td>${coverage(item)}</td></tr>`).join('');
    return `<section class="panel"><div class="panel-head"><div><h3>2. Chọn sản phẩm để sao chép</h3>
      <p class="panel-sub">Danh sách gồm sản phẩm đã quét ở bước 1 (hoặc ở mục Thu thập shop với loại dữ liệu “Đối thủ / thị trường”).</p></div></div>
      <div class="lc-row"><button type="button" class="btn btn-soft btn-sm" data-lc-all="1">Chọn tất cả</button><button type="button" class="btn btn-soft btn-sm" data-lc-all="0">Bỏ chọn tất cả</button><button type="button" class="btn btn-white btn-sm" data-lc-sdelete="1" ${state.selected.size && !state.busy ? '' : 'disabled'}>Xóa ${state.selected.size} sản phẩm đã chọn</button><small>${state.sources.filter(item => !item.draft_id).length} chưa có bản nháp · ${state.sources.filter(item => item.draft_id).length} đã có</small></div>
      <form data-lc-search class="lc-row"><input type="search" name="q" value="${esc(state.q)}" placeholder="Tìm theo tên sản phẩm hoặc shop"><button class="btn btn-soft btn-sm" type="submit">Tìm</button></form>
      ${rows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th></th><th>SẢN PHẨM</th><th>SHOP GỐC</th><th>GIÁ</th><th>DỮ LIỆU</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<div class="instructions">Chưa có sản phẩm của shop khác. Dán link shop ở bước 1 và quét trước.</div>'}
      <div class="lc-row"><label>Chỉnh giá bán <input type="number" data-lc-markup value="${esc(state.markup)}" min="-90" max="500" step="1" style="width:5rem">% so với giá gốc</label>
      <label class="check-control"><input type="checkbox" data-lc-overwrite ${state.overwrite ? 'checked' : ''}> <span>Ghi đè nội dung quét mới (tên, mô tả, ảnh, thuộc tính, phân loại) vào bản nháp đã có; giữ nguyên giá, kho, cân nặng, trạng thái</span></label>
      <button class="btn btn-primary btn-sm" data-lc-create ${state.selected.size && !state.busy ? '' : 'disabled'}>Tạo / cập nhật bản nháp (${state.selected.size})</button></div></section>`;
  }

  function draftCard(draft) {
    const images = list(draft.images).map((url, index) => `<span class="lc-img"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"><button type="button" data-lc-img="${esc(draft.id)}:${index}" title="Bỏ ảnh">×</button></span>`).join('');
    const fromDescription = list(draft.desc_images).filter(url => !list(draft.images).includes(url)).map((url, index) => `<span class="lc-img"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"><button type="button" data-lc-addimg="${esc(draft.id)}:${index}" title="Thêm vào ảnh sản phẩm">+</button></span>`).join('');
    const variants = list(draft.variants).map(item => `${esc(item.name)}: ${esc(list(item.options).join(', '))}`).join(' · ');
    const attributes = list(draft.attributes).map(item => `${esc(item.name)}: ${esc(item.value)}`).join(' · ');
    return `<article class="panel lc-draft" data-lc-draft="${esc(draft.id)}"><div class="lc-row"><input type="checkbox" data-lc-dpick="${esc(draft.id)}" ${state.draftSel.has(draft.id) ? 'checked' : ''} aria-label="Chọn bản nháp" style="width:auto"><strong>${draft.status === 'ready' ? '✅ Sẵn sàng' : draft.status === 'posted' ? '📦 Đã đăng' : '✎ Nháp'}</strong>
      <small>Gốc: ${esc(draft.source_shop)} · <a href="${esc(draft.source_url)}" target="_blank" rel="noopener noreferrer">xem sản phẩm</a></small></div>
      <label>Tên sản phẩm <input data-lc-field="name" maxlength="120" value="${esc(draft.name)}"></label>
      <div class="lc-row"><label>Giá (₫) <input type="number" data-lc-field="price" min="0" value="${esc(draft.price ?? '')}"></label>
        <label>Kho hàng <input type="number" data-lc-field="stock" min="0" value="${esc(draft.stock)}"></label>
        <label>Cân nặng (g) <input type="number" data-lc-field="weight_g" min="0" value="${esc(draft.weight_g)}"></label></div>
      <label>Ngành hàng <input data-lc-field="category" value="${esc(draft.category)}"></label>
      <label>Mô tả <textarea data-lc-field="description" rows="5" maxlength="5000">${esc(draft.description)}</textarea></label>
      <div class="lc-images">${images || '<small>Chưa có ảnh (sản phẩm này chưa đọc chi tiết).</small>'}</div>
      ${fromDescription ? `<details><summary>Ảnh trong mô tả gốc (bấm + để thêm vào ảnh sản phẩm, tối đa 9 ảnh)</summary><div class="lc-images">${fromDescription}</div></details>` : ''}
      ${attributes ? `<p class="muted"><b>Thuộc tính:</b> ${attributes}</p>` : ''}${variants ? `<p class="muted"><b>Phân loại:</b> ${variants}</p>` : ''}
      <div class="lc-row"><button class="btn btn-soft btn-sm" data-lc-save="${esc(draft.id)}">Lưu</button>
        <button class="btn btn-soft btn-sm" data-lc-status="${esc(draft.id)}:${draft.status === 'ready' ? 'draft' : 'ready'}">${draft.status === 'ready' ? 'Bỏ đánh dấu' : 'Đánh dấu sẵn sàng'}</button>
        <button class="btn btn-primary btn-sm" data-lc-post="${esc(draft.id)}:shopee">Đăng Shopee (tiện ích)</button>
        <button class="btn btn-primary btn-sm lc-tiktok" data-lc-post="${esc(draft.id)}:tiktok">Đăng TikTok Shop (tiện ích)</button>
        <button class="btn btn-white btn-sm" data-lc-delete="${esc(draft.id)}">Xóa</button></div></article>`;
  }

  const pageCount = () => Math.max(1, Math.ceil(state.drafts.length / state.pageSize));
  const bulkValue = name => esc(state.bulk[name] ?? '');
  function bulkForm(count) {
    const field = (name, label, type = 'text', extra = '') => `<label>${label}<input type="${type}" data-lc-bulk="${name}" value="${bulkValue(name)}" ${extra}></label>`;
    return `<details class="lc-bulk" ${state.bulkOpen ? 'open' : ''}><summary><strong>Sửa thuộc tính hàng loạt</strong> ${count ? `(áp dụng cho ${count} bản đã chọn)` : '(chọn bản nháp ở các thẻ bên dưới trước)'}</summary>
      <div class="lc-bulk-grid">
        <label>Chỉnh giá<select data-lc-bulk="price_mode"><option value="">Không đổi</option>${[['markup_pct', 'Tăng/giảm theo %'], ['add', 'Cộng/trừ số tiền (₫)'], ['set', 'Đặt giá cố định (₫)']].map(([value, text]) => `<option value="${value}" ${state.bulk.price_mode === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>
        ${field('price_value', 'Giá trị chỉnh giá', 'number', 'step="any"')}${field('stock', 'Kho hàng (đặt cho tất cả)', 'number', 'min="0"')}${field('weight_g', 'Cân nặng g (đặt cho tất cả)', 'number', 'min="0"')}
        ${field('category', 'Ngành hàng (đặt cho tất cả)')}
        <label>Trạng thái<select data-lc-bulk="status"><option value="">Không đổi</option>${[['ready', 'Sẵn sàng'], ['draft', 'Nháp'], ['posted', 'Đã đăng']].map(([value, text]) => `<option value="${value}" ${state.bulk.status === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>
        ${field('name_prefix', 'Thêm vào đầu tên')}${field('name_suffix', 'Thêm vào cuối tên')}${field('name_find', 'Tên: tìm chữ')}${field('name_replace', 'Tên: thay bằng')}
        ${field('description_prepend', 'Thêm vào đầu mô tả')}${field('description_append', 'Thêm vào cuối mô tả')}${field('description_find', 'Mô tả: tìm chữ')}${field('description_replace', 'Mô tả: thay bằng')}
        ${field('attribute_name', 'Thuộc tính: tên (vd Xuất xứ)')}${field('attribute_value', 'Thuộc tính: giá trị')}
      </div>
      <div class="lc-row"><button type="button" class="btn btn-primary btn-sm" data-lc-bulk-apply ${count && !state.busy ? '' : 'disabled'}>Áp dụng cho ${count} bản đã chọn</button>
        <button type="button" class="btn btn-white btn-sm" data-lc-bulk-delete ${count && !state.busy ? '' : 'disabled'}>Xóa ${count} bản đã chọn</button></div></details>`;
  }

  function pager() {
    const pages = pageCount();
    return `<div class="lc-row lc-pager"><button type="button" class="btn btn-soft btn-sm" data-lc-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>‹ Trước</button>
      <span>Trang ${state.page}/${pages} · ${state.drafts.length} bản nháp</span>
      <button type="button" class="btn btn-soft btn-sm" data-lc-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''}>Sau ›</button>
      <label>Mỗi trang <select data-lc-pagesize>${[10, 20, 50].map(n => `<option ${n === state.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>`;
  }

  function draftsSection() {
    const ready = state.drafts.filter(item => item.status === 'ready').length;
    const count = state.draftSel.size;
    const visible = state.drafts.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    return `<section class="panel"><div class="panel-head"><div><h3>3. Bản nháp đăng bán (${state.drafts.length})</h3>
      <p class="panel-sub">Chỉnh lại tên, giá, mô tả cho phù hợp shop của bạn rồi chọn một cách đăng.</p></div>
      <div class="lc-row">${[['shopee', 'Shopee'], ['tiktok', 'TikTok Shop']].map(([platform, name]) => `<a class="btn btn-soft btn-sm ${state.drafts.length ? '' : 'disabled'}" href="/api/listings/export?${esc(query({platform}).toString())}" data-lc-export="${platform}">Tải file ${name} (.xlsx)</a>`).join('')}
      ${count ? [['shopee', 'Shopee'], ['tiktok', 'TikTok']].map(([platform, name]) => `<a class="btn btn-soft btn-sm" href="/api/listings/export?${esc(query({platform, ids: [...state.draftSel].join(',')}).toString())}">${count} bản đã chọn → ${name}</a>`).join('') : ''}
      ${ready ? [['shopee', 'Shopee'], ['tiktok', 'TikTok']].map(([platform, name]) => `<a class="btn btn-soft btn-sm" href="/api/listings/export?${esc(query({platform, ids: state.drafts.filter(item => item.status === 'ready').map(item => item.id).join(',')}).toString())}">${ready} bản sẵn sàng → ${name}</a>`).join('') : ''}</div></div>
      ${state.drafts.length ? `<div class="lc-row"><button type="button" class="btn btn-soft btn-sm" data-lc-dall="1">Chọn tất cả ${state.drafts.length} bản</button><button type="button" class="btn btn-soft btn-sm" data-lc-dall="page">Chọn trang này</button><button type="button" class="btn btn-soft btn-sm" data-lc-dall="0">Bỏ chọn tất cả</button><small>Đã chọn ${count}</small></div>${bulkForm(count)}${pager()}` : ''}
      ${visible.map(draftCard).join('') || '<div class="instructions">Chưa có bản nháp. Chọn sản phẩm ở bước 2.</div>'}${state.drafts.length > state.pageSize ? pager() : ''}</section>`;
  }

  function renderListings() {
    if (!S.shopId) return '<section class="panel"><h2>Chưa có shop</h2><p>Thêm shop của bạn trước khi sao chép sản phẩm.</p></section>';
    if (state.shopId !== S.shopId) {
      Object.assign(state, {shopId: S.shopId, sources: [], drafts: [], selected: new Set(), draftSel: new Set(), page: 1, message: '', error: ''});
      if (!state.scheduled) { state.scheduled = true; setTimeout(() => { state.scheduled = false; load(); }, 0); }
    }
    return `<div class="lc-workspace"><section class="panel lc-warning"><span class="eyebrow">SAO CHÉP SẢN PHẨM → KÊNH NGƯỜI BÁN</span>
      <h2>Đăng sản phẩm từ shop khác lên shop của bạn</h2>
      <p><b>Lưu ý bản quyền:</b> ảnh và mô tả là nội dung của shop gốc. Shopee có thể gỡ listing hoặc xử lý vi phạm sở hữu trí tuệ nếu shop gốc báo cáo. Bạn chịu trách nhiệm về nội dung đăng; nên đổi ảnh và viết lại mô tả.</p>
      ${state.message ? `<p class="lc-ok">${esc(state.message)}</p>` : ''}${state.error ? `<p class="lc-err">${esc(state.error)}</p>` : ''}${state.loading ? '<p>Đang tải…</p>' : ''}</section>
      ${scanForm()}${sourceTable()}${draftsSection()}</div>`;
  }

  async function act(operation, message) {
    if (state.busy) return;
    state.busy = true; state.error = ''; state.message = '';
    try { await operation(); if (message) state.message = message; await load(); }
    catch (error) { state.error = error.message || 'Thao tác chưa thành công.'; redraw(); }
    finally { state.busy = false; redraw(); }
  }

  const draftById = id => state.drafts.find(item => item.id === id);
  function cardValues(id) {
    const card = document.querySelector(`[data-lc-draft="${CSS.escape(id)}"]`);
    const values = {};
    card?.querySelectorAll('[data-lc-field]').forEach(input => {
      const name = input.dataset.lcField;
      values[name] = ['price', 'stock', 'weight_g'].includes(name) ? (input.value === '' ? (name === 'price' ? null : 0) : Number(input.value)) : input.value;
    });
    return values;
  }
  // Persist edits typed into the cards currently on screen (before paging or bulk changes reload the list).
  async function saveVisible() {
    const ids = [...document.querySelectorAll('[data-lc-draft]')].map(card => card.dataset.lcDraft);
    for (const id of ids) {
      const draft = draftById(id), values = cardValues(id);
      const changed = draft && Object.entries(values).some(([name, value]) => String(draft[name] ?? '') !== String(value ?? ''));
      if (changed) await save(id);
    }
  }
  const save = id => json(`/api/listings/drafts/${encodeURIComponent(id)}?` + query(), 'PUT', cardValues(id));

  // The shared crawl handler in app.js runs the scan; refresh the product list once it finishes.
  document.addEventListener('submit', event => {
    if (!event.target.matches('[data-lc-scan]')) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const running = typeof S !== 'undefined' && S.crawlSubmitting;
      if (!running && Date.now() - started > 1500 || Date.now() - started > 3 * 3600 * 1000) {
        clearInterval(timer);
        load().then(refreshDrafts);
      }
    }, 1000);
  });
  // After a scan finishes, overwrite the content of drafts whose products were just re-read.
  async function refreshDrafts() {
    if (!state.autoRefresh || !state.shopId) return;
    const items = state.sources.filter(item => item.draft_id && item.has_detail).map(item => ({source_shop: item.source_shop, sku: item.sku}));
    if (!items.length) return;
    try {
      let updated = 0;
      for (let offset = 0; offset < items.length; offset += 50) {
        updated += (await json('/api/listings/drafts', 'POST', {shop_id: state.shopId, items: items.slice(offset, offset + 50), overwrite: true})).updated || 0;
      }
      state.message = `Quét xong: đã ghi đè nội dung mới vào ${updated} bản nháp đã có (giữ nguyên giá, kho, cân nặng, trạng thái).`;
      await load();
    } catch (error) { state.error = error.message || 'Chưa cập nhật được bản nháp.'; redraw(); }
  }
  document.addEventListener('input', event => {
    if (event.target.matches?.('input[data-lc-bulk]')) state.bulk[event.target.dataset.lcBulk] = event.target.value;
  });
  document.addEventListener('toggle', event => { if (event.target.matches?.('.lc-bulk')) state.bulkOpen = event.target.open; }, true);
  document.addEventListener('submit', event => {
    if (!event.target.matches('[data-lc-search]')) return;
    event.preventDefault();
    state.q = new FormData(event.target).get('q') || '';
    load();
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-lc-pick]')) { target.checked ? state.selected.add(target.dataset.lcPick) : state.selected.delete(target.dataset.lcPick); redraw(); }
    if (target.matches('[data-lc-autorefresh]')) state.autoRefresh = target.checked;
    if (target.matches('[data-lc-overwrite]')) state.overwrite = target.checked;
    if (target.matches('[data-lc-markup]')) state.markup = Number(target.value) || 0;
    if (target.matches('[data-lc-dpick]')) { target.checked ? state.draftSel.add(target.dataset.lcDpick) : state.draftSel.delete(target.dataset.lcDpick); redraw(); }
    if (target.matches('[data-lc-pagesize]')) { state.pageSize = Number(target.value) || 10; state.page = 1; redraw(); }
    if (target.matches('select[data-lc-bulk]')) state.bulk[target.dataset.lcBulk] = target.value;
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-lc-all],[data-lc-addimg],[data-lc-sdelete],[data-lc-dall],[data-lc-page],[data-lc-bulk-apply],[data-lc-bulk-delete],[data-lc-create],[data-lc-save],[data-lc-status],[data-lc-post],[data-lc-delete],[data-lc-img]');
    if (!button) return;
    const d = button.dataset;
    if (d.lcDall !== undefined) {
      const pageIds = state.drafts.slice((state.page - 1) * state.pageSize, state.page * state.pageSize).map(item => item.id);
      state.draftSel = d.lcDall === '1' ? new Set(state.drafts.map(item => item.id)) : d.lcDall === 'page' ? new Set([...state.draftSel, ...pageIds]) : new Set();
      redraw();
    } else if (d.lcPage !== undefined) {
      const target = Math.min(pageCount(), Math.max(1, Number(d.lcPage)));
      act(async () => { await saveVisible(); state.page = target; });
    } else if (d.lcBulkApply !== undefined || d.lcBulkDelete !== undefined) {
      const remove = d.lcBulkDelete !== undefined;
      if (remove && !confirm(`Xóa ${state.draftSel.size} bản nháp đã chọn?`)) return;
      const body = {shop_id: state.shopId, ids: [...state.draftSel], delete: remove};
      for (const [name, value] of Object.entries(state.bulk)) {
        if (remove || value === '' || value == null) continue;
        body[name] = ['price_value', 'stock', 'weight_g'].includes(name) ? Number(value) : value;
      }
      act(async () => {
        await saveVisible();
        const result = await json('/api/listings/drafts/bulk', 'POST', body);
        state.message = remove ? `Đã xóa ${result.deleted} bản nháp.` : `Đã cập nhật ${result.updated} bản nháp.`;
        if (remove) state.draftSel = new Set();
      });
    } else if (d.lcSdelete !== undefined) {
      const items = state.sources.filter(item => state.selected.has(key(item))).map(item => ({source_shop: item.source_shop, sku: item.sku}));
      if (!items.length || !confirm(`Xóa ${items.length} sản phẩm đã quét khỏi danh sách? Quét lại shop để lấy bản mới nhất. Bản nháp đã tạo được giữ nguyên.`)) return;
      act(async () => {
        let deleted = 0;
        for (let offset = 0; offset < items.length; offset += 500) deleted += (await json('/api/listings/sources/delete', 'POST', {shop_id: state.shopId, items: items.slice(offset, offset + 500)})).deleted;
        state.selected = new Set();
        state.message = `Đã xóa ${deleted} sản phẩm đã quét.`;
      });
    } else if (d.lcAddimg) {
      const [id, index] = d.lcAddimg.split(':'); const draft = draftById(id);
      const extra = list(draft?.desc_images).filter(url => !list(draft.images).includes(url))[Number(index)];
      if (!extra) return;
      if (list(draft.images).length >= 9) { state.error = 'Mỗi sản phẩm tối đa 9 ảnh; bỏ bớt ảnh trước khi thêm.'; redraw(); return; }
      act(() => json(`/api/listings/drafts/${encodeURIComponent(id)}?` + query(), 'PUT', {images: [...list(draft.images), extra]}));
    } else if (d.lcAll !== undefined) {
      state.selected = d.lcAll === '1' ? new Set(state.sources.map(key)) : new Set();
      redraw();
    } else if (d.lcCreate !== undefined) {
      const items = state.sources.filter(item => state.selected.has(key(item))).map(item => ({source_shop: item.source_shop, sku: item.sku}));
      act(async () => {
        let created = 0, skipped = 0, updated = 0;
        for (let offset = 0; offset < items.length; offset += 50) {  // the API accepts 50 products per request
          const result = await json('/api/listings/drafts', 'POST', {shop_id: state.shopId, items: items.slice(offset, offset + 50), markup_pct: state.markup, overwrite: !!state.overwrite});
          created += list(result.created).length; skipped += list(result.skipped).length; updated += result.updated || 0;
        }
        state.selected = new Set();
        state.message = `Đã tạo ${created} bản nháp` + (updated ? `, cập nhật ${updated} bản đã có` : '') + (skipped ? `, bỏ qua ${skipped} (đã có hoặc không tìm thấy).` : '.');
      });
    } else if (d.lcSave) act(() => save(d.lcSave), 'Đã lưu bản nháp.');
    else if (d.lcStatus) { const [id, status] = d.lcStatus.split(':'); act(async () => { await save(id); await json(`/api/listings/drafts/${encodeURIComponent(id)}?` + query(), 'PUT', {status}); }); }
    else if (d.lcDelete) { if (confirm('Xóa bản nháp này?')) act(() => api(`/api/listings/drafts/${encodeURIComponent(d.lcDelete)}?` + query(), {method: 'DELETE'}), 'Đã xóa bản nháp.'); }
    else if (d.lcImg) {
      const [id, index] = d.lcImg.split(':'); const draft = draftById(id);
      act(() => json(`/api/listings/drafts/${encodeURIComponent(id)}?` + query(), 'PUT', {images: list(draft?.images).filter((_, position) => position !== Number(index))}));
    } else if (d.lcPost) {
      const [postId, platform] = d.lcPost.split(':');
      const name = platform === 'tiktok' ? 'TikTok Shop Seller Center' : 'Kênh Người Bán Shopee';
      act(async () => {
        if (!window.MarketLensChrome?.listing) throw new Error('Chưa kết nối tiện ích MarketLens. Cài hoặc cập nhật tiện ích (phiên bản 1.6.0 trở lên) rồi tải lại trang.');
        await save(postId);
        const fresh = (await api('/api/listings/drafts?' + query())).find(item => item.id === postId);
        await window.MarketLensChrome.listing(fresh, platform);
        state.message = `Đã mở ${name}. Đăng nhập nếu cần, rồi bấm “Tự điền biểu mẫu” trong khung MarketLens ở góc phải; kiểm tra lại trước khi bấm Đăng.`;
      });
    }
  });

  window.MarketLensListings = Object.freeze({render: renderListings});
})();
