'use strict';

// Keep dataset identity independent of changing price/status/progress cells.
function marketPaginationState(previous, identities, filter, requestedSize) {
  const sizes = [10, 20, 50, 100];
  const size = sizes.includes(previous?.size) ? previous.size : sizes.includes(Number(requestedSize)) ? Number(requestedSize) : 20;
  const signature = JSON.stringify(identities);
  const unchanged = previous?.filter === filter;
  const pages = Math.max(1, Math.ceil(identities.length / size));
  const page = Math.min(pages, Math.max(1, unchanged ? previous.page : 1));
  return {signature, filter, size, page, pages, total: identities.length};
}

function marketPaginationRange(state) {
  const start = state.total ? (state.page - 1) * state.size : 0;
  const end = Math.min(state.total, start + state.size);
  return {start, end, label: `${state.total ? start + 1 : 0}–${end} / ${state.total}`};
}

(() => {
  const states = new Map();
  const bindings = new Map();
  let root = null;
  let observer = null;
  let scheduled = false;
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const filterSelector = 'input.search,select.filter-select,[data-pagination-filter],.filter-row input,.filter-row select,.ma-filters select';
  const tableSelector = 'table.data-table';
  const listSelector = '[data-pagination-list],.opportunities-grid,.ma-trend-grid';
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const rowsOf = target => {
    if (target.tagName === 'TABLE') return Array.from(target.tBodies || []).flatMap(body => Array.from(body.rows))
      .filter(row => !(row.cells.length === 1 && row.cells[0].colSpan > 1));
    const children = Array.from(target.children).filter(child => !child.classList.contains('ml-pagination'));
    const marked = children.filter(child => child.hasAttribute('data-pagination-item'));
    if (marked.length) return marked;
    if (target.hasAttribute('data-pagination-list')) return children;
    return children.filter(child => child.matches('.opp-card,.opp-wide,.ma-trend-card,.product-comparison-card,article'));
  };
  const identity = row => {
    for (const attr of ['data-pagination-id', 'data-row-key', 'data-id']) {
      const value = row.getAttribute(attr);
      if (value) return `${attr}:${value}`;
    }
    if (row.id) return `id:${row.id}`;
    const product = row.querySelector('[data-product-key]');
    if (product) return `product:${product.getAttribute('data-product-key')}`;
    const category = row.querySelector('[data-ma-category]');
    if (category) return `category:${category.getAttribute('data-ma-category')}`;
    const link = row.querySelector('a[href]');
    if (link) return `link:${link.getAttribute('href')}`;
    if (row.cells?.length) return `cell:${clean(row.cells[0].textContent)}`;
    const title = row.querySelector('h2,h3,h4');
    return `title:${clean(title?.textContent)}|${clean(row.querySelector('.opp-meta')?.textContent)}`;
  };
  const viewKey = () => `${root.dataset.paginationView || document.querySelector('.nav-item.active')?.dataset.view || 'view'}|${root.dataset.paginationScope || document.getElementById('shopSelect')?.value || ''}`;
  const keyOf = (target, occurrences) => {
    const explicit = target.dataset.paginationKey;
    const panel = target.closest('.panel,section');
    const heading = panel?.querySelector('.panel-title,h2,h3,h4');
    const headingText = clean(heading?.textContent).replace(/\(\s*\d+\s*\)/g, '');
    const headers = Array.from(target.querySelectorAll('thead th')).map(node => clean(node.textContent)).join('|');
    const base = `${viewKey()}|${explicit || target.id || `${headingText}|${headers}|${target.className}`}`;
    const ordinal = occurrences.get(base) || 0;
    occurrences.set(base, ordinal + 1);
    return `${base}|${ordinal}`;
  };
  const filterKey = () => JSON.stringify(Array.from(root.querySelectorAll(filterSelector))
    .filter(control => !control.closest('.ml-pagination')).map(control => [control.id || control.name || '', control.value, control.checked]));

  function controlsFor(binding) {
    const toolbar = element('nav', 'ml-pagination');
    toolbar.setAttribute('aria-label', 'Phân trang danh sách');
    toolbar.dataset.paginationControl = binding.key;
    const count = element('span', 'ml-pagination-count');
    count.setAttribute('aria-live', 'polite');
    const sizeLabel = element('label', 'ml-pagination-size', 'Mỗi trang ');
    const select = element('select');
    select.setAttribute('aria-label', 'Số mục mỗi trang');
    select.dataset.paginationSize = binding.key;
    for (const size of [10, 20, 50, 100]) {
      const option = element('option', '', String(size));
      option.value = String(size);
      select.append(option);
    }
    sizeLabel.append(select);
    const navigation = element('div', 'ml-pagination-navigation');
    const buttons = {};
    for (const [action, text, label] of [['first', '«', 'Trang đầu'], ['prev', '‹', 'Trang trước'], ['next', '›', 'Trang sau'], ['last', '»', 'Trang cuối']]) {
      const button = element('button', 'ml-pagination-button', text);
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.dataset.paginationAction = action;
      button.dataset.paginationOwner = binding.key;
      buttons[action] = button;
      navigation.append(button);
      if (action === 'prev') {
        binding.pageLabel = element('span', 'ml-pagination-page');
        navigation.append(binding.pageLabel);
      }
    }
    toolbar.append(count, sizeLabel, navigation);
    const anchor = binding.target.tagName === 'TABLE' ? binding.target.closest('.table-wrap') || binding.target : binding.target;
    if (binding.target === root || binding.target.classList.contains('panel')) binding.target.append(toolbar);
    else anchor.after(toolbar);
    Object.assign(binding, {toolbar, count, select, buttons});
  }

  function apply(binding) {
    const state = states.get(binding.key);
    const range = marketPaginationRange(state);
    binding.rows.forEach((row, index) => row.classList.toggle('ml-pagination-hidden', index < range.start || index >= range.end));
    if (!binding.toolbar || !binding.toolbar.isConnected) controlsFor(binding);
    binding.toolbar.hidden = !state.total;
    const countLabel = `Hiển thị ${range.label} mục`;
    if (binding.count.textContent !== countLabel) binding.count.textContent = countLabel;
    const pageLabel = `Trang ${state.page} / ${state.pages}`;
    if (binding.pageLabel.textContent !== pageLabel) binding.pageLabel.textContent = pageLabel;
    binding.select.value = String(state.size);
    binding.buttons.first.disabled = binding.buttons.prev.disabled = state.page <= 1;
    binding.buttons.last.disabled = binding.buttons.next.disabled = state.page >= state.pages;
  }

  function refresh() {
    if (!root) return;
    observer?.disconnect();
    try {
      const occurrences = new Map();
      const filter = filterKey();
      const targets = new Set(root.querySelectorAll(`${tableSelector},${listSelector}`));
      for (const item of root.querySelectorAll('.opp-wide,.product-comparison-card')) {
        if (!item.parentElement?.hasAttribute('data-pagination-list')) targets.add(item.parentElement);
      }
      const previous = new Map(bindings);
      bindings.clear();
      for (const target of targets) {
        if (!target || target.matches('.competitor-products') || target.closest('[data-pagination="off"]')) continue;
        const key = keyOf(target, occurrences);
        const rows = rowsOf(target);
        const state = marketPaginationState(states.get(key), rows.map(identity), filter, target.dataset.paginationSize);
        states.set(key, state);
        const old = previous.get(key);
        const binding = old?.target === target ? old : {key, target};
        if (old && old.target !== target && old.toolbar?.isConnected) old.toolbar.remove();
        binding.rows = rows;
        bindings.set(key, binding);
        apply(binding);
      }
      for (const [key, binding] of previous) {
        if (bindings.has(key)) continue;
        binding.rows?.forEach(row => row.classList.remove('ml-pagination-hidden'));
        binding.toolbar?.remove();
      }
    } finally {
      observer?.observe(root, {childList: true, subtree: true, characterData: true});
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {scheduled = false; refresh();});
  }

  function click(event) {
    const button = event.target.closest('[data-pagination-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    const binding = bindings.get(button.dataset.paginationOwner);
    if (!binding) return;
    event.preventDefault();
    const state = states.get(binding.key);
    const action = button.dataset.paginationAction;
    state.page = action === 'first' ? 1 : action === 'last' ? state.pages :
      Math.min(state.pages, Math.max(1, state.page + (action === 'next' ? 1 : -1)));
    // No rerender is needed; product and run action handlers keep their nodes.
    apply(binding);
  }

  function change(event) {
    const select = event.target.closest('select[data-pagination-size]');
    if (!select || !root.contains(select)) {filterChanged(event); return;}
    const binding = bindings.get(select.dataset.paginationSize);
    if (!binding) return;
    const state = states.get(binding.key);
    if (![10, 20, 50, 100].includes(Number(select.value))) return;
    state.size = Number(select.value);
    state.page = 1;
    state.pages = Math.max(1, Math.ceil(state.total / state.size));
    apply(binding);
  }

  function filterChanged(event) {
    if (!event.target.matches(filterSelector) || event.target.closest('.ml-pagination')) return;
    const prefix = viewKey() + '|';
    for (const [key, state] of states) if (key.startsWith(prefix)) state.page = 1;
    schedule();
  }

  function init(container = document.getElementById('viewContainer')) {
    if (!container) return;
    if (root !== container) {
      observer?.disconnect();
      root?.removeEventListener('click', click);
      root?.removeEventListener('change', change);
      root?.removeEventListener('input', filterChanged);
      root = container;
      root.addEventListener('click', click);
      root.addEventListener('change', change);
      root.addEventListener('input', filterChanged);
      observer = new MutationObserver(schedule);
    }
    refresh();
  }

  window.MarketLensPagination = Object.freeze({init, refresh});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), {once: true});
  else init();
})();
