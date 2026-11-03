'use strict';

// Shopee sometimes stops a collection with a login/verification page. A one-line
// status is easy to miss, so every such stop also opens a dialog that says what to do.
(() => {
  const ID = 'shopeeVerificationAlert';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);

  function show(detail = {}) {
    const existing = document.getElementById(ID);
    if (existing) existing.remove();
    const keptTab = detail.verificationRequired === true;
    const layer = document.createElement('div');
    layer.id = ID;
    layer.className = 'modal-layer';
    layer.setAttribute('role', 'alertdialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', ID + 'Title');
    layer.innerHTML = `<div class="modal"><div class="modal-head"><div><span class="eyebrow">CẦN BẠN XỬ LÝ</span><h2 id="${ID}Title">Shopee yêu cầu xác minh hoặc đăng nhập</h2></div><button class="close" type="button" data-verification-close aria-label="Đóng">×</button></div>
      <p class="muted">Lượt thu thập đã dừng để tránh bị chặn. Dữ liệu đã đọc xong trước đó vẫn được giữ.</p>
      <ol class="muted"><li>${keptTab ? 'Chuyển sang <strong>tab Shopee đang được giữ mở</strong>' : 'Mở <strong>shopee.vn</strong> trong Chrome này'} và hoàn tất xác minh hoặc đăng nhập.</li>
      <li>Khi trang Shopee hiển thị bình thường, quay lại trang này và <strong>bấm lại nút thu thập</strong> (Quét sản phẩm / Chạy tiếp tục).</li></ol>
      ${detail.message ? `<p class="fine-print">Chi tiết: ${esc(detail.message)}</p>` : ''}
      <div class="modal-actions"><button class="btn btn-primary" type="button" data-verification-close autofocus>Đã hiểu</button></div></div>`;
    layer.addEventListener('click', event => {
      if (event.target === layer || event.target.closest('[data-verification-close]')) layer.remove();
    });
    document.body.appendChild(layer);
    layer.querySelector('[data-verification-close].btn')?.focus();
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.getElementById(ID)?.remove();
  });
  window.addEventListener('marketlens:verification', event => show(event.detail || {}));
  window.MarketLensVerificationAlert = Object.freeze({show});
})();
