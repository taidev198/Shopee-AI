// Content script for banhang.shopee.vn/portal/product/*: fills the user's own "add product" form
// from a MarketLens draft.  It never presses Đăng/Lưu; the seller reviews and submits.
(() => {
  if (window.top !== window || window.__marketlensSellerFill) return;
  window.__marketlensSellerFill = true;
  const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const PATTERNS = {
    name: [/ten san pham/, /product name/],
    description: [/mo ta san pham/, /product description/, /mo ta/],
    price: [/^\s*gia\b/, /\bgia\b.*(vnd|₫|d\b)/, /\bprice\b/],
    stock: [/kho hang/, /\bstock\b/, /so luong/],
    weight: [/can nang/, /weight/],
  };
  const visible = element => !!(element && element.getClientRects().length);
  function describe(element) {
    const id = element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    const wrap = element.closest('[class*="form-item"], [class*="field"], .edit-row, tr, label') || element.parentElement;
    return [element.getAttribute('placeholder'), element.getAttribute('aria-label'), element.name, id?.innerText,
      String(wrap?.innerText || '').slice(0, 120)].filter(Boolean).join(' ');
  }
  function controls() {
    return [...document.querySelectorAll('input:not([type=file]):not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea')]
      .filter(visible).map(element => ({element, kind: element.tagName.toLowerCase(), text: describe(element)}));
  }
  function pick(list, key, kinds) {
    for (const pattern of PATTERNS[key]) {
      const found = list.find(item => kinds.includes(item.kind) && pattern.test(fold(item.text)));
      if (found) return found.element;
    }
    return null;
  }
  function setValue(element, value) {
    const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, String(value));
    element.dispatchEvent(new Event('input', {bubbles: true}));
    element.dispatchEvent(new Event('change', {bubbles: true}));
    element.dispatchEvent(new Event('blur', {bubbles: true}));
  }
  async function attachImages(draft, report) {
    const input = [...document.querySelectorAll('input[type=file]')].find(item => /image|png|jpe?g/i.test(item.accept || '')) ||
      document.querySelector('input[type=file]');
    if (!input) return report.missing.push('ảnh sản phẩm (không thấy ô tải ảnh)');
    const transfer = new DataTransfer();
    for (let index = 0; index < draft.images.length; index++) {
      const reply = await chrome.runtime.sendMessage({source: 'marketlens-seller', action: 'image', index});
      if (!reply?.ok) { report.notes.push(`Ảnh ${index + 1}: ${reply?.error || 'không tải được'}`); continue; }
      const bytes = Uint8Array.from(atob(reply.base64), char => char.charCodeAt(0));
      transfer.items.add(new File([bytes], `marketlens-${index + 1}.${reply.type.includes('png') ? 'png' : 'jpg'}`, {type: reply.type}));
    }
    if (!transfer.files.length) return report.missing.push('ảnh sản phẩm');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
    report.filled.push(`${transfer.files.length} ảnh`);
  }
  async function fill(draft, panel) {
    const report = {filled: [], missing: [], notes: []};
    const list = controls();
    for (const [key, label, value, kinds] of [
      ['name', 'tên', draft.name, ['input', 'textarea']], ['description', 'mô tả', draft.description, ['textarea', 'input']],
      ['price', 'giá', draft.price || '', ['input']], ['stock', 'kho hàng', draft.stock || '', ['input']],
      ['weight', 'cân nặng', draft.weight_g || '', ['input']]]) {
      if (value === '' || value === 0) continue;
      const element = pick(list, key, kinds);
      if (element) { setValue(element, value); report.filled.push(label); } else report.missing.push(label);
    }
    if (draft.variants.length) report.notes.push('Phân loại hàng: tự thêm theo bảng bên dưới (Shopee kiểm tra chặt phần này).');
    if (draft.images.length) await attachImages(draft, report);
    panel.querySelector('[data-result]').textContent =
      `Đã điền: ${report.filled.join(', ') || 'không có'}.` + (report.missing.length ? ` Chưa tìm thấy ô: ${report.missing.join(', ')} — hãy dán bằng nút Sao chép.` : '') +
      (report.notes.length ? ' ' + report.notes.join(' ') : '') + ' Kiểm tra ngành hàng, thuộc tính rồi tự bấm Đăng.';
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  function mount(draft) {
    const panel = document.createElement('div');
    panel.setAttribute('style', 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-height:80vh;overflow:auto;background:#fff;color:#222;border:2px solid #ee4d2d;border-radius:10px;padding:12px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)');
    const rows = [['Tên', draft.name], ['Giá', draft.price || ''], ['Kho hàng', draft.stock || ''], ['Ngành hàng', draft.category], ['Mô tả', draft.description]]
      .filter(([, value]) => value !== '' && value !== undefined);
    panel.innerHTML = `<strong style="color:#ee4d2d">MarketLens · bản nháp đăng bán</strong>
      <div style="margin:6px 0">${esc(draft.name)}</div>
      <button data-fill style="background:#ee4d2d;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer">Tự điền biểu mẫu</button>
      <button data-close style="margin-left:6px;border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer">Ẩn</button>
      <div data-result style="margin:8px 0;color:#555">Bấm “Tự điền biểu mẫu” sau khi trang thêm sản phẩm đã tải xong. Tiện ích không tự bấm Đăng.</div>
      ${rows.map(([label, value], index) => `<div style="margin-top:4px"><button data-copy="${index}" style="border:1px solid #ccc;background:#f6f6f6;border-radius:4px;cursor:pointer">Sao chép</button> <b>${esc(label)}</b></div>`).join('')}
      ${draft.attributes.length ? `<div style="margin-top:8px"><b>Thuộc tính</b><br>${draft.attributes.map(item => `${esc(item.name)}: ${esc(item.value)}`).join('<br>')}</div>` : ''}
      ${draft.variants.length ? `<div style="margin-top:8px"><b>Phân loại</b><br>${draft.variants.map(item => `${esc(item.name)}: ${esc(item.options.join(', '))}`).join('<br>')}</div>` : ''}`;
    panel.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.close !== undefined) panel.remove();
      else if (target.dataset.fill !== undefined) { target.disabled = true; fill(draft, panel).finally(() => { target.disabled = false; }); }
      else if (target.dataset.copy !== undefined) navigator.clipboard?.writeText(String(rows[Number(target.dataset.copy)][1]));
    });
    document.body.append(panel);
  }
  chrome.runtime.sendMessage({source: 'marketlens-seller', action: 'draft'}).then(reply => { if (reply?.ok && reply.draft) mount(reply.draft); }).catch(() => {});
})();
