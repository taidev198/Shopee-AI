'use strict';

// This bridge talks to the installed MarketLens extension in this browser.
// Every collect request reads the live shop DOM; it never loads a saved export.
(() => {
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== 'marketlens-extension') return;
    const request = pending.get(message.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.requestId);
    if (message.ok) request.resolve(message.result);
    else {
      if (message.blocked === true || message.verificationRequired === true) {
        try {
          window.dispatchEvent(new CustomEvent('marketlens:verification',
            {detail: {message: message.error || '', verificationRequired: message.verificationRequired === true}}));
        } catch {}
      }
      request.reject(Object.assign(new Error(message.error || 'Chrome không đọc được trang shop.'),
      {blocked: message.blocked === true, verificationRequired: message.verificationRequired === true,
        retryable: message.retryable === true,
        inspectionRequired: message.inspectionRequired === true,
        code: message.blocked ? 'blocked' : message.code}));
    }
  });

  function request(action, data, timeout) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Object.assign(new Error(action === 'ping'
          ? 'Chưa kết nối tiện ích MarketLens trong Chrome. Hãy nạp tiện ích một lần rồi tải lại trang.'
          : 'Chrome không trả kết quả trong thời gian cho phép. Kiểm tra trang shop và thử lại.'), {code: 'bridge_timeout'}));
      }, timeout);
      pending.set(requestId, {resolve, reject, timer});
      window.postMessage({source: 'marketlens-app', requestId, action, ...data}, location.origin);
    });
  }

  window.MarketLensChrome = Object.freeze({
    categories: () => request('categories', {}, 45000),
    category: url => request('category', {url}, 45000),
    ping: () => request('ping', {}, 1500),
    collect: url => request('collect', {url}, 240000),
    detail: url => request('detail', {url}, 120000),
    discover: (query, ownShopUrl) => request('discover', {query, ownShopUrl}, 150000),
  });
})();
