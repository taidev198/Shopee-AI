'use strict';

(() => {
  const cache=new Map(),list=value=>Array.isArray(value)?value:[];
  const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
  const text=value=>typeof value==='string'?value:'';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const count=value=>number(value)==null?'—':new Intl.NumberFormat('vi-VN').format(value);
  const money=value=>number(value)==null?'—':count(value)+' ₫';
  const keyFor=ctx=>JSON.stringify([String(ctx?.shopId||''),String(ctx?.product?.sku||'')]);
  const valid=ctx=>!!ctx?.shopId&&ctx?.product?.sku!=null&&(!ctx.data?.shop?.id||String(ctx.data.shop.id)===String(ctx.shopId));
  const signature=ctx=>JSON.stringify([ctx.data?.generated_at,ctx.product?.snapshot_date,ctx.product?.price,ctx.product?.sold_total,
    ctx.product?.review_count,ctx.product?.detail?.collected_at,ctx.data?.competitor_research?.[String(ctx.product?.sku)]]);
  function stateFor(ctx) {
    const key=keyFor(ctx),version=signature(ctx);let state=cache.get(key);
    if(!state||state.version!==version){state={version,attempted:false,loading:false,error:'',evidence:null,promise:null};cache.set(key,state);}
    return state;
  }
  const active=ctx=>!ctx.entry?.intelligenceSku||String(ctx.entry.intelligenceSku)===String(ctx.product?.sku);
  function ensure(ctx) {
    if(!valid(ctx))return Promise.resolve(false);
    const key=keyFor(ctx),state=stateFor(ctx);
    if(state.promise)return state.promise;
    if(state.attempted)return Promise.resolve(!!state.evidence);
    state.attempted=true;state.loading=true;state.error='';
    const controller=typeof AbortController==='function'?new AbortController():null;
    let timer;
    const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(new Error('Chưa đọc được bằng chứng sau 20 giây. Bấm thử lại để đọc dữ liệu đã lưu.'));},20000);});
    const work=Promise.resolve().then(()=>api('/api/seller/products/'+encodeURIComponent(String(ctx.product.sku))+'/market-evidence?shop_id='+encodeURIComponent(String(ctx.shopId)),controller?{signal:controller.signal}:{}));
    state.promise=Promise.race([work,deadline]).then(result=>{
      if(cache.get(key)!==state)return false;
      if(String(result?.shop_id)!==String(ctx.shopId)||String(result?.sku)!==String(ctx.product.sku))throw new Error('Bằng chứng không thuộc shop hoặc SKU đang chọn.');
      state.evidence=result;return true;
    }).catch(error=>{if(cache.get(key)===state)state.error=error?.message||'Chưa đọc được bằng chứng trong database.';return false;})
      .finally(()=>{clearTimeout(timer);if(cache.get(key)===state){state.loading=false;state.promise=null;if(active(ctx))ctx.redraw?.();}});
    return state.promise;
  }
  function safeUrl(value) {
    try {const url=new URL(value);return url.protocol==='https:'&&['shopee.vn','www.shopee.vn'].includes(url.hostname)&&!url.port&&!url.username&&!url.password?'https://shopee.vn'+url.pathname:'';}
    catch{return '';}
  }
  function source(name,url) {
    const safe=safeUrl(url);return safe?`<a href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${escape(name)} ↗</a>`:escape(name);
  }
  function notice(state) {
    if(state.error)return `<div class="smi-notice smi-error" role="alert">${escape(state.error)} <button class="btn btn-white btn-sm" data-smi-retry>Thử lại dữ liệu</button></div>`;
    return state.evidence?'':`<p class="smi-notice" role="status">Đang đọc bằng chứng bổ sung từ dữ liệu đã lưu…</p>`;
  }
  function referenceFor(ctx,state) {
    return state.evidence?.competitors||ctx.product?.competitor_reference||ctx.data?.competitor_research?.[String(ctx.product?.sku)]||{};
  }
  const fieldLabels={brand:'Thương hiệu',material:'Chất liệu',size:'Kích thước',capacity:'Dung tích',pack:'Số lượng / combo',function:'Công dụng',model:'Mã sản phẩm',size_or_capacity:'Kích thước hoặc dung tích',matching_category:'Cùng ngành hàng',matching_function:'Cùng công dụng'};
  function specifications(equivalence={}) {
    const rows=Object.entries(equivalence.specifications||{});
    return `<details class="smi-specs"><summary>Đối chiếu quy cách</summary>${rows.length?`<dl>${rows.map(([key,value])=>`<div><dt>${escape(fieldLabels[key]||key)}</dt><dd>Shop mình: ${escape(value?.own||'Chưa có')}<br>Ứng viên: ${escape(value?.competitor||'Chưa có')}</dd></div>`).join('')}</dl>`:'<p>Chưa ghi nhận thông số để xác minh.</p>'}${list(equivalence.conflicts).length?`<p>Khác: ${list(equivalence.conflicts).map(key=>escape(fieldLabels[key]||key)).join(', ')}.</p>`:''}${list(equivalence.missing).length?`<p>Cần bổ sung: ${list(equivalence.missing).map(key=>escape(fieldLabels[key]||key)).join(', ')}.</p>`:''}</details>`;
  }
  function competitors(ctx,state) {
    const reference=referenceFor(ctx,state),verified=number(reference.count)||0;
    const broad=candidate=>list(candidate.equivalence?.missing).includes('matching_function')||list(candidate.equivalence?.conflicts).includes('function');
    const rank=candidate=>candidate.equivalence?.status==='equivalent'?0:broad(candidate)?2:1;
    // Title relevance only orders discovery candidates; it never upgrades the
    // recorded equivalence status or contributes a price to the verified range.
    const tokens=value=>new Set((String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().match(/[a-z0-9]{3,}/g)||[]));
    const raw=list(reference.candidates),documents=raw.map(candidate=>tokens(candidate.name)),ownTokens=tokens(ctx.product.name),frequency=new Map();
    for(const document of documents)for(const token of document)frequency.set(token,(frequency.get(token)||0)+1);
    const weight=token=>1+Math.log((documents.length+1)/((frequency.get(token)||0)+1));
    const norm=document=>Math.sqrt([...document].reduce((sum,token)=>sum+weight(token)**2,0));
    const ownNorm=norm(ownTokens);
    const relevance=document=>{const denominator=ownNorm*norm(document);return denominator?[...document].reduce((sum,token)=>sum+(ownTokens.has(token)?weight(token)**2:0),0)/denominator:0;};
    const candidates=raw.map((candidate,index)=>({candidate,index,relevance:relevance(documents[index])})).sort((a,b)=>rank(a.candidate)-rank(b.candidate)||b.relevance-a.relevance||a.index-b.index).map(row=>row.candidate);
    const hasRange=verified>0&&number(reference.min)!=null&&number(reference.max)!=null;
    const range=hasRange?money(reference.min)+(reference.min===reference.max?'':' – '+money(reference.max)):'Chưa đủ giá để đối chiếu';
    const table=candidates.length?`<div class="table-wrap"><table class="data-table smi-competitors" data-pagination-key="shop-market-competitors-${escape(ctx.shopId)}-${escape(ctx.product.sku)}"><thead><tr><th>Shop / sản phẩm</th><th>Quy cách</th><th>Giá ghi nhận</th><th>Tổng đã bán</th><th>Lượt đánh giá</th><th>Nguồn</th></tr></thead><tbody>${candidates.map(candidate=>{
      const equivalence=candidate.equivalence||{},status=['equivalent','different','review'].includes(equivalence.status)?equivalence.status:'review';
      const label={equivalent:'Khớp quy cách đã ghi nhận',different:'Khác quy cách',review:'Chưa xác minh đủ quy cách'}[status];
      return `<tr><td><strong>${escape(candidate.source_shop||'Chưa ghi nhận tên shop')}</strong><span>${escape(candidate.name||candidate.sku||'Sản phẩm chưa có tên')}</span><small>SKU ${escape(candidate.sku||'—')}</small></td><td><span class="smi-badge smi-${status}">${label}</span>${broad(candidate)?`<small class="smi-scope">${list(equivalence.conflicts).includes('function')?'Khác công dụng đã ghi nhận':'Chỉ cùng ngành; chưa xác nhận cùng công dụng'}</small>`:''}${specifications(equivalence)}</td><td>${money(candidate.price)}</td><td>${candidate.sold_lower_bound?'≥ ':candidate.sold_approx?'≈ ':''}${count(candidate.sold_total)}<small>Bộ đếm cộng dồn công khai</small></td><td>${candidate.review_approx?'≈ ':''}${count(candidate.review_count)}${number(candidate.rating)!=null?`<small>★ ${count(candidate.rating)}/5</small>`:''}</td><td>${safeUrl(candidate.product_url)?source('Mở sản phẩm',candidate.product_url):'Chưa có URL nguồn'}${candidate.snapshot_date?`<small>${escape(candidate.snapshot_date)}</small>`:''}</td></tr>`;
    }).join('')}</tbody></table></div>`:`<div class="smi-empty"><h4>Chưa có ứng viên đối thủ đã lưu</h4><p>Đọc đối thủ cho sản phẩm này để có tên shop, giá, số bán và đánh giá thực tế. Không có dữ liệu không có nghĩa thị trường không có đối thủ.</p></div>`;
    return `<section class="smi-panel"><div class="smi-heading"><div><span class="smi-eyebrow">COMPETITOR RESEARCH</span><h3>Đối thủ của ${escape(ctx.product.name||ctx.product.sku)}</h3><p>Ứng viên trong ngành hàng đã thu thập. Chỉ so giá trực tiếp khi quy cách đã ghi nhận khớp.</p></div><button class="btn btn-primary" data-seller-competitors="${escape(ctx.product.sku)}">Tìm / đọc thêm đối thủ →</button></div>${notice(state)}<div class="smi-summary"><article><span>Khoảng giá nhóm khớp quy cách</span><strong>${range}</strong><small>${count(verified)} sản phẩm có thông số khớp</small></article><article><span>Cần xác minh thêm</span><strong>${count(number(reference.review_count)||0)}</strong><small>Thiếu thương hiệu, chất liệu, kích thước hoặc combo</small></article><article><span>Khác quy cách</span><strong>${count(number(reference.different_count)||0)}</strong><small>Không dùng làm giá đối thủ tương đương</small></article></div>${table}${reference.candidates_truncated?`<p class="smi-footnote">Hiển thị ${count(candidates.length)}/${count(reference.candidate_count)} ứng viên. Khoảng giá sử dụng toàn bộ sản phẩm đủ điều kiện đã lưu.</p>`:''}<p class="smi-footnote">${escape(reference.basis||'Tên giống nhau chưa đủ chứng minh hai sản phẩm tương đương.')} Số bán cộng dồn không phải lượng đơn trong 30 ngày.</p></section>`;
  }
  function dayNumber(value) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return null;
    const timestamp=Date.parse(value+'T00:00:00Z');return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value?timestamp:null;
  }
  function chart(rows,field,label,color) {
    const points=rows.map(row=>({day:row.day,x:dayNumber(row.day),value:number(row[field])})).filter(row=>row.x!=null);
    const known=points.filter(row=>row.value!=null);
    if(!known.length)return `<div class="smi-chart-empty"><h4>${escape(label)}</h4><p>Chưa có số liệu đã lưu cho chỉ số này.</p></div>`;
    const width=640,height=190,left=54,right=18,top=18,bottom=36,minX=points[0].x,maxX=points.at(-1).x,maxY=Math.max(1,...known.map(row=>row.value));
    const x=row=>maxX===minX?width/2:left+(row.x-minX)/(maxX-minX)*(width-left-right);
    const y=row=>height-bottom-row.value/maxY*(height-top-bottom);
    let path='',joined=false;
    for(const row of points){if(row.value==null){joined=false;continue;}path+=(joined?' L ':' M ')+x(row).toFixed(2)+' '+y(row).toFixed(2);joined=true;}
    return `<figure class="smi-chart"><figcaption>${escape(label)}</figcaption><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(label)} theo ngày ghi nhận"><line x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}" class="smi-axis"/><text x="${left-9}" y="${top+4}" text-anchor="end">${count(maxY)}</text><text x="${left-9}" y="${height-bottom+4}" text-anchor="end">0</text><path d="${path}" fill="none" stroke="${color}" stroke-width="2.5"/>${known.map(row=>`<circle cx="${x(row).toFixed(2)}" cy="${y(row).toFixed(2)}" r="3.5" fill="${color}"><title>${escape(row.day)}: ${count(row.value)}</title></circle>`).join('')}<text x="${left}" y="${height-10}">${escape(points[0].day)}</text>${points.length>1?`<text x="${width-right}" y="${height-10}" text-anchor="end">${escape(points.at(-1).day)}</text>`:''}</svg></figure>`;
  }
  function opportunities(ctx,state) {
    const evidence=state.evidence||{},history=list(evidence.history).filter(row=>dayNumber(row.day)!=null).sort((a,b)=>a.day.localeCompare(b.day));
    const visible=history.slice(-90),metrics=ctx.product.metrics||{},optimizer=ctx.product.optimizer||{},ml=evidence.ml;
    const engagement=[];
    if(number(metrics.visits_30d)!=null)engagement.push(`${count(metrics.visits_30d)} lượt truy cập trong kỳ 30 ngày được cung cấp`);
    if(number(ctx.product.review_count??metrics.review_count)!=null)engagement.push(`${count(ctx.product.review_count??metrics.review_count)} lượt đánh giá đã ghi nhận`);
    if(number(ctx.product.rating??metrics.rating)!=null)engagement.push(`điểm ${count(ctx.product.rating??metrics.rating)}/5`);
    const growth=history.length<2?'Cần ít nhất 2 ngày ghi nhận để đối chiếu biến động, và ít nhất 3 ngày có số liệu chính xác trước khi đánh giá xu hướng.':`Có ${count(history.length)} ngày quan sát. Độ chính xác của bộ đếm trong lịch sử chưa được xác nhận; chưa suy ra tốc độ bán hoặc xu hướng tăng trưởng.`;
    const contribution=typeof metrics.contribution_per_order==='number'&&Number.isFinite(metrics.contribution_per_order)?metrics.contribution_per_order:null;
    const business=optimizer.cost_complete&&contribution!=null?`Lãi đóng góp / đơn theo chi phí đã nhập: ${new Intl.NumberFormat('vi-VN').format(contribution)} ₫. ${contribution>0?'Có cơ sở xem xét một thử nghiệm; chưa dự báo lượng đơn.':'Cần đối soát chi phí hoặc giá trước khi mở rộng.'}`:'Chưa đủ chi phí để xác nhận lãi đóng góp. Nhập giá vốn, phí và phân bổ quảng cáo trước khi chọn sản phẩm nên đẩy bán.';
    const mlBlock=number(ml?.ml_signal_score)!=null?`<p class="smi-notice">Vị thế thị trường từ mô hình đã lưu: <strong>${count(ml.ml_signal_score)}/100</strong> · ${escape(ml.segment||'Nhóm đã học')}. ${escape(ml.reason||'')}<br>${escape(ml.basis||'Chưa xác nhận độ mới của mô hình; đây không phải dự báo tăng trưởng.')} Huấn luyện: ${escape(ml.created_at||'Chưa có thời điểm')}.</p>`:'';
    const chartBlock=history.length?`<div class="smi-charts">${chart(visible,'sold_total','Tổng đã bán cộng dồn','#798fca')}${chart(visible,'review_count','Lượt đánh giá cộng dồn','#76ada4')}</div><p class="smi-footnote">${history.length===1?'Mới có 1 ngày dữ liệu; điểm ghi nhận này không xác nhận xu hướng.':'Đường nối các điểm đã lưu, không phải dự báo. Không quy chênh lệch lượt đánh giá thành số đơn.'}${history.length>90?` Hiển thị 90/${count(history.length)} ngày quan sát gần nhất.`:''}</p><details class="smi-history"><summary>Xem số liệu nguồn (${count(history.length)} ngày)</summary><div class="table-wrap"><table class="data-table" data-pagination-key="shop-market-history-${escape(ctx.shopId)}-${escape(ctx.product.sku)}"><thead><tr><th>Ngày</th><th>Tổng đã bán</th><th>Lượt đánh giá</th><th>Giá ghi nhận</th><th>Nguồn</th></tr></thead><tbody>${history.map(row=>`<tr><td>${escape(row.day)}</td><td>${count(row.sold_total)}</td><td>${count(row.review_count)}</td><td>${money(row.price)}</td><td>${escape(row.source||'Dữ liệu đã lưu')}</td></tr>`).join('')}</tbody></table></div></details>`:'<div class="smi-empty"><h4>Chưa có lịch sử quan sát của SKU này</h4><p>Thu thập hoặc nhập báo cáo ở nhiều ngày để đối chiếu. Không tạo biểu đồ từ dữ liệu giả hoặc lượng tìm kiếm không được cung cấp.</p></div>';
    return `<section class="smi-panel"><div class="smi-heading"><div><span class="smi-eyebrow">OPPORTUNITY DISCOVERY</span><h3>Cơ hội từ bằng chứng đã ghi nhận</h3><p>${escape(ctx.product.name||ctx.product.sku)} · Kiểm tra mức quan tâm, lịch sử và khả năng kinh doanh trước khi hành động.</p></div><button class="btn btn-soft" data-seller-view="marketAnalysis">Phân tích toàn ngành →</button></div>${notice(state)}<div class="smi-steps"><article><span>1 · QUAN TÂM</span><h4>${engagement.length?'Tín hiệu đang có':'Chưa có tín hiệu đủ cơ sở'}</h4><p>${escape(engagement.length?engagement.join(' · ')+'.':'Chưa có lượt truy cập hoặc đánh giá được cung cấp cho SKU này.')}</p><small>Không phải lượng tìm kiếm trên Shopee, Google hoặc TikTok.</small></article><article><span>2 · TĂNG TRƯỞNG</span><h4>${history.length<3?'Chưa đủ lịch sử':'Đối chiếu dữ liệu cùng cơ sở'}</h4><p>${escape(growth)}</p><small>Số bán công khai là bộ đếm cộng dồn và có thể đã làm tròn.</small></article><article><span>3 · KHẢ NĂNG KINH DOANH</span><h4>${optimizer.cost_complete?'Đối chiếu lãi đóng góp':'Cần bổ sung chi phí'}</h4><p>${escape(business)}</p><button class="btn btn-white btn-sm" data-seller-optimize="${escape(ctx.product.sku)}">Kiểm tra chi phí / giá →</button></article></div>${mlBlock}${chartBlock}<p class="smi-footnote">Lịch sử chỉ dùng bản ghi của đúng shop và SKU đang chọn. ${list(evidence.limitations).map(escape).join(' ')}</p></section>`;
  }
  function render(mode,ctx) {
    if(!['competitors','opportunities'].includes(mode))return '';
    if(!valid(ctx))return '<div class="smi-empty"><h4>Chọn sản phẩm thuộc shop đang mở</h4><p>Chưa có dữ liệu SKU để phân tích thị trường.</p></div>';
    const state=stateFor(ctx);return mode==='competitors'?competitors(ctx,state):opportunities(ctx,state);
  }
  function click(button,ctx) {
    if(!button?.dataset||!('smiRetry' in button.dataset)||!valid(ctx))return false;
    const state=stateFor(ctx);if(state.loading)return true;
    state.attempted=false;state.error='';ensure(ctx);ctx.redraw?.();return true;
  }
  window.MarketLensShopMarket=Object.freeze({render,ensure,click});
})();
