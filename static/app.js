'use strict';
const $ = (id)=>document.getElementById(id);
const S = {shops:[],shopId:null,data:null,view:'overview',query:'',sort:'revenue',fee:12,ads:8,crawler:{enabled:false},jobTimer:null,crawlerRefreshing:false,refreshedCrawlJobs:new Set(),crawlSubmitting:false,crawlRun:null,competitor:{shop:'',category:'',query:'',sort:'sold',page:1,pageSize:50,url:'',detailLimit:20,readDetails:true}};
const esc = (value)=>String(value ?? '').replace(/[&<>"']/g, x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const money = n => n==null ? '—' : new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(n)+' ₫';
const compact = n => n==null ? '—' : n>=1e9 ? (n/1e9).toFixed(2).replace('.',',')+' tỷ' : n>=1e6 ? (n/1e6).toFixed(2).replace('.',',')+' tr' : new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(n);
const num = n => n==null ? '—' : new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(n);
const toast = msg => {const el=$('toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.add('hidden'),5000)};
const canCollect = ()=>window.MarketLensAuth?window.MarketLensAuth.canCollect:true;
const canCrawlShop = ()=>window.MarketLensAuth?window.MarketLensAuth.canCrawlShop:true;
const appArea = ()=>document.body?.dataset?.appRole||'user';
const routeUrl = (view,shopId=S.shopId)=>window.MarketLensRoutes?.url(view,shopId,appArea())||('/workspace?view='+encodeURIComponent(view)+(shopId?'&shop_id='+encodeURIComponent(shopId):''));
const api = async (path, opts={}) => {if(window.MarketLensAuth)return window.MarketLensAuth.request(path,opts);const r=await fetch(path,opts);let x;try{x=await r.json()}catch{x={detail:'Lỗi đọc phản hồi'}};if(!r.ok) throw Object.assign(new Error(typeof x.detail==='string'?x.detail:'Yêu cầu không thành công'),{status:r.status});return x};
const pages={users:'Tài khoản & phân quyền',myShops:'My Shops',shopAnalysis:'Shop Analysis',optimizer:'Product Optimizer',strategy:'AI Strategy',actions:'Action Center',reports:'Reports',marketAnalysis:'Phân tích ngành hàng',marketSchedules:'Lịch quét ngành hàng',categoryMarket:'Thu thập ngành hàng',overview:'Tổng quan',products:'Sản phẩm của shop',opportunities:'Cơ hội sản phẩm',competitors:'Đối thủ & thị trường',imports:'Nguồn dữ liệu',crawler:'Bot thu thập'};
const headings={users:'Quản lý tài khoản & nhật ký hoạt động',myShops:'Cửa hàng của bạn',shopAnalysis:'Phân tích sức khỏe shop',optimizer:'Tối ưu hiệu quả bán hàng',strategy:'Chiến lược từ dữ liệu',actions:'Kế hoạch triển khai',reports:'Báo cáo & hiệu quả',marketAnalysis:'Phân tích ngành hàng & tín hiệu thị trường',marketSchedules:'Lịch thu thập dữ liệu ngành hàng',categoryMarket:'Thu thập sản phẩm theo ngành hàng',overview:'Tổng quan cửa hàng',products:'Phân tích sản phẩm',opportunities:'Sản phẩm tiềm năng',competitors:'Thị trường & đối thủ',imports:'Trung tâm dữ liệu',crawler:'Browser crawler'};
function badge(s){return `<span class="mini-chip">${esc(s)}</span>`}
function empty(icon,title,detail,action='Nhập dữ liệu'){return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${detail}</p>${canCollect()?`<button class="btn btn-primary" data-action="imports">${action} →</button>`:'<p class="small-help">System sẽ cập nhật nguồn dữ liệu cho shop được cấp quyền.</p>'}</div>`}
async function loadShops(prefer){ S.shops=await api('/api/shops');$('shopSelect').innerHTML=S.shops.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');if(prefer)S.shopId=prefer;if(!S.shops.some(x=>x.id===S.shopId)) S.shopId=(S.shops.find(x=>!x.is_demo)||S.shops[0])?.id; $('shopSelect').value=S.shopId; await loadReport() }
async function loadReport(refreshView=true){
 if(!S.shopId)return false;const shopId=S.shopId;
 if(S.data&&String(S.data.shop?.id)!==String(shopId)){S.data=null;S.reportError='';$('shopUrl').textContent=S.shops.find(shop=>String(shop.id)===String(shopId))?.url||'';$('dataBadge').textContent='ĐANG ĐỌC DỮ LIỆU';render();}
 try{
  const data=await api(`/api/dashboard?shop_id=${encodeURIComponent(shopId)}&platform_fee_pct=${S.fee}&ads_fee_pct=${S.ads}&all_rows=true`);
  if(S.shopId!==shopId)return false;S.data=data;S.reportError='';$('shopUrl').textContent=data.shop.url;
  const demo=!!data.shop.is_demo;$('dataBadge').textContent=demo?'DỮ LIỆU MẪU':'SHOP RIÊNG';$('dataBadge').className='tag '+(demo?'tag-demo':'tag-real');$('demoWarning').classList.toggle('hidden',!demo);
  if(refreshView||S.view!=='crawler')render();return true;
 }catch(error){if(S.shopId!==shopId)return false;S.reportError=error.message;if([401,403,404].includes(error.status))S.data=null;if(!S.data){$('dataBadge').textContent='CHƯA ĐỌC ĐƯỢC DỮ LIỆU';render();}toast(error.message);return false;}
}
function setView(view){if(!pages[view])return;if(window.MarketLensRoutes){if(!window.MarketLensRoutes.canOpen(window.MarketLensAuth?.session?.account?.role,view)){toast('Chức năng này thuộc khu vực System. Hãy liên hệ người quản lý dữ liệu.');return;}if(window.MarketLensRoutes.areaForView(view,appArea())!==appArea()){location.assign(routeUrl(view));return;}}S.view=view;document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===view));$('pageTitle').textContent=pages[view];$('mainHeading').innerHTML=headings[view]+'<span class="h1-dot">.</span>';$('viewContainer').innerHTML='';history.replaceState(null,'',routeUrl(view));render();window.scrollTo({top:0,behavior:'smooth'})}
function panel(title,sub,body,action=''){return `<section class="panel"><div class="panel-head"><div><h3 class="panel-title">${title}</h3><p class="panel-sub">${sub}</p></div>${action}</div>${body}</section>`}
function kpi(title,value,hint,icon,style=''){return `<article class="kpi"><div class="kpi-top"><span class="kpi-title">${title}</span><div class="kpi-icon ${style}">${icon}</div></div><div class="kpi-value">${value}</div><div class="kpi-hint">${hint}</div></article>`}
function bars(categories){if(!categories.length)return '<div class="chart-empty">Hãy nhập dữ liệu sản phẩm để xem ngành hàng.</div>';const max=Math.max(1,...categories.map(x=>x.revenue_30d));return categories.slice(0,7).map(x=>`<div class="category-bar"><div class="cat-row"><strong title="${esc(x.category)}">${esc(x.category)}</strong><span>${compact(x.revenue_30d)} ₫</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,100*x.revenue_30d/max)}%"></div></div></div>`).join('')}
function summaryInsight(d){const o=d.own_products,m=d.market_products, k=d.kpis;
let best=o.find(x=>x.units_30d!=null);const leading=best ? `Sản phẩm mang lại doanh thu tham chiếu cao nhất là “${esc(best.name)}”.` :'Dữ liệu sản phẩm hiện chưa đủ để xác định mặt hàng dẫn đầu.';
let opp=d.opportunities[0];return `<div class="insight-card"><span class="symbol">📊</span><div><strong>Tập trung sản phẩm chủ lực</strong><p>${leading} ${k.revenue_30d!=null?'Doanh thu đang phân tích trong khoảng dữ liệu 30 ngày của từng sản phẩm.':'Hãy bổ sung cột đơn bán 30 ngày để tính doanh thu.'}</p></div></div>
<div class="insight-card gold"><span class="symbol">✦</span><div><strong>Cơ hội mở rộng danh mục</strong><p>${opp?`“${esc(opp.name)}” đạt ${opp.score}/100 trong tập đối thủ nhập lên. Nên kiểm tra chất lượng nguồn hàng và thử đơn nhỏ.`:'Nhập dữ liệu sản phẩm đối thủ cùng ngành để nhận danh sách cơ hội có giải thích.'}</p></div></div>
<div class="insight-card green"><span class="symbol">✓</span><div><strong>Chất lượng dữ liệu</strong><p>${o.length} sản phẩm shop, ${m.length} sản phẩm tham chiếu. Kết luận chỉ phản ánh phạm vi dữ liệu đã nhập, không đại diện toàn sàn Shopee.</p></div></div>`}
function unitsLabel(p){return p.units_basis==='estimated_snapshot_delta'?'Ước tính Δ đã bán':(p.is_provisional?'Chưa rõ /30 ngày':'BÁN / 30 NGÀY')}
function oppCard(p,i){return `<div class="opp-card"><div class="opp-top"><span class="rank">TOP ${i+1} CƠ HỘI</span><div class="score">${p.score}<small>/100</small></div></div><h3>${esc(p.name)}</h3><div class="opp-meta">${esc(p.source_shop)} · ${esc(p.category)}</div><div class="opp-line"></div><div class="opp-stats"><div><label>GIÁ THAM CHIẾU</label><strong>${money(p.price)}</strong></div><div><label>${esc(unitsLabel(p))}</label><strong>${num(p.units_30d)}</strong></div></div><div class="opp-reason">${esc(p.reasons[0]||'')} · Tin cậy: ${esc(p.confidence)}</div></div>`}
function renderOverview(d){let k=d.kpis;
const metrics=`<section class="grid-kpi">${kpi('Sản phẩm đang theo dõi',num(k.own_products),'Số SKU/sản phẩm ở snapshot mới nhất','▧')}${kpi('Doanh thu 30 ngày',k.revenue_30d==null?'—':compact(k.revenue_30d)+' ₫',k.revenue_kind==='estimated_snapshot_delta'?'Ước tính từ chênh lệch snapshot':k.revenue_kind==='estimate'?'Ước tính từ giá × số lượng bán':'Theo dữ liệu báo cáo hoặc chưa đủ dữ liệu','↗','purple')}${kpi('Sản lượng 30 ngày',num(k.units_30d),k.units_30d==null?'Chưa có dữ liệu 30 ngày':(k.revenue_kind==='estimated_snapshot_delta'?'Ước tính qua chênh lệch snapshot':'Tổng đơn vị hàng, không phải số đơn'),'▤','green')}${kpi('Giá bán trung vị',k.median_price==null?'—':compact(k.median_price)+' ₫','Trung vị sản phẩm shop','◇','orange')}</section>`;
const charts=`<div class="content-grid">${panel('Cơ cấu doanh thu theo ngành hàng','Giá trị trong tập dữ liệu đã nhập',bars(d.categories),'<span class="legend">● Doanh thu 30 ngày</span>')}${panel('Gợi ý từ dữ liệu','Ưu tiên dựa trên phạm vi dữ liệu có sẵn',summaryInsight(d))}</div>`;
const opts=d.opportunities.length?`<div class="opportunities-grid">${d.opportunities.slice(0,3).map(oppCard).join('')}</div>`:empty('✦','Chưa có cơ hội được xếp hạng','Nhập dữ liệu đối thủ cùng ngành hoặc dùng crawler. Một lần quét công khai chỉ có thể cho tín hiệu sơ bộ.');
const top=d.own_products.length?productTable(d.own_products.slice(0,6)):empty('▦','Chưa có sản phẩm nào','Tải CSV/XLSX xuất từ nguồn dữ liệu shop được phép sử dụng.');
return (window.MarketLensSeller?.overview(d)||metrics)+charts+`<div class="section-head"><h2>Cơ hội sản phẩm phù hợp</h2><button class="text-link" data-action="opportunities">Xem toàn bộ →</button></div>`+opts+`<div class="section-head"><h2>Sản phẩm nổi bật</h2><button class="text-link" data-action="products">Xem tất cả →</button></div><div class="panel">${top}</div>`;
}
function productKey(product){return JSON.stringify([product.role||'',product.source_shop||'',String(product.sku||'')])}
function findProductByKey(data,key){const products=new Map(),comparisons=data?.competitor_analysis?.product_comparisons||[];for(const product of [...(data?.own_products||[]),...(data?.market_products||[]),...(data?.opportunities||[]),...(data?.competitor_analysis?.recommendations||[]),...comparisons.flatMap(item=>[item.own_product,...(item.competitors||[])])].filter(Boolean)){const candidate=productKey(product);if(!products.has(candidate))products.set(candidate,product)}return products.get(key)}
function detailStatus(product){const detail=product.detail;return detail?.collected_at?'Đã đọc chi tiết':detail?.error||detail?.last_error?'Chưa đọc được':'Chưa đọc chi tiết'}
function productTable(items){return `<div class="table-wrap"><table class="data-table" data-pagination-key="own-products"><thead><tr><th>TÊN SẢN PHẨM</th><th>NGÀNH HÀNG</th><th>GIÁ BÁN</th><th>BÁN / 30 NGÀY</th><th>DOANH THU 30 NGÀY</th><th>ĐÁNH GIÁ</th><th>CHI TIẾT</th></tr></thead><tbody>${items.map(x=>`<tr><td class="product-name"><button class="product-detail-link" data-product-key="${esc(productKey(x))}">${esc(x.name)}</button></td><td>${badge(x.category)}</td><td class="numeric">${money(x.price)}</td><td>${num(x.units_30d)}</td><td class="numeric">${x.revenue_30d!=null?money(x.revenue_30d):x.price!=null&&x.units_30d!=null?money(x.price*x.units_30d)+' *':'—'}</td><td>${x.rating!=null?'★ '+esc(x.rating):'—'}</td><td><button class="btn btn-soft btn-sm" data-product-key="${esc(productKey(x))}" title="${esc(x.detail?.last_error||x.detail?.error||'Xem thông tin sản phẩm')}">${esc(detailStatus(x))} →</button> <button class="btn btn-white btn-sm" data-seller-optimize="${esc(x.sku)}">Tối ưu SKU</button></td></tr>`).join('')}</tbody></table></div><p class="fine-print">* Giá × lượng bán là doanh thu tham chiếu ước tính; chưa trừ hoàn trả, khuyến mãi, phí, thuế và chi phí. Bấm tên sản phẩm để xem mô tả, hình ảnh và phân loại đã đọc.</p>`}
function safeDetailUrl(value,image=false){try{const url=new URL(value);const host=url.hostname.toLowerCase();if(url.protocol!=='https:'||url.username||url.password||url.port)return '';if(image){if(!['shopee.vn','susercontent.com','shopeeusercontent.com'].some(domain=>host===domain||host.endsWith('.'+domain)))return ''}else if(!['shopee.vn','www.shopee.vn'].includes(host))return '';return url.href}catch{return ''}}
function sellerProductDiagnostics(product){
 if(product.role!=='own')return '';
 const insight=S.data?.seller_analysis?.products?.find(item=>String(item.sku)===String(product.sku)), metrics=insight?.metrics||{};
 return `<section class="product-detail-section sw-product-diagnostics"><h3>Product Intelligence</h3><div class="sw-detail-metrics"><div><span>Product Health</span><strong>${insight?.health?.score==null?'—':num(insight.health.score)+'/100'}</strong></div><div><span>Lãi đóng góp / đơn theo điều kiện</span><strong>${money(metrics.contribution_per_order)}</strong></div><div><span>ROAS ghi nhận</span><strong>${metrics.roas==null?'—':esc(metrics.roas)}</strong></div><div><span>Chuyển đổi</span><strong>${metrics.conversion_pct==null?'—':num(metrics.conversion_pct)+'%'}</strong></div></div>${insight?.health?.issues?.length?`<ul class="sw-assumptions">${insight.health.issues.map(esc).map(text=>`<li>${text}</li>`).join('')}</ul>`:''}<p class="small-help">${esc(insight?.health?.confidence||'Cần bổ sung dữ liệu SKU và chi phí.')} Phản hồi tiêu cực và nguyên nhân hoàn trả chưa được cung cấp.</p><div class="sw-card-actions"><button class="btn btn-primary btn-sm" data-seller-optimize="${esc(product.sku)}">Tối ưu giá SKU này</button><button class="btn btn-soft btn-sm" data-seller-strategy="${esc(product.sku)}">Lập chiến lược</button><button class="btn btn-white btn-sm" data-seller-task="${esc(product.sku)}">Theo dõi công việc</button><button class="btn btn-white btn-sm" data-seller-competitors="${esc(product.sku)}">So sánh đối thủ</button></div></section>`;
}
function productDetailContent(product){
 const detail=product.detail||{};
 const source=safeDetailUrl(detail.url||product.product_url);
 const images=(Array.isArray(detail.images)?detail.images:[]).map(url=>safeDetailUrl(url,true)).filter(Boolean);
 const attributes=Array.isArray(detail.attributes)?detail.attributes:[];
 const variants=Array.isArray(detail.variants)?detail.variants:[];
 const categories=Array.isArray(detail.categories)?detail.categories:[];
 const fields=[['Giá trên trang chi tiết',detail.price_text],['Đánh giá',detail.rating_text],['Số lượt đánh giá',detail.review_count_text],['Tổng đã bán',detail.sold_text],['Tình trạng kho',detail.stock_text]];
 const warning=detail.last_error||detail.error;
 return sellerProductDiagnostics(product)+`<div class="product-detail-meta">${badge(detailStatus(product))}${detail.collected_at?`<span>Đọc lúc ${esc(detail.collected_at.replace('T',' ').slice(0,19))}</span>`:''}${source?`<a class="text-link" href="${esc(source)}" target="_blank" rel="noopener noreferrer">Mở sản phẩm trên Shopee ↗</a>`:''}</div>
 ${warning?`<div class="warning-soft">Lần đọc gần nhất: ${esc(warning)}${detail.collected_at?' Thông tin dưới đây là lần đọc thành công trước đó.':''}</div>`:''}
 ${!detail.collected_at&&!warning?`<p class="muted">${canCollect()?'Sản phẩm hiện có thông tin từ danh sách shop. Bật “Đọc chi tiết từng sản phẩm” rồi bấm Quét để tự mở và đọc từng trang sản phẩm.':'Chưa có dữ liệu chi tiết. System cần đọc trang sản phẩm để bổ sung mô tả, hình ảnh và phân loại.'}</p>`:''}
 ${categories.length?`<p class="product-detail-category">${categories.map(esc).join(' › ')}</p>`:''}
 ${images.length?`<div class="product-detail-images" aria-label="Hình ảnh sản phẩm">${images.map((url,index)=>`<img src="${esc(url)}" alt="${esc(product.name)} — ảnh ${index+1}" loading="lazy" referrerpolicy="no-referrer">`).join('')}</div>`:''}
 ${fields.some(([,value])=>value)?`<dl class="product-detail-facts">${fields.filter(([,value])=>value).map(([name,value])=>`<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="fine-print">Giá là nội dung hiển thị trên trang chi tiết khi đọc; có thể là khoảng giá hoặc khác giá khuyến mãi trên danh sách shop.</p>`:''}
 ${variants.length?`<section class="product-detail-section"><h3>Phân loại sản phẩm</h3>${variants.map(group=>`<div class="product-detail-variant"><strong>${esc(group.name)}</strong><div>${(Array.isArray(group.options)?group.options:[]).map(option=>badge(option)).join(' ')}</div></div>`).join('')}</section>`:''}
 ${attributes.length?`<section class="product-detail-section"><h3>Thông số sản phẩm</h3><dl class="product-detail-attributes">${attributes.map(attribute=>`<div><dt>${esc(attribute.name)}</dt><dd>${esc(attribute.value)}</dd></div>`).join('')}</dl></section>`:''}
 ${detail.description?`<section class="product-detail-section"><h3>Mô tả sản phẩm</h3><div class="product-detail-description">${esc(detail.description)}</div></section>`:''}`;
}
function showProductDetail(product){
 $('productDetailDialog')?.close();
 const previousFocus=document.activeElement;
 const dialog=document.createElement('dialog');dialog.id='productDetailDialog';dialog.className='product-detail-dialog';dialog.setAttribute('aria-labelledby','productDetailTitle');
 dialog.innerHTML=`<div class="modal-head"><h2 id="productDetailTitle">${esc(product.detail?.name||product.name)}</h2><form method="dialog"><button class="close" aria-label="Đóng chi tiết sản phẩm" autofocus>×</button></form></div>${productDetailContent(product)}`;
 dialog.addEventListener('close',()=>{dialog.remove();if(previousFocus?.isConnected)previousFocus.focus()});
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close()});
 document.body.append(dialog);dialog.showModal();
}
function renderProducts(d){if(!d.own_products.length)return empty('▤','Shop chưa có dữ liệu sản phẩm','Tạo một shop riêng, nhập báo cáo sản phẩm CSV/XLSX để phân tích.');let q=S.query.trim().toLocaleLowerCase('vi');let items=d.own_products.filter(x=>[x.name,x.category,x.sku].join(' ').toLocaleLowerCase('vi').includes(q));let sorted=[...items].sort((a,b)=>{if(S.sort==='units')return (b.units_30d??-1)-(a.units_30d??-1);if(S.sort==='price')return (b.price??-1)-(a.price??-1);return ((b.revenue_30d??((b.units_30d??0)*(b.price??0))) - (a.revenue_30d??((a.units_30d??0)*(a.price??0))))});return `<div class="section-head"><h2>Danh mục của shop (${num(items.length)})</h2></div><div class="filter-row"><input id="productSearch" class="search" placeholder="⌕ Tìm tên, SKU, ngành hàng" value="${esc(S.query)}"><select id="productSort" class="filter-select"><option value="revenue" ${S.sort==='revenue'?'selected':''}>Doanh thu giảm dần</option><option value="units" ${S.sort==='units'?'selected':''}>Sản lượng giảm dần</option><option value="price" ${S.sort==='price'?'selected':''}>Giá giảm dần</option></select></div><div class="panel">${productTable(sorted)}</div>`}
function renderOpportunities(d){const control=`<div class="panel"><div class="panel-head"><div><h3 class="panel-title">Cấu hình chi phí giả định</h3><p class="panel-sub">Dùng cho điểm biên lợi nhuận, không phải phí Shopee mặc định hay phí của shop bạn</p></div></div><div class="controls"><label>Phí nền tảng (%)<input id="feeField" type="number" min="0" max="80" step="0.5" value="${S.fee}"></label><label>Quảng cáo / khuyến mãi (%)<input id="adsField" type="number" min="0" max="80" step="0.5" value="${S.ads}"></label><button class="btn btn-primary" id="scoreButton">Tính lại điểm</button><button class="btn btn-white" id="exportButton">↓ Xuất CSV</button></div><div class="small-help">Điểm = 37% nhu cầu + 18% mức phù hợp giá + 18% biên lợi nhuận + 12% cạnh tranh trong mẫu + 15% xu hướng (trung tính khi chưa đủ thời gian). Thiếu giá vốn → điểm margin trung tính.</div></div>`;
let rows=d.opportunities.length?`<div class="panel"><div class="panel-head"><div><h3 class="panel-title">Xếp hạng sản phẩm có thể thử bán</h3><p class="panel-sub">Sản phẩm đối thủ cùng ngành, chưa có tên trùng chính xác trong danh mục shop</p></div><span class="confidence">Đánh giá trong mẫu</span></div><div data-pagination-list data-pagination-key="opportunity-rankings">${d.opportunities.map((p,i)=>`<div class="opp-wide"><div class="opp-num">#${i+1}</div><div><h3>${esc(p.name)}</h3><small>${esc(p.source_shop)} · ${esc(p.category)}</small></div><div><small>Giá tham chiếu</small><div><strong>${money(p.price)}</strong></div></div><div><small>${esc(unitsLabel(p))}</small><div><strong>${num(p.units_30d)}</strong></div></div><div class="opp-score">${p.score}<small>/100</small></div><div class="detail-reasons">${p.reasons.map(esc).join(' · ')} · <span class="confidence ${p.confidence==='Trung bình'?'mid':''}">${esc(p.confidence)}</span></div></div>`).join('')}</div></div>`:empty('✦','Cần dữ liệu thị trường để đề xuất','Nhập sản phẩm đối thủ từ nguồn có quyền sử dụng. Nếu chỉ có số đã bán tích lũy, xếp hạng chỉ mang tính thăm dò.');
return control+`<div class="warning-soft">⚑ Đây là <strong>xếp hạng tương đối trên dữ liệu bạn cung cấp</strong>. Phí sàn, quảng cáo và giá vốn cần được kiểm chứng theo từng sản phẩm. Không dùng điểm làm cam kết về doanh số hay lợi nhuận.</div>`+rows;}
function knownNumber(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0}
function median(values){const sorted=values.filter(knownNumber).slice().sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return !sorted.length?null:sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2}
function comparisonStats(products,sourceShop){
 const prices=products.map(p=>p.price).filter(value=>knownNumber(value)&&value>0);
 const ratings=products.map(p=>p.rating).filter(value=>knownNumber(value)&&value>0&&value<=5);
 const sold=products.filter(p=>knownNumber(p.sold_total));
 const reviews=products.filter(p=>knownNumber(p.review_count));
 const monthly=products.filter(p=>knownNumber(p.units_30d));
 const dates=products.map(p=>p.snapshot_date).filter(Boolean).sort();
 return {source_shop:sourceShop,product_count:products.length,median_price:median(prices),price_count:prices.length,rating_mean:ratings.length?ratings.reduce((sum,value)=>sum+value,0)/ratings.length:null,rating_count:ratings.length,review_count_sum:reviews.length?reviews.reduce((sum,p)=>sum+p.review_count,0):null,review_count_known:reviews.length,sold_total_sum:sold.length?sold.reduce((sum,p)=>sum+p.sold_total,0):null,sold_count:sold.length,sold_lower_bound_count:sold.filter(p=>p.sold_is_lower_bound||p.sold_lower_bound||/\+/.test(p.detail?.sold_text||'')).length,monthly_count:monthly.length,monthly_estimated_count:monthly.filter(p=>p.units_basis==='estimated_snapshot_delta').length,detail_count:products.filter(p=>p.detail?.collected_at).length,oldest_snapshot:dates[0]||null,latest_snapshot:dates.at(-1)||null};
}
function competitorAnalysis(d){
 if(d.competitor_analysis)return d.competitor_analysis;
 const grouped=new Map();for(const product of d.market_products||[]){const name=product.source_shop||'Chưa rõ shop';if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(product)}
 const market=d.market_products||[],own=d.own_products||[],stats=comparisonStats(market,'');
 return {summary:{shop_count:grouped.size,product_count:market.length,own_product_count:own.length,own_median_price:comparisonStats(own,'').median_price,market_median_price:stats.median_price,price_count:stats.price_count,rating_count:stats.rating_count,sold_count:stats.sold_count,monthly_count:stats.monthly_count},shops:[...grouped].map(([name,products])=>comparisonStats(products,name)),categories:[],recommendations:[]};
}
function comparisonRow(stats,own=false){
 const total=stats.product_count||0;
 const sold=stats.sold_count?`${stats.sold_lower_bound_count?'≥ ':''}${num(stats.sold_total_sum)}`:'—';
 return `<tr class="${own?'comparison-own':''}"><td class="product-name">${esc(stats.source_shop)} ${own?badge('SHOP CỦA BẠN'):''}</td><td class="numeric">${num(total)}</td><td class="numeric">${money(stats.median_price)}<small>Giá: ${num(stats.price_count||0)}/${num(total)} SP</small></td><td class="numeric">${stats.rating_count?`★ ${Number(stats.rating_mean).toFixed(2)}`:'—'}<small>Đánh giá: ${num(stats.rating_count||0)}/${num(total)} SP</small></td><td class="numeric">${sold}<small>Có số đã bán: ${num(stats.sold_count||0)}/${num(total)} SP</small></td><td><small>Chi tiết: ${num(stats.detail_count||0)}/${num(total)} SP</small><small>Bán 30 ngày: ${num(stats.monthly_count||0)}/${num(total)} SP${stats.monthly_estimated_count?` (${num(stats.monthly_estimated_count)} ước tính)`:''}</small></td><td title="${esc(stats.oldest_snapshot&&stats.oldest_snapshot!==stats.latest_snapshot?`Ngày dữ liệu từ ${stats.oldest_snapshot} đến ${stats.latest_snapshot}`:'')}">${esc(stats.latest_snapshot||'—')}</td></tr>`;
}
function signedPercent(value){return typeof value==='number'&&Number.isFinite(value)?`${value>0?'+':''}${new Intl.NumberFormat('vi-VN',{maximumFractionDigits:1}).format(value)}%`:'—'}
function competitorRecommendation(product,index){
 const reasons=Array.isArray(product.reasons)?product.reasons:[];
 return `<article class="opp-card competitor-recommendation"><div class="opp-top"><span class="rank">GỢI Ý ${index+1}</span><div class="score">${esc(product.score??'—')}<small>/100</small></div></div><h3><button class="product-detail-link" data-product-key="${esc(productKey(product))}">${esc(product.name)}</button></h3><div class="opp-meta">${esc(product.source_shop)} · ${esc(product.category)}</div><div class="competitor-recommendation-stats"><strong>${money(product.price)}</strong><span>${badge(product.confidence||'Chưa đủ dữ liệu')}${product.category_match?badge(product.category_match_label||(product.category_match==='exact'?'Cùng nhóm hàng':'Cùng nhóm hàng rộng')):''}</span></div>${product.price_gap_pct!=null?`<p class="fine-print">Giá so với trung vị nhóm “${esc(product.comparison_category||product.category)}” của bạn: <strong>${signedPercent(product.price_gap_pct)}</strong>.</p>`:''}<ul class="competitor-reasons">${reasons.slice(0,3).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul><button class="btn btn-soft btn-sm" data-product-key="${esc(productKey(product))}">Xem sản phẩm →</button></article>`;
}
function filteredCompetitorProducts(products,filters=S.competitor){
 const query=filters.query.trim().toLocaleLowerCase('vi');
 const rows=products.filter(product=>(!filters.shop||product.source_shop===filters.shop)&&(!filters.category||(product.category||'Chưa phân loại')===filters.category)&&(!query||[product.name,product.sku,product.category,product.source_shop].join(' ').toLocaleLowerCase('vi').includes(query)));
 const key={sold:'sold_total',price_asc:'price',price_desc:'price',rating:'rating',reviews:'review_count'}[filters.sort]||'sold_total';
 return rows.slice().sort((a,b)=>{if(filters.sort==='name')return String(a.name).localeCompare(String(b.name),'vi');const av=knownNumber(a[key])?a[key]:null,bv=knownNumber(b[key])?b[key]:null;if(av==null||bv==null)return av==null?(bv==null?String(a.name).localeCompare(String(b.name),'vi'):1):-1;return (filters.sort==='price_asc'?av-bv:bv-av)||String(a.name).localeCompare(String(b.name),'vi')});
}
function competitorProductTable(products){
 return `<div class="table-wrap"><table class="data-table competitor-products"><thead><tr><th>SẢN PHẨM / SHOP</th><th>NGÀNH HÀNG</th><th>GIÁ HIỂN THỊ</th><th>TỔNG ĐÃ BÁN</th><th>ĐÁNH GIÁ</th><th>NGÀY DỮ LIỆU</th><th>CHI TIẾT</th></tr></thead><tbody>${products.map(product=>`<tr><td class="product-name"><button class="product-detail-link" data-product-key="${esc(productKey(product))}">${esc(product.name)}</button><small>${esc(product.source_shop)}</small></td><td>${badge(product.category||'Chưa phân loại')}</td><td class="numeric">${money(product.price)}</td><td class="numeric">${knownNumber(product.sold_total)?`${product.sold_is_lower_bound||product.sold_lower_bound?'≥ ':''}${num(product.sold_total)}`:product.detail?.sold_text?esc(product.detail.sold_text):'—'}</td><td class="numeric">${product.rating!=null?'★ '+esc(product.rating):'—'}${knownNumber(product.review_count)?`<small>${num(product.review_count)} lượt đánh giá</small>`:''}</td><td>${esc(product.snapshot_date||'—')}</td><td><button class="btn btn-soft btn-sm" data-product-key="${esc(productKey(product))}">${esc(detailStatus(product))} →</button></td></tr>`).join('')}</tbody></table></div>`;
}
function canonicalCompetitorUrl(value){try{const url=new URL(value);const slug=url.pathname.replace(/^\/+|\/+$/g,'');if(!safeDetailUrl(value)||url.search||url.hash||!/^[a-z0-9_.-]{2,80}$/i.test(slug)||['search','mall','buyer','seller','product','api','cart','login','verify','captcha','checkout'].includes(slug.toLowerCase()))return '';return `https://shopee.vn/${slug}`}catch{return ''}}
function mergeCompetitorCandidates(candidates,ownUrl){
 const own=canonicalCompetitorUrl(ownUrl).toLowerCase(),seen=new Set(),result=[];
 for(const candidate of candidates){const url=canonicalCompetitorUrl(candidate.url),key=url.toLowerCase();if(!url||key===own||seen.has(key))continue;seen.add(key);result.push({...candidate,url,name:String(candidate.name||new URL(url).pathname.slice(1)),query:String(candidate.query||''),product_url:safeDetailUrl(candidate.product_url),product_name:String(candidate.product_name||'')});if(result.length===6)break}
 return result;
}
async function discoverCompetitors(){
 if(!canCollect())return toast('Tìm và thu thập đối thủ thuộc khu vực System.');
 if(S.crawlSubmitting||S.competitor.discovering||(typeof marketState!=='undefined'&&marketState.busy))return;
 const state=S.competitor,shopId=S.shopId,data=S.data;
 const queries=(competitorAnalysis(data).discovery_queries||[]).filter(item=>item&&typeof item.query==='string'&&item.query.trim()).slice(0,3);
 if(data.shop.is_demo||!queries.length){toast('Hãy quét sản phẩm shop của bạn trước để tìm đối thủ cùng ngành.');return}
 state.discovering=true;state.discoveryError='';state.discoveryStatus='Đang kết nối Chrome để tìm đối thủ...';state.candidates=[];state.discoveryBlocked=false;render();
 let autoScanUrl='';
 try{
   const bridge=await window.MarketLensChrome.ping();
   const version=String(bridge.version||'').split('.').map(Number);
   if(typeof window.MarketLensChrome.discover!=='function'||bridge.capabilities?.discover!==true||!(version[0]>1||version[0]===1&&version[1]>=2))throw new Error('Tự tìm đối thủ cần tiện ích MarketLens 1.2.0. Hãy tải lại tiện ích từ thư mục browser-extension mới rồi tải lại trang ứng dụng.');
   const candidates=[],errors=[];
   for(let index=0;index<queries.length;index++){
     if(S.shopId!==shopId||S.competitor!==state)break;
     state.discoveryStatus=`Đang tìm ${index+1}/${queries.length}: ${queries[index].query}`;render();
     try{
       const result=await window.MarketLensChrome.discover(queries[index].query,data.shop.url);
       for(const candidate of result?.candidates||[])candidates.push({...candidate,query:candidate.query||result.query||queries[index].query});
       if(Array.isArray(result?.errors))errors.push(...result.errors.map(error=>typeof error==='string'?error:String(error.message||'Không đọc được một kết quả tìm kiếm.')));
       state.candidates=mergeCompetitorCandidates(candidates,data.shop.url);render();
       if(result?.blocked){state.discoveryBlocked=true;break}
     }catch(error){errors.push(error.message);if(error.blocked||['blocked','bridge_timeout','bridge_unavailable'].includes(error.code)){state.discoveryBlocked=true;break}}
   }
   state.discoveryError=errors.join(' ').slice(0,1200);
   state.discoveryStatus=state.candidates.length?`Đã tìm ${num(state.candidates.length)} shop có sản phẩm liên quan.${state.discoveryBlocked?' Shopee yêu cầu xác minh; đã dừng và giữ kết quả tìm được.':' Đang bắt đầu quét shop đầu tiên để so sánh.'}`:'Chưa tìm được shop phù hợp từ kết quả đang hiển thị. Hãy thử lại sau hoặc nhập một shop bạn biết.';
   if(state.candidates.length&&!state.discoveryBlocked)autoScanUrl=state.candidates[0].url;
 }catch(error){state.discoveryError=error.message;state.discoveryStatus='Không tìm được đối thủ.'}
 finally{state.discovering=false;if(S.shopId===shopId&&S.competitor===state)render()}
 if(autoScanUrl&&S.shopId===shopId&&S.competitor===state){state.readDetails=true;state.detailLimit=20;startCompetitorScan(autoScanUrl)}
}
function startCompetitorScan(url){if(!canCollect())return toast('Thu thập đối thủ thuộc khu vực System.');if(S.crawlSubmitting||S.competitor.discovering||(typeof marketState!=='undefined'&&marketState.busy))return;const canonical=canonicalCompetitorUrl(url);if(!canonical)return toast('Link shop đối thủ không hợp lệ.');S.competitor.url=canonical;render();document.querySelector('form[data-competitor]')?.requestSubmit()}
function soldDisplay(product){return knownNumber(product.sold_total)?`${product.sold_lower_bound||product.sold_is_lower_bound?'≥ ':''}${num(product.sold_total)}`:product.detail?.sold_text?esc(product.detail.sold_text):'—'}
function comparisonPriceRange(product){const low=product.price_min,high=product.price_max;if(knownNumber(low)&&knownNumber(high))return low===high?money(low):`${money(low)} – ${money(high)}`;return esc(product.detail?.price_text||'')||money(product.price)}
function productComparisonSection(d,analysis){
 const comparisons=analysis.product_comparisons||[],busy=S.crawlSubmitting||S.competitor.discovering;
 const disabled=busy||d.shop.is_demo||!S.crawler.enabled;
 if(!comparisons.length)return `<section class="panel product-comparison-section"><h2>Đối thủ của từng sản phẩm bán tốt</h2><p class="muted">Quét sản phẩm shop bạn để xếp nhóm bán tốt, rồi tự tìm những shop bán sản phẩm tương tự và đọc giá, số đã bán, lượt đánh giá của từng mặt hàng.</p></section>`;
 const cards=comparisons.map((comparison,index)=>{
   const own=comparison.own_product,competitors=comparison.competitors||[],summary=comparison.summary||{};
   const image=(own.detail?.images||[]).map(url=>safeDetailUrl(url,true)).find(Boolean);
   const monthly=['units_30d','reported_30d','estimated_30d'].includes(comparison.ranking_basis);
   const basis=monthly?`${comparison.ranking_basis==='estimated_30d'||own.units_basis==='estimated_snapshot_delta'?'Ước tính ':''}Bán 30 ngày: ${num(own.units_30d)}`:comparison.ranking_basis==='unknown'?'Chưa có số bán; tham chiếu lượt đánh giá':`Tổng đã bán: ${soldDisplay(own)}`;
   const table=competitors.length?`<div class="table-wrap"><table class="data-table product-rival-table"><thead><tr><th>SHOP / SẢN PHẨM ĐỐI THỦ</th><th>GIÁ / KHOẢNG GIÁ</th><th>TỔNG ĐÃ BÁN</th><th>LƯỢT ĐÁNH GIÁ</th><th>ĐIỂM ĐÁNH GIÁ</th><th>MỨC KHỚP</th><th>NGUỒN / THỜI ĐIỂM</th></tr></thead><tbody>${competitors.map(product=>`<tr><td class="product-name"><strong>${esc(product.source_shop)}</strong><button class="product-detail-link" data-product-key="${esc(productKey(product))}">${esc(product.name)}</button></td><td class="numeric">${comparisonPriceRange(product)}<small>Giá tham chiếu đã lưu: ${money(product.price)}</small></td><td class="numeric">${soldDisplay(product)}</td><td class="numeric">${num(product.review_count)}</td><td class="numeric">${product.rating!=null?'★ '+esc(product.rating):'—'}</td><td>${badge(product.equivalence?.label||product.match_label||'Sản phẩm liên quan')}<small>${product.equivalence?.comparable?'Có thể đối chiếu giá theo thông số đã ghi nhận':'Chưa dùng làm giá tương đương'}</small></td><td><small>Snapshot: ${esc(product.snapshot_date||'—')}</small><small>Chi tiết: ${esc((product.detail_collected_at||product.detail?.collected_at||'').replace('T',' ').slice(0,16)||'Chưa đọc')}</small>${product.detail_stale?'<small class="product-stale-note">Thông tin chi tiết từ lần đọc trước</small>':''}<button class="text-link" data-product-key="${esc(productKey(product))}">Xem chi tiết →</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="product-rival-empty">Chưa có đối thủ khớp sản phẩm này. '+(canCollect()?'Bấm tìm để đọc trực tiếp các mặt hàng liên quan trên Shopee.':'System sẽ bổ sung dữ liệu đối thủ cho sản phẩm này.')+'</div>';
   return `<article class="panel product-comparison-card"><div class="product-own-heading">${image?`<img src="${esc(image)}" alt="${esc(own.name)}" loading="lazy" referrerpolicy="no-referrer">`:'<div class="product-own-placeholder">▧</div>'}<div class="product-own-info"><div class="product-own-rank">TOP ${index+1} SHOP BẠN · ${monthly?(comparison.ranking_basis==='estimated_30d'?'THEO ƯỚC TÍNH 30 NGÀY':'THEO BÁN 30 NGÀY'):comparison.ranking_basis==='unknown'?'CHƯA CÓ SỐ BÁN':'THEO TỔNG ĐÃ BÁN'}</div><h3><button class="product-detail-link" data-product-key="${esc(productKey(own))}">${esc(own.name)}</button></h3><div class="product-own-metrics"><span>Giá: <strong>${money(own.price)}</strong></span><span>${basis}</span><span>Đánh giá: <strong>${num(own.review_count)}</strong>${own.rating!=null?` · ★ ${esc(own.rating)}`:''}</span></div></div><button ${canCollect()?'':'hidden'} type="button" class="btn btn-soft btn-sm" data-compare-own-sku="${esc(own.sku)}" ${disabled||!comparison.query?'disabled':''}>${competitors.length?'Tìm thêm đối thủ':'Tìm đối thủ sản phẩm này'} →</button></div><div class="product-rival-summary"><span>${num(summary.shop_count||0)} shop · ${num(summary.product_count||competitors.length)} sản phẩm liên quan</span>${summary.price_min!=null&&summary.price_max!=null?`<span>Khoảng giá ứng viên liên quan: <strong>${comparisonPriceRange(summary)}</strong></span>`:''}<span>Có số bán: ${num(summary.sold_count||0)} · có số đánh giá: ${num(summary.review_count_known||0)}</span></div>${table}${comparison.competitors_truncated?`<p class="fine-print">Đang hiển thị ${num(competitors.length)} sản phẩm khớp đầu tiên; tổng cộng ${num(summary.product_count)} sản phẩm được dùng để tính khoảng giá và độ phủ.</p>`:""}</article>`;
 }).join('');
 return `<section class="product-comparison-section"><div class="section-head"><div><h2>Top sản phẩm của bạn đang cạnh tranh với ai?</h2><p class="competitor-section-sub">Theo từng sản phẩm: shop bán tương tự, khoảng giá, tổng đã bán và lượt đánh giá thực tế hiển thị. Các mặt hàng liên quan cần đối chiếu lại quy cách.</p></div><button ${canCollect()?'':'hidden'} type="button" id="compareTopProducts" class="btn btn-primary" ${disabled?'disabled':''}>⌕ Tìm đối thủ cho top sản phẩm</button></div><div data-pagination-list data-pagination-key="product-comparisons" data-pagination-size="10">${cards}</div><p class="fine-print">Tổng đã bán là tích lũy; ≥ giữ mức tối thiểu từ dấu +. Lượt đánh giá là số phản hồi của sản phẩm, không phải đánh giá shop. Khoảng giá có thể gồm nhiều phân loại; ngày đọc khác nhau có thể cho giá khác nhau.</p></section>`;
}
async function compareTopProducts(ownSku){
 if(!canCollect())return toast('Thu thập đối thủ thuộc khu vực System.');
 if(S.crawlSubmitting||S.competitor.discovering||(typeof marketState!=='undefined'&&marketState.busy))return;
 const data=S.data,shopId=S.shopId,state=S.competitor;
 const comparisons=(competitorAnalysis(data).product_comparisons||[]).filter(item=>item.own_product&&item.query&&(!ownSku||String(item.own_product.sku)===String(ownSku))).slice(0,ownSku?1:3);
 if(data.shop.is_demo||!comparisons.length){toast('Chưa có sản phẩm và từ khóa phù hợp để tìm đối thủ.');return}
 const current=()=>S.shopId===shopId&&S.competitor===state;
 const run={jobId:null,type:'product_comparison',shopId,entryView:'competitors',detailPhase:true,total:comparisons.length*3,completed:0,failed:0,searched:0,skipped:0,savedOwn:0,stopRequested:false};
 S.crawlSubmitting=true;S.crawlRun=run;state.deepErrors=[];
 const tell=message=>{run.message=message;if(current())updateCrawlFeedback(message)};
 let stopReason='';
 const savedOwnSkus=new Set();
 const problemText=value=>typeof value==='string'?value:String(value?.message||'Không đọc được một kết quả tìm kiếm.');
 const noteProblem=(comparison,message)=>{const text=`${comparison.own_product.name} (tìm “${comparison.query}”): ${problemText(message)}`;if(!state.deepErrors.includes(text))state.deepErrors.push(text);return text};
 const resultSummary=()=>{run.savedOwn=savedOwnSkus.size;run.skipped=Math.max(0,run.searched-run.savedOwn);return `Đã lưu ${num(run.completed)} sản phẩm đối thủ cho ${num(run.savedOwn)}/${num(comparisons.length)} sản phẩm của bạn. Đã tìm ${num(run.searched)}/${num(comparisons.length)} sản phẩm${run.skipped?`; ${num(run.skipped)} sản phẩm chưa lưu được đối thủ`:''}${run.failed?`; ${num(run.failed)} lượt đọc lỗi`:''}.`};
 const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
   tell('Đang tìm đối thủ cho từng sản phẩm bán tốt...');render();
   const bridge=await window.MarketLensChrome.ping(),version=String(bridge.version||'').split('.').map(Number);
   if(typeof window.MarketLensChrome.discover!=='function'||bridge.capabilities?.discover!==true||!(version[0]>1||version[0]===1&&version[1]>=2))throw new Error('Tìm đối thủ theo sản phẩm cần tiện ích MarketLens 1.2.0. Hãy tải lại tiện ích và trang ứng dụng.');
   for(let index=0;index<comparisons.length;index++){
     if(!current()||run.stopRequested)break;
     const comparison=comparisons[index];
     tell(`Tìm sản phẩm ${index+1}/${comparisons.length}: ${comparison.own_product.name}. Đã lưu ${num(run.completed)} mặt hàng đối thủ.`);
     run.searched++;
     let result;
     try{result=await window.MarketLensChrome.discover(comparison.query,data.shop.url)}catch(error){const message=noteProblem(comparison,error.message);if(error.blocked||['blocked','bridge_timeout','bridge_unavailable'].includes(error.code))throw new Error(message);continue}
     const discoveryErrors=Array.isArray(result?.errors)?result.errors.map(problemText):[];
     discoveryErrors.forEach(message=>noteProblem(comparison,message));
     if(result?.blocked)throw new Error(noteProblem(comparison,discoveryErrors.join(' ')||'Shopee yêu cầu xác minh. Đã dừng tìm đối thủ.'));
     if(!current()||run.stopRequested)break;
     const candidates=mergeCompetitorCandidates(result?.candidates||[],data.shop.url).filter(candidate=>/-i\.\d+\.\d+(?:\b|\/)|\/product\/\d+\/\d+(?:\b|\/)/.test(new URL(candidate.product_url||'https://shopee.vn/').pathname)).slice(0,3);
     if(!candidates.length){noteProblem(comparison,'Chưa tìm được sản phẩm đối thủ phù hợp từ kết quả đang hiển thị.');continue}
     for(let candidateIndex=0;candidateIndex<candidates.length;candidateIndex++){
       if(!current()||run.stopRequested)break;
       const candidate=candidates[candidateIndex];
       tell(`Đọc đối thủ ${candidateIndex+1}/${candidates.length} cho sản phẩm ${index+1}/${comparisons.length}: ${candidate.name}. Đã lưu ${num(run.completed)}, lỗi ${num(run.failed)}.`);
       const job=await post('/api/competitors/product-jobs',{shop_id:shopId,own_sku:String(comparison.own_product.sku),target_url:candidate.url,product_url:candidate.product_url,query:comparison.query});
       let detail,error,fatal=false;
       if(!current()||run.stopRequested){error='Đã dừng trước khi đọc sản phẩm đối thủ.';fatal=true}
       else try{const read=await window.MarketLensChrome.detail(candidate.product_url);if(!read?.detail)throw new Error('Chưa đọc được trang chi tiết sản phẩm đối thủ.');detail=read.detail}catch(cause){error=String(cause.message||cause).slice(0,500);fatal=!!cause.blocked||['blocked','bridge_timeout','bridge_unavailable'].includes(cause.code)}
       try{const saved=await post(`/api/competitors/product-jobs/${encodeURIComponent(job.job_id)}/result`,{result_token:job.result_token,...(detail?{detail}:{error})});if(error||saved.status==='failed'){run.failed++;noteProblem(comparison,`${candidate.name}: ${error||saved.error||'Máy chủ báo không lưu được sản phẩm đối thủ.'}`)}else if(saved.status==='done'){run.completed++;savedOwnSkus.add(String(comparison.own_product.sku));run.savedOwn=savedOwnSkus.size}else throw new Error(saved.error||'Máy chủ chưa xác nhận đã lưu sản phẩm đối thủ.')}catch(cause){stopReason='Không lưu được kết quả sản phẩm đối thủ: '+cause.message;throw new Error(stopReason)}
       syncCrawlProgress();
       if(fatal){stopReason=error;break}
     }
     if(stopReason||run.stopRequested||!current())break;
   }
   if(run.stopRequested)stopReason='Đã dừng theo yêu cầu của bạn.';
   else if(!current())stopReason='Đã dừng vì bạn chuyển shop.';
   tell(`${resultSummary()}${stopReason?' '+stopReason:''}`);
 }catch(error){tell(`${resultSummary()} Lượt tìm dừng: ${error.message}`);if(!state.deepErrors.includes(error.message))state.deepErrors.push(error.message)}
 finally{run.total=Math.max(1,run.completed+run.failed);S.crawlSubmitting=false;if(current()){await loadReport(false);syncCrawlProgress();render()}}
}
function competitorScanPanel(d,analysis){
 if(!canCollect())return `<section class="panel competitor-scan"><div><span class="eyebrow">PHÂN TÍCH TỪ DATABASE</span><h2>Đối thủ của sản phẩm shop bạn</h2><p>So sánh giá, số đã bán và đánh giá từ dữ liệu đã thu thập. System cập nhật nguồn dữ liệu và tìm đối thủ.</p></div>${window.MarketLensAuth?.isSystem?'<button class="btn btn-soft" data-action="crawler">Mở thu thập System →</button>':''}</section>`;
 const state=S.competitor,busy=S.crawlSubmitting||state.discovering,disabled=!!d.shop.is_demo||!S.crawler.enabled||busy;
 const queries=analysis.discovery_queries||[],active=S.crawlRun?.entryView==='competitors'||S.crawlSubmitting;
 const candidates=state.candidates||[];
 const candidateList=candidates.length?`<div class="competitor-discovery-results"><h3>Shop có sản phẩm liên quan</h3><p class="small-help">Được tìm từ sản phẩm và ngành hàng của shop bạn. Kiểm tra sản phẩm mẫu trước khi dùng làm đối thủ so sánh.</p><div class="competitor-candidates">${candidates.map(candidate=>`<article class="competitor-candidate"><div><a class="product-detail-link" href="${esc(candidate.url)}" target="_blank" rel="noopener noreferrer">${esc(candidate.name)} ↗</a><p>${esc(candidate.url)}</p><small>Tìm theo: “${esc(candidate.query)}”</small>${candidate.product_name?`<p class="competitor-sample">Sản phẩm liên quan: ${candidate.product_url?`<a href="${esc(candidate.product_url)}" target="_blank" rel="noopener noreferrer">${esc(candidate.product_name)} ↗</a>`:esc(candidate.product_name)}</p>`:''}</div><button type="button" class="btn btn-soft btn-sm" data-scan-competitor="${esc(candidate.url)}" ${busy?'disabled':''}>Quét & so sánh →</button></article>`).join('')}</div></div>`:'';
 return `<section class="panel competitor-scan"><div><span class="eyebrow">SO SÁNH & CHỌN SẢN PHẨM</span><h2>Tìm đối thủ cho sản phẩm bán tốt</h2><p>Đọc từng mặt hàng tương tự từ nhiều shop: giá và khoảng giá, tổng đã bán, số lượt đánh giá, điểm đánh giá. Ưu tiên ba sản phẩm bán tốt của shop bạn.</p>${d.shop.is_demo?'<p class="competitor-scan-note">Chọn hoặc tạo shop của bạn trước khi tìm đối thủ.</p>':''}<p id="chromeConnection" class="small-help">${S.chromeConnected?`Chrome đã kết nối (v${esc(S.chromeVersion||'?')}).`:'Dùng tiện ích MarketLens trong cùng Chrome. Nếu chưa kết nối, mở Bot thu thập để xem hướng dẫn.'}</p></div><div class="competitor-discovery-control">${(analysis.product_comparisons||[]).length?`<button type="button" id="compareTopProductsHero" class="btn btn-primary" ${disabled?'disabled':''}>${S.crawlSubmitting&&S.crawlRun?.type==='product_comparison'?'Đang đọc đối thủ...':'⌕ Tìm đối thủ cho top sản phẩm'}</button><p class="small-help">Tìm cho top 3 sản phẩm, đọc tối đa 3 mặt hàng đối thủ cho mỗi sản phẩm.</p>`:''}<button type="button" id="discoverCompetitors" class="btn ${(analysis.product_comparisons||[]).length?'btn-soft':'btn-primary'}" ${disabled||!queries.length?'disabled':''}>${state.discovering?'Đang tìm đối thủ...':(analysis.product_comparisons||[]).length?'Tìm shop cùng ngành':'⌕ Tự tìm & phân tích'}</button><p class="small-help">${queries.length?`Tìm từ ${num(queries.length)} nhóm trong danh mục, rồi tự quét shop đầu tiên và đọc mẫu 20 sản phẩm.`:'Quét sản phẩm shop của bạn trước để có cơ sở tìm đối thủ.'}</p></div><div class="crawl-progress"><p id="crawlFeedback" role="status" aria-live="polite">${esc(state.discovering?state.discoveryStatus:active?S.crawlRun?.message||'':state.discoveryStatus||'')}</p><progress id="crawlDetailProgress" class="${active&&S.crawlRun?.detailPhase?'':'hidden'}" max="${Math.max(1,S.crawlRun?.total||1)}" value="${(S.crawlRun?.completed||0)+(S.crawlRun?.failed||0)}" aria-label="Tiến độ đọc đối thủ"></progress><button type="button" id="stopCrawlDetails" class="btn btn-soft btn-sm ${S.crawlSubmitting&&S.crawlRun?.detailPhase?'':'hidden'}" ${S.crawlRun?.stopRequested?'disabled':''}>${S.crawlRun?.stopRequested?'Đang dừng sau sản phẩm hiện tại...':'Dừng sau sản phẩm hiện tại'}</button></div>${state.discoveryError?`<p class="competitor-discovery-error">${esc(state.discoveryError)}</p>`:''}${state.deepErrors?.length?`<p class="competitor-discovery-error">${state.deepErrors.slice(-3).map(esc).join(' · ')}</p>`:''}${candidateList}<details class="competitor-manual" ${state.url?'open':''}><summary>Đã có shop muốn so sánh? Nhập link trực tiếp</summary><form class="form" data-crawl data-competitor><label for="competitorUrl">Link shop đối thủ</label><input id="competitorUrl" name="target_url" type="url" placeholder="https://shopee.vn/ten_shop_doi_thu" value="${esc(state.url)}" required ${d.shop.is_demo?'disabled':''}><input type="hidden" name="role" value="market"><input type="hidden" name="browser_mode" value="chrome"><label class="check-control"><input type="checkbox" name="read_details" ${state.readDetails!==false?'checked':''} ${d.shop.is_demo?'disabled':''}><span>Đọc chi tiết từng sản phẩm<small>Lấy thêm mô tả, phân loại và ngành hàng để đối chiếu.</small></span></label><label for="competitorDetailLimit">Số trang chi tiết mỗi lượt</label><select id="competitorDetailLimit" name="detail_limit">${[20,50,150].map(limit=>`<option value="${limit}" ${(state.detailLimit||20)===limit?'selected':''}>${limit===150?'Tối đa 150':limit} sản phẩm</option>`).join('')}</select><button type="submit" class="btn btn-primary" ${disabled?'disabled':''}>${S.crawlSubmitting?'Đang quét...':'◉ Quét đối thủ →'}</button></form></details></section>`;
}
function renderCompetitors(d){
 const analysis=competitorAnalysis(d),summary=analysis.summary||{},market=d.market_products||[],own=d.own_products||[];
 const scan=competitorScanPanel(d,analysis),deep=productComparisonSection(d,analysis);
 const metrics=`<section class="grid-kpi competitor-kpis">${kpi('Giá trung vị shop bạn',money(summary.own_median_price),`${num(summary.own_product_count??own.length)} sản phẩm đang theo dõi`,'◇')}${kpi('Giá trung vị đối thủ',money(summary.market_median_price),`${num(summary.price_count||0)}/${num(summary.product_count||0)} sản phẩm có giá`,'↔','purple')}${kpi('Shop đối thủ',num(summary.shop_count||0),'Phạm vi shop đã thu thập','◎','green')}${kpi('Sản phẩm đối thủ',num(summary.product_count||0),`${num(summary.sold_count||0)} có số đã bán tích lũy`,'▧','orange')}</section>`;
 if(!(summary.product_count||market.length))return scan+deep+metrics+`<div class="competitor-empty"><span>◎</span><h3>Chưa có dữ liệu đối thủ để so sánh</h3><p>${canCollect()?'Bấm “Tự tìm & phân tích” để tìm và quét shop có sản phẩm liên quan.':'System cần thu thập shop có sản phẩm liên quan.'} Sau khi có dữ liệu, bạn sẽ xem được mức giá, số đã bán công khai và danh sách sản phẩm gợi ý.</p>${!own.length?`<p>Shop của bạn cũng chưa có sản phẩm. ${canCollect()?'Quét shop của bạn trong Bot thu thập để có cơ sở đối chiếu.':'System cần cập nhật dữ liệu shop để có cơ sở đối chiếu.'}</p>`:''}</div>`;
 const ownStats=comparisonStats(own,d.shop.name||'Shop của bạn');
 const comparison=panel('Shop của bạn đang ở đâu trong mẫu?','Mỗi shop dùng snapshot mới nhất của từng sản phẩm; các chỉ số ghi rõ phạm vi có dữ liệu.',`<div class="table-wrap"><table class="data-table competitor-comparison"><thead><tr><th>SHOP</th><th>SẢN PHẨM</th><th>GIÁ TRUNG VỊ</th><th>ĐÁNH GIÁ TRUNG BÌNH</th><th>TỔNG ĐÃ BÁN HIỂN THỊ</th><th>ĐỘ PHỦ DỮ LIỆU</th><th>NGÀY MỚI NHẤT</th></tr></thead><tbody>${comparisonRow(ownStats,true)}${(analysis.shops||[]).map(shop=>comparisonRow(shop)).join('')}</tbody></table></div><p class="fine-print">Tổng đã bán là tích lũy trên những sản phẩm có dữ liệu, có thể được Shopee làm tròn. Ký hiệu ≥ là mức tối thiểu khi nguồn hiển thị dấu +. Chỉ số này không phải lượng bán 30 ngày; các shop có độ phủ hoặc ngày thu thập khác nhau cần được đối chiếu thận trọng.</p>`);
 const matched=(analysis.categories||[]).filter(category=>category.own_count&&category.market_count&&category.own_median_price!=null&&category.market_median_price!=null&&category.gap_pct!=null);
 const categories=panel('Đối chiếu giá trong cùng ngành hàng',matched.length?`${num(matched.length)} nhóm có giá ở cả shop bạn và đối thủ.`:'Cần ngành hàng trùng nhau để so giá có ý nghĩa.',matched.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>NGÀNH HÀNG</th><th>SHOP BẠN</th><th>ĐỐI THỦ</th><th>CHÊNH LỆCH ĐỐI THỦ</th><th>PHẠM VI</th></tr></thead><tbody>${matched.map(category=>`<tr><td class="product-name">${esc(category.category)}</td><td class="numeric">${money(category.own_median_price)}</td><td class="numeric">${money(category.market_median_price)}</td><td><span class="comparison-gap">${signedPercent(category.gap_pct)}${category.gap_pct>0?' · cao hơn':category.gap_pct<0?' · thấp hơn':' · ngang giá'}</span></td><td>${num(category.own_count)} SP của bạn · ${num(category.market_count)} SP / ${num(category.shop_count)} đối thủ</td></tr>`).join('')}</tbody></table></div><p class="fine-print">Chênh lệch = (giá trung vị đối thủ − giá trung vị shop bạn) / giá trung vị shop bạn. Cùng ngành hàng vẫn có thể khác chất liệu, kích thước và chất lượng.</p>`:'<p class="muted">Chưa đủ dữ liệu ngành hàng chung. Hãy đọc chi tiết shop bạn và đối thủ cùng ngành để có nhóm sản phẩm phù hợp cho việc so giá.</p>');
 const recommendations=analysis.recommendations||[];
 const ideas=`<div class="section-head"><div><h2>Sản phẩm nên kiểm chứng để thử bán</h2><p class="competitor-section-sub">${summary.monthly_count?'Xếp hạng trong tập đối thủ đã thu thập, ưu tiên mặt hàng phù hợp danh mục của bạn.':'Gợi ý thăm dò từ giá, ngành hàng và số đã bán tích lũy; chưa xác định được tốc độ bán 30 ngày.'}</p></div>${badge(`${num(recommendations.length)} gợi ý`)}</div>${recommendations.length?`<div class="opportunities-grid competitor-recommendations" data-pagination-list data-pagination-key="competitor-recommendations" data-pagination-size="10">${recommendations.map(competitorRecommendation).join('')}</div><p class="fine-print">Kiểm tra giá vốn, chất lượng nguồn hàng và chi phí thực tế trước khi thử bán. Điểm chỉ xếp hạng trong mẫu đã thu thập.</p>`:'<div class="instructions">Chưa tìm được sản phẩm phù hợp để gợi ý từ dữ liệu hiện tại. Bổ sung đối thủ cùng ngành hoặc đọc chi tiết sản phẩm để cải thiện cơ sở so sánh.</div>'}`;
 const filtered=filteredCompetitorProducts(market),pageSize=[10,20,50,100].includes(S.competitor.pageSize)?S.competitor.pageSize:50,pages=Math.max(1,Math.ceil(filtered.length/pageSize)),page=Math.min(pages,Math.max(1,S.competitor.page));
 S.competitor.page=page;
 const start=(page-1)*pageSize,shown=filtered.slice(start,start+pageSize);
 const shops=[...new Set(market.map(product=>product.source_shop).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi'));
 const productCategories=[...new Set(market.map(product=>product.category||'Chưa phân loại'))].sort((a,b)=>a.localeCompare(b,'vi'));
 const filters=`<div class="competitor-filters"><label>Tìm sản phẩm<input id="competitorSearch" class="search" value="${esc(S.competitor.query)}" placeholder="Tên, SKU, shop hoặc ngành hàng"></label><label>Shop đối thủ<select id="competitorShopFilter" class="filter-select"><option value="">Tất cả shop</option>${shops.map(shop=>`<option value="${esc(shop)}" ${S.competitor.shop===shop?'selected':''}>${esc(shop)}</option>`).join('')}</select></label><label>Ngành hàng<select id="competitorCategoryFilter" class="filter-select"><option value="">Tất cả ngành hàng</option>${productCategories.map(category=>`<option value="${esc(category)}" ${S.competitor.category===category?'selected':''}>${esc(category)}</option>`).join('')}</select></label><label>Sắp xếp<select id="competitorSort" class="filter-select">${[['sold','Tổng đã bán giảm dần'],['price_asc','Giá tăng dần'],['price_desc','Giá giảm dần'],['rating','Đánh giá giảm dần'],['reviews','Số đánh giá giảm dần'],['name','Tên sản phẩm A–Z']].map(([value,label])=>`<option value="${value}" ${S.competitor.sort===value?'selected':''}>${label}</option>`).join('')}</select></label></div>`;
 const productList=`<div class="section-head"><h2>Tra cứu sản phẩm đối thủ</h2><span class="muted">${num(filtered.length)} sản phẩm theo bộ lọc</span></div><section class="panel">${filters}${shown.length?competitorProductTable(shown):'<p class="muted">Không có sản phẩm khớp bộ lọc. Thử đổi shop, ngành hàng hoặc từ khóa.</p>'}<nav class="competitor-pagination" aria-label="Phân trang sản phẩm đối thủ"><span>${filtered.length?`${num(start+1)}–${num(start+shown.length)}`:'0'} / ${num(filtered.length)} sản phẩm</span><label>Số dòng / trang <select id="competitorPageSize" class="filter-select">${[10,20,50,100].map(size=>`<option value="${size}" ${size===pageSize?'selected':''}>${size}</option>`).join('')}</select></label><div><button type="button" class="btn btn-soft btn-sm" data-competitor-page="1" ${page<=1?'disabled':''}>« Đầu</button><button type="button" class="btn btn-soft btn-sm" data-competitor-page="${page-1}" ${page<=1?'disabled':''}>← Trước</button><span>Trang ${num(page)} / ${num(pages)}</span><button type="button" class="btn btn-soft btn-sm" data-competitor-page="${page+1}" ${page>=pages?'disabled':''}>Sau →</button><button type="button" class="btn btn-soft btn-sm" data-competitor-page="${pages}" ${page>=pages?'disabled':''}>Cuối »</button></div></nav>${d.market_products_truncated?`<p class="fine-print">Các phép so sánh dùng toàn bộ ${num(d.market_products_total??summary.product_count)} sản phẩm đã lưu; bảng tra cứu đang tải ${num(market.length)} sản phẩm từ máy chủ.</p>`:''}</section>`;
 return scan+deep+metrics+comparison+`<div class="section-head"><h2>Nhìn vào từng nhóm sản phẩm</h2></div>`+categories+ideas+productList;
}
function renderImports(d){const disabled=d.shop.is_demo;return `<div class="section-head"><h2>Nhập nguồn dữ liệu có quyền sử dụng</h2></div>${disabled?'<div class="warning-soft">Bạn đang xem dữ liệu giả lập. Hãy nhấn “+ Thêm shop” để tạo shop riêng trước khi nhập file thực.</div>':''}<div class="import-grid">
${panel('Dữ liệu cửa hàng của bạn','Báo cáo Seller Center, sản phẩm / hiệu quả bán hàng',`<form class="form" data-upload="own"><div class="upload-area"><input type="file" name="file" accept=".csv,.xlsx" required ${disabled?'disabled':''}><div><strong id="fileLabelOwn">⇧ Chọn hoặc thả file CSV / XLSX</strong><p>Dung lượng tối đa 8 MB · 10.000 dòng / lần</p></div></div><div class="form-row"><div><label>Ngày dữ liệu</label><input name="snapshot_date" type="date" required value="${localDate()}" ${disabled?'disabled':''}></div><div><label>Nguồn</label><select disabled><option>Shop của tôi</option></select></div></div><button class="btn btn-primary" type="submit" ${disabled?'disabled':''}>Nhập dữ liệu shop →</button><p><a class="text-link" href="/api/template/own">↓ Tải CSV mẫu shop</a></p></form>`)}
${panel('Dữ liệu đối thủ & thị trường','Tệp nghiên cứu thị trường hợp lệ có thông tin shop bán',`<form class="form" data-upload="market"><div class="upload-area"><input type="file" name="file" accept=".csv,.xlsx" required ${disabled?'disabled':''}><div><strong id="fileLabelMarket">⇧ Chọn hoặc thả file CSV / XLSX</strong><p>Dung lượng tối đa 8 MB · 10.000 dòng / lần</p></div></div><div class="form-row"><div><label>Ngày quan sát</label><input name="snapshot_date" type="date" required value="${localDate()}" ${disabled?'disabled':''}></div><div><label>Nguồn</label><select disabled><option>Đối thủ / thị trường</option></select></div></div><button class="btn btn-primary" type="submit" ${disabled?'disabled':''}>Nhập dữ liệu đối thủ →</button><p><a class="text-link" href="/api/template/market">↓ Tải CSV mẫu đối thủ</a></p></form>`)}
</div><div class="section-head"><h2>Hướng dẫn định dạng dữ liệu</h2></div><div class="instructions"><strong>Cột cần có:</strong> <code>ten_san_pham</code>. Nên thêm <code>sku</code>, <code>nganh_hang</code>, <code>gia_ban</code>, <code>so_luong_ban_30_ngay</code>, <code>doanh_thu_30_ngay</code>, <code>gia_von</code>. File đối thủ nên có <code>ten_shop</code>.<br><strong>Lưu ý:</strong> Dữ liệu <code>da_ban</code> là tích lũy, không thay thế <code>so_luong_ban_30_ngay</code>. Muốn phân tích xu hướng, nhập các snapshot theo ngày. Chỉ nhập dữ liệu bạn được quyền sử dụng.</div><div class="section-head"><h2>Lịch sử nhập dữ liệu</h2></div>${d.imports.length?`<div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>TỆP</th><th>LOẠI DỮ LIỆU</th><th>SỐ DÒNG</th><th>NGÀY DỮ LIỆU</th><th>THỜI GIAN NHẬP</th></tr></thead><tbody>${d.imports.map(x=>`<tr data-pagination-id="${esc(x.id??[x.filename,x.imported_at].join('|'))}"><td class="product-name">${esc(x.filename)}</td><td>${badge(x.role==='own'?'Shop':'Đối thủ')}</td><td>${num(x.rows_imported)}</td><td>${esc(x.snapshot_date)}</td><td>${esc(x.imported_at.slice(0,16).replace('T',' '))}</td></tr>`).join('')}</tbody></table></div></div>`:empty('▤','Chưa có lịch sử nhập','Bắt đầu bằng một tệp CSV/XLSX theo định dạng mẫu.','Xem hướng dẫn')}`}
async function refreshChromeConnection(){
 if(!canCrawlShop())return;
 S.chromeConnected=false;
 for(let attempt=0;attempt<3&&!S.chromeConnected;attempt++){
  try{const bridge=await window.MarketLensChrome.ping();S.chromeConnected=true;S.chromeVersion=bridge.version}
  catch(err){S.chromeError=(err.code||'')+(err.message?': '+err.message:'');await new Promise(r=>setTimeout(r,700))}
 }
 const el=$('chromeConnection');
 if(el)el.innerHTML=S.chromeConnected?`Chrome đã kết nối (v${esc(S.chromeVersion)}) — mỗi lần bấm Quét sẽ đọc dữ liệu mới.`:'Chưa thấy tiện ích trên trang này. <button type="button" class="btn btn-soft btn-sm" data-recheck-chrome>↻ Kiểm tra lại</button> <a class="btn btn-primary btn-sm" href="/static/marketlens-chrome-extension.zip?v=1.3.7-host-permissions-01" download>⬇ Tải bản mới</a><br><small>Đã cài rồi mà vẫn thế? Bản cũ chưa hỗ trợ địa chỉ web này: chạy lại lệnh cài nhanh bên dưới (hoặc tải bản mới, ghi đè thư mục cũ), vào <code>chrome://extensions</code> bấm nút ⟳ Tải lại ở MarketLens, rồi bấm Kiểm tra lại. Nếu tiện ích đang tắt hoặc bị gỡ, hãy bật lại.<br>Chẩn đoán: trang chạy tại <code>'+esc(location.origin)+'</code> (tiện ích chỉ hỗ trợ <code>https://shopee-ai.onrender.com</code>, <code>http://localhost:8000</code>, <code>http://127.0.0.1:8000</code>); lỗi: <code>'+esc(S.chromeError||'không có phản hồi')+'</code></small>';
}
function updateCrawlFeedback(message){
 if(S.crawlRun)S.crawlRun.message=message;
 const feedback=$('crawlFeedback');if(feedback)feedback.textContent=message;
 syncCrawlProgress();
}
function syncCrawlProgress(){
 const run=S.crawlRun,progress=$('crawlDetailProgress'),stop=$('stopCrawlDetails');
 if(progress){progress.classList.toggle('hidden',!run?.detailPhase);progress.max=Math.max(1,run?.total||1);progress.value=(run?.completed||0)+(run?.failed||0)}
 if(stop){stop.classList.toggle('hidden',!S.crawlSubmitting||!run?.detailPhase);stop.disabled=!!run?.stopRequested;stop.textContent=run?.stopRequested?'Đang dừng sau sản phẩm hiện tại...':'Dừng sau sản phẩm hiện tại'}
}
function supportsProductDetails(version){const parts=String(version||'').split('.').map(Number);return parts.length>=2&&Number.isFinite(parts[0]+parts[1])&&(parts[0]>1||parts[0]===1&&parts[1]>=1)}
async function collectProductDetails(run,products,token){
 const path=`/api/crawl/jobs/${encodeURIComponent(run.jobId)}`;
 const post=(suffix,body)=>api(path+suffix,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_token:token,...body})});
 run.detailPhase=true;run.total=products.length;run.completed=0;run.failed=0;
 let stopReason='';
 try{
   for(const product of products){
     if(run.stopRequested){stopReason='Đã dừng theo yêu cầu của bạn.';break}
     updateCrawlFeedback(`Đang đọc chi tiết ${num(run.completed+run.failed+1)}/${num(run.total)}: ${product.name}. Đã lưu ${num(run.completed)}, lỗi ${num(run.failed)}.`);
     let detail,error;
     try{
       const result=await window.MarketLensChrome.detail(product.product_url);
       if(!result?.detail)throw new Error('Trang sản phẩm chưa trả về thông tin chi tiết.');
       detail=result.detail;
     }catch(cause){
       error=String(cause.message||cause).slice(0,500);
       if(cause.blocked||['blocked','bridge_timeout','bridge_unavailable'].includes(cause.code)||/chưa kết nối|tiện ích.*không phản hồi|không kết nối được tiện ích/i.test(error))stopReason=error;
     }
     const saved=await post('/product-result',{product_url:product.product_url,...(detail?{detail}:{error})});
     if(error)run.failed++;else run.completed++;
     if(Number.isFinite(saved.detail_completed))run.completed=saved.detail_completed;
     if(Number.isFinite(saved.detail_failed))run.failed=saved.detail_failed;
     syncCrawlProgress();
     if(stopReason)break;
   }
   if(run.stopRequested&&!stopReason)stopReason='Đã dừng theo yêu cầu của bạn.';
 }catch(error){stopReason='Không lưu được tiến độ đọc chi tiết: '+error.message}
 const finished=await post('/finish-details',stopReason?{error:stopReason.slice(0,500)}:{});
 return {...finished,stopped:!!stopReason,stopReason,detail_completed:finished.detail_completed??run.completed,detail_failed:finished.detail_failed??run.failed,detail_total:finished.detail_total??run.total};
}
function renderCrawler(d){
 const isDemo=!!d.shop.is_demo;
 const authorized=!!S.crawler.enabled;
 const state=authorized ? '<span class="tag tag-real">ĐÃ BẬT</span>' : '<span class="tag tag-demo">ĐANG KHÓA</span>';
 const blockers = S.crawler.error ? [S.crawler.error] : (S.crawler.blockers || (authorized ? [] : ['Máy chủ chưa bật cấu hình crawler.']));
 const diagnostics = `${isDemo ? '<div class="warning-soft"><strong>Nhập link để bắt đầu.</strong> Khi bấm quét hoặc đặt lịch, ứng dụng sẽ tạo shop riêng từ link bên dưới.</div>' : ''}${blockers.length ? `<div class="warning-soft"><strong>Bot chưa thể chạy:</strong><ul>${blockers.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>Sau khi cập nhật cấu hình máy chủ, khởi động lại ứng dụng và bấm Làm mới.</p></div>` : ''}`;
 return `<div class="section-head"><h2>Bot thu thập sản phẩm</h2>${state}</div>${diagnostics}
 <div class="crawl-progress"><p id="crawlFeedback" role="status" aria-live="polite">${esc(S.crawlRun?.message||'')}</p><progress id="crawlDetailProgress" class="${S.crawlRun?.detailPhase?'':'hidden'}" max="${Math.max(1,S.crawlRun?.total||1)}" value="${(S.crawlRun?.completed||0)+(S.crawlRun?.failed||0)}" aria-label="Tiến độ đọc chi tiết sản phẩm"></progress><button type="button" id="stopCrawlDetails" class="btn btn-soft btn-sm ${S.crawlSubmitting&&S.crawlRun?.detailPhase?'':'hidden'}" ${S.crawlRun?.stopRequested?'disabled':''}>${S.crawlRun?.stopRequested?'Đang dừng sau sản phẩm hiện tại...':'Dừng sau sản phẩm hiện tại'}</button></div>
 <div class="instructions"><strong>Quét trực tiếp bằng Chrome đang dùng</strong><p id="chromeConnection">${S.chromeConnected?`Chrome đã kết nối (v${esc(S.chromeVersion||'?')}) — mỗi lần bấm Quét sẽ đọc dữ liệu mới.`:'Cần tiện ích MarketLens để nút Quét điều khiển Chrome. <button type="button" class="btn btn-soft btn-sm" data-recheck-chrome>↻ Kiểm tra lại</button> <a class="btn btn-primary btn-sm" href="/static/marketlens-chrome-extension.zip?v=1.3.7-host-permissions-01" download>⬇ Tải tiện ích Chrome</a>'}</p><details${S.chromeConnected?'':' open'}><summary>Kết nối Chrome một lần</summary><p><strong>Cài nhanh (1 lệnh):</strong> Chrome không cho trang web tự cài tiện ích, nhưng lệnh dưới sẽ tải, giải nén sẵn và mở trang cài đặt cho bạn.</p><p>macOS — dán vào Terminal:</p><pre class="cmd-block"><code>curl -fsSL ${esc(typeof location==='undefined'?'':location.origin)}/static/install-extension.sh | bash -s -- ${esc(typeof location==='undefined'?'':location.origin)}</code></pre><p>Windows — dán vào PowerShell:</p><pre class="cmd-block"><code>$s='${esc(typeof location==='undefined'?'':location.origin)}'; irm "$s/static/install-extension.ps1" | iex</code></pre><p>Rồi trong Chrome: bật Chế độ nhà phát triển → Tải tiện ích đã giải nén → chọn thư mục <code>MarketLens-Extension</code> (đường dẫn đã được sao chép).</p><p><strong>Hoặc làm thủ công:</strong></p><ol><li><a href="/static/marketlens-chrome-extension.zip?v=1.3.7-host-permissions-01" download>Tải tiện ích MarketLens 1.3.7</a> và giải nén.</li><li>Mở <code>chrome://extensions</code>, bật Chế độ nhà phát triển, chọn <strong>Tải tiện ích đã giải nén</strong>, chọn thư mục <code>browser-extension</code>.</li><li>Mở lại ứng dụng này trong cùng Chrome và tải lại trang.</li></ol><p>Tiện ích đọc danh sách và từng trang sản phẩm trên Shopee khi bạn bấm Quét, rồi gửi kết quả về ứng dụng cục bộ.</p></details></div>
 ${canCollect()?` <details><summary>Nhập HTML thủ công</summary>
 ${panel('Nhập sản phẩm từ trình duyệt của bạn' ,'Dùng khi Chrome/Safari xem được shop nhưng cửa sổ bot bị chặn',
 `<div class="instructions"><ol><li>Mở <a href="${esc(d.shop.url)}" target="_blank" rel="noopener noreferrer">trang shop</a> trong trình duyệt thường dùng và chờ sản phẩm xuất hiện.</li><li>Cuộn để tải sản phẩm, nhấn <strong>Cmd + S</strong>, chọn định dạng <strong>HTML / Trang web, hoàn chỉnh</strong>.</li><li>Chọn tệp <strong>.html</strong> bên dưới và bấm <strong>Nhập sản phẩm từ HTML</strong>. Chỉ những sản phẩm có trong tệp được nhập.</li></ol></div>
 <form class="form" data-shop-html>
 <label for="savedShopUrl">Link shop đã lưu</label><input id="savedShopUrl" name="target_url" type="url" value="${esc(d.shop.url)}" required>
 <div class="form-row"><div><label for="savedShopRole">Phân loại dữ liệu</label><select id="savedShopRole" name="role"><option value="own">Shop đang phân tích</option><option value="market">Đối thủ / thị trường</option></select></div><div><label for="savedShopDate">Ngày lưu trang</label><input id="savedShopDate" name="snapshot_date" type="date" value="${localDate()}" required></div></div>
 <label for="savedShopFile">Tệp HTML của trang đang hiển thị sản phẩm</label><input id="savedShopFile" name="file" type="file" accept=".html,.htm,text/html" required>
 <button type="submit" class="btn btn-primary">Nhập sản phẩm từ HTML →</button></form>`)}</details>`:''}
 <div class="import-grid">
 ${panel('Quét shop hoặc đối thủ','Thu thập thẻ sản phẩm hiện công khai trên trang được phép truy cập',
 `<form class="form" data-crawl><label>Link shop cần quét</label><input type="url" name="target_url" required value="${esc(d.shop.url)}" placeholder="https://shopee.vn/ten_shop">
 <div class="form-row"><div><label>Phân loại dữ liệu</label><select name="role"><option value="own">Shop đang phân tích</option><option value="market">Đối thủ / thị trường</option></select></div><div><label>Chế độ</label><select name="browser_mode"><option value="chrome" selected>Chrome đang dùng</option><option value="assisted">Chromium có hỗ trợ</option><option value="headless">Chromium chạy nền</option></select></div></div><label class="check-control"><input type="checkbox" name="read_details" checked> <span>Đọc chi tiết từng sản phẩm (Chrome)<small>Tự mở lần lượt từng sản phẩm, lưu ngay thông tin đã đọc.</small></span></label><button type="submit" class="btn btn-primary" ${!authorized||S.crawlSubmitting?'disabled':''}>${S.crawlSubmitting?'Đang quét...':'◉ Quét một lần →'}</button></form>
 <p class="fine-print">Chrome đọc danh sách shop trước, sau đó tự mở từng sản phẩm để lấy mô tả, hình ảnh, thông số, phân loại, giá và đánh giá hiển thị. Nếu Shopee yêu cầu đăng nhập hoặc xác minh, lượt đọc sẽ dừng và giữ dữ liệu đã lưu.</p>
 <p class="fine-print">Bỏ chọn đọc chi tiết để chỉ lấy danh sách nhanh. Không thể lấy doanh thu 30 ngày từ một lần quét.</p>`)}
 ${canCollect()?panel('Tự động quét định kỳ','Chạy tối đa một lần mỗi ngày cho từng shop, lưu snapshot để phân tích biến động',
 `<form class="form" data-schedule><label>URL shop theo dõi</label><input type="url" name="target_url" value="${esc(d.shop.url)}" required>
 <div class="form-row"><div><label>Dữ liệu</label><select name="role"><option value="own">Shop đang chọn</option><option value="market">Đối thủ</option></select></div><div><label>Chu kỳ (giờ)</label><select name="interval_hours"><option value="24">24 giờ</option><option value="48">48 giờ</option><option value="168">7 ngày</option></select></div></div>
 <button type="submit" class="btn btn-primary" ${!authorized?'disabled':''}>Đặt lịch tự động →</button></form><p class="fine-print">Chỉ chạy khi server MarketLens đang bật. Lịch chạy nền và có thể thất bại nếu Shopee yêu cầu bạn thao tác trên trình duyệt. Lịch sẽ bắt đầu sau một chu kỳ; muốn quét ngay, dùng nút bên trái.</p>`):''}
 </div>
 ${canCollect()?`<div class="section-head"><h2>Lịch thu thập</h2></div><div id="crawlSchedules"><p class="muted">Đang kiểm tra lịch...</p></div>`:''}
 <div class="section-head"><h2>Lịch sử thực thi</h2></div><div id="crawlJobs"><p class="muted">Đang tải trạng thái...</p></div>
 <div class="instructions">Chọn shop riêng và bấm <strong>Quét một lần</strong>. Nếu chưa cài trình duyệt, chạy <code>python -m playwright install chromium</code>.</div>`;
}
async function refreshCrawlerLists(){
 if(!canCrawlShop())return;
 if(!['crawler','competitors'].includes(S.view)||!S.shopId||S.crawlerRefreshing)return;
 S.crawlerRefreshing=true;
 const shopId=S.shopId;
 const view=S.view;
 try{let [jobs, schedules]=await Promise.all([api(`/api/crawl/jobs?shop_id=${encodeURIComponent(shopId)}&all_rows=true`),view==='crawler'&&canCollect()?api(`/api/crawl/schedules?shop_id=${encodeURIComponent(shopId)}`):Promise.resolve([])]);
 if(S.view!==view||S.shopId!==shopId)return;
 const j=$('crawlJobs'),sc=$('crawlSchedules');
 if(j)j.innerHTML=jobs.length?`<div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>URL</th><th>VAI TRÒ</th><th>TRẠNG THÁI</th><th>SẢN PHẨM</th><th>CHI TIẾT</th><th>LỖI / GHI CHÚ</th></tr></thead><tbody>${jobs.map(x=>`<tr data-pagination-id="${esc(x.id)}"><td class="product-name">${esc(x.target_url)}</td><td>${badge(x.role)}</td><td>${badge(x.status)}</td><td>${num(x.rows_imported)}</td><td>${x.read_details?`${num(x.detail_completed||0)}/${num(x.detail_total||0)}${x.detail_failed?` · lỗi ${num(x.detail_failed)}`:''}`:'—'}</td><td>${esc(x.error||'—')}</td></tr>`).join('')}</tbody></table></div></div>`:empty('◉','Chưa thực thi crawler','Nhập URL shop và bấm Quét một lần.');
 if(sc)sc.innerHTML=schedules.length?`<div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>SHOP</th><th>LOẠI</th><th>CHU KỲ</th><th>LẦN TỚI</th><th></th></tr></thead><tbody>${schedules.map(x=>`<tr data-pagination-id="${esc(x.id)}"><td class="product-name">${esc(x.target_url)}</td><td>${badge(x.role)}</td><td>${num(x.interval_hours)} giờ</td><td>${esc(x.next_run_at.slice(0,16).replace('T',' '))}</td><td><button class="btn btn-soft btn-sm" data-remove-schedule="${x.id}">Bỏ lịch</button></td></tr>`).join('')}</tbody></table></div></div>`:'<div class="instructions">Chưa có lịch tự động.</div>';
 const running=jobs.find(x=>x.status==='running');
 if(running&&$('crawlFeedback')&&!(S.crawlSubmitting&&S.crawlRun)&&!S.competitor.discovering&&(view==='crawler'||running.role==='market'))$('crawlFeedback').textContent=running.error||'Đang tải trang và đọc sản phẩm...';
 const completed=jobs.filter(x=>x.status==='done'&&!S.refreshedCrawlJobs.has(x.id));
 if(completed.length){
   const refreshed=await loadReport(false);
   if(refreshed)completed.forEach(x=>S.refreshedCrawlJobs.add(x.id));
   if(refreshed&&S.view===view&&S.shopId===shopId&&jobs[0]?.status==='done'&&$('crawlFeedback')&&!(S.crawlSubmitting&&S.crawlRun)&&!(S.crawlRun?.jobId===jobs[0].id)&&!(view==='competitors'&&S.crawlRun?.type==='product_comparison')&&!S.competitor.discovering&&(view==='crawler'||jobs[0].role==='market'))$('crawlFeedback').textContent=jobs[0].error||`Đã cập nhật ${num(jobs[0].rows_imported)} sản phẩm.${jobs[0].read_details?` Đã đọc chi tiết ${num(jobs[0].detail_completed||0)}/${num(jobs[0].detail_total||0)} sản phẩm.`:''}`;
 }
 }catch(err){toast('Không tải được lịch crawler: '+err.message)}finally{S.crawlerRefreshing=false}
}
function localDate(){let d=new Date(),t=new Date(d.getTime()-d.getTimezoneOffset()*60000);return t.toISOString().slice(0,10)}
function render(){const globalView=['marketAnalysis','categoryMarket','marketSchedules','myShops','users'].includes(S.view);if(!S.data&&!globalView){$('demoWarning').classList.add('hidden');$('viewContainer').innerHTML=`<section class="panel"><h2>${S.shopId?'Chưa tải được dữ liệu shop':'Chưa có shop để phân tích'}</h2><p>${S.reportError?esc(S.reportError)+' Bấm Làm mới để thử lại.':S.shopId?'Đang đọc dữ liệu của shop được chọn…':'System cần tạo shop và cấp quyền dữ liệu cho tài khoản của bạn.'}</p></section>`;return;}const d=S.data;document.querySelector('.shop-strip').classList.toggle('hidden',globalView);$('demoWarning').classList.toggle('hidden',globalView||!d?.shop?.is_demo);const seller=view=>d=>window.MarketLensSeller?.render(view,d)||'<section class="panel">Đang nạp Seller Workspace…</section>';const renders={users:()=>window.MarketLensSystemUsers?.render()||'<section class="panel">Đang nạp quản lý tài khoản…</section>',myShops:seller('myShops'),shopAnalysis:seller('shopAnalysis'),optimizer:seller('optimizer'),strategy:seller('strategy'),actions:seller('actions'),reports:seller('reports'),marketAnalysis:renderMarketAnalysis,marketSchedules:renderMarketSchedules,categoryMarket:renderCategoryMarket,overview:renderOverview,products:renderProducts,opportunities:renderOpportunities,competitors:renderCompetitors,imports:renderImports,crawler:d=>renderCrawler(d)+(canCollect()&&d?competitorScanPanel(d,competitorAnalysis(d)).replace(/<div class="crawl-progress">[\s\S]*?<\/div>/,'').replace('id="chromeConnection"',''):'')};$('viewContainer').dataset.paginationView=S.view;$('viewContainer').dataset.paginationScope=globalView?'market':S.shopId;$('viewContainer').innerHTML=renders[S.view](d);if(['crawler','competitors'].includes(S.view)){syncCrawlProgress();refreshCrawlerLists()}}
// Delegated interactions
document.addEventListener('click',event=>{const button=event.target.closest('[data-seller-competitors]');if(!button)return;$('productDetailDialog')?.close();S.competitor.query='';setView('competitors');const target=document.querySelector(`[data-compare-own-sku="${CSS.escape(button.dataset.sellerCompetitors)}"]`);if(target)target.focus()});


$('navigation').addEventListener('click',e=>{let b=e.target.closest('[data-view]');if(b)setView(b.dataset.view)});
$('viewContainer').addEventListener('click',e=>{
 const detailButton=e.target.closest('[data-product-key]');
 if(detailButton){const product=findProductByKey(S.data,detailButton.dataset.productKey);if(product)showProductDetail(product)}
 if(e.target.closest('#stopCrawlDetails')&&S.crawlRun){S.crawlRun.stopRequested=true;syncCrawlProgress()}
 const discoverButton=e.target.closest('#discoverCompetitors');if(discoverButton&&!discoverButton.disabled)discoverCompetitors();
 const deepButton=e.target.closest('#compareTopProducts, #compareTopProductsHero, [data-compare-own-sku]');if(deepButton&&!deepButton.disabled)compareTopProducts(deepButton.dataset.compareOwnSku);
 const competitorButton=e.target.closest('[data-scan-competitor]');if(competitorButton&&!competitorButton.disabled)startCompetitorScan(competitorButton.dataset.scanCompetitor);
 const pageButton=e.target.closest('[data-competitor-page]');if(pageButton&&!pageButton.disabled){S.competitor.page=Math.max(1,Number(pageButton.dataset.competitorPage)||1);render()}
});
document.addEventListener('click',async e=>{const r=e.target.closest('[data-recheck-chrome]');if(!r)return;r.disabled=true;r.textContent='Đang kiểm tra…';await refreshChromeConnection();if(S.view==='crawler'&&S.data)render();toast(S.chromeConnected?'Đã kết nối tiện ích Chrome.':'Vẫn chưa thấy tiện ích. Hãy cập nhật và tải lại tiện ích rồi thử lại.')});
$('viewContainer').addEventListener('click',async e=>{let b=e.target.closest('[data-action]');if(b)setView(b.dataset.action);if(e.target.dataset.removeSchedule){try{await api(`/api/crawl/schedules/${Number(e.target.dataset.removeSchedule)}?shop_id=${encodeURIComponent(S.shopId)}`,{method:'DELETE'});await refreshCrawlerLists();toast('Đã bỏ lịch.')}catch(ex){toast(ex.message)}}if(e.target.id==='scoreButton'){let a=Number($('feeField').value),v=Number($('adsField').value);if(!Number.isFinite(a+v)||a<0||v<0||a+v>95)return toast('Kiểm tra lại tỷ lệ phí (tổng không vượt 95%).');S.fee=a;S.ads=v;loadReport()}if(e.target.id==='exportButton'){window.location.href=`/api/export/opportunities?shop_id=${encodeURIComponent(S.shopId)}&platform_fee_pct=${S.fee}&ads_fee_pct=${S.ads}`}});
$('viewContainer').addEventListener('input',e=>{if(e.target.id==='productSearch'){S.query=e.target.value;let start=e.target.selectionStart;render();$('productSearch').focus();$('productSearch').setSelectionRange(start,start)}if(e.target.id==='competitorUrl')S.competitor.url=e.target.value;if(e.target.id==='competitorSearch'){S.competitor.query=e.target.value;S.competitor.page=1;const start=e.target.selectionStart;render();$('competitorSearch').focus();$('competitorSearch').setSelectionRange(start,start)}});
$('viewContainer').addEventListener('change',e=>{const key={competitorShopFilter:'shop',competitorCategoryFilter:'category',competitorSort:'sort'}[e.target.id];if(key){S.competitor[key]=e.target.value;S.competitor.page=1;render()}if(e.target.id==='competitorPageSize'){const size=Number(e.target.value);if([10,20,50,100].includes(size)){S.competitor.pageSize=size;S.competitor.page=1;render()}}if(e.target.id==='competitorDetailLimit')S.competitor.detailLimit=Number(e.target.value);if(e.target.matches('form[data-competitor] input[name=read_details]'))S.competitor.readDetails=e.target.checked});
$('viewContainer').addEventListener('change',e=>{if(e.target.id==='productSort'){S.sort=e.target.value;render()}if(e.target.matches('select[name=browser_mode]')){const checkbox=e.target.closest('form').querySelector('[name=read_details]');checkbox.disabled=e.target.value!=='chrome'}if(e.target.matches('form[data-upload] input[type=file]')){let name=e.target.files?.[0]?.name||'Chọn hoặc thả file';let own=!!e.target.closest('[data-upload=own]');$(own?'fileLabelOwn':'fileLabelMarket').textContent=name}});
$('viewContainer').addEventListener('submit',async e=>{
 const saved=e.target.closest('form[data-shop-html]');
 if(saved){
   e.preventDefault();if(!canCollect())return toast('Nhập dữ liệu thuộc khu vực System.');
   const button=saved.querySelector('button[type=submit]');
   if(button.disabled)return;
   button.disabled=true;button.textContent='Đang đọc HTML...';
   const feedback=message=>{const el=$('crawlFeedback');if(el)el.textContent=message};
   feedback('Đang đọc sản phẩm từ tệp HTML...');
   try{
     const formData=new FormData(saved);
     let shopId=S.shopId;
     if(S.data.shop.is_demo){
       const shop=await api('/api/shops',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:formData.get('target_url')})});
       shopId=shop.id;
     }
     formData.set('shop_id',shopId);
     const result=await api('/api/crawl/import-html',{method:'POST',body:formData});
     await loadShops(shopId);
     const message=`Đã nhập ${num(result.rows)} sản phẩm từ trang HTML. Xem trong Sản phẩm của shop hoặc Đối thủ & thị trường.`;
     feedback(message);toast(message);
   }catch(error){feedback('Không nhập được HTML: '+error.message);toast(error.message)}
   finally{button.disabled=false;button.textContent='Nhập sản phẩm từ HTML →'}
   return;
 }
 const crawl=e.target.closest('form[data-crawl]');const schedule=e.target.closest('form[data-schedule]');
 if(crawl||schedule){e.preventDefault();if(!canCrawlShop()||schedule&&!canCollect())return toast('Đặt lịch tự động thuộc khu vực System.');const f=crawl||schedule;const b=f.querySelector('button[type=submit]');
 if(S.crawlSubmitting||S.competitor.discovering||(typeof marketState!=='undefined'&&marketState.busy))return;
 S.crawlSubmitting=true;S.crawlRun=crawl?{jobId:null,shopId:S.shopId,entryView:S.view,detailPhase:false,stopRequested:false}:null;b.disabled=true;
 const originalText=b.textContent;b.textContent='Đang gửi...';
 const feedback=updateCrawlFeedback;
 feedback('Đang gửi yêu cầu...');
 try{
 const payload=Object.fromEntries(new FormData(f));payload.shop_id=S.shopId;
 if(payload.detail_limit)payload.detail_limit=Number(payload.detail_limit);
 if(f.hasAttribute('data-competitor')){if(S.data.shop.is_demo)throw new Error('Hãy chọn hoặc tạo shop của bạn trước khi thêm đối thủ.');S.competitor.url=payload.target_url;payload.role='market'}
 if(crawl){
   payload.browser=payload.browser_mode==='chrome'?'chrome':'playwright';
   payload.interactive=payload.browser_mode==='assisted';
   payload.read_details=payload.browser==='chrome'&&!!f.querySelector('[name=read_details]')?.checked;
   delete payload.browser_mode;
   if(payload.browser==='chrome'){
     if(!S.crawler.chrome_bridge_available)throw new Error('Server chưa tải phần kết nối Chrome mới. Hãy khởi động lại server rồi tải lại trang.');
     const bridge=await window.MarketLensChrome.ping();
     if(payload.read_details&&!supportsProductDetails(bridge.version))throw new Error('Đọc chi tiết cần tiện ích MarketLens 1.1.0. Hãy tải lại tiện ích từ thư mục browser-extension mới của dự án, rồi tải lại trang ứng dụng.');
     if(['1.0.0','1.0.1'].includes(bridge.version))throw new Error('Tiện ích đang dùng bản cũ '+bridge.version+'. Hãy nạp thư mục browser-extension mới của dự án (bản 1.2.0), rồi tải lại trang.');
   }
 }
 if(S.data.shop.is_demo){
   const shop=await api('/api/shops',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:payload.target_url})});
   payload.shop_id=shop.id;
   await loadShops(shop.id);
 }
 if(schedule)payload.interval_hours=Number(payload.interval_hours);
 let res=await api(crawl?'/api/crawl/jobs':'/api/crawl/schedules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 if(crawl&&payload.browser==='chrome'){
   const run=S.crawlRun;run.jobId=res.job_id;run.shopId=payload.shop_id;
   feedback('Chrome đang mở shop, đọc danh sách sản phẩm và các trang tiếp theo...');
   b.textContent='Chrome đang quét...';
   let listingSaved=false;
   try{
     const capture=await window.MarketLensChrome.collect(res.target_url);
     const listing=await api(`/api/crawl/jobs/${encodeURIComponent(res.job_id)}/browser-result`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_token:res.result_token,pages:capture.pages})});
     if(!['done','running'].includes(listing.status))throw new Error(listing.error||'Chrome chưa đọc được sản phẩm.');
     listingSaved=true;
     let message=`Đã quét và lưu ${num(listing.rows_imported)} sản phẩm từ Chrome hiện tại.`;
     if(payload.read_details){
       if(listing.status!=='running'||!Array.isArray(listing.products))throw new Error('Server đã lưu danh sách nhưng chưa hỗ trợ đọc chi tiết. Hãy khởi động lại server mới rồi quét lại.');
       feedback(`Đã lưu ${num(listing.rows_imported)} sản phẩm. Đang bắt đầu đọc từng trang chi tiết...`);
       await loadReport(false);
       const completed=await collectProductDetails(run,listing.products,res.result_token);
       message=`Đã lưu ${num(listing.rows_imported)} sản phẩm; đọc chi tiết ${num(completed.detail_completed)}/${num(completed.detail_total)}${completed.detail_total<listing.rows_imported?` (mẫu ${num(completed.detail_total)}/${num(listing.rows_imported)} sản phẩm)`:''}${completed.detail_failed?`, lỗi ${num(completed.detail_failed)}`:''}.${completed.stopped?' '+completed.stopReason+' Dữ liệu đã đọc được giữ lại.':''}`;
     }
     feedback(message);toast(message);await loadReport(false);await refreshCrawlerLists();
   }catch(error){
     const suffix=listingSaved&&payload.read_details?'finish-details':'browser-result';
     try{await api(`/api/crawl/jobs/${encodeURIComponent(res.job_id)}/${suffix}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result_token:res.result_token,error:error.message.slice(0,500)})})}catch{}
     if(listingSaved)await loadReport(false);
     throw error;
   }
   return;
 }
 const message=crawl?`Đã xếp hàng quét: ${res.job_id.slice(0,8)}.${res.interactive?' Chromium sẽ mở khi tới lượt; bạn tự đăng nhập nếu cần rồi mở lại link shop.':' Xem trạng thái bên dưới.'}`:'Đã lưu lịch thu thập định kỳ.';
 feedback(message);toast(message);await refreshCrawlerLists();
 }catch(err){feedback('Không thực hiện được: '+err.message);toast(err.message)}finally{S.crawlSubmitting=false;b.disabled=false;b.textContent=originalText;const currentForm=document.querySelector('form[data-crawl]'),currentButton=currentForm?.querySelector('button[type=submit]');if(currentButton){currentButton.disabled=!S.crawler.enabled||currentForm.hasAttribute('data-competitor')&&!!S.data.shop.is_demo;currentButton.textContent=currentForm.hasAttribute('data-competitor')?'◉ Quét đối thủ →':'◉ Quét một lần →'}syncCrawlProgress()}return;
 }
 let form=e.target.closest('form[data-upload]');if(!form)return;e.preventDefault();if(!canCollect())return toast('Nhập dữ liệu thuộc khu vực System.');let btn=form.querySelector('button[type=submit]');btn.disabled=true;btn.textContent='Đang nhập dữ liệu...';try{let fd=new FormData(form);fd.append('shop_id',S.shopId);fd.append('role',form.dataset.upload);let result=await api('/api/import',{method:'POST',body:fd});toast(`Đã nhập ${result.rows} sản phẩm (${result.role==='own'?'shop':'đối thủ'}).`);await loadReport()}catch(err){toast('Lỗi nhập: '+err.message)}finally{btn.disabled=false;btn.textContent='Nhập dữ liệu →'}});
