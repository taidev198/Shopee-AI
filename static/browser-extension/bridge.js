// This bridge is deliberately limited to the MarketLens app window (local or the Render deployment).
(() => {
  const origins = new Set(['http://127.0.0.1:8000', 'http://localhost:8000', 'https://shopee-ai.onrender.com']);
  if (window.top !== window || !origins.has(window.location.origin)) return;
  const pending = new Set();
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.source !== 'marketlens-app' ||
        !['ping', 'collect', 'detail', 'discover', 'categories', 'category'].includes(message.action) ||
        typeof message.requestId !== 'string' || !message.requestId ||
        message.requestId.length > 128 || pending.has(message.requestId)) return;
    pending.add(message.requestId);
    const reply = {source: 'marketlens-extension', requestId: message.requestId};
    try {
      const response = await chrome.runtime.sendMessage({
        source: 'marketlens-bridge', action: message.action,
        requestId: message.requestId, url: message.url,
        query: message.query, ownShopUrl: message.ownShopUrl,
      });
      if (!response || typeof response.ok !== 'boolean') {
        throw new Error('Tiện ích không trả kết quả. Hãy tải lại tiện ích và trang MarketLens.');
      }
      window.postMessage({...reply, ...response}, window.location.origin);
    } catch (error) {
      window.postMessage({...reply, ok: false, code: 'bridge_unavailable',
        error: error.message || String(error)}, window.location.origin);
    } finally {
      pending.delete(message.requestId);
    }
  });
})();
