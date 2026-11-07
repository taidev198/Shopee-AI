'use strict';
function marketSavedConcurrency() {
  try {const value=window.localStorage?.getItem('marketlens.categoryConcurrency'); if(value==='all')return value; if([2,4].includes(Number(value)))return Number(value);} catch {}
  return 4;
}
const marketState = {categories: [], runs: [], products: [], stats: {}, busy: false, stop: false, filter: '', message: '', loaded: false, schedules: [], polling: false, autoPaused: false, connection: 'Chờ kết nối Chrome', chromeInfo: null, chromeError: '', chromeCheckedAt: 0, chromeChecking: false, runner: null, concurrency: marketSavedConcurrency()};
const MARKET_MAX_PARALLEL=4;
const MARKET_DETAIL_ATTEMPTS=2;
const marketPost = (path, body) => api('/api/category-market' + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
let marketChromeProbe;
function marketChromeStatus() {
  const m=marketState, info=m.chromeInfo;
  if (m.chromeChecking) return 'Đang kiểm tra kết nối tiện ích Chrome…';
  if (!info) return m.chromeError || 'Đang chờ kiểm tra tiện ích MarketLens trong Chrome…';
  const version=info.version ? `v${info.version}` : 'chưa rõ phiên bản';
  if (info.capabilities?.categories && info.capabilities?.categoryCatalog && info.capabilities?.verificationPause && info.capabilities?.categoryCardsV2 && marketConcurrencySupported(info)) return `Chrome đã kết nối · MarketLens ${version} · sẵn sàng đọc toàn bộ hàng đợi, tối đa ${marketConcurrencyLimit(marketState.concurrency,info)} tab cùng lúc.${info.capabilities?.tabEditRetry?' Tự chờ khi Chrome tạm khóa thao tác tab.':''}`;
  const limitation=info.capabilities?.categories && info.capabilities?.categoryCatalog
    ? (info.capabilities?.verificationPause ? (info.capabilities?.categoryCardsV2?`chưa hỗ trợ mức ${marketState.concurrency==='all'?'tất cả danh mục':marketState.concurrency+' ngành đồng thời'} đã chọn`:'chưa hỗ trợ bố cục danh sách ngành hàng mới của Shopee') : 'hỗ trợ đọc ngành hàng nhưng chưa hỗ trợ giữ tab khi Shopee yêu cầu xác minh')
    : 'chưa hỗ trợ đọc đầy đủ danh mục';
  return `Chrome đang kết nối MarketLens ${version}, ${limitation}. Bấm ↻ Reload tiện ích MarketLens 1.3.7 trong chrome://extensions, rồi tải lại MarketLens.`;
}
function marketConcurrencySupported(info,selection=marketState.concurrency) {
  const required=Math.min(MARKET_MAX_PARALLEL,selection==='all'?MARKET_MAX_PARALLEL:Number(selection));
  return Number(info?.capabilities?.categoryParallel)>=required;
}
function marketConcurrencyLimit(selection,info) {
  return Math.min(MARKET_MAX_PARALLEL,Number(info.capabilities.categoryParallel),selection==='all'?MARKET_MAX_PARALLEL:Number(selection));
}
function marketConcurrencyControl() {
  const limit=Math.min(MARKET_MAX_PARALLEL,Number(marketState.chromeInfo?.capabilities?.categoryParallel)||MARKET_MAX_PARALLEL);
  return `<label class="market-concurrency">Số ngành chạy đồng thời<select id="marketConcurrency">${[2,4,'all'].map(value=>`<option value="${value}" ${marketState.concurrency===value?'selected':''}>${value==='all'?'Toàn bộ ngành · tối đa '+limit+' tab':value>limit?value+' ngành · tối đa '+limit+' tab':value+' ngành'}</option>`).join('')}</select><small>Toàn bộ ngành được xếp hàng; tối đa ${limit} tab đọc sản phẩm cùng lúc. Ngành tiếp theo bắt đầu khi một ngành hoàn tất để tránh mở quá nhiều tab.</small></label>`;
}
async function probeMarketChrome(force = false) {
  if (marketChromeProbe) return marketChromeProbe;
  if (!force && marketState.chromeCheckedAt && Date.now()-marketState.chromeCheckedAt<30000) return marketState.chromeInfo;
  marketState.chromeChecking=true;
  marketChromeProbe=(async()=>{
    await Promise.resolve();
    try {
      if (!window.MarketLensChrome?.ping) throw new Error('Mở MarketLens trong Chrome đã nạp tiện ích, rồi tải lại trang.');
      const info=await window.MarketLensChrome.ping();
      if (!info || typeof info!=='object') throw new Error('Tiện ích chưa trả thông tin kết nối. Tải lại tiện ích và trang MarketLens.');
      marketState.chromeInfo=info; marketState.chromeError='';
      return info;
    } catch(e) {
      marketState.chromeInfo=null; marketState.chromeError='Chưa kết nối Chrome: '+e.message;
      return null;
    } finally {
      marketState.chromeChecking=false; marketState.chromeCheckedAt=Date.now(); marketChromeProbe=null;
    }
  })();
  return marketChromeProbe;
}
function marketExplain(message) {
  marketState.message=message; marketRender(); toast(message);
}
function marketTabBusy(error) {
  return error?.code==='chrome_tabs_busy' || /Tabs cannot be edited right now|user may be dragging a tab/i.test(String(error?.message||error||''));
}
function marketRunResumable(run) {
  return !run.superseded && (['pending','paused'].includes(run.status) || (run.status==='partial' && Number(run.failed)>0));
}
function marketPreferredRun(run) {
  if (run.category_id==null || run.category_id==='') return true;
  const same=marketState.runs.filter(other=>String(other.category_id)===String(run.category_id) && marketRunResumable(other));
  same.sort((a,b)=>(a.status==='partial')-(b.status==='partial') || String(b.created_at||'').localeCompare(String(a.created_at||'')));
  return !same.length || same[0].id===run.id;
}
function marketRunAvailable(run) {
  if (!marketRunResumable(run) || !marketPreferredRun(run)) return false;
  const runner=marketState.runner, entry=runner?.assigned.get(run.id);
  if (marketState.busy && (!runner || !runner.accepting || marketState.stop)) return false;
  if (run.category_id!=null && [...(runner?.assigned.values()||[])].some(other=>other.id!==run.id && ['queued','active'].includes(other.state) && other.categoryKey===String(run.category_id))) return false;
  if (runner?.active.has(run.id) || runner?.queue.some(item=>item.id===run.id)) return false;
  return !entry || ['paused','partial'].includes(entry.state);
}
function marketErrorRuns() {
  return marketState.runs.filter(run=>marketRunAvailable(run) && (run.status==='paused' || Number(run.failed)>0));
}
function marketRetryErrorsButton(id) {
  const count=marketErrorRuns().length;
  return `<button class="btn btn-soft" id="${id}" ${!count?'disabled':''}>Thử lại tất cả lỗi (${count})</button>`;
}
function marketRunActions(run) {
  if (!marketRunResumable(run)) return '—';
  const retry=run.status==='partial';
  const entry=marketState.runner?.assigned.get(run.id);
  const label=!marketPreferredRun(run)?'Đã có lượt mới cùng ngành':entry?.state==='active'?'Đang quét':entry?.state==='queued'?'Đã xếp hàng đợi':entry?.state==='done'?'Đã xong':retry?'Thử lại SP lỗi':'Tiếp tục';
  return `<button class="btn btn-white btn-sm" data-market-run="${esc(run.id)}" ${marketRunAvailable(run)?'':'disabled'}>${label}</button>${['pending','paused'].includes(run.status)?` <button class="btn btn-soft btn-sm" data-market-skip="${esc(run.id)}" ${marketState.busy?'disabled':''}>Bỏ SP lỗi</button>`:''}`;
}
function marketCategoryTimeout(error) {
  if (error?.blocked || error?.verificationRequired || marketTabBusy(error)) return false;
  return error?.code==='category_page_timeout' || [
    'Trang ngành hàng chưa tải đủ hoặc cấu trúc trang chưa được hỗ trợ. Hãy kiểm tra Chrome rồi tiếp tục.',
    'Trang ngành hàng chưa tải đủ hoặc cấu trúc trang chưa được hỗ trợ.',
  ].includes(String(error?.message||error||''));
}
function marketProductTimeout(error) {
  if (error?.blocked || error?.verificationRequired || marketTabBusy(error)) return false;
  return error?.code==='product_detail_timeout' || String(error?.message||error||'')==='Shopee chưa tải trang chi tiết sản phẩm trong thời gian cho phép.';
}
function marketProductTimeoutMessage(error) {
  return `${String(error?.message||error).slice(0,250)} Đã thử ${MARKET_DETAIL_ATTEMPTS} lần; ghi nhận sản phẩm lỗi để tiếp tục các sản phẩm khác.${error?.inspectionRequired?' Tab Shopee được giữ để kiểm tra.':''} Bấm “Thử lại SP lỗi” hoặc “Thử lại tất cả lỗi” để đọc lại; sản phẩm đã lưu được giữ nguyên.`;
}
function marketFailureMessage(error, hasQueue) {
  const reason=String(error?.message||error||'Chrome chưa đọc được trang Shopee.').slice(0,500);
  if (error?.inspectionRequired && !error?.blocked && !error?.verificationRequired && !marketTabBusy(error)) return `${reason} Sau khi trang hiển thị sản phẩm, bấm “${hasQueue?'Chạy / tiếp tục tất cả':'Quét tất cả ngành hàng'}” trong MarketLens. Tiến độ đã lưu được giữ nguyên; không tự thử lại.`;
  if (marketTabBusy(error)) {
    const next=hasQueue
      ? 'Sau đó bấm “Chạy / tiếp tục tất cả” để tiếp tục từ tiến độ đã lưu.'
      : 'Sau đó bấm “Quét tất cả ngành hàng” để đọc lại danh mục; chưa tạo hàng đợi.';
    return `Chrome đang bận thao tác với tab. Nếu đang kéo hoặc sắp xếp tab, hãy thả chuột và kết thúc thao tác đó. ${next} Dữ liệu đã lưu được giữ nguyên; thu thập đang tạm dừng và không tự chạy lại.`;
  }
  if (!error?.blocked && !error?.verificationRequired) return reason;
  const tab=error.verificationRequired
    ? 'Tab Shopee yêu cầu xác minh được giữ mở để bạn thao tác trực tiếp.'
    : 'Hãy mở trang Shopee để hoàn tất yêu cầu xác minh; nếu bot đã đóng tab, tải lại tiện ích MarketLens 1.3.7 rồi thử lại.';
  const next=hasQueue
    ? 'Sau khi hoàn tất, quay lại MarketLens và bấm “Chạy / tiếp tục tất cả” để tiếp tục tiến độ đã lưu.'
    : 'Sau khi hoàn tất, quay lại MarketLens và bấm “Quét tất cả ngành hàng” để đọc lại danh mục; chưa tạo hàng đợi.';
  return `${reason} ${tab} ${next} Thu thập đang tạm dừng và không tự chạy lại.`;
}
function marketScanAllPanel() {
  return `<section class="panel market-scan-all"><div><div class="eyebrow">THU THẬP TỰ ĐỘNG TOÀN DANH MỤC</div><h2>Một nút · tất cả ngành hàng Shopee</h2><p>Tự tìm danh mục hiện có → mở từng ngành hàng → đọc từng sản phẩm → lưu database. Không cần nhập tên, link hoặc chọn ngành hàng.</p><p class="small-help">Quét hết các trang Shopee hiển thị, lưu tiến độ sau mỗi sản phẩm. Nếu Shopee yêu cầu xác minh, bạn tự hoàn tất trên tab Shopee rồi bấm chạy lại trong MarketLens. Dữ liệu đã lưu được giữ nguyên.</p><p id="marketChromeStatus" class="small-help" role="status">${esc(marketChromeStatus())}</p><p id="marketScanAllProgress" class="small-help" role="status" aria-live="polite">${esc(marketState.message||'Bấm Quét tất cả ngành hàng để bắt đầu.')}</p></div><div><button class="btn btn-primary" id="marketScanEverything" ${marketState.busy?'disabled':''}>${marketState.busy?'Đang thu thập…':'◉ Quét tất cả ngành hàng'}</button> ${marketRetryErrorsButton('marketRetryErrorsHero')}${marketState.busy?` <button class="btn btn-soft" id="marketStopAll" ${marketState.stop?'disabled':''}>${marketState.stop?'Đang dừng sau các tác vụ hiện tại…':'Dừng sau các tác vụ đang chạy'}</button>`:''}</div></section>`;
}
function renderCategoryMarket() {
  const m = marketState;
  if (!m.loaded) { m.loaded = true; setTimeout(refreshMarket, 0); }
  return `${marketScanAllPanel()}<div class="notice"><span>◎</span><div><strong>Kho dữ liệu ngành hàng · độc lập với shop đang chọn</strong><br>Quét các sản phẩm được hiển thị trong phạm vi trang đã chọn; không khẳng định bao phủ toàn Shopee. Giữ tab MarketLens mở khi chạy. Có thể tiếp tục hàng đợi sau khi tải lại trang.</div></div>
  <div class="market-kpis">${kpi('Sản phẩm duy nhất', num(m.stats.product_count || 0), 'Trong phạm vi ngành hàng đang lọc', '▤')}${kpi('Quan sát sản phẩm / ngày', num(m.stats.snapshot_count || 0), 'Quét lại cùng ngày cập nhật quan sát', '◷')}${kpi('Đủ lịch sử tính xu hướng', num(m.stats.eligible_count || 0), 'Ít nhất 3 ngày có số bán chính xác', '↗')}</div>
  <details class="panel"><summary>Tùy chọn nâng cao · chọn ngành hàng hoặc quét mẫu</summary><div class="panel-head"><div><h3 class="panel-title">1. Chọn ngành hàng cần thu thập</h3><p class="panel-sub">Đọc danh mục hiển thị trên trang chủ Shopee hoặc thêm link ngành hàng / ngành con.</p></div><button class="btn btn-white" id="marketDiscover" ${m.busy?'disabled':''}>Đọc danh mục từ Shopee</button></div>
  <div class="controls"><label>Tên ngành hàng<input id="marketCategoryName" placeholder="Nhà cửa & Đời sống"></label><label>Link ngành hàng<input id="marketCategoryUrl" placeholder="https://shopee.vn/…-cat.…"></label><button class="btn btn-soft" id="marketAdd" ${m.busy?'disabled':''}>+ Thêm</button></div>
  <div class="market-categories">${m.categories.length?`<label><input type="checkbox" id="marketSelectAll" ${m.categories.every(c=>c.selected)?'checked':''}> Chọn tất cả (${m.categories.length})</label>`:'<p class="muted">Chưa chọn ngành hàng. Bấm đọc danh mục để lấy danh sách thực tế từ Chrome.</p>'}${m.categories.map((c,i)=>`<label><input type="checkbox" data-market-category="${i}" ${c.selected?'checked':''}> ${esc(c.name)}</label>`).join('')}</div>
  <div class="controls"><label>Phạm vi<select id="marketMode"><option value="full">Quét hết các trang hiển thị</option><option value="sample">Quét mẫu có giới hạn</option></select></label><label>Số trang tối đa / ngành (quét mẫu)<input id="marketPages" type="number" min="1" max="100" value="5"></label><label>Số SP tối đa / ngành (quét mẫu)<input id="marketLimit" type="number" min="1" max="1000" value="150"></label><button class="btn btn-primary" id="marketCreate" ${m.busy?'disabled':''}>Tạo hàng đợi</button><button class="btn btn-primary" id="marketScanNow" ${m.busy?'disabled':''}>Quét ngay ngành đã chọn</button></div><p class="small-help">Mỗi sản phẩm được mở riêng để đọc tên, giá, số bán hiển thị, đánh giá, mô tả, ảnh, thuộc tính và phân loại. Dữ liệu không hiển thị được giữ là thiếu.</p></details>
  <section class="panel"><div class="panel-head"><div><h3 class="panel-title">2. Thu thập từng sản phẩm</h3><p class="panel-sub">Các ngành chạy song song theo mức bạn chọn; mỗi ngành lưu tiến độ sau từng sản phẩm. Có thể thêm ngành khác trong lúc đang chạy.</p></div><div><button class="btn btn-primary" id="marketRunAll" ${!m.runs.some(marketRunAvailable)?'disabled':''}>Chạy / tiếp tục tất cả</button> ${marketRetryErrorsButton('marketRetryErrors')} <button class="btn btn-soft" id="marketStop" ${!m.busy?'disabled':''}>Dừng sau các tác vụ đang chạy</button></div></div>
  ${marketConcurrencyControl()}<p class="small-help" role="status" id="marketProgress">${esc(m.message || 'Sẵn sàng. Kết nối tiện ích MarketLens để bắt đầu thu thập.')}</p>
  <div class="table-wrap"><table class="data-table market-runs-table" data-pagination-key="category-runs"><thead><tr><th>Ngành hàng</th><th>Phạm vi</th><th>Tiến độ</th><th>Trạng thái / ghi chú</th><th>Thao tác</th></tr></thead><tbody>${m.runs.map(r=>`<tr data-pagination-id="${esc(r.id)}"><td>${esc(r.name)}<small class="muted"> · ${esc(r.created_at.slice(0,10))}</small></td><td>${r.full_scan?`${r.page} trang · quét hết trang hiển thị`:`${r.page}/${r.max_pages} trang · tối đa ${r.max_products} SP`}</td><td>${r.completed}/${r.discovered} SP · lỗi ${r.failed}</td><td>${esc(r.superseded?'Đã chuyển sang lượt mới':({pending:'Chờ / sẵn sàng',paused:'Tạm dừng',done:'Xong phạm vi',partial:'Xong, có lỗi'})[r.status])}<br><small>${esc(r.error)}</small></td><td class="market-run-actions">${marketRunActions(r)}</td></tr>`).join('') || '<tr><td colspan="5">Chưa có hàng đợi.</td></tr>'}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><div><h3 class="panel-title">3. Tín hiệu hot trend & dataset máy học</h3><p class="panel-sub">Điểm quy tắc tham khảo, chưa phải mô hình ML đã huấn luyện. Tổng đã bán không phải doanh số 30 ngày.</p></div><div><a class="btn btn-white" href="/api/category-market/export?format=csv&category_id=${encodeURIComponent(m.filter)}">↓ Features CSV</a> <a class="btn btn-white" href="/api/category-market/export?format=jsonl&category_id=${encodeURIComponent(m.filter)}">↓ Dữ liệu gốc JSONL</a></div></div>
  <div class="controls"><label>Ngành hàng<select id="marketFilter" data-pagination-filter><option value="">Tất cả ngành hàng</option>${[...new Map(m.runs.map(r=>[r.category_id,r])).values()].map(r=>`<option value="${esc(r.category_id)}" ${m.filter===r.category_id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label><button class="btn btn-soft" id="marketRefresh">Làm mới</button></div>
  <div class="table-wrap"><table class="data-table market-dataset" data-pagination-key="category-dataset"><thead><tr><th>Sản phẩm</th><th>Giá</th><th>Đánh giá</th><th>Phân loại</th><th>Tổng đã bán</th><th>Δ bán / ngày</th><th>Gia tốc</th><th>Điểm xu hướng</th></tr></thead><tbody>${m.products.map(p=>{
    const link=marketSafeUrl(p.url);
    const thumb=marketSafeUrl(p.image,true);
    const variants=(Array.isArray(p.variants)?p.variants:[]).map(g=>`<div><strong>${esc(g.name)}:</strong> ${esc((Array.isArray(g.options)?g.options:[]).join(', '))}</div>`).join('');
    return `<tr data-pagination-id="${esc(p.sku)}"><td class="product-name market-product-cell">${thumb?`<img class="market-thumb" src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}<div><button type="button" class="product-detail-link" data-market-product="${esc(p.sku)}" data-market-category-id="${esc(p.category_id)}">${esc(p.name)}</button>${link?` <a class="text-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Mở trên Shopee ↗</a>`:''}<br><small>${esc(p.category)} · ${esc(p.day)}</small></div></td><td class="numeric">${esc(p.price_text)||money(p.price)}</td><td>${p.rating_text||p.rating!=null?`★ ${esc(p.rating_text||p.rating)}`:'—'}<br><small>${esc(p.review_count_text||(p.review_count!=null?String(p.review_count):'—'))} lượt đánh giá</small></td><td class="market-variants">${variants||'—'}</td><td>${esc(p.sold_text)||num(p.sold_total)}${p.sold_approx?' (làm tròn)':''}</td><td>${p.velocity==null?'—':p.velocity.toFixed(2)}</td><td>${p.acceleration==null?'—':p.acceleration.toFixed(2)}</td><td>${p.trend_score??'—'}<br><small>${esc(p.reason)}</small></td></tr>`}).join('') || '<tr><td colspan="8">Chưa có quan sát. Chạy hàng đợi để thu thập dữ liệu thật.</td></tr>'}</tbody></table></div><p class="small-help">Đã tải ${num(m.products.length)}/${num(m.stats.product_count||0)} sản phẩm trong bộ lọc; phân trang chỉ thay đổi phần đang hiển thị. Bản xuất chứa toàn bộ lịch sử trong bộ lọc. Giá, đánh giá, số lượt đánh giá và phân loại hiển thị đúng chữ đã đọc trên trang sản phẩm, không làm tròn. Số bán dạng 1k / 1k+ không được dùng tính tăng trưởng. CSV chứa đặc trưng tính từ hiện tại và quá khứ; nhãn tương lai cần tạo riêng khi huấn luyện và chia tập theo thời gian.</p></section>`;
}
function marketRender() {
  if (!['categoryMarket','marketSchedules'].includes(S.view)) return;
  const fields=['marketCategoryName','marketCategoryUrl','marketPages','marketLimit','marketMode','marketScheduleStart','marketInterval'];
  const values=fields.filter(id=>$(id)).map(id=>[id,$(id).value]);
  render();
  for(const [id,value] of values) if($(id)) $(id).value=value;
}
async function refreshMarket(forceConnection = false) {
  try {
    const [runs, data, schedules] = await Promise.all([api('/api/category-market/runs?all_rows=true'), api('/api/category-market/products?all_rows=true&category_id=' + encodeURIComponent(marketState.filter)), api('/api/category-market/schedules'), probeMarketChrome(forceConnection)]);
    marketState.schedules = schedules;
    if (!marketState.categories.length) marketState.categories = [...new Map([...schedules,...runs].map(r=>[r.url,{name:r.name,url:r.url,selected:true}])).values()];
    marketState.runs = runs; marketState.products = data.products; marketState.stats = data; marketRender(); return true;
  } catch (e) { marketState.message = e.message; marketRender(); return false; }
}
async function marketBridge() {
  const info = await probeMarketChrome(true);
  if (!info) throw new Error(marketState.chromeError);
  if (!info.capabilities?.categories || !info.capabilities?.verificationPause || !info.capabilities?.categoryCardsV2 || !marketConcurrencySupported(info)) throw new Error(marketChromeStatus());
  return info;
}
async function runMarket(ids, automatic = false, retryFailed = false) {
  if (window.MarketLensAuth&&!window.MarketLensAuth.canCollect) return marketExplain('Thu thập ngành hàng thuộc khu vực System.');
  ids=[...new Set(ids)];
  if (!ids.length) return automatic?undefined:marketExplain('Không có lượt quét cần tiếp tục hoặc thử lại.');
  if (marketState.runner) {
    if (!marketState.runner.accepting || marketState.stop) return marketExplain('Đang dừng và lưu các tác vụ còn chạy. Chờ lưu xong rồi bấm tiếp tục.');
    if (S.crawlSubmitting || S.competitor.discovering) return marketExplain('Đang có tác vụ Chrome khác.');
    const added=enqueueMarketRuns(marketState.runner,ids,automatic,retryFailed);
    if (!added) marketExplain('Các ngành đã chọn đang chạy, đã xếp hàng đợi hoặc đã hoàn tất.');
    return;
  }
  if (navigator.locks) return navigator.locks.request('marketlens-category-collector', {ifAvailable:true}, async lock=>{
    if (!lock) { marketState.connection='Một tab MarketLens khác đang thu thập'; return marketExplain('Một tab MarketLens khác đang thu thập. Chờ tab đó hoàn tất hoặc dừng lượt quét tại tab đó rồi thử lại.'); }
    return runMarketUnlocked(ids, automatic, retryFailed);
  });
  if (!automatic) return runMarketUnlocked(ids, false, retryFailed);
}
function marketPoolProgress(runner,detail='') {
  const running=runner.active.size;
  marketState.message=`${running?`Đang quét ${running} ngành cùng lúc`:'Đang xử lý hàng đợi'} · ${runner.queue.length} ngành chờ.${detail?' '+detail:''}`;
  for (const field of ['marketProgress','marketScanAllProgress']) if ($(field)) $(field).textContent=marketState.message;
}
function enqueueMarketRuns(runner,ids,automatic,retryFailed) {
  if (!runner.accepting || marketState.stop) return 0;
  let added=0;
  for (const id of ids) {
    const previous=runner.assigned.get(id);
    if (runner.active.has(id) || runner.queue.some(entry=>entry.id===id)) continue;
    if (previous && !['paused','partial'].includes(previous.state)) continue;
    const run=marketState.runs.find(item=>item.id===id), categoryKey=run?.category_id==null?'':String(run.category_id);
    if (run && !marketPreferredRun(run)) continue;
    if (categoryKey && [...runner.assigned.values()].some(item=>item.categoryKey===categoryKey && ['queued','active'].includes(item.state))) continue;
    const entry={id,automatic,retryFailed,state:'queued',categoryKey};
    runner.assigned.set(id,entry); runner.queue.push(entry); added++;
  }
  if (added) {runner.pump?.(); marketPoolProgress(runner); marketRender();}
  return added;
}
async function collectMarketRun(runner,entry) {
  const id=entry.id;
  try {
    if (!entry.automatic && entry.retryFailed) {
      try {await marketPost(`/runs/${id}/resume`,{});} catch(error) {
        if (error.status!==409) throw error;
        entry.state='paused';entry.error=error.message;return;
      }
    }
    while (!runner.halted && !marketState.stop) {
      const task=await api(`/api/category-market/runs/${id}/next?automatic=${entry.automatic}`);
      if (runner.halted || marketState.stop) break;
      if (task.type==='done') {entry.state=entry.failedProducts||Number(marketState.runs.find(run=>run.id===id)?.failed)>0?'partial':'done'; return;}
      if (task.type==='paused') {entry.state='paused'; return;}
      marketPoolProgress(runner,task.type==='listing'?`Đọc trang ${task.page+1}: ${task.url}`:`Đọc sản phẩm: ${task.url}`);
      if (task.type==='listing') {
        let result;
        try {result=await MarketLensChrome.category(task.url);}
        catch(error) {
          if (!marketCategoryTimeout(error)) throw error;
          await marketPost(`/runs/${id}/pause`,{error:marketFailureMessage(error,true).slice(0,500)});
          entry.state='paused'; marketState.autoPaused=true;
          if (await refreshMarket()===false) throw new Error('Chưa đọc được tiến độ đã lưu: '+marketState.message);
          return;
        }
        await marketPost(`/runs/${id}/listing`,{...result,page:task.page});
      } else {
        let result,timeout;
        for (let attempt=1;attempt<=MARKET_DETAIL_ATTEMPTS;attempt++) {
          if (runner.halted || marketState.stop) break;
          try {result=await MarketLensChrome.detail(task.url);timeout=null;break;}
          catch(error) {
            if (!marketProductTimeout(error)) throw error;
            timeout=error;
            if (runner.halted || marketState.stop) break;
            if (attempt<MARKET_DETAIL_ATTEMPTS) {
              marketPoolProgress(runner,`Trang chi tiết chưa tải; thử lại sản phẩm ${attempt+1}/${MARKET_DETAIL_ATTEMPTS}: ${task.url}`);
              await new Promise(resolve=>setTimeout(resolve,1500));
            }
          }
        }
        if (result) await marketPost(`/runs/${id}/detail`,result.detail);
        else if (runner.halted || marketState.stop) break;
        else if (timeout) {
          entry.error=marketProductTimeoutMessage(timeout);entry.failedProducts=(entry.failedProducts||0)+1;
          await marketPost(`/runs/${id}/skip`,{url:task.url,error:entry.error.slice(0,500)});
          marketPoolProgress(runner,`Đã ghi nhận SP lỗi sau ${MARKET_DETAIL_ATTEMPTS} lần đọc; tiếp tục hàng đợi.`);
        } else throw new Error('Chrome chưa trả kết quả chi tiết sản phẩm.');
      }
      if (await refreshMarket()===false) throw new Error('Chưa đọc được tiến độ đã lưu: '+marketState.message);
      if (!runner.halted && !marketState.stop) await new Promise(resolve=>setTimeout(resolve,1500));
    }
    entry.state='paused';
  } catch(error) {
    entry.state='paused'; runner.halted=true; runner.accepting=false;
    if (!runner.error || error.blocked || error.verificationRequired) runner.error=error;
    marketState.autoPaused=true;
    marketState.message='Đang dừng, chờ lưu tác vụ đang chạy: '+marketFailureMessage(error,true);
    marketRender();
  }
}
async function runMarketUnlocked(ids, automatic, retryFailed = false) {
  if (marketState.busy || S.crawlSubmitting || S.competitor.discovering) return marketExplain('Đang có tác vụ Chrome khác. Chờ tác vụ đó hoàn tất hoặc dừng trước khi quét ngành hàng.');
  const runner={assigned:new Map(),queue:[],active:new Map(),accepting:true,halted:false,error:null,pump:null,concurrency:1};
  marketState.runner=runner;
  marketState.busy = true; marketState.stop = false; if (!automatic) marketState.autoPaused = false;
  enqueueMarketRuns(runner,ids,automatic,retryFailed);
  marketRender();
  try {
    const info=await marketBridge();
    runner.concurrency=marketConcurrencyLimit(marketState.concurrency,info);
    if (marketState.stop) {
      marketState.autoPaused=true;
      for (const id of runner.assigned.keys()) await marketPost(`/runs/${id}/pause`,{error:'Người dùng dừng; có thể tiếp tục.'});
      marketState.message='Đã dừng trước khi đọc sản phẩm; hàng đợi và tiến độ được giữ lại.';
      return;
    }
    await new Promise(resolve=>{
      runner.pump=()=>{
        while (!runner.halted && !marketState.stop && runner.queue.length && runner.active.size<runner.concurrency) {
          const entry=runner.queue.shift(); entry.state='active';
          const work=collectMarketRun(runner,entry).finally(()=>{runner.active.delete(entry.id); runner.pump();});
          runner.active.set(entry.id,work);
        }
        if (!runner.active.size && (!runner.queue.length || runner.halted || marketState.stop)) {runner.accepting=false; resolve();}
        else {
          if (runner.halted || marketState.stop) marketState.message='Đang dừng, chờ lưu các tác vụ đang chạy trước khi tạm dừng hàng đợi.';
          else marketPoolProgress(runner);
          marketRender();
        }
      };
      runner.pump();
    });
    const assigned=[...runner.assigned.values()], completedRuns=assigned.filter(entry=>entry.state==='done').length;
    const unresolved=assigned.length-completedRuns;
    if (marketState.stop || runner.halted) {
      marketState.autoPaused=true;
      const reason=runner.error?marketFailureMessage(runner.error,true):'Người dùng dừng; có thể tiếp tục.';
      for (const entry of assigned) try {await marketPost(`/runs/${entry.id}/pause`,{error:reason.slice(0,500)});} catch {}
      marketState.message=runner.error?'Đã tạm dừng: '+reason:`Đã dừng và lưu tiến độ. Hoàn tất ${completedRuns}/${assigned.length} ngành; ${unresolved} ngành chưa xong.`;
    } else {
      marketState.autoPaused=unresolved>0;
      marketState.message=`Hoàn tất ${completedRuns}/${assigned.length} ngành; ${unresolved} ngành còn lỗi / tạm dừng.${unresolved?' Bấm “Tiếp tục” ở từng ngành hoặc “Thử lại tất cả lỗi”; các sản phẩm đã lưu được giữ nguyên.':' Đã hoàn tất phạm vi hàng đợi.'}`;
    }
  } catch (e) {
    marketState.message = 'Đã tạm dừng: ' + marketFailureMessage(e,true);
    marketState.autoPaused=true;
  } finally {
    marketState.runner=null; marketState.busy = false;
    const message=marketState.message;
    if (await refreshMarket()===false) {marketState.message=message+' Chưa cập nhật được tiến độ: '+marketState.message; marketRender();}
  }
}
document.addEventListener('change', e=>{
  if (e.target.id==='marketConcurrency') {
    let value=e.target.value==='all'?'all':Number(e.target.value);
    if (value===8) value=4;
    if (value!=='all' && ![2,4].includes(value)) return;
    if (marketState.runner?.pump && !marketConcurrencySupported(marketState.chromeInfo,value)) return marketExplain('Tiện ích đang dùng chưa hỗ trợ mức này. Reload MarketLens 1.3.7 rồi thử lại.');
    marketState.concurrency=value;
    try {window.localStorage?.setItem('marketlens.categoryConcurrency',String(value));} catch {}
    if (marketState.runner?.pump) {marketState.runner.concurrency=marketConcurrencyLimit(value,marketState.chromeInfo);marketState.runner.pump();}
    marketRender();return;
  }
  if (e.target.matches('[data-market-category]')) marketState.categories[Number(e.target.dataset.marketCategory)].selected = e.target.checked;
  if (e.target.id === 'marketSelectAll') { marketState.categories.forEach(c=>c.selected=e.target.checked); marketRender(); }
  if (e.target.id === 'marketFilter') { marketState.filter=e.target.value; refreshMarket(); }
});
document.addEventListener('click', async e=>{
  const productButton=e.target.closest('[data-market-product]');
  if (productButton?.dataset?.marketProduct) return marketOpenProduct(productButton);
  if (window.MarketLensAuth&&!window.MarketLensAuth.canCollect) return;
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  try {
    if (b.id === 'marketScanEverything') return scanAllMarket();
    if (['marketStop','marketStopAll'].includes(b.id)) { marketState.stop = true; if(marketState.runner)marketState.runner.accepting=false; marketState.message='Đang dừng sau các tác vụ hiện tại; dữ liệu đã lưu được giữ lại.'; b.disabled = true; marketRender(); return; }
    if (b.id === 'marketRefresh') return refreshMarket(true);
    if (b.id === 'marketDiscover') {
      marketState.busy = true; marketState.message='Đang đọc danh mục hiển thị trên trang chủ Shopee…'; marketRender();
      try { await marketBridge(); const result = await MarketLensChrome.categories();
        for (const c of result.categories) if (!marketState.categories.some(x=>x.url===c.url)) marketState.categories.push({...c,selected:true});
        const note=typeof result.note==='string'?result.note.trim().slice(0,300):'';
        marketState.message=result.catalog_complete===false
          ? `Đọc được ${result.categories.length} ngành hàng, danh mục chưa tải đủ.${note?' '+note:''} Có thể chọn trong các ngành đã đọc để quét riêng, hoặc bấm Quét tất cả ngành hàng để đọc lại danh mục.`
          : `Đọc được ${result.categories.length} ngành hàng. Chọn ngành hàng và tạo hàng đợi.`;
      } finally {marketState.busy=false; marketRender();}
    }
    if (b.id === 'marketAdd') {
      const name=$('marketCategoryName').value.trim(), url=$('marketCategoryUrl').value.trim();
      const u=new URL(url);
      if (!name || u.protocol!=='https:' || !['shopee.vn','www.shopee.vn'].includes(u.hostname) || u.port || u.username || u.password || !/^\/[^/]+-cat\.\d+(?:\.\d+)*$/.test(u.pathname)) throw new Error('Nhập tên và link ngành hàng Shopee hợp lệ (…-cat.…).');
      const canonical='https://shopee.vn'+u.pathname;
      if (!marketState.categories.some(c=>c.url===canonical)) marketState.categories.push({name,url:canonical,selected:true});
      marketRender();
    }
    if (['marketCreate','marketScanNow','marketSaveSchedule'].includes(b.id)) {
      const categories=marketState.categories.filter(c=>c.selected).map(({name,url})=>({name,url}));
      if (!categories.length) throw new Error('Chọn ít nhất một ngành hàng.');
      const ownShop=(typeof S!=='undefined'&&S.data?.shop&&!S.data.shop.is_demo)?S.shopId:'';
      const payload={categories,max_pages:Number($('marketPages').value),max_products:Number($('marketLimit').value),full_scan:$('marketMode').value==='full',shop_id:ownShop||''};
      if (b.id === 'marketSaveSchedule') {
        const start=$('marketScheduleStart').value;
        if (!start) throw new Error('Chọn ngày giờ bắt đầu theo giờ Việt Nam.');
        await marketPost('/schedules',{...payload,start_at:start+':00+07:00',interval_hours:Number($('marketInterval').value)});
        marketState.autoPaused=false;
        marketState.message='Đã lưu lịch vào database. Lịch đến hạn sẽ tạo hàng đợi; Chrome kết nối sẽ tự thu thập.';
        await refreshMarket(); return;
      }
      const result=await marketPost('/campaigns',payload);
      marketState.message='Đã lưu hàng đợi. Lượt đang dang dở giữ nguyên phạm vi ban đầu; hoàn tất rồi tạo lượt mới nếu đổi chế độ.';
      await refreshMarket();
      if (b.id === 'marketScanNow') return runMarket(result.run_ids);
    }
    if (b.dataset.marketToggle) {
      const schedule=marketState.schedules.find(x=>x.id===b.dataset.marketToggle);
      if (!schedule.enabled && marketState.autoPaused) marketState.autoPaused=false;
      await api('/api/category-market/schedules/'+schedule.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!schedule.enabled})});
      await refreshMarket();
    }
    if (b.dataset.marketScheduleRun) {
      const result=await marketPost('/schedules/'+b.dataset.marketScheduleRun+'/run',{});
      await refreshMarket(); return runMarket(result.run_ids);
    }

    if (b.id === 'marketRunAll') return runMarket(marketState.runs.filter(marketRunAvailable).map(r=>r.id),false,true);
    if (['marketRetryErrorsHero','marketRetryErrors'].includes(b.id)) return runMarket(marketErrorRuns().map(r=>r.id),false,true);
    if (b.dataset.marketRun) {
      const run=marketState.runs.find(r=>r.id===b.dataset.marketRun);
      if (!run || !marketRunAvailable(run)) return marketExplain('Lượt quét này đang chạy, đã xếp hàng đợi, đã hoàn tất hoặc đã chuyển sang lượt mới.');
      return runMarket([run.id],false,true);
    }
    if (b.dataset.marketSkip) { await marketPost(`/runs/${b.dataset.marketSkip}/skip`,{error:'Người dùng bỏ qua sản phẩm không đọc được'}); await refreshMarket(); }
  } catch (e) {
    if (e.blocked || e.verificationRequired || marketTabBusy(e)) marketState.autoPaused=true;
    marketState.message=marketFailureMessage(e,false); toast(marketState.message); marketRender();
  }
});

function marketLocalTime(value) {
  return value ? new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false}) : 'Chưa đến hạn';
}
function renderMarketSchedules() {
  const m=marketState;
  if (!m.loaded) {m.loaded=true;setTimeout(refreshMarket,0);}
  return `${marketScanAllPanel()}<div class="notice"><span>◷</span><div><strong>Lịch thu thập → database → dataset máy học</strong><br>Giờ Việt Nam (UTC+7). Máy chủ phải đang chạy để tạo hàng đợi. Chrome cần mở MarketLens tại cổng 8000 và kết nối tiện ích để đọc từng sản phẩm. Lịch bị lỡ được gộp thành một lượt, không tạo dữ liệu lịch sử giả.</div></div>
  <section class="panel"><div class="panel-head"><div><h3 class="panel-title">Thiết lập lịch cho từng ngành hàng</h3><p class="panel-sub">Có thể chọn tất cả ngành hàng đã đọc. Mỗi ngành có một lịch riêng; lưu lại sẽ cập nhật lịch hiện tại.</p></div><button class="btn btn-white" id="marketDiscover" ${m.busy?'disabled':''}>Đọc danh mục từ Shopee</button></div>
  <div class="controls"><label>Tên ngành hàng<input id="marketCategoryName" placeholder="Nhà cửa & Đời sống"></label><label>Link ngành hàng<input id="marketCategoryUrl" placeholder="https://shopee.vn/…-cat.…"></label><button class="btn btn-soft" id="marketAdd" ${m.busy?'disabled':''}>+ Thêm</button></div>
  <div class="market-categories">${m.categories.length?`<label><input type="checkbox" id="marketSelectAll" ${m.categories.every(c=>c.selected)?'checked':''}> Chọn tất cả</label>`:'<p class="muted">Đọc danh mục từ Shopee hoặc thêm link ngành hàng trước khi lưu lịch.</p>'}${m.categories.map((c,i)=>`<label><input type="checkbox" data-market-category="${i}" ${c.selected?'checked':''}>${esc(c.name)}</label>`).join('')}</div>
  <div class="controls"><label>Phạm vi<select id="marketMode"><option value="full">Quét hết các trang hiển thị</option><option value="sample">Quét mẫu có giới hạn</option></select></label><label>Số trang / ngành (quét mẫu)<input id="marketPages" type="number" min="1" max="100" value="5"></label><label>Số SP / ngành (quét mẫu)<input id="marketLimit" type="number" min="1" max="1000" value="150"></label></div>
  <div class="controls"><label>Bắt đầu · giờ Việt Nam<input id="marketScheduleStart" type="datetime-local"></label><label>Lặp lại<select id="marketInterval"><option value="24">Mỗi ngày</option><option value="168">Mỗi tuần</option><option value="12">Mỗi 12 giờ</option><option value="6">Mỗi 6 giờ</option></select></label><button class="btn btn-primary" id="marketSaveSchedule" ${m.busy?'disabled':''}>Lưu lịch cho ngành đã chọn</button><button class="btn btn-white" id="marketScanNow" ${m.busy?'disabled':''}>Quét ngay ngành đã chọn</button></div>
  <p class="small-help">Quét hết nghĩa là tiếp tục các trang Shopee hiển thị đến khi hết trang hoặc không có sản phẩm mới. Shopee có thể giới hạn kết quả; đây không phải cam kết bao phủ 100% sản phẩm toàn sàn.</p></section>
  <section class="panel"><div class="panel-head"><div><h3 class="panel-title">Lịch đã lưu (${m.schedules.length})</h3><p class="panel-sub" id="marketConnection">${esc(m.autoPaused?'Tự động tạm dừng sau lỗi / yêu cầu dừng. Bấm Quét ngay để tiếp tục.':m.connection)}</p></div><button class="btn btn-soft" id="marketRefresh">Làm mới</button></div>
  <p class="small-help" id="marketProgress" role="status">${esc(m.message)}</p>
  <div class="table-wrap"><table class="data-table" data-pagination-key="category-schedules"><thead><tr><th>Ngành hàng</th><th>Chu kỳ / phạm vi</th><th>Đến hạn tiếp theo (VN)</th><th>Lần xử lý lịch gần nhất</th><th>Thao tác</th></tr></thead><tbody>${m.schedules.map(s=>`<tr data-pagination-id="${esc(s.id)}"><td>${esc(s.name)}<br>${s.enabled?'Đang bật':'Đã tắt'}</td><td>${s.interval_hours} giờ<br>${s.full_scan?'Hết trang hiển thị':`${s.max_pages} trang / ${s.max_products} SP`}</td><td>${esc(marketLocalTime(s.next_run_at))}</td><td>${esc(marketLocalTime(s.last_run_at))}</td><td><button class="btn btn-white btn-sm" data-market-schedule-run="${s.id}" ${m.busy?'disabled':''}>Quét ngay</button> <button class="btn btn-soft btn-sm" data-market-toggle="${s.id}">${s.enabled?'Tắt lịch':'Bật lịch'}</button></td></tr>`).join('')||'<tr><td colspan="5">Chưa có lịch. Chọn ngành hàng và giờ bắt đầu ở trên.</td></tr>'}</tbody></table></div><p class="small-help">“Lần xử lý lịch” là lúc tạo / kiểm tra hàng đợi, không phải lúc quét xong. Xem tiến độ và tải dataset tại tab Ngành hàng & Hot trend.</p><button class="btn btn-soft" id="marketStop" ${!m.busy?'disabled':''}>Dừng sau các tác vụ đang chạy</button></section>`;
}
async function pollMarketSchedules() {
  if (window.MarketLensAuth&&!window.MarketLensAuth.canCollect) return;
  const m=marketState;
  if (m.polling||m.busy||m.autoPaused||S.crawlSubmitting||S.competitor.discovering) return;
  m.polling=true;
  try {
    const ready=await api('/api/category-market/scheduled-ready');
    if (!ready.run_ids.length) return;
    try {await marketBridge();} catch (e) {m.connection='Có lượt đến hạn đang chờ Chrome: '+e.message; if($('marketConnection')) $('marketConnection').textContent=m.connection; return;}
    m.connection='Chrome đã kết nối · đang xử lý lịch đến hạn';
    await runMarket(ready.run_ids,true);
  } catch(e) {m.connection='Chưa kết nối máy chủ: '+e.message;}
  finally {m.polling=false;}
}
setInterval(pollMarketSchedules,30000);
setTimeout(pollMarketSchedules,5000);

