// Content script for banhang.shopee.vn/portal/product/*: fills the user's own "add product" form
// from a MarketLens draft.  It never presses Đăng/Lưu; the seller reviews and submits.
(() => {
  if (window.top !== window || window.__marketlensSellerFill) return;
  window.__marketlensSellerFill = true;
  const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const PATTERNS = {
    name: [/ten san pham/, /product name/],
    description: [/mo ta san pham/, /product description/, /mo ta/],
    price: [/gia ban/, /^\s*gia\b/, /\bgia\b.*(vnd|₫|d\b)/, /\bprice\b/],
    stock: [/kho hang/, /\bstock\b/, /so luong/],
    weight: [/can nang/, /trong luong/, /weight/],
  };
  const visible = element => !!(element && element.getClientRects().length);
  const SELECTOR = 'input:not([type=file]):not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=search]), textarea, [contenteditable="true"], [role="textbox"]';
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Text that labels a control: its own attributes, then the closest ancestor row that holds a label
  // but not many other controls (Shopee wraps each field in a form-item block).
  function describe(element) {
    const own = [element.getAttribute('placeholder'), element.getAttribute('aria-label'), element.getAttribute('name'), element.id,
      element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.innerText].filter(Boolean).join(' ');
    let node = element.parentElement, context = '';
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const count = node.querySelectorAll(SELECTOR).length;
      const text = String(node.innerText || '').replace(/\s+/g, ' ').trim();
      if (count <= 2 && text.length >= 2 && text.length <= 220) { context = text; break; }
      if (count > 2) break;
    }
    return `${own} ${context}`.trim();
  }
  function controls() {
    return [...document.querySelectorAll(SELECTOR)].filter(visible)
      .map(element => ({element, kind: element.matches('textarea') ? 'textarea' : element.matches('[contenteditable],[role=textbox]') ? 'rich' : 'input', text: describe(element)}));
  }
  function pick(list, key, kinds, used) {
    for (const pattern of PATTERNS[key]) {
      const found = list.find(item => !used.has(item.element) && kinds.includes(item.kind) && pattern.test(fold(item.text)));
      if (found) return found.element;
    }
    return null;
  }
  // Fallbacks when labels cannot be read: the first long text input is the product name,
  // the largest multi-line control is the description.
  function guess(list, key, used) {
    const free = list.filter(item => !used.has(item.element));
    if (key === 'name') return free.find(item => item.kind === 'input' && (item.element.maxLength > 60 || /ten|name/.test(fold(item.text))))?.element || null;
    if (key === 'description') {
      const area = free.filter(item => item.kind !== 'input').sort((a, b) => b.element.getBoundingClientRect().height - a.element.getBoundingClientRect().height)[0];
      return area?.element || null;
    }
    return null;
  }
  function setValue(element, value) {
    element.scrollIntoView({block: 'center'});
    element.focus();
    if (element.matches('[contenteditable],[role=textbox]')) {
      document.execCommand('selectAll', false);
      if (!document.execCommand('insertText', false, String(value))) element.textContent = String(value);
    } else {
      const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, String(value));
      element.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: String(value)}));
    }
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
  async function fill(draft, panel, platform) {
    const report = {filled: [], missing: [], notes: []};
    const result = panel.querySelector('[data-result]');
    result.textContent = 'Đang chờ biểu mẫu tải…';
    let list = [];
    for (let attempt = 0; attempt < 30; attempt++) {  // the form renders late; wait up to ~15 s
      list = controls();
      if (list.length >= 3) break;
      await pause(500);
    }
    const used = new Set();
    for (const [key, label, value, kinds] of [
      ['name', 'tên', draft.name, ['input', 'textarea', 'rich']], ['description', 'mô tả', draft.description, ['textarea', 'rich', 'input']],
      ['price', 'giá', draft.price || '', ['input']], ['stock', 'kho hàng', draft.stock || '', ['input']],
      ['weight', 'cân nặng', platform === 'tiktok' ? (draft.weight_g ? draft.weight_g / 1000 : '') : draft.weight_g || '', ['input']]]) {
      if (value === '' || value === 0) continue;
      const element = pick(list, key, kinds, used) || guess(list, key, used);
      if (element) { used.add(element); setValue(element, value); report.filled.push(label); await pause(150); } else report.missing.push(label);
    }
    if (draft.variants.length) report.notes.push('Phân loại hàng: tự thêm theo bảng bên dưới (Shopee kiểm tra chặt phần này).');
    if (draft.images.length) await attachImages(draft, report);
    result.textContent =
      `Đã điền: ${report.filled.join(', ') || 'không có'}.` + (report.missing.length ? ` Chưa tìm thấy ô: ${report.missing.join(', ')} — hãy dán bằng nút Sao chép.` : '') +
      (report.notes.length ? ' ' + report.notes.join(' ') : '') + ' Kiểm tra ngành hàng, thuộc tính rồi tự bấm Đăng.';
    panel.dataset.diagnostics = JSON.stringify({url: location.pathname, found: list.length,
      controls: list.slice(0, 40).map(item => ({kind: item.kind, text: item.text.slice(0, 100), type: item.element.type || '', max: item.element.maxLength > 0 ? item.element.maxLength : 0}))}, null, 1);
    panel.querySelector('[data-diag]').hidden = false;
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  function mount(draft, platform) {
    const panel = document.createElement('div');
    panel.setAttribute('style', 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-height:80vh;overflow:auto;background:#fff;color:#222;border:2px solid #ee4d2d;border-radius:10px;padding:12px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)');
    const rows = [['Tên', draft.name], ['Giá', draft.price || ''], ['Kho hàng', draft.stock || ''], ['Ngành hàng', draft.category], ['Mô tả', draft.description]]
      .filter(([, value]) => value !== '' && value !== undefined);
    panel.innerHTML = `<strong style="color:#ee4d2d">MarketLens · bản nháp đăng ${platform === 'tiktok' ? 'TikTok Shop' : 'Shopee'}</strong>
      <div style="margin:6px 0">${esc(draft.name)}</div>
      <button data-fill style="background:#ee4d2d;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer">Tự điền biểu mẫu</button>
      <button data-diag hidden style="margin-left:6px;border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer">Sao chép chẩn đoán</button>
      <button data-close style="margin-left:6px;border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer">Ẩn</button>
      <div data-result style="margin:8px 0;color:#555">Bấm “Tự điền biểu mẫu” sau khi trang thêm sản phẩm đã tải xong. Tiện ích không tự bấm Đăng.</div>
      ${rows.map(([label, value], index) => `<div style="margin-top:4px"><button data-copy="${index}" style="border:1px solid #ccc;background:#f6f6f6;border-radius:4px;cursor:pointer">Sao chép</button> <b>${esc(label)}</b></div>`).join('')}
      ${draft.attributes.length ? `<div style="margin-top:8px"><b>Thuộc tính</b><br>${draft.attributes.map(item => `${esc(item.name)}: ${esc(item.value)}`).join('<br>')}</div>` : ''}
      ${draft.variants.length ? `<div style="margin-top:8px"><b>Phân loại</b><br>${draft.variants.map(item => `${esc(item.name)}: ${esc(item.options.join(', '))}`).join('<br>')}</div>` : ''}`;
    panel.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.close !== undefined) panel.remove();
      else if (target.dataset.diag !== undefined) navigator.clipboard?.writeText(panel.dataset.diagnostics || '');
      else if (target.dataset.fill !== undefined) { target.disabled = true; fill(draft, panel, platform).finally(() => { target.disabled = false; }); }
      else if (target.dataset.copy !== undefined) navigator.clipboard?.writeText(String(rows[Number(target.dataset.copy)][1]));
    });
    document.body.append(panel);
  }
  const here = location.hostname === 'seller-vn.tiktok.com' ? 'tiktok' : 'shopee';
  chrome.runtime.sendMessage({source: 'marketlens-seller', action: 'draft'}).then(reply => {
    if (reply?.ok && reply.draft && (reply.draft.target || 'shopee') === here) mount(reply.draft, here);
  }).catch(() => {});
})();
