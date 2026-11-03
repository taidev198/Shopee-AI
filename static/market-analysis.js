'use strict';
const analysisCanManage=()=>typeof window==='undefined'||!window.MarketLensAuth||window.MarketLensAuth.isSystem;

const marketAnalysisState = {
  data: null, dataKey: '', categoryId: '', days: 7, limit: 100, started: false,
  loading: false, training: false, error: '', trainingError: '', trainingMessage: '',
  requestId: 0, showAllCategories: true, updatedAt: '',
};

function marketAnalysisRender() {
  if (S.view === 'marketAnalysis') render();
}

function marketAnalysisKey() {
  const state=marketAnalysisState;
  return `${state.categoryId}|${state.days}|${state.limit}`;
}

async function loadMarketAnalysis() {
  const state=marketAnalysisState, requestId=++state.requestId, key=marketAnalysisKey();
  state.started=true; state.loading=true; state.error=''; marketAnalysisRender();
  const query=new URLSearchParams({category_id:state.categoryId,days:String(state.days),limit:String(state.limit),all_rows:'true'});
  try {
    const result=await api('/api/category-market/analysis?'+query.toString());
    if (requestId!==state.requestId || key!==marketAnalysisKey()) return false;
    state.data=result; state.dataKey=key; state.updatedAt=result.generated_at||new Date().toISOString();
    return true;
  } catch(error) {
    if (requestId===state.requestId && key===marketAnalysisKey()) state.error=error.message||'Chưa đọc được dữ liệu phân tích.';
    return false;
  } finally {
    if (requestId===state.requestId) {state.loading=false; marketAnalysisRender();}
  }
}

function refreshMarketAnalysis() {
  return loadMarketAnalysis();
}