async function scanAllMarket() {
  if (window.MarketLensAuth&&!window.MarketLensAuth.canCollect) return marketExplain('Thu thập ngành hàng thuộc khu vực System.');
  if (marketState.busy || S.crawlSubmitting || S.competitor.discovering) return marketExplain('Đang có tác vụ Chrome khác. Chờ tác vụ đó hoàn tất hoặc dừng trước khi quét tất cả ngành hàng.');
  const collectAll = async () => {
    marketState.busy=true; marketState.stop=false; marketState.autoPaused=false;
    marketState.message='Đang tự tìm toàn bộ link ngành hàng hiển thị trên Shopee…'; marketRender();
    let ids;
    try {
      const info=await probeMarketChrome(true);
      if (!info) throw new Error(marketState.chromeError);
      if (!info.capabilities?.categories || !info.capabilities?.categoryCatalog || !info.capabilities?.verificationPause || !info.capabilities?.categoryCardsV2 || !marketConcurrencySupported(info)) throw new Error(marketChromeStatus());
      if (marketState.stop) {marketState.autoPaused=true; marketState.message='Đã dừng trước khi đọc danh mục và tạo hàng đợi.'; return;}
      const result=await MarketLensChrome.categories();
      if (marketState.stop) {marketState.autoPaused=true; marketState.message='Đã dừng trước khi tạo hàng đợi.'; return;}
      if (!Array.isArray(result?.categories) || !result.categories.length) throw new Error('Shopee chưa hiển thị danh mục; chưa tạo lượt quét. Hãy kiểm tra Chrome rồi thử lại.');
      const unique=new Map();
      for (const category of result.categories) {
        if (!category || typeof category.name!=='string' || !category.name.trim() || category.name.trim().length>200 || typeof category.url!=='string' || category.url.length>2048) throw new Error('Danh mục Chrome trả về chưa hợp lệ; chưa tạo hàng đợi. Đọc lại danh mục Shopee rồi thử lại.');
        let url;
        try {url=new URL(category.url);} catch {throw new Error('Link ngành hàng Chrome trả về không hợp lệ; chưa tạo hàng đợi.');}
        if (url.protocol!=='https:' || !['shopee.vn','www.shopee.vn'].includes(url.hostname) || url.port || url.username || url.password || !/^\/[^/]+-cat\.\d+(?:\.\d+)*$/.test(url.pathname)) throw new Error('Link ngành hàng Chrome trả về không phải danh mục Shopee VN; chưa tạo hàng đợi.');
        const canonical='https://shopee.vn'+url.pathname;
        unique.set(canonical,{name:category.name.trim(),url:canonical});
      }
      const categories=[...unique.values()];
      marketState.categories=categories.map(c=>({...c,selected:true}));
      if (result.catalog_complete===false) {
        const note=typeof result.note==='string'?result.note.trim().slice(0,300):'';
        throw new Error(`Mới đọc được ${categories.length} ngành hàng; danh mục chưa tải đủ.${note?' '+note:''} Chưa tạo hàng đợi quét tất cả. Kiểm tra trang Shopee rồi bấm Quét tất cả ngành hàng để đọc lại.`);
      }
      if (categories.length>100) throw new Error(`Danh mục có ${categories.length} link, vượt phạm vi 100 ngành hàng mỗi lượt. Chưa tạo hàng đợi; hãy đọc lại danh mục chính của Shopee.`);
      const campaign=await marketPost('/campaigns',{categories,full_scan:true,shop_id:(typeof S!=='undefined'&&S.data?.shop&&!S.data.shop.is_demo)?S.shopId:''});
      if (!Array.isArray(campaign?.run_ids) || !campaign.run_ids.length || campaign.run_ids.some(id=>typeof id!=='string' || !id)) throw new Error('Máy chủ chưa trả về hàng đợi hợp lệ. Kiểm tra danh sách lượt quét và thử lại.');
      ids=campaign.run_ids;
      if (marketState.stop) {
        marketState.autoPaused=true;
        for (const id of ids) await marketPost(`/runs/${id}/pause`,{error:'Người dùng dừng trước khi thu thập sản phẩm.'});
        marketState.message='Đã dừng; hàng đợi được giữ lại để tiếp tục.'; ids=null; return;
      }
      marketState.message=`Đã tự tìm ${categories.length} ngành hàng. Bắt đầu đọc sản phẩm của tất cả ngành và lưu vào database…`;
    } catch(e) {marketState.autoPaused=true; marketState.message='Chưa bắt đầu quét: '+marketFailureMessage(e,Boolean(ids?.length)); toast(marketState.message);}
    finally {marketState.busy=false; marketRender();}
    if (ids?.length) await runMarketUnlocked(ids,false);
  };
  if (navigator.locks) {
    try {
      return await navigator.locks.request('marketlens-category-collector',{ifAvailable:true},async lock=>{
        if (!lock) return marketExplain('Một tab MarketLens khác đang thu thập. Chờ tab đó hoàn tất hoặc dừng lượt quét tại tab đó rồi thử lại.');
        await collectAll();
      });
    } catch(e) {return marketExplain('Chưa bắt đầu quét: '+e.message);}
  }
  return collectAll();
}
async function marketOpenProduct(button) {
  button.disabled = true;
  try {
    const query = `sku=${encodeURIComponent(button.dataset.marketProduct)}&category_id=${encodeURIComponent(button.dataset.marketCategoryId || '')}`;
    const item = await api('/api/category-market/product?' + query);
    showProductDetail({role: 'market', source_shop: '', sku: item.sku, name: item.name, product_url: item.url, detail: item.detail});
  } catch (error) { toast(error.message || 'Không mở được chi tiết sản phẩm.'); }
  finally { button.disabled = false; }
}
function marketSafeUrl(value, image = false) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const hosts = image ? ['shopee.vn', 'susercontent.com', 'shopeeusercontent.com'] : ['shopee.vn'];
    return hosts.some(domain => host === domain || host.endsWith('.' + domain)) ? url.href : '';
  } catch { return ''; }
}
