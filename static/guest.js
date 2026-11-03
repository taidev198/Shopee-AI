'use strict';

function guestContribution(values, price = values.price) {
  const fee = price * values.fee / 100;
  const contribution = price - values.cost - fee - values.packaging - values.ad_cost_per_order;
  return {price, fee, contribution, margin: price > 0 ? contribution / price * 100 : null,
    breakEven: Math.ceil((values.cost + values.packaging + values.ad_cost_per_order) / (1 - values.fee / 100))};
}

(() => {
  function init() {
    const money = value => new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 0}).format(value) + ' ₫';
    const percent = value => new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 1}).format(value) + '%';
    const byId = id => document.getElementById(id);
    const tabs = [...document.querySelectorAll('[data-module]')];
    const fields = [...byId('priceCalculator').querySelectorAll('input')];
    let selectedPrice = 109000;
    let currentValues = null;
    let strategyText = '';

    function switchModule(module, focus = false) {
      const selected = tabs.find(tab => tab.dataset.module === module);
      if (!selected) return;
      for (const tab of tabs) {
        const active = tab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        byId(tab.getAttribute('aria-controls')).hidden = !active;
      }
      if (focus) selected.focus();
    }
    for (const tab of tabs) {
      tab.addEventListener('click', () => switchModule(tab.dataset.module));
      tab.addEventListener('keydown', event => {
        const index = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
          event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
        if (next === null) return;
        event.preventDefault();
        switchModule(tabs[next].dataset.module, true);
      });
    }
    for (const link of document.querySelectorAll('[data-open-module]')) link.addEventListener('click', () => switchModule(link.dataset.openModule));
    for (const button of document.querySelectorAll('[data-switch]')) button.addEventListener('click', () => {
      switchModule(button.dataset.switch, true);
      byId('xem-thu').scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    });

    function updateStrategy() {
      if (!currentValues) {
        byId('strategyRecommendation').textContent = 'Hoàn tất giả định trước khi lập kế hoạch';
        byId('strategyRationale').textContent = 'Nhập các chi phí hợp lệ trong Price Optimizer để tính kịch bản và sao chép kế hoạch.';
        byId('strategyBasis').textContent = 'Giả định hiện tại chưa hợp lệ; chưa có kết quả tính toán.';
        byId('copyStrategy').disabled = true;
        strategyText = '';
        return;
      }
      const baseline = guestContribution(currentValues);
      const scenario = guestContribution(currentValues, selectedPrice);
      const change = scenario.contribution - baseline.contribution;
      byId('strategyRecommendation').textContent = `Thử nghiệm giá ${money(selectedPrice)} cho sản phẩm A`;
      byId('strategyRationale').textContent = change > 0 ?
        `Lãi đóng góp giả định mỗi đơn tăng ${money(change)}, lên ${money(scenario.contribution)} nếu chi phí không đổi. Cần đo số đơn và chuyển đổi để biết tác động đến lợi nhuận tổng.` : change < 0 ?
        `Lãi đóng góp giả định mỗi đơn giảm ${money(-change)}, còn ${money(scenario.contribution)}. Chỉ cân nhắc thử nếu có cơ sở rõ ràng về phản ứng khách hàng; chưa dự báo được số đơn.` :
        `Lãi đóng góp giả định mỗi đơn là ${money(scenario.contribution)}, bằng mức hiện tại. Có thể giữ giá để đo dữ liệu nền trước khi chọn một thay đổi.`;
      byId('strategyBasis').textContent = `Giá vốn ${money(currentValues.cost)}; phí giả định ${percent(currentValues.fee)}; đóng gói ${money(currentValues.packaging)}; quảng cáo phân bổ ${money(currentValues.ad_cost_per_order)} mỗi đơn. Chưa tính thuế và chi phí còn thiếu.`;
      byId('copyStrategy').disabled = false;
      strategyText = [
        'MARKETLENS — KẾ HOẠCH MÔ PHỎNG, KHÔNG PHẢI KHUYẾN NGHỊ TỪ DỮ LIỆU SHOP THẬT',
        byId('strategyRecommendation').textContent, byId('strategyRationale').textContent,
        'Cơ sở: ' + byId('strategyBasis').textContent,
        'Kế hoạch: thử trong 7 ngày; so sánh số đơn, tỷ lệ chuyển đổi và tổng lãi đóng góp với dữ liệu nền trong điều kiện tương đương.',
        'Điều kiện dừng: đặt ngưỡng giảm của tổng lãi và chuyển đổi trước khi thử; dừng để xem xét khi một ngưỡng bị vượt.',
        'Mức tin cậy: chưa có dữ liệu để dự báo tác động đến số đơn.',
        'Chỉ là ví dụ giao diện; không thay đổi giá hoặc thực hiện hành động trên Shopee.',
      ].join('\n\n');
    }

    function updateCalculator() {
      const values = {};
      for (const input of fields) values[input.name] = input.value.trim() === '' ? NaN : Number(input.value);
      const valid = fields.every(input => Number.isFinite(values[input.name]) && values[input.name] >= 0 &&
        values[input.name] <= (input.name === 'fee' ? 99.9 : 1000000000));
      currentValues = valid ? values : null;
      byId('calculatorError').hidden = valid;
      byId('calculatorError').textContent = valid ? '' : 'Nhập đủ các giá trị không âm. Phí từ 0 đến 99,9%; các khoản tiền tối đa 1 tỷ đồng.';
      byId('copyStatus').textContent = '';
      byId('strategyCopyFallback').hidden = true;
      if (!valid) {
        for (const id of ['contributionValue', 'contributionMargin', 'breakEvenValue']) byId(id).textContent = '—';
        byId('priceScenarios').replaceChildren();
        updateStrategy();
        return;
      }
      const baseline = guestContribution(values);
      byId('contributionValue').textContent = money(baseline.contribution);
      byId('contributionValue').parentElement.classList.toggle('is-negative', baseline.contribution < 0);
      byId('contributionMargin').textContent = baseline.margin === null ? 'Không tính khi giá bằng 0' : percent(baseline.margin);
      byId('breakEvenValue').textContent = money(baseline.breakEven);
      const scenarios = [89000, 99000, 109000].map((price, index) => {
        const calculation = guestContribution(values, price);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'scenario';
        button.setAttribute('aria-pressed', String(price === selectedPrice));
        button.setAttribute('aria-label', `Chọn kịch bản giá ${money(price)}, lãi đóng góp ${money(calculation.contribution)} mỗi đơn`);
        const label = document.createElement('span'); label.textContent = `KỊCH BẢN ${index + 1}${price === values.price ? ' · HIỆN TẠI' : ''}`;
        const amount = document.createElement('strong'); amount.textContent = money(price);
        const profit = document.createElement('small'); profit.textContent = 'Lãi giả định / đơn';
        const profitAmount = document.createElement('b'); profitAmount.textContent = money(calculation.contribution); profit.append(profitAmount);
        const mark = document.createElement('i'); mark.textContent = price === selectedPrice ? '✓' : ''; mark.setAttribute('aria-hidden', 'true');
        button.append(label, amount, profit, mark);
        button.addEventListener('click', () => {selectedPrice = price; updateCalculator();});
        return button;
      });
      byId('priceScenarios').replaceChildren(...scenarios);
      updateStrategy();
    }
    fields.forEach(field => field.addEventListener('input', updateCalculator));
    byId('priceCalculator').addEventListener('submit', event => {event.preventDefault(); updateCalculator();});
    byId('resetCalculator').addEventListener('click', () => {byId('priceCalculator').reset(); selectedPrice = 109000; updateCalculator();});
    byId('copyStrategy').addEventListener('click', async () => {
      if (!strategyText) return;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(strategyText);
        byId('copyStatus').textContent = 'Đã sao chép kế hoạch mô phỏng. Chưa thực hiện thay đổi nào trên Shopee.';
      } catch {
        const fallback = byId('strategyCopyFallback');
        fallback.value = strategyText;
        fallback.hidden = false;
        fallback.focus(); fallback.select();
        byId('copyStatus').textContent = 'Trình duyệt chưa cho phép ghi clipboard. Kế hoạch đã được chọn bên dưới để bạn sao chép thủ công.';
      }
    });

    const actions = [
      {title: 'Đối soát giá vốn của nhóm lợi nhuận thấp', priority: 'Cao', due: 'Hôm nay'},
      {title: 'Thử tiêu đề và ảnh đại diện sản phẩm A', priority: 'Cao', due: '3 ngày'},
      {title: 'Kiểm tra ngân sách quảng cáo phân bổ', priority: 'Cao', due: '3 ngày'},
      {title: 'So giá với mặt hàng có cùng quy cách', priority: 'Trung bình', due: '5 ngày'},
      {title: 'Đánh giá một phương án nhập thử nhỏ', priority: 'Trung bình', due: '7 ngày'},
    ];
    const statuses = ['Chưa thực hiện', 'Đang thực hiện', 'Hoàn thành'];
    for (const [index, action] of actions.entries()) {
      const item = document.createElement('div'); item.className = 'action-item';
      const bullet = document.createElement('span'); bullet.className = 'action-bullet'; bullet.textContent = String(index + 1); bullet.setAttribute('aria-hidden', 'true');
      const body = document.createElement('div'); const title = document.createElement('h4'); title.textContent = action.title;
      const meta = document.createElement('div'); meta.className = 'action-item-meta';
      const priority = document.createElement('span'); priority.className = 'priority' + (action.priority === 'Trung bình' ? ' medium' : ''); priority.textContent = action.priority;
      const due = document.createElement('span'); due.textContent = action.due;
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Trạng thái: ' + action.title);
      for (const status of statuses) {const option = document.createElement('option'); option.value = status; option.textContent = status; select.append(option);}
      action.status = statuses[0];
      select.addEventListener('change', () => {
        action.status = select.value;
        const done = action.status === 'Hoàn thành'; item.classList.toggle('is-done', done); bullet.textContent = done ? '✓' : String(index + 1);
        byId('actionProgress').textContent = `${actions.filter(entry => entry.status === 'Hoàn thành').length} / ${actions.length} hoàn thành`;
      });
      meta.append(priority, due, select); body.append(title, meta); item.append(bullet, body); byId('demoActions').append(item);
    }
    updateCalculator();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