async function trainMarketAnalysisModel() {
  if (!analysisCanManage()) return toast('System quản lý việc huấn luyện mô hình.');
  const state=marketAnalysisState;
  if (state.training) return;
  state.training=true; state.trainingError=''; state.trainingMessage='Đang học các nhóm sản phẩm từ dữ liệu trong database…'; marketAnalysisRender();
  try {
    const result=await api('/api/category-market/ml/train',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const model=result.model||result;
    state.trainingMessage=model.status==='trained'
      ? 'Đã huấn luyện mô hình từ dữ liệu thực tế. Đang cập nhật kết quả…'
      : model.reason||'Dữ liệu hiện chưa đủ để huấn luyện mô hình.';
    const refreshed=await loadMarketAnalysis();
    if (model.status==='trained') state.trainingMessage=refreshed
      ? 'Đã cập nhật kết quả của mô hình vừa huấn luyện.'
      : 'Mô hình đã huấn luyện, nhưng chưa tải được kết quả mới. Bấm Làm mới phân tích để đọc lại.';
  } catch(error) {
    state.trainingMessage=''; state.trainingError=error.message||'Huấn luyện chưa thành công.';
  } finally {state.training=false; marketAnalysisRender();}
}

function analysisNumber(value) {
  return typeof value==='number' && Number.isFinite(value) ? value : null;
}

function analysisSold(value, approximate=false) {
  return analysisNumber(value)==null ? '—' : `${approximate?'≥ ':''}${num(value)}`;
}

function analysisAggregateSold(value) {
  return value.sold_known===0 ? '—' : analysisSold(value.sold_total,Number(value.approx_count)>0);
}

function analysisShopeeUrl(value) {
  try {
    const url=new URL(value);
    if (url.protocol!=='https:' || !['shopee.vn','www.shopee.vn'].includes(url.hostname) || url.port || url.username || url.password) return '';
    return 'https://shopee.vn'+url.pathname;
  } catch {return '';}
}

function analysisSource(name, url, className='') {
  const safe=analysisShopeeUrl(url);
  return safe ? `<a class="${className}" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(name||'Mở Shopee')} ↗</a>` : `<span class="${className}">${esc(name||'Chưa có tên')}</span>`;
}

function analysisDate(value, dateOnly=false) {
  if (!value) return 'Chưa có';
  const date=new Date(value);
  if (!Number.isFinite(date.getTime())) return esc(value);
  return esc(date.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',...(dateOnly?{}:{hour:'2-digit',minute:'2-digit'})}));
}

function analysisMetric(label,value,hint,icon) {
  return `<article class="ma-metric"><div><span>${esc(label)}</span><i aria-hidden="true">${icon}</i></div><strong>${value}</strong><small>${esc(hint)}</small></article>`;
}

function analysisEmpty(title,detail,action=false) {
  return `<div class="ma-empty"><span aria-hidden="true">◇</span><h4>${esc(title)}</h4><p>${esc(detail)}</p>${action&&(analysisCanManage())?'<button class="btn btn-soft" data-action="categoryMarket">Mở thu thập ngành hàng →</button>':''}</div>`;
}

function analysisAutomatic(data) {
  const learning=data.learning||{}, enabled=learning.enabled===true;
  const stateLabel=({checking:'Đang kiểm tra dữ liệu và học mô hình',ready:'Mô hình sẵn sàng',waiting:'Đang chờ đủ dữ liệu',error:'Chưa cập nhật được mô hình'})[learning.state]||'Đang chờ bộ học tự động';
  const insights=Array.isArray(data.insights)?data.insights:[];
  return `<section class="panel ma-automatic"><div class="panel-head"><div><span class="ma-eyebrow">TỰ PHÂN TÍCH TỪ DATABASE</span><h3 class="panel-title">${enabled?'Tự học và cập nhật đang bật':'Trạng thái học tự động'}</h3><p class="panel-sub">${enabled?`Máy chủ kiểm tra dữ liệu mỗi ${num(learning.interval_seconds||30)} giây, tự huấn luyện lại khi dữ liệu đổi. Màn hình tự cập nhật mỗi 30 giây khi đang mở.`:'Đang đọc trạng thái bộ học từ máy chủ.'}</p></div><span class="ma-pill">${esc(stateLabel)}</span></div><p class="ma-footnote">Kiểm tra gần nhất: ${analysisDate(learning.last_checked_at)} · Báo cáo tính lúc: ${analysisDate(data.generated_at||marketAnalysisState.updatedAt)}</p>${learning.last_error?`<p class="ma-error" role="alert">Lần học gần nhất chưa thành công: ${esc(learning.last_error)}. Dữ liệu và mô hình đã lưu được giữ lại; máy chủ sẽ kiểm tra lại.</p>`:''}${insights.length?`<div class="ma-insights">${insights.map(insight=>`<article><h4>${esc(insight.title)}</h4><p>${esc(insight.body)}</p>${insight.url?analysisSource('Xem sản phẩm nguồn',insight.url):''}</article>`).join('')}</div>`:'<p class="muted">Nhận định sẽ được sinh từ dữ liệu thực sau khi thu thập sản phẩm.</p>'}</section>`;
}

function analysisFilters(categories) {
  const state=marketAnalysisState;
  const options=[...categories];
  if (state.categoryId && !options.some(category=>String(category.id)===state.categoryId)) options.push({id:state.categoryId,name:'Ngành hàng đang chọn'});
  return `<section class="panel ma-filters"><label>Ngành hàng<select id="marketAnalysisCategory"><option value="">Tất cả ngành hàng</option>${options.map(category=>`<option value="${esc(category.id)}" ${String(category.id)===state.categoryId?'selected':''}>${esc(category.name)}</option>`).join('')}</select></label><label>Cửa sổ quan sát<select id="marketAnalysisDays">${[7,14,30].map(days=>`<option value="${days}" ${days===state.days?'selected':''}>${days} ngày gần nhất</option>`).join('')}</select></label><button class="btn btn-primary" id="marketAnalysisRefresh" ${state.loading?'disabled':''}>${state.loading?'Đang cập nhật…':'↻ Làm mới phân tích'}</button><p>Đọc trực tiếp database ngành hàng, độc lập với shop đang chọn.</p></section>`;
}

function analysisProductTable(products,summary) {
  if (!products.length) return analysisEmpty('Chưa có sản phẩm trong phạm vi này','Thu thập ngành hàng hoặc mở rộng cửa sổ quan sát để phân tích dữ liệu thực tế.',true);
  return `<div class="table-wrap"><table class="data-table ma-product-table"><thead><tr><th>Sản phẩm / shop</th><th>Giá ghi nhận</th><th>Tổng đã bán</th><th>Lượt đánh giá</th><th>Điểm sao</th><th>Lần ghi nhận</th></tr></thead><tbody>${products.map((product,index)=>`<tr><td><div class="ma-ranked-product"><span class="ma-rank">${index+1}</span><div>${analysisSource(product.name,product.url,'ma-product-name')}<small>${analysisSource(product.shop_name||`Shop ${product.shop_id||'chưa rõ'}`,product.shop_url)} · ${esc(product.category||'Chưa rõ ngành')}</small></div></div></td><td class="numeric">${money(analysisNumber(product.price))}</td><td><strong>${analysisSold(product.sold_total,!!product.sold_approx)}</strong>${product.sold_approx?'<small>Số hiển thị làm tròn / cận dưới</small>':''}</td><td>${analysisSold(product.review_count,!!product.review_approx)}${product.review_approx?'<small>Số đánh giá hiển thị làm tròn</small>':''}</td><td>${analysisNumber(product.rating)==null?'—':'★ '+esc(product.rating)}</td><td><small>${analysisDate(product.collected_at||product.day)}</small></td></tr>`).join('')}</tbody></table></div><p class="ma-footnote">Hiển thị ${num(products.length)}/${num(summary.product_count||0)} sản phẩm, xếp theo số đã bán cộng dồn hiển thị. Mỗi SKU lấy lần ghi nhận mới nhất trong cửa sổ đã chọn; đây không phải lượng bán trong ${marketAnalysisState.days} ngày.</p>`;
}

function analysisShopTable(shops) {
  if (!shops.length) return analysisEmpty('Chưa có shop để xếp hạng','Shop được nhận diện từ các sản phẩm đã thu thập trong ngành hàng.');
  return `<div class="table-wrap"><table class="data-table ma-shop-table"><thead><tr><th>Shop</th><th>SP đã đọc</th><th>Tổng đã bán của mẫu</th><th>Lượt đánh giá</th><th>Giá trung vị</th></tr></thead><tbody>${shops.map((shop,index)=>`<tr><td><div class="ma-ranked-product"><span class="ma-rank">${index+1}</span><div>${analysisSource(shop.shop_name||shop.name||`Shop ${shop.shop_id}`,shop.shop_url||shop.url,'ma-product-name')}<small>Ghi nhận ${analysisDate(shop.latest_at,true)}</small></div></div></td><td>${num(shop.product_count)}</td><td><strong>${analysisAggregateSold(shop)}</strong><small>Có số bán: ${num(shop.sold_known||0)}/${num(shop.product_count||0)} SP</small></td><td>${shop.review_known===0?'—':analysisSold(shop.review_count,Number(shop.review_approx_count)>0)}${shop.review_approx_count?'<small>Có số đánh giá làm tròn</small>':''}</td><td class="numeric">${money(analysisNumber(shop.price_median))}</td></tr>`).join('')}</tbody></table></div><p class="ma-footnote">Xếp hạng chỉ phản ánh sản phẩm của mỗi shop có trong kho dữ liệu. Không đại diện doanh số toàn shop hoặc toàn sàn.</p>`;
}

function analysisCategories(categories) {
  const state=marketAnalysisState, observed=categories.filter(category=>category.product_count>0);
  const sorted=[...categories].sort((a,b)=>(b.sold_total??-1)-(a.sold_total??-1) || b.product_count-a.product_count);
  const displayed=state.showAllCategories?sorted:sorted.filter(category=>category.product_count>0);
  return `<section class="panel ma-category-panel"><div class="panel-head"><div><h3 class="panel-title">Bản đồ ngành hàng</h3><p class="panel-sub">${num(observed.length)}/${num(categories.length)} ngành có quan sát trong ${state.days} ngày · so sánh toàn bộ danh mục</p></div>${categories.length>8?`<button class="btn btn-soft btn-sm" id="marketAnalysisCategoriesMore">${state.showAllCategories?'Chỉ ngành có dữ liệu':`Xem độ phủ ${num(categories.length)} ngành`}</button>`:''}</div>${displayed.length?`<div class="table-wrap"><table class="data-table ma-category-table"><thead><tr><th>Ngành hàng</th><th>Sản phẩm / shop</th><th>Khoảng giá</th><th>Giá trung vị</th><th>Tổng đã bán của mẫu</th></tr></thead><tbody>${displayed.map(category=>`<tr class="${String(category.id)===state.categoryId?'ma-selected-row':''}"><td><button class="ma-category-link" data-ma-category="${esc(category.id)}">${esc(category.name)} →</button>${!category.product_count?'<small>Chưa có quan sát</small>':''}</td><td>${num(category.product_count||0)} SP · ${num(category.shop_count||0)} shop</td><td>${analysisNumber(category.price_min)==null?'—':`${money(category.price_min)} – ${money(category.price_max)}`}</td><td class="numeric">${money(analysisNumber(category.price_median))}</td><td>${analysisAggregateSold(category)}</td></tr>`).join('')}</tbody></table></div><p class="ma-footnote">Một sản phẩm có thể xuất hiện ở nhiều ngành hàng. Không cộng các hàng thành tổng toàn sàn.</p>`:analysisEmpty('Danh mục đã sẵn sàng, chưa có quan sát','Chạy hàng đợi thu thập để có dữ liệu so sánh giữa các ngành hàng.',true)}</section>`;
}

function analysisPriceBands(bands) {
  const max=Math.max(1,...bands.map(band=>analysisNumber(band.count)||0));
  const count=bands.reduce((sum,band)=>sum+(analysisNumber(band.count)||0),0);
  return `<section class="panel ma-chart-panel"><div class="panel-head"><div><h3 class="panel-title">Phân bố giá sản phẩm</h3><p class="panel-sub">${num(count)} sản phẩm có giá · cùng bộ lọc hiện tại</p></div><span class="ma-chart-icon" aria-hidden="true">▥</span></div>${count?`<div class="ma-price-chart" aria-label="Số sản phẩm theo khoảng giá">${bands.map(band=>`<div class="ma-price-band"><div><span>${esc(band.label)}</span><strong>${num(band.count)} SP</strong></div><div class="ma-bar-track"><span style="width:${Math.max(0,Math.min(100,100*(analysisNumber(band.count)||0)/max))}%"></span></div></div>`).join('')}</div>`:analysisEmpty('Chưa có phân bố giá','Cần các sản phẩm có giá ghi nhận để so sánh phân khúc.')}</section>`;
}

function analysisHistory(history) {
  const max=Math.max(1,...history.map(day=>analysisNumber(day.product_count)||0));
  return `<section class="panel ma-chart-panel"><div class="panel-head"><div><h3 class="panel-title">Độ phủ ghi nhận theo ngày</h3><p class="panel-sub">Số SKU được quan sát mỗi ngày, không phải số bán</p></div><span class="ma-chart-icon" aria-hidden="true">◷</span></div>${history.length?`<div class="ma-history-chart" aria-label="Số sản phẩm được ghi nhận theo ngày">${history.map(day=>`<div class="ma-history-day"><strong>${num(day.product_count)}</strong><div><span style="height:${Math.max(0,Math.min(100,100*(analysisNumber(day.product_count)||0)/max))}%" title="${esc(day.day)}: ${num(day.product_count)} sản phẩm"></span></div><small>${analysisDate(day.day,true)}</small></div>`).join('')}</div><p class="ma-footnote">${num(history.length)} ngày có ghi nhận trong cửa sổ ${marketAnalysisState.days} ngày. Quét lại giúp bổ sung lịch sử.</p>`:analysisEmpty('Chưa có lịch sử ghi nhận','Mỗi lượt thu thập lưu lại một quan sát sản phẩm theo ngày.')}</section>`;
}

function analysisTrendCard(product) {
  const reviews=product.trend_basis==='reviews';
  const velocity=reviews?product.review_velocity:product.velocity;
  const acceleration=reviews?product.review_acceleration:product.acceleration;
  const unit=reviews?'đánh giá/ngày':'SP/ngày';
  return `<article class="ma-trend-card">${analysisSource(product.name,product.url,'ma-product-name')}<small>${esc(product.category)} · ${esc(product.shop_name||`Shop ${product.shop_id}`)}</small><dl><div><dt>${reviews?'Tốc độ đánh giá quan sát':'Tốc độ bán quan sát'}</dt><dd>${analysisNumber(velocity)==null?'—':esc(velocity.toFixed(2))} <small>${unit}</small></dd></div><div><dt>Chênh lệch tốc độ</dt><dd>${analysisNumber(acceleration)==null?'—':esc((acceleration>0?'+':'')+acceleration.toFixed(2))} <small>${unit}</small></dd></div></dl><p>${esc(product.reason||(reviews?'Tính từ các lần ghi nhận lượt đánh giá chính xác; không quy đổi thành số bán.':'Tính từ các lần ghi nhận số bán chính xác.'))}</p></article>`;
}

function analysisTrends(products,summary) {
  return `<section class="panel ma-trend-panel" id="marketAnalysisTrends"><div class="panel-head"><div><span class="ma-eyebrow">TĂNG TRƯỞNG ĐÃ QUAN SÁT</span><h3 class="panel-title">Sản phẩm có tín hiệu tăng tốc</h3><p class="panel-sub">So sánh số bán hoặc lượt đánh giá chính xác qua ít nhất 3 ngày · độc lập với điểm ML</p></div><span class="ma-pill ma-pill-green">${num(summary.history_ready_count||0)} SP đủ lịch sử</span></div>${products.length?`<div class="ma-trend-grid" data-pagination-list data-pagination-key="observed-trends" data-pagination-size="10">${products.map(analysisTrendCard).join('')}</div>`:analysisEmpty('Chưa đủ lịch sử để xác định sản phẩm tăng tốc',`Hiện có ${num(summary.day_count||0)} ngày ghi nhận và ${num(summary.approx_sales_count||0)} sản phẩm có số bán làm tròn. Cần ít nhất 3 ngày có số bán hoặc lượt đánh giá chính xác; số bán dạng 1k / 1k+ không dùng để suy diễn tăng trưởng.`,true)}</section>`;
}

function analysisModel(model,candidates) {
  const state=marketAnalysisState, trained=model.status==='trained';
  const groups=analysisNumber(model.groups_count)??(Array.isArray(model.groups)?model.groups.length:null);
  return `<section class="panel ma-model-panel" id="marketAnalysisModel"><div class="panel-head"><div><span class="ma-eyebrow">MACHINE LEARNING · TỪ DỮ LIỆU THỰC</span><h3 class="panel-title">Vị thế sản phẩm trong mẫu thị trường</h3><p class="panel-sub">Phân cụm nhóm giá, độ phổ biến và đánh giá. Kết quả mô tả thị trường hiện tại; không dự báo doanh số hoặc hot trend tương lai.</p></div><span class="ma-pill ${trained?'ma-pill-blue':''}">${state.training?'Đang huấn luyện…':trained?'Đã huấn luyện':'Chờ đủ dữ liệu'}</span></div><div class="ma-model-layout"><div class="ma-model-info"><strong>${model.algorithm==='kmeans_standardized_log_features'?'Phân cụm K-means':esc(model.algorithm||'Phân cụm sản phẩm')}</strong><p>${esc(model.reason||'Huấn luyện từ dữ liệu đã thu thập để nhận diện các nhóm sản phẩm có đặc trưng tương tự.')}</p><dl><div><dt>Sản phẩm huấn luyện</dt><dd>${num(analysisNumber(model.training_product_count))}</dd></div><div><dt>Phạm vi mô hình</dt><dd>${groups==null?'—':`${num(groups)} ngành`}</dd></div><div><dt>Dữ liệu đến</dt><dd>${analysisDate(model.training_cutoff,true)}</dd></div><div><dt>Huấn luyện lúc</dt><dd>${analysisDate(model.trained_at)}</dd></div></dl><div class="ma-model-actions"><button ${!analysisCanManage()?'hidden':''} class="btn btn-primary" id="marketAnalysisTrain" ${state.training||state.loading?'disabled':''}>${state.training?'Đang huấn luyện…':trained?'Huấn luyện lại từ database':'Huấn luyện từ database'}</button>${trained||model.artifact_available?'<a class="btn btn-white" href="/api/category-market/ml/export">↓ Tải mô hình JSON</a>':''}</div><p class="ma-footnote">Huấn luyện trên kho dữ liệu. Bộ lọc ngành và thời gian áp dụng cho các kết quả đang hiển thị.</p></div><div class="ma-model-candidates">${candidates.length?`<h4>Tín hiệu vị thế thị trường đã học</h4><p class="ma-footnote">Điểm tương đối trong dữ liệu của ngành; không phải xác suất bán chạy.</p><div data-pagination-list data-pagination-key="model-candidates" data-pagination-size="10">${candidates.map(product=>`<article><div>${analysisSource(product.name,product.url,'ma-product-name')}<span class="ma-pill">${esc(product.segment||'Nhóm sản phẩm tương tự')}</span><p>${esc(product.ml_reason||product.reason||'Mức vị thế tương đối theo mô hình đã học.')}</p></div><strong>${analysisNumber(product.ml_signal_score)==null?'—':num(product.ml_signal_score)}<small>/100</small></strong></article>`).join('')}</div>`:analysisEmpty(trained?'Chưa có sản phẩm được chấm điểm trong bộ lọc':'Chưa có kết quả mô hình',trained?'Đổi ngành hàng hoặc cửa sổ quan sát để xem sản phẩm có dữ liệu phù hợp với mô hình.':'Máy chủ tự học khi đủ dữ liệu. Có thể bấm huấn luyện để chạy ngay; nếu dữ liệu chưa đủ, hệ thống sẽ nêu rõ phần còn thiếu.')}</div></div>${model.stale?'<p class="ma-model-status">Kho dữ liệu đã thay đổi sau lần huấn luyện. Bộ học tự động sẽ cập nhật mô hình ở lần kiểm tra kế tiếp; có thể bấm Huấn luyện lại để chạy ngay.</p>':''}${state.trainingMessage?`<p class="ma-model-status" role="status" aria-live="polite">${esc(state.trainingMessage)}</p>`:''}${state.trainingError?`<p class="ma-error" role="alert">Huấn luyện chưa thành công: ${esc(state.trainingError)}. Kết quả đã có được giữ lại.</p>`:''}</section>`;
}

function renderMarketAnalysis() {
  const state=marketAnalysisState;
  if (!state.started) {state.started=true; setTimeout(loadMarketAnalysis,0);}
  const data=state.dataKey===marketAnalysisKey()?state.data:null;
  const summary=data?.summary||{}, categories=Array.isArray(state.data?.categories)?state.data.categories:[];
  const basis=data?.basis||{}, coverage=data?.coverage||{};
  const hero=`<section class="panel ma-hero"><div><span class="ma-eyebrow">KHO DỮ LIỆU NGÀNH HÀNG</span><h2>Nhìn rõ sản phẩm, shop<br>và tín hiệu thị trường.</h2><p>So sánh các sản phẩm đã thu thập, tìm shop nổi bật và học những nhóm thị trường từ dữ liệu của bạn.</p></div><div class="ma-hero-stat"><span>PHẠM VI ĐÃ QUAN SÁT</span><strong>${data?num(summary.product_count||0):'—'}</strong><small>${data?`sản phẩm · ${num(summary.shop_count||0)} shop`:'Chưa có kết quả cho bộ lọc hiện tại'}</small><p>${data?`Ghi nhận mới nhất ${analysisDate(summary.latest_at)}`:state.loading?'Đang đọc database…':'Kết quả sẽ xuất hiện sau khi cập nhật.'}</p></div></section>`;
  const status=state.error?`<div class="ma-error" role="alert">Chưa cập nhật được phân tích: ${esc(state.error)}${data?' · Đang giữ kết quả lần đọc trước.':''}</div>`:'';
  const filters=analysisFilters(categories);
  if (!data) return hero+filters+status+`<section class="panel">${state.loading?'<div class="ma-loading" role="status"><span></span>Đang đọc dữ liệu phân tích cho bộ lọc hiện tại…</div>':analysisEmpty('Chưa có kết quả cho bộ lọc này','Bấm Làm mới phân tích để thử lại. Kết quả của bộ lọc khác không được đưa vào báo cáo này.')}</section>`;
  const products=Array.isArray(data.top_products)?data.top_products:[], shops=Array.isArray(data.top_shops)?data.top_shops:[];
  return hero+filters+status+analysisAutomatic(data)+`<nav class="ma-section-links" aria-label="Các phần phân tích"><a href="#marketAnalysisProducts">Top sản phẩm</a><a href="#marketAnalysisShops">Top shop</a><a href="#marketAnalysisTrends">Tín hiệu tăng trưởng</a><a href="#marketAnalysisModel">Mô hình ML</a></nav><div class="ma-data-note"><span aria-hidden="true">◎</span><p><strong>${esc(basis.sales_label||'Số bán cộng dồn công khai; gồm giá trị làm tròn / cận dưới.')}</strong><br>${analysisDate(basis.window_start,true)} – ${analysisDate(basis.window_end,true)} · ${num(summary.exact_sales_count||0)} SP có số bán chính xác, ${num(summary.approx_sales_count||0)} SP có số bán làm tròn. Kết luận chỉ trong phạm vi đã thu thập.</p></div><div class="ma-metrics">${analysisMetric('Sản phẩm quan sát',num(summary.product_count||0),'SKU duy nhất trong bộ lọc','▤')}${analysisMetric('Shop trong mẫu',num(summary.shop_count||0),'Từ những sản phẩm đã thu thập','⌂')}${analysisMetric('Ngày có dữ liệu',num(summary.day_count||0),`Trong ${state.days} ngày gần nhất`,'◷')}${analysisMetric('Đủ lịch sử tăng trưởng',num(summary.history_ready_count||0),'3 ngày có số bán / đánh giá chính xác','↗')}</div><section class="panel" id="marketAnalysisProducts"><div class="panel-head"><div><h3 class="panel-title">Top sản phẩm theo số đã bán hiển thị</h3><p class="panel-sub">Giá, độ phổ biến và đánh giá của từng mặt hàng</p></div><span class="ma-pill">${num(products.length)} sản phẩm trong mẫu</span></div>${analysisProductTable(products,summary)}</section><section class="panel" id="marketAnalysisShops"><div class="panel-head"><div><h3 class="panel-title">Shop nổi bật trong ngành</h3><p class="panel-sub">So sánh trên các sản phẩm đã quan sát, mỗi SKU chỉ tính một lần</p></div><span class="ma-pill">${num(shops.length)} shop hiển thị</span></div>${analysisShopTable(shops)}</section>${analysisCategories(categories)}<div class="ma-chart-grid">${analysisPriceBands(Array.isArray(data.price_bands)?data.price_bands:[])}${analysisHistory(Array.isArray(data.history)?data.history:[])}</div>${analysisTrends(Array.isArray(data.trend_candidates)?data.trend_candidates:[],summary)}${analysisModel(data.model||{},Array.isArray(data.ml_candidates)?data.ml_candidates:[])}<div class="ma-dataset-footer"><p>Hàng đợi: ${num(coverage.completed||0)}/${num(coverage.discovered||0)} SP đã lưu · ${num(coverage.paused||0)} lượt tạm dừng. Quét tiếp để mở rộng độ phủ.</p><div>${analysisCanManage()?'<button class="btn btn-soft" data-action="categoryMarket">Mở kho thu thập →</button>':'<span class="small-help">System quản lý kho thu thập</span>'}<a class="btn btn-white" href="/api/category-market/export?format=csv&category_id=${encodeURIComponent(state.categoryId)}">↓ Xuất đặc trưng CSV</a></div></div>`;
}

document.addEventListener('change',event=>{
  if (event.target.id==='marketAnalysisCategory') {
    marketAnalysisState.categoryId=event.target.value; return loadMarketAnalysis();
  }
  if (event.target.id==='marketAnalysisDays') {
    const days=Number(event.target.value);
    if (![7,14,30].includes(days)) return;
    marketAnalysisState.days=days; return loadMarketAnalysis();
  }
});

document.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.id==='marketAnalysisRefresh') return loadMarketAnalysis();
  if (button.id==='marketAnalysisTrain') return trainMarketAnalysisModel();
  if (button.id==='marketAnalysisCategoriesMore') {marketAnalysisState.showAllCategories=!marketAnalysisState.showAllCategories; return marketAnalysisRender();}
  if (button.dataset.maCategory) {marketAnalysisState.categoryId=button.dataset.maCategory; return loadMarketAnalysis();}
});


// The server learns independently; this timer only reads the latest computed report.
if (typeof setInterval === 'function') setInterval(() => {
  if (S.view === 'marketAnalysis' && !document.hidden && !marketAnalysisState.loading && !marketAnalysisState.training) return loadMarketAnalysis();
}, 30000);