$('shopSelect').addEventListener('change',async e=>{S.shopId=e.target.value;history.replaceState(null,'',routeUrl(S.view));S.query='';S.competitor={shop:'',category:'',query:'',sort:'sold',page:1,pageSize:50,url:'',detailLimit:20,readDetails:true};await loadReport()});
$('refreshButton').addEventListener('click',async()=>{if(window.MarketLensAuth&&!window.MarketLensAuth.session.authenticated)return initializeWorkspace(true);if(['myShops','shopAnalysis','optimizer','strategy','actions','reports'].includes(S.view)){await loadReport(false);return window.MarketLensSeller?.refresh()}if(S.view==='users')return window.MarketLensSystemUsers?.refresh();if(S.view==='marketAnalysis')return refreshMarketAnalysis();if(['categoryMarket','marketSchedules'].includes(S.view))return refreshMarket(true);await refreshCrawlerConfig();await loadReport()});
$('importShortcut').addEventListener('click',()=>setView('imports'));
function toggleShopModal(show){$('shopModal').classList.toggle('hidden',!show)}
$('newShopButton').addEventListener('click',()=>toggleShopModal(true));
$('closeShopModal').addEventListener('click',()=>toggleShopModal(false));$('cancelShop').addEventListener('click',()=>toggleShopModal(false));
$('shopModal').addEventListener('click',e=>{if(e.target===$('shopModal'))toggleShopModal(false)});
$('shopForm').addEventListener('submit',async e=>{e.preventDefault();try{let p=Object.fromEntries(new FormData(e.target));let s=await api('/api/shops',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});toggleShopModal(false);toast('Đã tạo shop. Hãy bấm Quét để thu thập sản phẩm.');await loadShops(s.id);setView(canCrawlShop()?'crawler':'myShops')}catch(err){toast(err.message)}});
async function refreshCrawlerConfig(){
 if(!canCrawlShop())return;
 try{S.crawler=await api('/api/crawl/config')}
 catch(err){S.crawler={enabled:false,error:'Không đọc được cấu hình bot: '+err.message}}
 render();
}
$('logoutButton')?.addEventListener('click',()=>window.MarketLensAuth?.logout().catch(error=>toast(error.message)));
setInterval(()=>{if(canCrawlShop()&&['crawler','competitors'].includes(S.view))refreshCrawlerLists()},7000);
async function initializeWorkspace(retry=false){try{
 if(window.MarketLensAuth){if(retry)await window.MarketLensAuth.refreshSession();await window.MarketLensAuth.ready;if(!window.MarketLensAuth.requireSession())return;const account=window.MarketLensAuth.session.account;const identity=$('authAccountName');if(identity)identity.textContent=account.username;const badge=$('authRoleBadge');if(badge)badge.textContent=account.role==='system'?'System':'User';document.querySelectorAll('[data-system-link]').forEach(link=>link.hidden=account.role!=='system');}
 const params=new URLSearchParams(location.search),requested=params.get('view');
 S.view=window.MarketLensRoutes?.defaultView(appArea())||'overview';
 await loadShops(params.get('shop_id')||undefined);
 if(canCrawlShop()){await refreshCrawlerConfig();refreshChromeConnection();}
 setView(requested&&pages[requested]?requested:S.view);
 }catch(error){toast('Không kết nối được backend: '+error.message+' Bấm Làm mới để thử lại.');}}
initializeWorkspace();
