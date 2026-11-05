// Content script for banhang.shopee.vn/portal/product/*: fills the user's own "add product" form
// from a MarketLens draft.  It never presses Đăng/Lưu; the seller reviews and submits.
(() => {
  if (window.top !== window || window.__marketlensSellerFill) return;
  window.__marketlensSellerFill = true;
  const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const PATTERNS = {
    name: [/ten san pham/, /product name/],
    description: [/mo ta san pham/, /product description/, /mo ta/],
    price: [/gia ban le/, /gia ban/, /^\s*gia\b/, /\bgia\b.*(vnd|₫|d\b)/, /\bprice\b/],
    stock: [/hang co san/, /hang ton/, /kho hang/, /\bstock\b/, /so luong/],
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
    if (key === 'name') {
      return free.find(item => item.kind === 'input' && (item.element.maxLength > 60 || /ten|name/.test(fold(item.text))))?.element ||
        free.find(item => item.kind !== 'rich' && !item.element.readOnly && !item.element.value && item.element.getBoundingClientRect().width > 300)?.element || null;
    }
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
  // Shopee renders each section (Thông tin bán hàng, Vận chuyển…) only after its tab is opened or scrolled to,
  // so open every tab once, then return to the first.
  async function revealSections() {
    const tabs = [...document.querySelectorAll('[role=tab], [class*="tab"] li, [class*="tabs"] > *, [class*="anchor"] *')]
      .filter(el => visible(el) && el.children.length <= 1 && /^(thong tin (chi tiet|ban hang|khac)|mo ta|van chuyen|basic|specification|sales|shipping)/.test(fold(el.innerText).trim()));
    const seen = new Set();
    for (const tab of tabs) {
      const key = fold(tab.innerText).trim();
      if (seen.has(key)) continue;
      seen.add(key);
      tab.click();
      await pause(700);
    }
    const first = document.querySelector('[role=tab]');
    if (first) first.click();
    await pause(300);
  }
  // Scroll every scrollable area to the bottom and back so lazily rendered sections (price, stock, shipping) exist.
  async function scrollThrough() {
    const areas = [document.scrollingElement, ...document.querySelectorAll('div, main, section')]
      .filter(el => el && el.scrollHeight > el.clientHeight + 200 && /auto|scroll|visible/.test(getComputedStyle(el).overflowY) && el.clientHeight > 200);
    for (const area of areas.slice(0, 6)) {
      for (let step = 0; step < 12; step++) {
        area.scrollTop = Math.min(area.scrollHeight, area.scrollTop + area.clientHeight * 0.8);
        await pause(120);
        if (area.scrollTop + area.clientHeight >= area.scrollHeight - 4) break;
      }
      area.scrollTop = 0;
    }
  }
  // Last resort for a field: find the label text itself ("Giá", "Kho hàng"…) and take the first input after it.
  function inputAfterLabel(pattern, used) {
    const labels = [...document.querySelectorAll('div, span, label, p, h3, h4')].filter(el => {
      if (!visible(el) || el.children.length > 3) return false;
      const text = fold(el.innerText).replace(/[*:()?]/g, ' ').replace(/\s+/g, ' ').trim();
      return text.length <= 40 && pattern.test(text);
    });
    for (const label of labels) {
      for (let node = label, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
        const inputs = [...node.querySelectorAll(SELECTOR)].filter(input => visible(input) && !used.has(input) &&
          (label.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING) && !input.contains(label));
        if (inputs.length && node.querySelectorAll(SELECTOR).length <= 3) return inputs[0];
      }
    }
    return null;
  }
  const LABEL_PATTERNS = {price: /^gia( ban( le)?)?(\b.*d)?$/, stock: /^(kho hang|hang co san|hang ton)\b/, weight: /^(can nang|trong luong)\b/};
  // Heuristics for inputs whose label sits in a neighbouring element (price has a "đ" prefix, weight a "gr" suffix).
  function nearText(element) {
    let node = element.parentElement;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      if (node.querySelectorAll(SELECTOR).length > 1) break;
      const text = fold(node.innerText).replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  }
  function guessNumeric(list, key, used) {
    const free = list.filter(item => item.kind === 'input' && !used.has(item.element));
    // Seller Centre puts neither label near these inputs; use their position: stock holds the default "0",
    // price is the empty input right before it, weight is the one with the "gr" suffix.
    const all = list.filter(item => item.kind === 'input');
    const stockIndex = all.findIndex(item => item.element.value === '0');
    if (key === 'stock' && stockIndex >= 0 && !used.has(all[stockIndex].element)) return all[stockIndex].element;
    if (key === 'price' && stockIndex > 0 && all[stockIndex - 1].element.value === '' && !used.has(all[stockIndex - 1].element)) {
      const byPrefix = free.find(item => /^d$|^d\s|\sd$/.test(nearText(item.element)))?.element;
      return byPrefix || all[stockIndex - 1].element;
    }
    if (key === 'price') return free.find(item => /^d$|^d\s|\sd$/.test(nearText(item.element)))?.element || null;
    if (key === 'weight') return free.find(item => /\bgr?\b|\bg$|\bkg\b/.test(nearText(item.element)))?.element || null;
    return null;
  }
  // Dropdown fields (Thương hiệu, Xuất xứ…): open the select under the label, then click the matching option.
  async function chooseOption(labelPattern, value, report, label) {
    const labelEl = [...document.querySelectorAll('div, span, label, p')]
      .filter(el => visible(el) && el.children.length <= 2).find(el => {
        const text = fold(el.innerText).replace(/\s+/g, ' ').trim();
        return text.length < 60 && labelPattern.test(text);
      });
    if (!labelEl) return false;
    let box = null;
    for (let node = labelEl, depth = 0; node && depth < 4 && !box; node = node.parentElement, depth++) {
      box = node.querySelector('[class*="select"], [class*="dropdown"], input[readonly]');
    }
    if (!box) return false;
    box.scrollIntoView({block: 'center'});
    box.click();
    await pause(500);
    const wanted = fold(value);
    const searchBox = [...document.querySelectorAll('input[type=text], input:not([type])')].find(el => visible(el) && /search|tim|nhap/.test(fold(el.placeholder || '')));
    if (searchBox) { setValue(searchBox, value); await pause(600); }
    const options = [...document.querySelectorAll('[role=option], [class*="option"], [class*="select-item"], [class*="dropdown"] li, li')]
      .filter(el => visible(el) && el.children.length <= 3);
    const match = options.find(el => fold(el.innerText).trim() === wanted) || options.find(el => fold(el.innerText).includes(wanted));
    if (match) { match.click(); await pause(300); report.filled.push(label); return true; }
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    document.body.click();
    return false;
  }
  const ATTRIBUTE_FIELDS = [
    ['thương hiệu', /^\W*thuong hieu/, /^(brand|thuong hieu)$/],
    ['xuất xứ', /^\W*(quoc gia )?xuat xu/, /^(country of origin|xuat xu)$/],
  ];
  // Category: open the "Ngành hàng" picker, search the deepest segment of the copied path and click the best match.
  // TikTok lists "Đề xuất" categories under the name once it is typed; each row has an "Áp dụng" button.
  async function applySuggestedCategory(draft, report) {
    let buttons = [];
    for (let attempt = 0; attempt < (location.hostname === 'seller-vn.tiktok.com' ? 14 : 1) && !buttons.length; attempt++) {
      buttons = [...document.querySelectorAll('button, span, div, a')].filter(el => visible(el) && !panelOwns(el) && el.children.length === 0 && fold(el.innerText).trim() === 'ap dung');
      if (!buttons.length) await pause(500);
    }
    if (!buttons.length) return false;
    const leaf = fold(String(draft.category || '').split(/\s*[>/›»]\s*/).pop());
    const rowText = button => { let node = button.parentElement; for (let d = 0; node && d < 4; d++, node = node.parentElement) { if (node.querySelectorAll('button, [class*=btn]').length <= 2 && node.innerText.length > 15) return fold(node.innerText); } return ''; };
    const best = (leaf && buttons.find(button => rowText(button).includes(leaf))) || buttons[0];
    best.click();
    await pause(1500);
    report.filled.push('hạng mục (đề xuất đầu tiên)');
    return true;
  }
  async function chooseCategory(draft, report) {
    if (await applySuggestedCategory(draft, report)) return;
    const path = String(draft.category || '').split(/\s*[>/›»]\s*/).map(part => part.trim()).filter(Boolean);
    if (!path.length) return;
    const leaf = path[path.length - 1];
    const labelEl = [...document.querySelectorAll('div, span, label, p')].filter(el => visible(el) && el.children.length <= 2)
      .find(el => /^\W*(nganh hang|hang muc|danh muc|category)\W*$/.test(fold(el.innerText).replace(/\s+/g, ' ').trim()));
    let box = null;
    for (let node = labelEl, depth = 0; node && depth < 5 && !box; node = node.parentElement, depth++) {
      box = node.querySelector('input:not([type=file]), [class*="select"], [class*="cascader"], [class*="category"]');
    }
    if (!box) return report.missing.push('ngành hàng (không thấy ô chọn)');
    box.scrollIntoView({block: 'center'});
    box.click(); box.focus();
    await pause(800);
    const candidates = () => [...document.querySelectorAll('[role=option], [role=menuitem], [class*="option"], [class*="item"], [class*="cascader"] li, li')]
      .filter(el => visible(el) && el.children.length <= 4 && !panelOwns(el) && !el.contains(box));
    const textOf = el => fold(el.innerText).replace(/\s+/g, ' ').trim();
    // Click through the levels of the path (Ngành cấp 1 > cấp 2 > …), like a person would.
    let clicked = 0;
    for (const part of path) {
      const wanted = fold(part);
      const match = candidates().find(el => textOf(el) === wanted) || candidates().find(el => textOf(el).startsWith(wanted));
      if (!match) break;
      match.scrollIntoView({block: 'nearest'});
      match.click(); clicked++;
      await pause(700);
    }
    if (clicked < path.length) {
      // Fallback: type the last segment in the picker's search box and click the best match.
      const search = [...document.querySelectorAll('input')].find(el => visible(el) && !el.readOnly && /tim|search|nhap|nganh/.test(fold(el.placeholder || ''))) || (box.matches('input') && !box.readOnly ? box : null);
      if (search) { setValue(search, leaf); await pause(1000); }
      const wanted = fold(leaf);
      const match = candidates().find(el => textOf(el).endsWith(wanted)) || candidates().find(el => textOf(el).includes(wanted));
      if (!match) return report.missing.push(`ngành hàng "${leaf}" (chọn trong danh sách)`);
      match.click(); await pause(700);
    }
    const confirm = [...document.querySelectorAll('button')].find(el => visible(el) && !panelOwns(el) && /^(xac nhan|chon|ok|confirm|hoan tat)$/.test(textOf(el)));
    if (confirm) { confirm.click(); await pause(700); }
    report.filled.push('ngành hàng');
    await pause(1200);  // the rest of the form (variants, price, weight) appears after the category is set
  }
  const panelOwns = el => !!el.closest('[data-marketlens-panel]');
  // Re-encode as a real JPEG: the CDN often serves WebP under a .jpg name, which the seller sites accept but never finish processing.
  async function toJpeg(blob) {
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    } catch (error) { return null; }
  }
  const uploading = () => [...document.querySelectorAll('[class*="loading"], [class*="spin"], [class*="progress"]')].filter(el => visible(el) && !panelOwns(el)).length;
  // Upload one image at a time and wait for its spinner to finish, so the site's uploader is never flooded.
  async function attachImages(draft, report) {
    // Shopee has two image inputs: "image/*" (multiple) and ".jpg, .jpeg, .png" (single). Try the explicit one first;
    // if its spinner never finishes, switch to the other for the remaining images.
    const inputs = [...document.querySelectorAll('input[type=file]')].filter(item => /image|png|jpe?g/i.test(item.accept || ''))
      .sort((a, b) => Number(/image\/\*/.test(a.accept)) - Number(/image\/\*/.test(b.accept)));
    if (!inputs.length && document.querySelector('input[type=file]')) inputs.push(document.querySelector('input[type=file]'));
    if (!inputs.length) return report.missing.push('ảnh sản phẩm (không thấy ô tải ảnh)');
    let current = 0, sent = 0;
    for (let index = 0; index < Math.min(draft.images.length, 9); index++) {
      const reply = await chrome.runtime.sendMessage({source: 'marketlens-seller', action: 'image', index});
      if (!reply?.ok) { report.notes.push(`Ảnh ${index + 1}: ${reply?.error || 'không tải được'}`); continue; }
      const bytes = Uint8Array.from(atob(reply.base64), char => char.charCodeAt(0));
      const jpeg = await toJpeg(new Blob([bytes], {type: reply.type}));
      const file = jpeg ? new File([jpeg], `marketlens-${index + 1}.jpg`, {type: 'image/jpeg'}) : new File([bytes], `marketlens-${index + 1}.${reply.type.includes('png') ? 'png' : 'jpg'}`, {type: reply.type});
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = inputs[current];
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', {bubbles: true}));
      sent++;
      await pause(1500);
      for (let waited = 0; waited < 15000 && uploading(); waited += 500) await pause(500);
      if (uploading() && current + 1 < inputs.length) { current++; report.notes.push('Ô tải ảnh thứ nhất không xong, đã thử ô còn lại.'); }
    }
    if (!sent) return report.missing.push('ảnh sản phẩm');
    report.filled.push(`${sent} ảnh`);
  }
  // The video comes from the background in 3MB chunks and is put into the "Thêm video" file input.
  async function attachVideo(draft, report) {
    const files = [...document.querySelectorAll('input[type=file]')];
    const input = files.find(item => /video|mp4|mov/i.test(item.accept || '')) ||
      (files.length > 1 ? files.find(item => !/image|png|jpe?g/i.test(item.accept || '') && !item.multiple) || files[files.length - 1] : null);
    if (!input) return report.missing.push('video (không thấy ô tải video)');
    const parts = [];
    let total = Infinity, offset = 0, type = 'video/mp4';
    while (offset < total) {
      const reply = await chrome.runtime.sendMessage({source: 'marketlens-seller', action: 'video', offset});
      if (!reply?.ok) return report.missing.push(`video (${reply?.error || 'không tải được'})`);
      total = reply.total; type = reply.type;
      const bytes = Uint8Array.from(atob(reply.base64), char => char.charCodeAt(0));
      if (!bytes.length) break;
      parts.push(bytes); offset += bytes.length;
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File(parts, 'marketlens-video.mp4', {type}));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
    report.filled.push('video');
    report.notes.push('Video cần vài phút để Shopee xử lý trước khi hiển thị.');
  }
  const clean = (text, platform) => platform === 'tiktok' ? String(text || '').replace(/\bshopee\b/gi, '').replace(/[ \t]{2,}/g, ' ') : text;
  // "Dimension (L x W x H): 50*30*38cm" → package size for TikTok's Chiều dài / rộng / cao.
  function packageSize(draft) {
    const attribute = draft.attributes.find(item => /dimension|kich thuoc/.test(fold(item.name)));
    const numbers = String(attribute?.value || '').match(/\d+(?:[.,]\d+)?/g);
    return numbers && numbers.length >= 3 ? {length: numbers[0], width: numbers[1], height: numbers[2]} : null;
  }
  function fillPackageSize(draft, report) {
    const size = packageSize(draft);
    if (!size) return;
    const fields = [['length', /chieu dai|length/], ['width', /chieu rong|width/], ['height', /chieu cao|height/]];
    let done = 0;
    for (const [key, pattern] of fields) {
      const item = controls().find(entry => entry.kind === 'input' && !entry.element.value && pattern.test(fold(entry.element.getAttribute('placeholder') || '')));
      if (item) { setValue(item.element, size[key].replace(',', '.')); done++; }
    }
    if (done) report.filled.push('kích thước kiện hàng');
  }
  // Shopee's "Thêm 1 sản phẩm mới" has two steps: (1) images + title, then "Tiếp theo", (2) the full form.
  const stored = key => { try { return sessionStorage.getItem(`marketlens-${key}`) === '1'; } catch (error) { return false; } };
  const remember = key => { try { sessionStorage.setItem(`marketlens-${key}`, '1'); } catch (error) { /* ignore */ } };
  const imagesDone = () => stored('images');
  const nextButton = () => [...document.querySelectorAll('button')].find(el => visible(el) && !panelOwns(el) && fold(el.innerText).trim() === 'tiep theo');
  const hasFullForm = () => [...document.querySelectorAll('div, span, li, a')].some(el => visible(el) && !panelOwns(el) && el.children.length === 0 && /^(thong tin ban hang|van chuyen)$/.test(fold(el.innerText).trim()));
  const isStepOne = () => !hasFullForm() && !!nextButton();
  async function waitFor(test, ms) {
    for (let waited = 0; waited < ms; waited += 400) { if (test()) return true; await pause(400); }
    return !!test();
  }
  async function stepOne(draft, panel) {
    const result = panel.querySelector('[data-result]');
    const report = {filled: [], missing: [], notes: []};
    result.textContent = 'Bước 1: đang đăng ảnh và nhập tên…';
    await waitFor(() => document.querySelector('input[type=file]'), 8000);
    if (draft.images.length && !imagesDone()) { await attachImages(draft, report); remember('images'); await pause(2500); }
    const name = controls().find(item => item.kind !== 'rich' && /ten san pham|product name/.test(fold(item.text)) || (item.kind === 'input' && item.element.maxLength === 120));
    if (name) setValue(name.element, String(draft.name || '').trim().slice(0, 120));
    await pause(800);
    if (await waitFor(() => { const button = nextButton(); return button && !button.disabled && !button.className.includes('disabled'); }, 15000)) {
      nextButton().click();
      result.textContent = 'Bước 1 xong, đang chờ biểu mẫu chi tiết…';
      await waitFor(hasFullForm, 25000);
      await pause(1500);
    } else result.textContent = 'Bước 1: nút "Tiếp theo" chưa bật — kiểm tra ảnh/tên rồi bấm Tự điền lại.';
  }
  async function run(draft, panel, platform) {
    if (platform === 'shopee' && isStepOne()) await stepOne(draft, panel);
    await fill(draft, panel, platform);
    remember(autoKey(draft));
  }
  const autoKey = draft => `auto-${draft.id || draft.name}`;
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
    await scrollThrough();
    await revealSections();
    list = controls();
    if (!list.some(item => /gia|price/.test(fold(item.text)))) { await scrollThrough(); await pause(600); list = controls(); }
    const used = new Set();
    for (const [key, label, value, kinds] of [
      ['name', 'tên', clean(draft.name, platform), ['input', 'textarea', 'rich']], ['description', 'mô tả', clean(draft.description, platform), ['textarea', 'rich', 'input']],
      ['price', 'giá', draft.price || '', ['input']], ['stock', 'kho hàng', draft.stock || '', ['input']],
      ['weight', 'cân nặng', draft.weight_g || '', ['input']]]) {
      if (key === 'description' && draft.category) { await chooseCategory(draft, report); list = controls(); }
      if (value === '' || value === 0) { if (key !== 'name' && key !== 'description') report.notes.push(`${label}: bản nháp để trống/0 nên không điền (sửa ở trang bản nháp).`); continue; }
      if (key === 'weight' || key === 'price') list = controls();
      const find = () => pick(list, key, kinds, used) || guess(list, key, used) || guessNumeric(list, key, used) || (LABEL_PATTERNS[key] ? inputAfterLabel(LABEL_PATTERNS[key], used) : null);
      let element = find();
      if (!element && key === 'weight') { await scrollThrough(); await pause(1500); list = controls(); element = find(); }  // weight appears only after price is set
      if (element) { used.add(element); setValue(element, value); report.filled.push(label); await pause(150); } else report.missing.push(label);
    }
    for (const [label, pattern, nameMatch] of ATTRIBUTE_FIELDS) {
      const attribute = draft.attributes.find(item => nameMatch.test(fold(item.name).trim()));
      if (attribute?.value && !(await chooseOption(pattern, attribute.value, report, label))) report.missing.push(`${label} (chọn trong danh sách)`);
    }
    if (draft.variants.length) report.notes.push('Phân loại hàng: tự thêm theo bảng bên dưới (Shopee kiểm tra chặt phần này).');
    if (platform === 'tiktok') fillPackageSize(draft, report);
    if (draft.images.length && !imagesDone()) await attachImages(draft, report);
    if (draft.video) await attachVideo(draft, report);
    result.textContent =
      `Đã điền: ${report.filled.join(', ') || 'không có'}.` + (report.missing.length ? ` Chưa tìm thấy ô: ${report.missing.join(', ')} — hãy dán bằng nút Sao chép.` : '') +
      (report.notes.length ? ' ' + report.notes.join(' ') : '') + ' Kiểm tra ngành hàng, thuộc tính rồi tự bấm Đăng.';
    const labelsSeen = [...document.querySelectorAll('div, span, label, h3, h4')].filter(el => visible(el) && el.children.length === 0 && /^(\*\s*)?(gia|kho hang|can nang|thuong hieu)\b/.test(fold(el.innerText).trim())).slice(0, 12).map(el => el.innerText.trim());
    panel.dataset.diagnostics = JSON.stringify({url: location.pathname, result: result.textContent.slice(0, 600), spinners: uploading(), found: list.length, labelsSeen,
      iframes: document.querySelectorAll('iframe').length, files: [...document.querySelectorAll('input[type=file]')].map(item => ({accept: item.accept || '', multiple: item.multiple})),
      categoryLabels: [...document.querySelectorAll('div, span, label')].filter(el => visible(el) && el.children.length === 0 && /^(nganh hang|danh muc|ten san pham|can nang|trong luong|video)/.test(fold(el.innerText).trim())).slice(0, 12).map(el => el.innerText.trim()),
      controls: list.slice(0, 40).map(item => ({kind: item.kind, text: item.text.slice(0, 100), type: item.element.type || '', placeholder: item.element.getAttribute('placeholder') || '', max: item.element.maxLength > 0 ? item.element.maxLength : 0}))}, null, 1);
    panel.querySelector('[data-diag]').hidden = false;
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  function mount(draft, platform) {
    const panel = document.createElement('div');
    panel.dataset.marketlensPanel = '1';
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
      else if (target.dataset.fill !== undefined) { target.disabled = true; run(draft, panel, platform).finally(() => { target.disabled = false; }); }
      else if (target.dataset.copy !== undefined) navigator.clipboard?.writeText(String(rows[Number(target.dataset.copy)][1]));
    });
    document.body.append(panel);
    return panel;
  }
  const here = location.hostname === 'seller-vn.tiktok.com' ? 'tiktok' : 'shopee';
  chrome.runtime.sendMessage({source: 'marketlens-seller', action: 'draft'}).then(reply => {
    if (reply?.ok && reply.draft && (reply.draft.target || 'shopee') === here) {
      const panel = mount(reply.draft, here);
      // Start by itself once per browser tab and draft (the seller can still press the button to run it again).
      if (!stored(autoKey(reply.draft))) { setTimeout(() => panel.querySelector('[data-fill]')?.click(), 1500); }
    }
  }).catch(() => {});
})();
