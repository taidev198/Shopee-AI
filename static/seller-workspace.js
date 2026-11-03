'use strict';

(() => {
  const views=new Set(['myShops','shopAnalysis','optimizer','strategy','actions','reports']);
  const cache=new Map();
  const ai={config:null,error:'',loading:false,checked:false,connectionScheduled:false,connectionRequest:null,request:0,jobs:new Map(),timer:null,polling:false};
  const inputFields=[
    ['unit_cost','Giá vốn / sản phẩm','₫'],['platform_fee_pct','Phí nền tảng','%'],
    ['payment_fee_pct','Phí thanh toán','%'],['tax_pct','Thuế theo giả định','%'],
    ['packaging_cost','Đóng gói / đơn','₫'],['shipping_cost','Vận chuyển shop chịu / đơn','₫'],
    ['other_unit_cost','Chi phí khác / sản phẩm','₫'],['ad_cost_per_order','Quảng cáo / đơn thành công','₫'],
    ['ad_spend','Chi quảng cáo / cùng kỳ 30 ngày','₫'],['ad_revenue','Doanh thu quảng cáo / cùng kỳ 30 ngày','₫'],
    ['orders_30d','Đơn thành công / 30 ngày','đơn'],['visits_30d','Lượt truy cập / 30 ngày','lượt'],
    ['ad_impressions','Hiển thị quảng cáo / cùng kỳ 30 ngày','lượt'],['ad_clicks','Nhấp quảng cáo / cùng kỳ 30 ngày','lượt'],
    ['ad_orders_30d','Đơn từ quảng cáo / cùng kỳ 30 ngày','đơn'],
    ['target_margin_pct','Biên đóng góp mục tiêu','%'],['return_rate_pct','Tỷ lệ hoàn trả theo giả định','%'],
  ];
  const fieldNames=new Set(inputFields.map(field=>field[0]));
  const countFields=new Set(['orders_30d','visits_30d','ad_impressions','ad_clicks','ad_orders_30d']);
  const metricLabels={product_count:'Sản phẩm',revenue_30d:'Doanh thu 30 ngày',units_30d:'Sản lượng 30 ngày',orders_30d:'Đơn thành công 30 ngày',contribution_30d:'Lãi đóng góp 30 ngày',contribution_per_order:'Lãi đóng góp / đơn',conversion_pct:'Tỷ lệ chuyển đổi',roas:'ROAS',acos_pct:'ACOS',score:'Điểm sức khỏe',health_score:'Điểm sức khỏe',ad_impressions:'Hiển thị quảng cáo 30 ngày',ad_clicks:'Nhấp quảng cáo 30 ngày',ad_orders_30d:'Đơn từ quảng cáo 30 ngày',ad_ctr_pct:'CTR',ad_conversion_pct:'Chuyển đổi quảng cáo',review_count:'Lượt đánh giá',rating:'Điểm đánh giá',image_count:'Số ảnh sản phẩm',title_length:'Độ dài tiêu đề',description_length:'Độ dài mô tả'};
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  const list=value=>Array.isArray(value)?value:[];
  const currentId=()=>String(S.shopId||'');
  const shop=()=>list(S.shops).find(item=>String(item.id)===currentId())||(String(S.data?.shop?.id||'')===currentId()?S.data.shop:null);
  const query=id=>'?shop_id='+encodeURIComponent(id);
  const entryFor=id=>{
    if(!cache.has(id))cache.set(id,{data:null,embedded:null,loading:false,scheduled:false,request:0,error:'',message:'',busy:new Set(),sku:'',drafts:new Map(),notes:new Map(),reportDays:7,aiResults:new Map(),costsOpen:false,segment:'all',intelligenceModule:'shop',intelligenceSku:''});
    return cache.get(id);
  };
  const redraw=id=>{if(id===currentId()&&(views.has(S.view)||S.view==='overview'))render();};
  const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['shopee.vn','www.shopee.vn'].includes(u.hostname)&&!u.username&&!u.password&&!u.port?'https://shopee.vn'+u.pathname:'';}catch{return '';}};
  const source=(name,url)=>{const safe=safeUrl(url);return safe?`<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(name)} ↗</a>`:esc(name);};
  const date=value=>{if(!value)return '—';const d=new Date(value);return Number.isFinite(d.getTime())?esc(d.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})):esc(value);};
  const metric=(name,value)=>number(value)==null?'—':name.includes('revenue')||name.includes('contribution')?money(value):name.includes('pct')?esc(value.toFixed(2))+'%':num(value);
  const score=health=>number(health?.score)==null?'—':`${num(health.score)}<small>/100</small>`;
  const empty=(title,detail)=>`<div class="sw-empty"><span aria-hidden="true">◇</span><h3>${esc(title)}</h3><p>${esc(detail)}</p></div>`;
  const strings=value=>list(value).filter(item=>typeof item==='string');
  const activeAi=status=>['queued','running'].includes(status);
  const aiStatus=record=>record.status==='running'&&record.phase==='repairing'?'AI đang hoàn thiện lại kết quả':({queued:'Đang chờ AI',running:'AI đang phân tích',done:'AI đã hoàn tất',failed:'Phân tích AI thất bại',poll_error:'Chưa xác nhận được trạng thái AI'})[record.status]||'Chưa phân tích bằng AI';
  const aiDuration=value=>{
    if(number(value)==null||value<0)return '';
    const seconds=Math.round(value/1000),minutes=Math.floor(seconds/60);
    return minutes?`${num(minutes)} phút${seconds%60?' '+num(seconds%60)+' giây':''}`:`${num(seconds)} giây`;
  };
  const aiElapsed=(start,end)=>{
    if(!start||!end)return null;
    const elapsed=new Date(end).getTime()-new Date(start).getTime();
    return Number.isFinite(elapsed)&&elapsed>=0?elapsed:null;
  };
  function aiTelemetry(record) {
    const telemetry=record.telemetry||{},terminal=['done','failed'].includes(record.status);
    const duration=aiDuration(number(telemetry.duration_ms)??(terminal?aiElapsed(record.started_at,record.completed_at):null));
    const queue=aiDuration(number(telemetry.queue_duration_ms)??aiElapsed(record.created_at,record.started_at));
    const repairs=number(telemetry.repair_count),attempts=number(telemetry.attempt_count);
    const items=[...(queue?[['Chờ lượt',queue]]:[]),...(duration?[['Xử lý',duration]]:[]),...(Number.isInteger(attempts)&&attempts>0?[['Lượt xử lý',num(attempts)]]:[]),...(Number.isInteger(repairs)&&repairs>0?[['Hoàn thiện lại',num(repairs)+' lần']]:[])];
    return items.length?`<dl class="sw-ai-telemetry" aria-label="Thời gian và lượt xử lý AI">${items.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:'';
  }
  const planStatus=status=>({ready:'Có cơ sở triển khai',needs_data:'Cần bổ sung dữ liệu',missing:'Thiếu dữ liệu',review:'Cần kiểm tra',warning:'Cần chú ý',healthy:'Đủ cơ sở',needs_attention:'Cần cải thiện',insufficient:'Chưa đủ dữ liệu',unknown:'Chưa đủ dữ liệu',opportunity:'Có cơ hội thử nghiệm',fix:'Cần khắc phục',test:'Cần kiểm chứng',scale:'Có cơ sở thử mở rộng'})[status]||status||'Chưa xác định';
  const channelLabel=channel=>({ads:'Quảng cáo',reviews:'Đánh giá & niềm tin',images:'Hình ảnh',title:'Tiêu đề',description:'Mô tả',video:'Video',price:'Giá & biên lợi nhuận',promotion:'Khuyến mại',bundles:'Combo & bán kèm',variants:'Phân loại & quy cách',service:'Dịch vụ & hậu mãi',positioning:'Định vị & khách hàng'})[channel]||channel||'';
  const tierLabel=tier=>({now:'Làm trước',next:'Bước tiếp theo',later:'Theo dõi sau'})[tier]||'';
  const strategyRank=item=>Number.isInteger(number(item.rank))&&item.rank>0?item.rank:null;
  const strategyOrder=(a,b)=>strategyRank(a)&&strategyRank(b)?strategyRank(a)-strategyRank(b):(({now:0,next:1,later:2})[a.priority_tier]??1)-(({now:0,next:1,later:2})[b.priority_tier]??1)||(number(b.priority)||0)-(number(a.priority)||0);

  async function sellerApi(path,options={}) {
    const controller=typeof AbortController==='function'?new AbortController():null;
    let timer;
    const deadline=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>{
        reject(Object.assign(new Error('Máy chủ chưa xác nhận kết quả sau 20 giây. Bấm “Thử lại” để đọc lại dữ liệu.'),{code:'seller_request_timeout'}));
        controller?.abort();
      },20000);
    });
    try{return await Promise.race([api(path,{...options,...(controller?{signal:controller.signal}:{})}),deadline]);}
    finally{if(typeof clearTimeout==='function')clearTimeout(timer);}
  }

  function refreshAiConfig() {
    if(ai.connectionRequest)return ai.connectionRequest;
    const request=++ai.request;ai.loading=true;ai.error='';redraw(currentId());
    ai.connectionRequest=(async()=>{
      try {
        const config=await sellerApi('/api/seller/ai/config');
        if(request!==ai.request)return false;
        ai.config=config;return true;
      }catch(error){if(request===ai.request)ai.error=error.message||'Chưa kết nối được Ollama.';return false;}
      finally{if(request===ai.request){ai.loading=false;ai.checked=true;ai.connectionRequest=null;redraw(currentId());}}
    })();
    return ai.connectionRequest;
  }

  function ensureAiConnection() {
    if(ai.checked||ai.loading||ai.connectionScheduled)return;
    ai.connectionScheduled=true;
    Promise.resolve().then(()=>{ai.connectionScheduled=false;if(S.view==='optimizer')return refreshAiConfig();});
  }

  const aiRecord=(entry,product)=>entry.aiResults.get(String(product.sku))||product.ai_analysis||{};
  const aiPlan=(entry,product)=>{const record=aiRecord(entry,product);return record.result||record.plan||record.previous_result||product.ai_analysis?.result||product.ai_analysis?.plan||null;};

  function scheduleAiPoll() {
    if(ai.timer!==null||ai.polling||!ai.jobs.size)return;
    ai.timer=setTimeout(async()=>{
      ai.timer=null;ai.polling=true;
      try{await Promise.allSettled([...ai.jobs.values()].map(readAiJob));}
      finally{ai.polling=false;scheduleAiPoll();}
    },2000);
  }

  function trackAiJob(id,sku,record) {
    if(!record.job_id||!activeAi(record.status))return;
    const key=id+':'+record.job_id,entry=entryFor(id);
    entry.aiResults.set(String(sku),record);ai.jobs.set(key,{key,id,sku:String(sku),record});scheduleAiPoll();
  }

  function syncAiJobs(entry,id) {
    if(!ai.config&&entry.data?.ai_config)ai.config=entry.data.ai_config;
    for(const product of list(entry.data?.products)){
      const record=product.ai_analysis,sku=String(product.sku),local=entry.aiResults.get(sku);
      if(!record?.job_id||entry.busy.has('ai:'+sku))continue;
      if(local?.job_id&&(local.job_id===record.job_id&&!activeAi(record.status)||!activeAi(local.status))){
        ai.jobs.delete(id+':'+local.job_id);entry.aiResults.delete(sku);
      }
      if(activeAi(record.status)&&!entry.aiResults.has(sku))trackAiJob(id,sku,{...record});
    }
    if(!ai.jobs.size&&ai.timer!==null){clearTimeout(ai.timer);ai.timer=null;}
  }

  async function readAiJob(job) {
    const entry=entryFor(job.id),record=job.record;
    if(entry.aiResults.get(job.sku)!==record){ai.jobs.delete(job.key);return;}
    try {
      const data=await sellerApi('/api/seller/ai/jobs/'+encodeURIComponent(record.job_id)+query(job.id));
      if(entry.aiResults.get(job.sku)!==record)return;
      Object.assign(record,data);
      if(!activeAi(record.status)){
        ai.jobs.delete(job.key);
        if(await refresh(job.id)){
          const persisted=list(entry.data?.products).find(product=>String(product.sku)===job.sku)?.ai_analysis;
          if(persisted?.job_id===record.job_id&&!activeAi(persisted.status))entry.aiResults.delete(job.sku);
        }
      }
    }catch(error){record.status='poll_error';record.error=error.message||'Chưa đọc được trạng thái tác vụ AI.';ai.jobs.delete(job.key);}
    finally{redraw(job.id);}
  }

  async function generateAi(id,sku,force=false) {
    const entry=entryFor(id),product=list(entry.data?.products).find(item=>String(item.sku)===sku),key='ai:'+sku;
    if(!product||entry.busy.has(key)||activeAi(aiRecord(entry,product).status))return;
    entry.busy.add(key);const previous=aiPlan(entry,product);entry.aiResults.set(sku,{status:'queued',phase:'queued',previous_result:previous,error:''});redraw(id);
    try {
      const response=await sellerApi('/api/seller/ai/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shop_id:id,sku,force})});
      if(!response.job_id)throw new Error('Máy chủ chưa trả mã tác vụ AI. Kiểm tra kết nối trước khi thử lại.');
      const record={...response,previous_result:previous,error:''};entry.aiResults.set(sku,record);
      if(activeAi(record.status))trackAiJob(id,sku,record);
      else await readAiJob({key:id+':'+record.job_id,id,sku,record});
    }catch(error){entry.aiResults.set(sku,{status:'failed',previous_result:previous,error:error.message||'Chưa tạo được phân tích AI.'});}
    finally{entry.busy.delete(key);redraw(id);}
  }

  function adopt(data,id=currentId()) {
    const embedded=data?.seller_analysis;
    if(!embedded||String(data.shop?.id||'')!==id)return;
    const entry=entryFor(id);
    if(entry.embedded===embedded)return;
    entry.embedded=embedded;entry.data=embedded;entry.error='';entry.loading=false;entry.request++;syncAiJobs(entry,id);
  }

  async function refresh(id=currentId()) {
    if(!id)return false;
    const entry=entryFor(id),request=++entry.request;
    entry.loading=true;entry.error='';redraw(id);
    try {
      const data=await sellerApi('/api/seller/analysis'+query(id));
      if(request!==entry.request)return false;
      entry.data=data;syncAiJobs(entry,id);return true;
    }catch(error){if(request===entry.request)entry.error=error.message||'Chưa đọc được dữ liệu shop.';return false;}
    finally{if(request===entry.request){entry.loading=false;redraw(id);}}
  }

  function ensure(id,data) {
    adopt(data,id);const entry=entryFor(id);
    if(!entry.data&&!entry.loading&&!entry.scheduled&&!entry.error){entry.scheduled=true;setTimeout(()=>{entry.scheduled=false;if(currentId()===id)return refresh(id);},0);}
    return entry;
  }

  function currentProduct(entry) {
    const products=list(entry.data?.products);
    return products.find(product=>String(product.sku)===entry.sku)||products[0]||null;
  }

  function inputDraft(entry,product) {
    const sku=String(product.sku);
    if(!entry.drafts.has(sku)){
      const saved=product.inputs||entry.data?.inputs?.[sku]||{};
      entry.drafts.set(sku,Object.fromEntries(inputFields.map(([name])=>[name,saved[name]==null||(name==='ad_cost_per_order'&&saved.ad_allocation_basis&&saved.ad_allocation_basis!=='manual_per_order')?'':String(saved[name])])));
    }
    return entry.drafts.get(sku);
  }

  async function mutate(key,operation,id=currentId()) {
    const entry=entryFor(id);if(entry.busy.has(key))return;
    entry.busy.add(key);entry.error='';entry.message='';redraw(id);
    try{await operation(entry,id);await refresh(id);}
    catch(error){entry.error=error.message||'Chưa lưu được thay đổi.';}
    finally{entry.busy.delete(key);redraw(id);}
  }

  function context(entry) {
    if(!entry.sku)return '';
    const product=list(entry.data?.products).find(item=>String(item.sku)===entry.sku);
    return `<div class="sw-context"><div><span>SKU ĐANG PHÂN TÍCH</span><strong>${esc(product?.name||entry.sku)}</strong></div><div><button class="btn btn-soft btn-sm" data-seller-optimize="${esc(entry.sku)}">Kế hoạch bán hàng</button><button class="btn btn-white btn-sm" data-seller-strategy="${esc(entry.sku)}">Chiến lược</button><button class="btn btn-white btn-sm" data-seller-task="${esc(entry.sku)}">Công việc</button><button class="text-link" data-seller-clear> Xem tất cả ×</button></div></div>`;
  }

  function shopKpis(data) {
    const summary=data.summary||{},catalog=summary.catalog;
    if(number(summary.revenue_30d)==null&&catalog?.product_count)return `<div class="grid-kpi sw-kpis" data-seller-catalog>${kpi('Sản phẩm đã thu thập',num(catalog.product_count),`${num(catalog.sold_known_count)} sản phẩm có số đã bán · ${num(catalog.detail_count)} có chi tiết`,'▤')}${kpi('Tổng đã bán (tích lũy)',number(catalog.sold_total_sum)==null?'—':num(catalog.sold_total_sum),catalog.top3_share_pct==null?'Chưa có số đã bán':`Top 3 chiếm ${esc(catalog.top3_share_pct.toFixed(1))}% tổng đã bán`,'↗')}${kpi('GMV tích lũy ước tính',number(catalog.gmv_cumulative_estimate)==null?'—':money(catalog.gmv_cumulative_estimate),'Giá hiện tại × tổng đã bán; không phải doanh thu 30 ngày','◇')}${kpi('Giá trung vị',number(catalog.price_median)==null?'—':money(catalog.price_median),number(catalog.price_min)==null?'':`Từ ${esc(money(catalog.price_min))} đến ${esc(money(catalog.price_max))}`,'✓')}</div>`;
    return `<div class="grid-kpi sw-kpis">${kpi('Doanh thu 30 ngày',metric('revenue_30d',summary.revenue_30d),summary.revenue_basis||'Thiếu dữ liệu nếu chưa có kỳ báo cáo phù hợp','↗')}${kpi('Đơn thành công',metric('orders_30d',summary.orders_30d),'Số đơn chỉ dùng khi được cung cấp, không thay bằng sản lượng','▤')}${kpi('Lãi đóng góp 30 ngày',metric('contribution_30d',summary.contribution_30d),'Trong phần dữ liệu có chi phí đủ điều kiện','◇')}${kpi('SKU đủ chi phí',num(summary.coverage?.cost_complete??summary.eligible_count??0),`Trong ${num(summary.product_count||0)} sản phẩm`,'✓')}</div>`;
  }

  function healthPanel(data) {
    const summary=data.summary||{},health=data.health||{};
    return `<section class="panel sw-health"><div class="sw-health-score"><span>SHOP HEALTH SCORE</span><strong>${score(health)}</strong><small>${esc(health.confidence||'Chưa đủ dữ liệu')}</small></div><div><h2>Sức khỏe shop từ dữ liệu hiện có</h2><p>Điểm ưu tiên tham khảo theo độ đầy đủ dữ liệu và các vấn đề đã ghi nhận.</p>${strings(health.issues).length?`<ul>${strings(health.issues).slice(0,5).map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>`:'<p class="sw-muted">Chưa ghi nhận vấn đề cụ thể trong phạm vi dữ liệu hiện tại.</p>'}</div></section>${shopKpis(data)}`;
  }

  function productRows(products) {
    return `<div class="table-wrap"><table class="data-table sw-products" data-pagination-key="seller-products"><thead><tr><th>Sản phẩm</th><th>Nhóm / sức khỏe</th><th>Giá</th><th>Lãi đóng góp / đơn</th><th>Doanh thu 30 ngày</th><th>Quảng cáo / chuyển đổi</th><th>Phân tích tiếp</th></tr></thead><tbody>${products.map(product=>{const m=product.metrics||{};return `<tr data-pagination-id="${esc(product.sku)}"><td><button class="sw-product-link" data-seller-detail="${esc(product.sku)}">${esc(product.name)}</button><small>${esc(product.category||'')} · ${esc(product.sku)}</small></td><td><span class="sw-tag">${esc(product.segment_label||'Chưa phân nhóm')}</span><small>Health ${number(product.health?.score)==null?'—':num(product.health.score)}/100 · ${esc(product.health?.confidence||'Chưa đủ dữ liệu')}</small>${product.segment_reason?`<small>${esc(product.segment_reason)}</small>`:''}</td><td>${money(number(product.price))}</td><td>${money(number(m.contribution_per_order))}<small>${product.optimizer?.cost_complete?'Theo chi phí đã nhập':'Có điều kiện; chi phí còn thiếu'}</small></td><td>${metric('revenue_30d',m.revenue_30d)}</td><td><small>ROAS ${metric('roas',m.roas)} · ACOS ${metric('acos_pct',m.acos_pct)}</small><small>Chuyển đổi ${metric('conversion_pct',m.conversion_pct)}</small></td><td><button class="btn btn-soft btn-sm" data-seller-optimize="${esc(product.sku)}">Tối ưu →</button></td></tr>`;}).join('')}</tbody></table></div>`;
  }

  const shopGroups=[
    {key:'chief',label:'Sản phẩm chủ lực',hint:'Ưu tiên kiểm tra nguồn hàng và lợi nhuận'},
    {key:'growth',label:'Có tiềm năng',hint:'Thiết kế thử nghiệm có giới hạn'},
    {key:'low_margin',label:'Biên lợi nhuận thấp',hint:'Đối soát giá vốn và phí trước khi giảm giá'},
    {key:'slow',label:'Bán chậm',hint:'Kiểm tra nội dung và mức phù hợp'},
    {key:'unknown',label:'Chưa đủ dữ liệu phân nhóm',hint:'Bổ sung chi phí và báo cáo bán hàng cùng kỳ'},
  ];
  const shopSegment=product=>shopGroups.some(group=>group.key===product.segment)?product.segment:'unknown';

  const intelligenceModules=[['shop','Shop','Shop Intelligence','shop'],['product','Sản phẩm','Product Intelligence','products'],['price','Tối ưu giá','Price Optimizer','optimizer'],['competitors','Đối thủ','Competitor Research','competitors'],['opportunities','Cơ hội','Hot Trend Discovery','marketAnalysis']];
  function intelligenceContext(entry,id=currentId()) {
    const products=list(entry.data?.products),product=products.find(item=>String(item.sku)===entry.intelligenceSku)||products.find(item=>String(item.sku)===entry.sku)||products[0];
    entry.intelligenceSku=product?String(product.sku):'';
    return {entry,data:entry.data,product,shopId:id,redraw:()=>redraw(id),openProduct};
  }
  function intelligenceModuleBody(entry) {
    const ctx=intelligenceContext(entry),mode=entry.intelligenceModule;
    if(!ctx.product)return empty('Shop chưa có sản phẩm','Thu thập hoặc nhập dữ liệu sản phẩm để mở các góc nhìn phân tích.');
    const selector=`<label class="sw-product-select sw-intelligence-select">Chọn sản phẩm để phân tích<select id="sellerIntelligenceSku">${list(entry.data.products).map(product=>`<option value="${esc(product.sku)}" ${String(product.sku)===entry.intelligenceSku?'selected':''}>${esc(product.name)} · ${esc(product.sku)}</option>`).join('')}</select></label>`;
    let content='';
    if(['product','price'].includes(mode))content=window.MarketLensProductPrice?.render(mode,ctx)||empty('Đang nạp góc nhìn sản phẩm','Tải lại MarketLens để nạp giao diện mới.');
    else {
      const module=window.MarketLensShopMarket;
      content=module?.render(mode,ctx)||empty('Đang nạp góc nhìn thị trường','Tải lại MarketLens để nạp giao diện mới.');
      if(module?.ensure)Promise.resolve(module.ensure(ctx)).catch(()=>{});
    }
    return selector+content;
  }

  function shopIntelligence(entry) {
    const data=entry.data,products=list(data.products),health=data.health||{};
    const value=number(health.score),progress=value==null?0:Math.max(0,Math.min(100,value));
    const counts=Object.fromEntries(shopGroups.map(group=>[group.key,products.filter(product=>shopSegment(product)===group.key).length]));
    const known=number(health.coverage?.known)??products.filter(product=>number(product.health?.score)!=null).length;
    const cumulative=products.filter(product=>product.segment==='chief'&&number(product.metrics?.units_30d)==null).length;
    const priority=list(data.strategies).find(item=>item.title&&(!item.sku||products.some(product=>String(product.sku)===String(item.sku))));
    const icons={shop:'<path d="M3 10h18L19 4H5l-2 6Zm2 0v10h14V10M9 20v-6h6v6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',products:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',optimizer:'<path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7.5" cy="7.5" r="1"/>',competitors:'<path d="M4 7h16m-5-5 5 5-5 5M20 17H4m5-5-5 5 5 5"/>',marketAnalysis:'<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>'};
    const mode=entry.intelligenceModule||'shop';
    return `<section class="panel sw-intelligence" aria-label="Shop Intelligence"><div class="sw-module-nav" role="tablist" aria-label="Các góc nhìn phân tích shop">${intelligenceModules.map(([view,label,caption,icon])=>`<button type="button" role="tab" id="sellerModule-${view}" data-seller-intelligence-module="${view}" aria-selected="${view===mode}" aria-controls="sellerIntelligenceBody" tabindex="${view===mode?0:-1}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[icon]}</svg><span>${label}<small>${caption}</small></span></button>`).join('')}</div>
    <div class="sw-intelligence-body" id="sellerIntelligenceBody" role="tabpanel" aria-labelledby="sellerModule-${mode}">${mode!=='shop'?intelligenceModuleBody(entry):`<div class="sw-intelligence-heading"><div><span class="sw-eyebrow">SHOP INTELLIGENCE</span><h2 id="sellerIntelligenceTitle">Điều gì cần được chú ý trước?</h2><p>Nhìn nhanh sức khỏe danh mục và chọn nhóm sản phẩm cần phân tích tiếp.</p></div><span class="sw-tag">${data.is_demo?'Shop minh họa':esc(shop()?.name||'Dữ liệu shop đang chọn')}</span></div>
    <div class="sw-intelligence-grid"><div class="sw-intelligence-health"><div class="sw-score-ring ${value==null?'is-missing':''}" style="--sw-health-progress:${progress}%" ${value==null?'role="img" aria-label="Chưa đủ dữ liệu tính điểm sức khỏe shop"':`role="progressbar" aria-label="Điểm sức khỏe shop" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"`}><strong>${score(health)}</strong></div><h3 aria-label="SHOP HEALTH SCORE">Shop Health Score</h3><p>${esc(health.confidence||'Chưa đủ dữ liệu tính điểm.')}<br>Đủ chỉ số tính điểm: <strong>${num(known)}/${num(products.length)} SKU</strong>.</p><small>Điểm quy tắc từ chỉ số đã biết, không phải dự báo doanh số.</small></div>
    <div class="sw-product-groups">${shopGroups.filter(group=>group.key!=='unknown'||counts.unknown>0).map(group=>`<button type="button" class="sw-group-row sw-group-${group.key}" data-seller-segment="${group.key}" aria-pressed="${entry.segment===group.key}"><span class="sw-group-dot" aria-hidden="true"></span><span><strong>${group.label}</strong><small>${group.hint}</small></span><b>${num(counts[group.key])}</b><span class="sw-group-arrow" aria-hidden="true">↗</span></button>`).join('')}${cumulative?`<p class="sw-group-basis">${num(cumulative)} sản phẩm chủ lực được phân nhóm tham khảo theo tổng đã bán tích lũy; chưa xác nhận sức bán 30 ngày.</p>`:''}</div></div>
    <div class="sw-shop-priority" data-seller-priority><span aria-hidden="true">✧</span><div><p><strong>Bước hành động ưu tiên:</strong> ${priority?esc(priority.title):products.length?'Bổ sung dữ liệu bán hàng và chi phí để xác định việc cần làm.':'Thu thập sản phẩm của shop để bắt đầu phân tích.'}</p>${priority?.body?`<small>${esc(priority.body)}</small>`:''}${priority?`<small class="sw-priority-source">${priority.source==='ollama'?'Đề xuất từ AI cục bộ · kiểm tra bằng chứng trước khi áp dụng':'Từ dữ liệu và quy tắc phân tích hiện có'}</small>`:''}</div>${priority?.sku?`<button class="text-link" data-seller-optimize="${esc(priority.sku)}">Phân tích SKU này →</button>`:products.length?'<button class="text-link" data-seller-view="strategy" data-seller-reset-sku>Xem kế hoạch →</button>':(!window.MarketLensAuth||window.MarketLensAuth.isSystem?'<button class="text-link" data-seller-view="crawler">Thu thập sản phẩm →</button>':'<span class="small-help">System sẽ cập nhật dữ liệu shop</span>')}</div>
    <details class="sw-health-basis"><summary>Cơ sở tính điểm và dữ liệu còn thiếu</summary><p>${esc(health.basis||'Tính từ các chỉ số sản phẩm đã có; chỉ số thiếu không được gán bằng 0.')}</p>${strings(health.issues).length?`<ul>${strings(health.issues).map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>`:''}<p>Các nhóm sản phẩm không trùng nhau. Nhóm biên lợi nhuận thấp cần đủ chi phí và biên đóng góp không dương hoặc thấp hơn mục tiêu đã nhập.</p></details>`}</div></section>`;
  }

  const shopAiState=entry=>entry.shopAi||(entry.shopAi={data:null,busy:false,error:'',timer:null,loaded:false});
  const shopAiActive=state=>['queued','running'].includes(state.data?.job?.status);
  function scheduleShopAiPoll(id) {
    const state=shopAiState(entryFor(id));
    if(state.timer!==null||!shopAiActive(state))return;
    state.timer=setTimeout(()=>{state.timer=null;loadShopAi(id);},3000);
  }
  async function loadShopAi(id) {
    const state=shopAiState(entryFor(id));state.loaded=true;
    try{state.data=await sellerApi('/api/seller/ai/shop'+query(id));state.error='';}
    catch(error){state.error=error.message||'Chưa đọc được kết quả AI toàn shop.';}
    finally{scheduleShopAiPoll(id);redraw(id);}
  }
  async function startShopAi(id,force=false) {
    const state=shopAiState(entryFor(id));if(state.busy||shopAiActive(state))return;
    state.busy=true;state.error='';redraw(id);
    try{await sellerApi('/api/seller/ai/shop-generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shop_id:id,force})});}
    catch(error){state.error=error.message||'Chưa tạo được phân tích AI toàn shop.';}
    finally{state.busy=false;await loadShopAi(id);}
  }

  function shopAiPanel(entry,id) {
    const state=shopAiState(entry);
    if(!state.loaded){state.loaded=true;state.data=entry.data?.shop_ai||null;Promise.resolve().then(()=>scheduleShopAiPoll(id));}
    const job=state.data?.job,result=state.data?.result,active=shopAiActive(state)||state.busy;
    const seconds=ms=>number(ms)==null?'':Math.round(ms/1000)+' giây';
    const status=active?'AI đang đọc toàn bộ danh sách sản phẩm của shop… thường xong trong 1–2 phút.':job?.status==='failed'?esc(job.error||'Phân tích AI thất bại.'):result?`Hoàn tất${job?.telemetry?.duration_ms?' trong '+seconds(job.telemetry.duration_ms):''} · model ${esc(job?.model||'')}${state.data.stale?' · <strong>Dữ liệu shop đã thay đổi, nên phân tích lại</strong>':''}`:'Chưa có phân tích AI cho toàn shop.';
    const priority=(item,index)=>`<article class="sw-ai-shop-priority"><h4>${index+1}. ${esc(item.title)}</h4><p><strong>Vì sao:</strong> ${esc(item.why)}</p><p><strong>Việc cần làm:</strong> ${esc(item.action)}</p>${list(item.products).length?`<div class="sw-ai-shop-products">${list(item.products).map(product=>`<button type="button" class="sw-tag" data-seller-detail="${esc(product.sku)}">${esc(product.name)}</button>`).join('')}</div>`:''}</article>`;
    const bullets=(title,items)=>strings(items).length?`<div><h4>${title}</h4><ul>${strings(items).map(text=>`<li>${esc(text)}</li>`).join('')}</ul></div>`:'';
    return `<section class="panel sw-ai-shop" data-seller-ai-shop><div class="panel-head"><div><h3 class="panel-title">Phân tích AI toàn shop</h3><p class="panel-sub">${status}</p></div><button class="btn btn-primary" data-seller-ai-shop-run ${active?'disabled':''}>${active?'Đang phân tích…':result?'Phân tích lại toàn shop':'Phân tích toàn shop bằng AI'}</button></div>${state.error?`<div class="warning-soft">${esc(state.error)}</div>`:''}${result?`<p class="sw-ai-shop-summary">${esc(result.summary)}</p><div class="sw-ai-shop-grid">${list(result.priorities).map(priority).join('')}</div><div class="sw-ai-shop-notes">${bullets('Việc làm nhanh',result.quick_wins)}${bullets('Rủi ro',result.risks)}${bullets('Dữ liệu còn thiếu',result.data_gaps)}</div><small class="sw-muted">AI chỉ đọc số liệu đã thu thập; nhận định mang tính tham khảo, cần đối chiếu trước khi hành động.</small>`:''}</section>`;
  }

  function shopAnalysis(entry,id=currentId()) {
    const data=entry.data,products=list(data.products),selected=shopGroups.find(group=>group.key===entry.segment);
    const filtered=selected?products.filter(product=>shopSegment(product)===selected.key):products;
    return shopIntelligence(entry)+(entry.intelligenceModule!=='shop'?'':shopAiPanel(entry,id)+shopKpis(data)+`<section class="panel" id="sellerShopProducts"><div class="panel-head"><div><h3 class="panel-title">${selected?esc(selected.label):'Danh mục cần ưu tiên'} · ${num(filtered.length)} sản phẩm</h3><p class="panel-sub">${selected?`${num(filtered.length)}/${num(products.length)} sản phẩm trong shop đang chọn. Xem cơ sở phân nhóm ở từng dòng.`:'Bấm một nhóm ở trên để xem sản phẩm và cơ sở phân loại.'}</p></div><div class="sw-card-actions">${selected?'<button class="btn btn-white btn-sm" data-seller-segment="all">Xem tất cả sản phẩm</button>':''}<button class="btn btn-soft btn-sm" data-seller-view="strategy" data-seller-reset-sku>Xem chiến lược →</button></div></div>${filtered.length?productRows(filtered):empty(products.length?'Chưa có sản phẩm trong nhóm này':'Shop chưa có sản phẩm',products.length?'Nhóm này hiện có 0 sản phẩm theo dữ liệu đã thu thập. Chọn nhóm khác hoặc xem tất cả sản phẩm.':'Quét shop hoặc nhập báo cáo trước khi phân tích hiệu quả từng SKU.')}</section>`);
  }

  function planDetails(plan) {
    return (typeof plan?.hypothesis==='string'&&plan.hypothesis?`<div><dt>Giả thuyết cần kiểm chứng</dt><dd>${esc(plan.hypothesis)}</dd></div>`:'')+[['steps','Các bước thực hiện'],['measurement','Chỉ số theo dõi'],['prerequisites','Cần chuẩn bị']].map(([key,label])=>strings(plan?.[key]).length?`<div><dt>${label}</dt><dd><${key==='steps'?'ol':'ul'} class="sw-plan-points">${strings(plan[key]).map(text=>`<li>${esc(text)}</li>`).join('')}</${key==='steps'?'ol':'ul'}></dd></div>`:'').join('')+(typeof plan?.tradeoff==='string'&&plan.tradeoff?`<div><dt>Đánh đổi / rủi ro</dt><dd>${esc(plan.tradeoff)}</dd></div>`:'');
  }

  function strategyCoverage(strategies) {
    const channels=[...new Set(strategies.map(item=>item.channel).filter(Boolean))];
    return `<div class="sw-strategy-coverage"><strong>${num(strategies.length)} chiến lược từ dữ liệu SKU${channels.length?' · '+num(channels.length)+' hướng triển khai':''}</strong><div>${channels.map(channel=>`<span data-seller-strategy-channel="${esc(channel)}">${esc(channelLabel(channel))}</span>`).join('')}</div><small>Thứ tự dựa trên ưu tiên trong kết quả phân tích; đọc bằng chứng và đo lường trước khi áp dụng.</small></div>`;
  }

  function diagnosisEvidence(value) {
    const evidence=strings(value).filter(text=>text.trim());
    if(!evidence.length)return '<p class="sw-muted">Chưa có bằng chứng được ghi nhận cho nội dung này.</p>';
    const content=`<ul>${evidence.map(text=>`<li>${esc(text)}</li>`).join('')}</ul>`;
    return evidence.length>2||evidence.reduce((length,text)=>length+text.length,0)>360?`<details class="sw-diagnosis-evidence"><summary>${num(evidence.length)} căn cứ từ dữ liệu</summary>${content}</details>`:content;
  }

  function diagnosisCards(items,key,{paginate=true}={}) {
    return `<div class="sw-diagnosis${paginate?'':' sw-ai-diagnosis'}"${paginate?` data-pagination-list data-pagination-key="${esc(key)}" data-pagination-size="6"`:''}>${list(items).map(item=>`<article data-pagination-id="${esc(item.channel)}"><div><h3>${esc(item.label||item.channel)}</h3><span class="sw-tag">${esc(planStatus(item.status))}</span></div>${typeof item.insight==='string'&&item.insight.trim()?`<p class="sw-diagnosis-insight"><strong>Nhận định</strong>${esc(item.insight)}</p>`:''}${typeof item.recommendation==='string'&&item.recommendation.trim()?`<p class="sw-diagnosis-recommendation"><strong>Hướng xử lý</strong>${esc(item.recommendation)}</p>`:''}${diagnosisEvidence(item.evidence)}${strings(item.missing).length?`<p class="sw-diagnosis-missing"><strong>Cần bổ sung:</strong> ${strings(item.missing).map(esc).join(' · ')}</p>`:''}</article>`).join('')}</div>`;
  }

  function aiOverview(product,plan) {
    const metrics=product.metrics||{},optimizer=product.optimizer||{},detail=product.detail||{};
    const baseline=list(optimizer.scenarios).find(item=>item.key==='baseline');
    const sold=number(metrics.sold_total)??number(product.sold_total),rating=number(metrics.rating)??number(product.rating),reviews=number(metrics.review_count)??number(product.review_count);
    const soldText=typeof detail.sold_text==='string'?detail.sold_text.trim():'';
    const contribution=number(metrics.contribution_per_order)??number(optimizer.contribution_per_order);
    const breakEvenRoas=number(metrics.break_even_roas)??number(optimizer.break_even_roas);
    const decimal=(value,minimumFractionDigits=0)=>new Intl.NumberFormat('vi-VN',{minimumFractionDigits,maximumFractionDigits:2}).format(value);
    const percent=(value,minimumFractionDigits=0)=>number(value)==null?'Chưa có dữ liệu':decimal(value,minimumFractionDigits)+'%';
    const roas=value=>decimal(value,2);
    const valueOrMissing=(value,format=num)=>number(value)==null?'Chưa có dữ liệu':format(value);
    const cards=[
      ['Giá bán hiện tại',valueOrMissing(number(product.price),money),'Giá ghi nhận trong database'],
      ['Sản lượng bán công khai',soldText?esc(soldText):valueOrMissing(sold),'Số cộng dồn / hiển thị làm tròn; không phải đơn 30 ngày'],
      ['Điểm đánh giá',rating==null?'Chưa có dữ liệu':decimal(rating,1)+'/5','Điểm tổng hợp đã ghi nhận'],
      ['Lượt đánh giá',valueOrMissing(reviews),'Không thay cho số đơn hàng'],
      ['Lãi đóng góp / đơn',valueOrMissing(contribution,money),optimizer.cost_complete?'Theo các chi phí đã nhập':'Có điều kiện; còn thiếu chi phí'],
      ['Biên đóng góp',percent(baseline?.margin_pct,2),optimizer.cost_complete?'Tại giá và chi phí hiện tại':'Có điều kiện; chưa đủ chi phí'],
      ['ROAS hòa vốn',valueOrMissing(breakEvenRoas,roas),'Theo chi phí trước quảng cáo đã nhập'],
      ['ROAS ghi nhận',valueOrMissing(number(metrics.roas),roas),'Từ doanh thu và chi quảng cáo cùng kỳ'],
    ];
    const missingCosts=strings(optimizer.missing).map(name=>inputFields.find(field=>field[0]===name)?.[1]||name);
    const imageCount=number(metrics.image_count)??(Array.isArray(detail.images)?detail.images.length:null);
    const descriptionKnown=typeof detail.description==='string',descriptionLength=number(metrics.description_length)??(descriptionKnown?detail.description.trim().length:null);
    const summary=typeof plan.summary==='string'&&plan.summary.trim()?plan.summary:'Chưa có phần tóm tắt từ AI.';
    return `<section class="sw-ai-overview" aria-label="Tổng quan phân tích sản phẩm"><div class="sw-ai-overview-heading"><span class="sw-eyebrow">TỔNG QUAN SẢN PHẨM</span><h3>${esc(product.name||product.sku)}</h3><p>SKU ${esc(product.sku)} · Số liệu hiện tại từ database và phép tính chi phí; AI không tự tạo các chỉ số này.</p></div><dl class="sw-ai-metrics">${cards.map(([label,value,basis])=>`<div><dt>${label}</dt><dd>${value}</dd><small>${basis}</small></div>`).join('')}</dl><div class="sw-ai-data-coverage"><h4>Dữ liệu sẵn có và giới hạn phân tích</h4><ul><li><strong>Bán hàng cùng kỳ:</strong> đơn thành công 30 ngày ${valueOrMissing(number(metrics.orders_30d))} · chuyển đổi ${percent(metrics.conversion_pct)}.</li><li><strong>Chi phí:</strong> ${optimizer.cost_complete?'Đủ các khoản được yêu cầu theo dữ liệu đã nhập.':missingCosts.length?'Chưa đủ; thiếu '+missingCosts.map(esc).join(', ')+'.':'Chưa đủ cơ sở xác nhận đầy đủ chi phí.'}</li><li><strong>Nội dung đã lưu:</strong> ảnh ${imageCount==null?'chưa ghi nhận':num(imageCount)+' URL'} · mô tả ${descriptionLength==null?'chưa ghi nhận':num(descriptionLength)+' ký tự'}. URL ảnh chưa phải kết quả đánh giá chất lượng hình ảnh.</li></ul></div><div class="sw-ai-model-overview"><h4>Nhận định tổng quan từ AI</h4><div class="sw-ai-summary">${summary.split(/\n\s*\n/).filter(text=>text.trim()).map(text=>`<p>${esc(text)}</p>`).join('')}</div></div>${list(plan.diagnosis).length?`<div class="sw-plan-heading"><h3>Phân tích từng khía cạnh</h3><p>${num(plan.diagnosis.length)} khía cạnh được AI trả về cho SKU này; nhận định, hướng xử lý và phần còn thiếu được giữ đầy đủ.</p></div>${diagnosisCards(plan.diagnosis,'seller-ai-diagnosis-'+product.sku,{paginate:false})}`:''}</section>`;
  }

  function aiConfigPanel() {
    const config=ai.config||{},model=ai.checked?(config.selected_model||config.model||''):'';
    const paused=ai.checked&&config.enabled===false;
    const ready=ai.checked&&!paused&&config.available===true&&config.model_installed!==false&&!!model;
    const state=ai.loading||!ai.checked?'Đang tự kết nối…':paused?'AI đang được System tạm dừng':ready?'Đã kết nối':'Lần kiểm tra gần nhất chưa sẵn sàng';
    const error=ai.error||config.error;
    return `<div class="sw-ai-connection" role="status" aria-live="polite"><div><span class="sw-ai-connection-dot ${ready?'is-ready':paused?'is-paused':''}" aria-hidden="true"></span><strong>AI tự kết nối</strong><span>${esc(state)}</span></div>${model?`<p>Mô hình cục bộ: <strong>${esc(model)}</strong></p>`:'<p>Hệ thống tự xác định mô hình cục bộ phù hợp; bạn không cần chọn hoặc lưu cấu hình.</p>'}${error?`<p class="sw-ai-connection-error">${esc(String(error).slice(0,500))}</p>`:''}${paused?'<p>System đã tạm dừng AI. Kết quả đã lưu vẫn xem được.</p>':ai.checked&&!ready?'<p>Mở Ollama và chờ mô hình cục bộ sẵn sàng. Bấm Phân tích để hệ thống kiểm tra lại tự động, hoặc kết nối lại bên dưới.</p>':''}<div class="sw-ai-connection-footer"><small>Chỉ kiểm tra kết nối khi mở tab. AI phân tích SKU khi bạn bấm Phân tích.</small><button class="btn btn-white btn-sm" type="button" data-seller-ai-config-refresh ${ai.loading?'disabled':''}>${ai.loading?'Đang kết nối…':'Kết nối lại'}</button></div></div>`;
  }

  function aiDrafts(plan,sku) {
    const drafts=plan.listing_drafts||{};
    if(!strings(drafts.titles).length&&!drafts.description&&!strings(drafts.image_briefs).length&&!strings(drafts.video_script).length)return '';
    const copy=(key,label)=>`<button class="btn btn-white btn-sm" data-seller-ai-copy="${key}" data-seller-sku="${esc(sku)}">${label}</button>`;
    return `<section class="sw-ai-drafts"><h3>Bản nháp nội dung từ AI</h3><p>Kiểm tra lại quy cách, bằng chứng và ngôn ngữ trước khi dùng. Các nội dung này chưa được đăng lên Shopee.</p>${strings(drafts.titles).length?`<div class="sw-draft-block"><h4>Tiêu đề đề xuất</h4>${strings(drafts.titles).map((text,index)=>`<div><textarea readonly aria-label="Tiêu đề đề xuất ${index+1}">${esc(text)}</textarea>${copy('titles:'+index,'Sao chép tiêu đề')}</div>`).join('')}</div>`:''}${typeof drafts.description==='string'&&drafts.description?`<div class="sw-draft-block"><h4>Mô tả đề xuất</h4><textarea readonly rows="8" aria-label="Mô tả đề xuất">${esc(drafts.description)}</textarea>${copy('description','Sao chép mô tả')}</div>`:''}${[['image_briefs','Gợi ý ảnh cần chụp','Sao chép danh sách ảnh'],['video_script','Kịch bản video','Sao chép kịch bản']].map(([key,label,button])=>strings(drafts[key]).length?`<div class="sw-draft-block"><h4>${label}</h4><ol>${strings(drafts[key]).map(text=>`<li>${esc(text)}</li>`).join('')}</ol>${copy(key,button)}</div>`:'').join('')}</section>`;
  }

  function aiPanel(entry,product,products) {
    const record=aiRecord(entry,product),plan=aiPlan(entry,product),busy=activeAi(record.status)||entry.busy.has('ai:'+product.sku),failed=record.status==='failed';
    const progress=record.status==='running'&&record.phase==='repairing'?'AI đang hoàn thiện lại đầu ra chưa đạt kiểm tra. Chưa có kết quả mới được chấp nhận.':record.status==='queued'?'SKU đang chờ đến lượt xử lý trên máy này.':'AI đang phân tích và kiểm tra kết quả từ dữ liệu của SKU.';
    const strategies=list(plan?.strategies).filter(item=>!item.sku||String(item.sku)===String(product.sku)).map(item=>({...item,sku:item.sku||product.sku,source:'ollama'})).sort(strategyOrder);
    return `<section class="panel sw-ai-panel"><div class="panel-head"><div><span class="sw-eyebrow">PRODUCT OPTIMIZER · AI CỤC BỘ</span><h2>Kế hoạch bán hàng cho từng sản phẩm</h2><p class="panel-sub">AI đọc dữ liệu của SKU đang chọn để ưu tiên chiến lược giá, quảng cáo, combo, nội dung và trải nghiệm khách hàng theo bằng chứng đã có. Kết luận cần được kiểm chứng bằng số liệu thực tế.</p><p class="sw-muted">AI hiện đọc văn bản và số liệu đã lưu, chưa đọc trực tiếp ảnh. Gợi ý ảnh và video dựa trên tên, mô tả và thuộc tính sản phẩm.</p></div></div><label class="sw-product-select">Sản phẩm<select id="sellerProductSelect">${products.map(item=>`<option value="${esc(item.sku)}" ${String(item.sku)===entry.sku?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label><div class="sw-ai-run"><div><span class="sw-tag">${esc(aiStatus(record))}</span>${record.model||plan?.model?`<small>${esc(record.model||plan.model)} · ${date(record.completed_at||(!activeAi(record.status)&&record.status!=='failed'?plan?.generated_at:null))}</small>`:''}${aiTelemetry(record)}</div><button class="btn btn-primary" data-seller-ai-generate="${esc(product.sku)}" data-seller-ai-force="${plan||failed?'true':'false'}" ${busy?'disabled':''}>${busy?'AI đang xử lý SKU này…':failed?'Thử phân tích lại bằng AI':plan?'Phân tích lại bằng AI cục bộ':'Phân tích bằng AI cục bộ'}</button>${record.status==='poll_error'&&record.job_id?`<button class="btn btn-soft" data-seller-ai-job="${esc(record.job_id)}" data-seller-sku="${esc(product.sku)}">Kiểm tra lại tác vụ</button>`:''}</div>${aiConfigPanel()}${failed||record.error?`<div class="sw-error sw-ai-failure" role="alert">${failed?'<strong>Tác vụ này chưa có kết quả AI mới được chấp nhận.</strong>':''}${record.error?`<p>${esc(record.error)}</p>`:''}${plan?'<p>Kết quả AI trước đó được giữ lại.</p>':''}${failed?'<p>Bấm “Thử phân tích lại bằng AI” để tạo tác vụ mới; dữ liệu sản phẩm được giữ nguyên.</p>':''}</div>`:''}${activeAi(record.status)?`<p class="sw-status" role="status" aria-live="polite">${progress} Bạn có thể chuyển SKU hoặc tab; kết quả sẽ được lưu đúng sản phẩm.</p>`:''}${record.stale?'<div class="sw-notice">Dữ liệu SKU đã thay đổi sau lần phân tích này. Bấm Phân tích lại để AI đọc dữ liệu mới.</div>':''}${plan?`${activeAi(record.status)||record.status==='failed'||record.status==='poll_error'?'<div class="sw-notice">Đang hiển thị kết quả AI đã lưu trước đó, chưa phải kết quả của tác vụ mới.</div>':''}<div class="sw-ai-result"><span class="sw-eyebrow">KẾT QUẢ TỪ MÔ HÌNH OLLAMA</span>${aiOverview(product,plan)}${strategies.length?`<div class="sw-plan-heading"><h3>Chiến lược AI cho ${esc(product.name||product.sku)}</h3></div>${strategyCoverage(strategies)}<div class="sw-strategy-list" data-pagination-list data-pagination-key="seller-ai-strategies-${esc(product.sku)}" data-pagination-size="10">${strategies.map((item,index)=>strategyCard(item,entry,index+1)).join('')}</div>`:''}${aiDrafts(plan,product.sku)}</div>`:empty('Chưa có kết quả AI cho SKU này','Bấm Phân tích bằng AI cục bộ sau khi Ollama sẵn sàng. Các kiểm tra bằng quy tắc vẫn có ở phía dưới.')}</section>`;
  }

  function salesPlan(entry,product) {
    const plan=product.sales_plan||{},diagnosis=list(plan.diagnosis);
    const strategies=list(plan.strategies).filter(item=>!item.sku||String(item.sku)===String(product.sku)).map(item=>({...item,sku:item.sku||product.sku})).sort(strategyOrder);
    return `<section class="panel sw-sales-plan"><div class="panel-head"><div><span class="sw-eyebrow">KIỂM TRA BẰNG QUY TẮC TỪ DATABASE</span><h3 class="panel-title">Cơ sở dữ liệu và kế hoạch theo quy tắc</h3><p class="panel-sub">${esc(typeof plan.summary==='string'?plan.summary:'Chọn sản phẩm để xem cơ sở phân tích và việc cần làm từ dữ liệu của SKU.')}</p><p class="sw-muted">Phần này dùng quy tắc và phép tính từ database; kết quả AI cục bộ được hiển thị riêng phía trên.</p></div></div>${diagnosis.length?diagnosisCards(diagnosis,'seller-diagnosis-'+product.sku):empty('Chưa có chẩn đoán bán hàng cho SKU này','Cập nhật dữ liệu sản phẩm, nội dung và báo cáo quảng cáo để có cơ sở phân tích.')}<div class="sw-plan-heading"><h3>Việc ưu tiên cho ${esc(product.name||product.sku)}</h3><p>Đọc bằng chứng, điều kiện cần và chỉ số theo dõi trước khi tạo công việc.</p></div>${strategies.length?`<div class="sw-strategy-list" data-pagination-list data-pagination-key="seller-sales-plan-${esc(product.sku)}" data-pagination-size="10">${strategies.map((item,index)=>strategyCard(item,entry,index+1)).join('')}</div>`:empty('Chưa có kế hoạch đủ cơ sở','Các thông tin còn thiếu được liệt kê ở phần chẩn đoán; chưa thể xác định việc cần triển khai cho SKU này.')}</section>${context(entry)}`;
  }

  function optimizer(entry) {
    const products=list(entry.data.products),product=currentProduct(entry);
    if(!product)return empty('Chưa có SKU để tối ưu','Quét hoặc nhập sản phẩm của shop, sau đó bổ sung nội dung và báo cáo bán hàng mà bạn có.');
    entry.sku=String(product.sku);
    const draft=inputDraft(entry,product),result=product.optimizer||{},competitors=product.competitor_range||{},busy=entry.busy.has('inputs:'+entry.sku);
    return aiPanel(entry,product,products)+salesPlan(entry,product)+`<details class="sw-cost-details" ${entry.costsOpen||busy||strings(result.errors).length?'open':''} data-seller-costs><summary>Dữ liệu quảng cáo, chi phí & kịch bản giá <span>${result.cost_complete?'Chi phí đã đủ điều kiện':'Chi phí còn thiếu'}</span></summary><section class="panel sw-optimizer"><div class="panel-head"><div><h3 class="panel-title">Bổ sung dữ liệu cùng kỳ và chi phí của SKU</h3><p class="panel-sub">Nhập báo cáo quảng cáo trong cùng 30 ngày để đối chiếu hiệu quả. Lãi theo giá cần được kiểm chứng bằng dữ liệu đơn hàng thực tế.</p></div></div><form data-seller-optimizer="${esc(entry.sku)}"><div class="sw-input-grid">${inputFields.map(([name,label,unit],index)=>`<label${index>=8?' class="sw-input-secondary"':''}>${esc(label)} <span>${unit}</span><input type="number" name="${name}" min="0" ${unit==='%'?'max="100"':''} step="${countFields.has(name)?'1':'any'}" value="${esc(draft[name])}" placeholder="Chưa cung cấp" ${busy?'disabled':''}></label>`).join('')}</div><p class="sw-muted">Để trống nghĩa là chưa biết. Chỉ nhập 0 khi bạn xác nhận khoản chi phí đó bằng 0. Phí và thuế do bạn cấu hình theo điều kiện đang áp dụng.</p><button class="btn btn-primary" type="submit" ${busy?'disabled':''}>${busy?'Đang lưu và tính…':'Lưu chi phí & phân tích kịch bản'}</button></form></section><section class="panel"><div class="panel-head"><div><h3 class="panel-title">Kịch bản giá có điều kiện</h3><p class="panel-sub">Giá hiện tại ${money(number(product.price))} · ${esc(result.confidence||'Chưa đủ dữ liệu')}</p></div><span class="sw-tag">${result.cost_complete?'Chi phí đã đủ điều kiện':'Chi phí còn thiếu'}</span></div>${strings(result.errors).length?`<div class="sw-error" role="alert">${strings(result.errors).map(esc).join(' · ')}</div>`:''}${list(result.missing).length?`<div class="sw-notice">Cần bổ sung: ${list(result.missing).map(name=>esc(inputFields.find(field=>field[0]===name)?.[1]||name)).join(', ')}.</div>`:''}<div class="sw-competitor-range"><strong>Đối thủ đã xác nhận tương đương quy cách</strong><p>${competitors.count?`${num(competitors.count)} sản phẩm · ${money(number(competitors.min))} – ${money(number(competitors.max))}`:'Chưa có sản phẩm đối thủ đủ bằng chứng tương đương để lấy khoảng giá.'}</p><small>${esc(competitors.basis||'Đối chiếu thương hiệu, chất liệu, kích thước / dung tích và quy cách combo trước khi so giá.')}${competitors.review_count?` · ${num(competitors.review_count)} ứng viên cần kiểm tra thêm`:''}</small></div><div class="sw-price-facts"><div><span>Giá hòa vốn theo điều kiện</span><strong>${money(number(result.break_even_price))}</strong></div><div><span>Giá theo biên mục tiêu</span><strong>${money(number(result.target_price))}</strong></div><div><span>Mức giảm tối đa theo điều kiện</span><strong>${number(result.max_discount_pct)==null?'—':esc(result.max_discount_pct.toFixed(2))+'%'}</strong></div></div>${list(result.scenarios).length?`<div class="sw-scenarios" data-pagination-list data-pagination-key="seller-price-scenarios">${list(result.scenarios).map(scenario=>`<article data-pagination-id="${esc(scenario.key)}"><span>${esc(scenario.label||scenario.key)}</span><h3>${money(number(scenario.price))}</h3><dl><div><dt>Phí theo giả định</dt><dd>${money(number(scenario.fee_amount))}</dd></div><div><dt>Lãi đóng góp / đơn</dt><dd>${money(number(scenario.contribution))}</dd></div><div><dt>Biên đóng góp</dt><dd>${number(scenario.margin_pct)==null?'—':esc(scenario.margin_pct.toFixed(2))+'%'}</dd></div></dl><small>${scenario.cost_complete?'Theo các chi phí đã nhập':'Kết quả có điều kiện; chưa gồm đầy đủ chi phí'}</small></article>`).join('')}</div>`:empty('Chưa tính được kịch bản giá','Bổ sung giá vốn và phí nền tảng để hệ thống tính trên dữ liệu của bạn.')}${strings(result.assumptions).length?`<ul class="sw-assumptions">${strings(result.assumptions).map(text=>`<li>${esc(text)}</li>`).join('')}</ul>`:''}${result.experiment?`<div class="sw-experiment"><h4>Thử nghiệm ${num(result.experiment.duration_days||7)} ngày</h4><p>${esc(result.experiment.action||'Ghi nhận mức giá nền, thử một thay đổi và so sánh trong cùng điều kiện.')}</p><p><strong>Theo dõi:</strong> ${strings(result.experiment.metrics).map(esc).join(' · ')||'Đơn thành công, chuyển đổi và tổng lãi đóng góp khi có dữ liệu.'}</p><p><strong>Điều kiện dừng:</strong> ${esc(result.experiment.stop||'Cần cấu hình ngưỡng dừng trước khi triển khai.')}</p></div>`:''}<p class="sw-muted">Các kịch bản không thay đổi giá trên Shopee. Thiếu chi phí quan trọng thì chưa xác định được lợi nhuận thực tế.</p></section></details>`;
  }

  function strategyEvidence(value) {
    const evidence=strings(value).filter(text=>text.trim());
    if(!evidence.length)return 'Chưa có bằng chứng bổ sung.';
    const content=evidence.map(text=>`<p>${esc(text)}</p>`).join('');
    return evidence.length>2||evidence.reduce((length,text)=>length+text.length,0)>240?`<details class="sw-strategy-evidence"><summary>${num(evidence.length)} căn cứ từ dữ liệu</summary><div>${content}</div></details>`:content;
  }

  function strategyCard(strategy,entry,rank=0) {
    const exists=list(entry.data.actions).some(action=>action.strategy_key===strategy.key&&String(action.sku||'')===String(strategy.sku||'')&&['todo','doing'].includes(action.status));
    const busy=entry.busy.has('strategy:'+strategy.key);
    const position=strategyRank(strategy)||rank;
    const badge=strategy.source==='ollama'?`AI cục bộ${position?' · #'+position:''}${tierLabel(strategy.priority_tier)?' · '+tierLabel(strategy.priority_tier):''}`:`Ưu tiên ${num(number(strategy.priority))}`;
    const unavailable=strategy.source==='ollama'&&!list(entry.data.strategies_available||entry.data.strategies).some(item=>item.key===strategy.key);
    return `<article class="sw-strategy" data-pagination-id="${esc(strategy.key)}"><div class="sw-strategy-head"><div class="sw-strategy-badges"><span class="sw-tag">${esc(badge)}</span>${strategy.channel?`<span class="sw-strategy-channel">${esc(channelLabel(strategy.channel))}</span>`:''}</div><span>${esc(strategy.confidence_label||strategy.confidence||'Chưa đủ dữ liệu')}${strategy.status?` · ${esc(planStatus(strategy.status))}`:''}</span></div><h3>${esc(strategy.title)}</h3><p>${esc(strategy.body||'')}</p><dl><div><dt>Cơ sở phân tích</dt><dd>${strategyEvidence(strategy.evidence)}</dd></div>${strings(strategy.steps).length?'':`<div><dt>Kế hoạch hành động</dt><dd>${esc(strategy.action||'Cần bổ sung kế hoạch thực hiện.')}</dd></div>`}${planDetails(strategy)}<div><dt>Điều kiện dừng</dt><dd>${esc(strategy.stop||'Cần xác định ngưỡng dừng trước khi triển khai.')}</dd></div></dl><div class="sw-card-actions"><button class="btn btn-primary btn-sm" data-seller-create-action="${esc(strategy.key)}" data-seller-sku="${esc(strategy.sku||'')}" ${exists||busy||unavailable?'disabled':''}>${exists?'Đã có trong Action Center':busy?'Đang lưu…':unavailable?'Phân tích lại trước khi tạo việc':'Thêm vào Action Center'}</button>${strategy.sku?`<button class="btn btn-soft btn-sm" data-seller-optimize="${esc(strategy.sku)}">Mở SKU →</button>`:''}</div></article>`;
  }

  function strategies(entry,forActions=false) {
    const all=entry.sku?list(entry.data.strategies_available||entry.data.strategies):list(entry.data.strategies),items=entry.sku?all.filter(item=>String(item.sku||'')===entry.sku):all;
    return context(entry)+`<section class="panel"><div class="panel-head"><div><span class="sw-eyebrow">${forActions?'BƯỚC TIẾP THEO':'AI STRATEGY ENGINE'}</span><h2>${forActions?'Tạo công việc từ chiến lược đã có cơ sở':'Chiến lược ưu tiên cho shop'}</h2><p class="panel-sub">Ưu tiên nội bộ từ tác động, độ tin cậy, tính cấp thiết và công sức; không phải dự báo lợi nhuận.</p><p class="sw-muted">Chiến lược có nhãn AI cục bộ được sinh bằng Ollama; các mục khác là quy tắc từ database. Nếu chưa có kết quả AI, mở SKU và bấm Phân tích bằng AI cục bộ. Chưa kết nối Google Trends / TikTok.</p></div></div>${items.length?`<div class="sw-strategy-list" data-pagination-list data-pagination-key="seller-strategies" data-pagination-size="10">${items.map((item,index)=>strategyCard(item,entry,index+1)).join('')}</div>`:empty('Chưa có chiến lược phù hợp','Bổ sung dữ liệu SKU, chi phí hoặc các báo cáo bán hàng để xác định việc cần ưu tiên.')}</section>`;
  }

  function actions(entry) {
    const all=list(entry.data.actions),items=entry.sku?all.filter(action=>String(action.sku||'')===entry.sku):all;
    return context(entry)+`<section class="panel"><div class="panel-head"><div><span class="sw-eyebrow">ACTION CENTER</span><h2>Từ phân tích đến công việc có thể theo dõi</h2><p class="panel-sub">Lưu trạng thái, thời điểm và ghi chú thay đổi để đối chiếu với dữ liệu sau 7 hoặc 14 ngày.</p></div><button class="btn btn-soft" data-seller-view="strategy">Chọn chiến lược →</button></div>${items.length?`<div class="table-wrap"><table class="data-table sw-actions" data-pagination-key="seller-actions"><thead><tr><th>Công việc / cơ sở</th><th>Ưu tiên / thời hạn</th><th>Trạng thái</th><th>Ghi chú thực hiện</th><th>Mốc theo dõi</th></tr></thead><tbody>${items.map(action=>`<tr data-pagination-id="${esc(action.id)}"><td><strong>${esc(action.title)}</strong><p>${esc(action.description||'')}</p>${action.plan&&Object.keys(action.plan).length?`<details class="sw-action-plan"><summary>Kế hoạch đã lưu cùng công việc</summary><dl>${planDetails(action.plan)}${action.plan.stop?`<div><dt>Điều kiện dừng</dt><dd>${esc(action.plan.stop)}</dd></div>`:''}</dl></details>`:''}<small>SKU ${esc(action.sku||'Toàn shop')} · ${esc(action.confidence||'Chưa đủ dữ liệu')}</small></td><td>${num(number(action.priority))}<small>${date(action.due_at)}</small></td><td><select data-seller-action-status="${esc(action.id)}" ${entry.busy.has('action:'+action.id)?'disabled':''}>${[['todo','Chưa thực hiện'],['doing','Đang thực hiện'],['done','Hoàn thành']].map(([value,label])=>`<option value="${value}" ${action.status===value?'selected':''}>${label}</option>`).join('')}</select></td><td><textarea data-seller-action-notes="${esc(action.id)}" placeholder="Thay đổi đã áp dụng, thời điểm và điều kiện thử nghiệm">${esc(entry.notes.get(String(action.id))??action.notes??'')}</textarea><button class="btn btn-soft btn-sm" data-seller-save-action="${esc(action.id)}" ${entry.busy.has('action:'+action.id)?'disabled':''}>Lưu ghi chú</button></td><td><small>Tạo ${date(action.created_at)}</small><small>Bắt đầu ${date(action.started_at)}</small><small>Hoàn thành ${date(action.completed_at)}</small></td></tr>`).join('')}</tbody></table></div>`:empty('Chưa có công việc đang theo dõi','Chọn một chiến lược, đọc cơ sở và kế hoạch rồi thêm vào Action Center.')}</section>${!items.length?strategies(entry,true):''}`;
  }

  function reports(entry,id) {
    const items=list(entry.data.reports),busy=entry.busy.has('report');
    return `<section class="panel"><div class="panel-head"><div><span class="sw-eyebrow">REPORTS</span><h2>Đo thay đổi từ các mốc dữ liệu</h2><p class="panel-sub">Báo cáo mô tả biến động trước / sau. Khi không có nhóm đối chứng, không quy toàn bộ cải thiện cho AI.</p></div></div><div class="sw-report-controls"><label>Khoảng theo dõi<select id="sellerReportPeriod"><option value="7" ${entry.reportDays===7?'selected':''}>7 ngày</option><option value="14" ${entry.reportDays===14?'selected':''}>14 ngày</option></select></label><button class="btn btn-primary" data-seller-create-report ${busy?'disabled':''}>${busy?'Đang tạo báo cáo…':'Tạo báo cáo từ database'}</button></div><p class="sw-muted">Bản ghi hiện tại là mốc nền khi chưa đủ lịch sử. Báo cáo công việc tự đối chiếu khi có dữ liệu đến hạn.</p></section>${items.length?`<div class="sw-report-list" data-pagination-list data-pagination-key="seller-reports" data-pagination-size="10">${items.map(report=>`<article class="panel sw-report" data-pagination-id="${esc(report.id)}"><div class="panel-head"><div><h3 class="panel-title">${esc(report.title||'Báo cáo shop')}</h3><p class="panel-sub">${date(report.created_at)} · ${num(report.period_days)} ngày · ${report.kind==='action_review'?'Theo dõi công việc':'Bản ghi không gian phân tích'}</p></div><span class="sw-tag">${({snapshot:'Mốc dữ liệu',comparison:'Có đối chiếu',insufficient:'Chưa đủ dữ liệu'})[report.status]||esc(report.status||'Chưa đủ dữ liệu')}</span></div>${list(report.comparison).length?`<div class="table-wrap"><table class="data-table" data-pagination-key="seller-report-${esc(report.id)}"><thead><tr><th>Chỉ số</th><th>Trước</th><th>Sau</th><th>Chênh lệch</th><th>Thay đổi</th></tr></thead><tbody>${list(report.comparison).map(item=>`<tr data-pagination-id="${esc(item.metric)}"><td>${esc(metricLabels[item.metric]||item.metric)}</td><td>${metric(item.metric,item.before)}</td><td>${metric(item.metric,item.after)}</td><td>${metric(item.metric,item.delta)}</td><td>${number(item.delta_pct)==null?'—':esc((item.delta_pct>0?'+':'')+item.delta_pct.toFixed(2))+'%'}</td></tr>`).join('')}</tbody></table></div>`:empty('Chưa có dữ liệu trước / sau đủ điều kiện','Giữ bản ghi làm mốc và bổ sung báo cáo ở các ngày tiếp theo.')}${strings(report.limitations).length?`<ul class="sw-assumptions">${strings(report.limitations).map(text=>`<li>${esc(text)}</li>`).join('')}</ul>`:''}<div class="sw-card-actions"><a class="btn btn-white btn-sm" href="/api/seller/reports/${encodeURIComponent(report.id)}/export${query(id)}&format=json">↓ JSON</a><a class="btn btn-soft btn-sm" href="/api/seller/reports/${encodeURIComponent(report.id)}/export${query(id)}&format=html" target="_blank" rel="noopener">Mở báo cáo HTML ↗</a></div></article>`).join('')}</div>`:empty('Chưa có lịch sử báo cáo','Tạo bản ghi hiện tại hoặc theo dõi công việc để có mốc đối chiếu sau 7 / 14 ngày.')}`;
  }

  function myShops() {
    const shops=list(S.shops);
    return `<section class="panel sw-shop-hero"><span class="sw-eyebrow">MY SHOPS</span><h2>Shop được cấp quyền phân tích</h2><p>Chọn shop được cấp quyền để phân tích sản phẩm, chi phí và công việc. System quản lý nguồn dữ liệu cho từng shop.</p>${!window.MarketLensAuth||window.MarketLensAuth.canCollect?'<button class="btn btn-primary" id="sellerAddShop">+ Thêm shop</button>':''}</section>${shops.length?`<div class="sw-shops" data-pagination-list data-pagination-key="seller-shops">${shops.map(item=>`<article class="panel" data-pagination-id="${esc(item.id)}"><div><span class="sw-tag">${item.is_demo?'Dữ liệu minh họa':'Shop cục bộ'}</span><h3>${esc(item.name)}</h3><p>${source(item.url,item.url)}</p><small>${esc(item.category||'Chưa xác định ngành hàng')}</small></div><button class="btn ${String(item.id)===currentId()?'btn-soft':'btn-primary'}" data-seller-shop="${esc(item.id)}">${String(item.id)===currentId()?'Đang chọn · mở phân tích':'Phân tích shop →'}</button></article>`).join('')}</div>`:empty('Chưa được cấp quyền shop','Người quản trị System cần gán shop cho tài khoản này trong Tài khoản & quyền shop.')}`;
  }

  function renderView(view,data=S.data) {
    if(view==='myShops')return `<div class="seller-workspace">${myShops()}</div>`;
    if(!views.has(view))return '';
    const id=currentId();if(!id)return empty('Chọn shop để bắt đầu','Mở My Shops để chọn hoặc tạo không gian shop của bạn.');
    const entry=ensure(id,data);if(view==='optimizer')ensureAiConnection();const isDemo=!!(entry.data?.is_demo||shop()?.is_demo);
    const header=`<div class="sw-toolbar"><p>${esc(shop()?.name||'Shop đang phân tích')} · ${entry.loading?'Đang cập nhật từ database…':'Dữ liệu của shop đang chọn'}</p><button class="btn btn-white btn-sm" data-seller-refresh ${entry.loading?'disabled':''}>${entry.error?'↻ Thử lại':'↻ Cập nhật phân tích'}</button></div>${isDemo?'<div class="sw-notice">DỮ LIỆU MINH HỌA · Các số liệu ở không gian này không phải kết quả kinh doanh thực tế.</div>':''}${entry.error?`<div class="sw-error" role="alert">${esc(entry.error)}${entry.data?' · Dữ liệu đã có được giữ lại.':''}</div>`:''}${entry.message?`<p class="sw-status" role="status" aria-live="polite">${esc(entry.message)}</p>`:''}`;
    if(!entry.data)return `<div class="seller-workspace">${header}${empty(entry.loading||entry.scheduled?'Đang đọc dữ liệu shop…':'Chưa tải được phân tích','Dữ liệu được đọc từ database của shop; chưa có số liệu sẽ hiển thị là thiếu.')}</div>`;
    const renderers={shopAnalysis,optimizer,strategy:entry=>strategies(entry,false),actions,reports};
    return `<div class="seller-workspace">${header}${renderers[view](entry,id)}</div>`;
  }

  function overview(data) {
    adopt(data);const entry=entryFor(currentId()),analysis=entry.data||data?.seller_analysis;if(!analysis)return '';
    return `<div class="seller-workspace sw-overview">${healthPanel(analysis)}<section class="panel"><div class="panel-head"><div><h3 class="panel-title">Việc ưu tiên từ dữ liệu shop</h3><p class="panel-sub">Đọc bằng chứng, chọn thử nghiệm và theo dõi trong Action Center</p></div><button class="btn btn-soft" data-seller-view="strategy">Xem tất cả →</button></div><div class="sw-overview-strategies">${list(analysis.strategies).slice(0,3).map((strategy,index)=>strategyCard(strategy,entry,index+1)).join('')||empty('Chưa có việc ưu tiên','Bổ sung dữ liệu sản phẩm và chi phí để có cơ sở đề xuất.')}</div></section></div>`;
  }

  function openProduct(sku,view='optimizer') {
    const entry=entryFor(currentId());entry.sku=String(sku||'');
    document.getElementById('productDetailDialog')?.close();
    setView(views.has(view)?view:'optimizer');
  }

  async function selectShop(id) {
    if(!list(S.shops).some(item=>String(item.id)===id))return;
    S.shopId=id;const select=document.getElementById('shopSelect');if(select)select.value=id;
    if(typeof loadReport==='function')await loadReport(false);
    if(currentId()===id)setView('shopAnalysis');
  }

  document.addEventListener('input',event=>{
    const target=event.target,entry=entryFor(currentId());
    if('intelligencePriceField'in target.dataset){window.MarketLensProductPrice?.input(target,intelligenceContext(entry));return;}
    if(target.dataset.sellerActionNotes)entry.notes.set(String(target.dataset.sellerActionNotes),target.value);
    const form=target.closest('form[data-seller-optimizer]');
    if(form&&fieldNames.has(target.name)){
      const product=list(entry.data?.products).find(item=>String(item.sku)===form.dataset.sellerOptimizer);
      if(product)inputDraft(entry,product)[target.name]=target.value;
    }
  });

  document.addEventListener('change',async event=>{
    const target=event.target,entry=entryFor(currentId());
    if(target.id==='sellerIntelligenceSku'){entry.intelligenceSku=target.value;redraw(currentId());return;}
    if(target.id==='sellerProductSelect'){entry.sku=target.value;redraw(currentId());}
    if(target.id==='sellerReportPeriod'&&[7,14].includes(Number(target.value)))entry.reportDays=Number(target.value);
    if(target.dataset.sellerActionStatus){
      const id=String(target.dataset.sellerActionStatus),status=target.value;
      if(!['todo','doing','done'].includes(status))return;
      await mutate('action:'+id,async(e,shopId)=>{await sellerApi('/api/seller/actions/'+encodeURIComponent(id)+query(shopId),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,notes:e.notes.get(id)??list(e.data.actions).find(action=>String(action.id)===id)?.notes??''})});e.message='Đã lưu trạng thái công việc.';});
    }
  });

  document.addEventListener('keydown',event=>{
    const button=event.target.closest?.('[data-seller-intelligence-module]');
    if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const entry=entryFor(currentId()),modes=intelligenceModules.map(([mode])=>mode),index=modes.indexOf(button.dataset.sellerIntelligenceModule);
    event.preventDefault();entry.intelligenceModule=event.key==='Home'?modes[0]:event.key==='End'?modes.at(-1):modes[(index+(event.key==='ArrowRight'?1:-1)+modes.length)%modes.length];
    redraw(currentId());document.getElementById('sellerModule-'+entry.intelligenceModule)?.focus?.();
  });

  document.addEventListener('toggle',event=>{
    if(event.target?.dataset&&'sellerCosts'in event.target.dataset&&event.target.isConnected!==false)entryFor(currentId()).costsOpen=!!event.target.open;
  },true);

  document.addEventListener('submit',async event=>{
    const form=event.target;
    if('sellerAiConfig'in form.dataset){event.preventDefault();return;}
    if(!form.matches('form[data-seller-optimizer]'))return;
    event.preventDefault();const sku=String(form.dataset.sellerOptimizer),inputs={};
    for(const [name]of inputFields){const value=form.querySelector(`[name="${name}"]`)?.value??'';const parsed=value.trim()===''?null:Number(value);if(parsed!==null&&(!Number.isFinite(parsed)||parsed<0||(name.endsWith('_pct')&&parsed>100)||(countFields.has(name)&&!Number.isInteger(parsed)))){entryFor(currentId()).error='Nhập chi phí không âm, tỷ lệ 0–100%; số đơn và lượt truy cập phải là số nguyên. Hiển thị, nhấp và đơn từ quảng cáo cũng phải là số nguyên.';redraw(currentId());return;}inputs[name]=parsed;}
    await mutate('inputs:'+sku,async(entry,id)=>{
      await sellerApi('/api/seller/products/'+encodeURIComponent(sku)+'/inputs'+query(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(inputs)});
      await sellerApi('/api/seller/optimize'+query(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku,inputs})});
      entry.drafts.set(sku,Object.fromEntries(inputFields.map(([name])=>[name,inputs[name]==null?'':String(inputs[name])])));entry.message='Đã lưu chi phí và cập nhật phân tích kịch bản.';
    });
  });

  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    const d=button.dataset,entry=entryFor(currentId());
    if(d.sellerShop)return selectShop(d.sellerShop);
    if('sellerAiShopRun'in d)return startShopAi(currentId(),!!shopAiState(entry).data?.result);
    if(d.sellerIntelligenceModule){
      if(!intelligenceModules.some(([mode])=>mode===d.sellerIntelligenceModule))return;
      entry.intelligenceModule=d.sellerIntelligenceModule;redraw(currentId());return;
    }
    if(window.MarketLensProductPrice?.click(button,intelligenceContext(entry)))return;
    if(window.MarketLensShopMarket?.click?.(button,intelligenceContext(entry)))return;
    if(button.id==='sellerAddShop'){document.getElementById('newShopButton')?.click();return;}
    if(d.sellerView){if('sellerResetSku'in d)entry.sku='';setView(d.sellerView);return;}
    if(d.sellerSegment){
      if(d.sellerSegment!=='all'&&!shopGroups.some(group=>group.key===d.sellerSegment))return;
      entry.segment=d.sellerSegment;redraw(currentId());
      document.getElementById('sellerShopProducts')?.scrollIntoView?.({behavior:'smooth',block:'start'});return;
    }
    if(d.sellerOptimize)return openProduct(d.sellerOptimize,'optimizer');
    if(d.sellerStrategy)return openProduct(d.sellerStrategy,'strategy');
    if(d.sellerTask)return openProduct(d.sellerTask,'actions');
    if(d.sellerDetail){const product=list(S.data?.own_products).find(item=>String(item.sku)===d.sellerDetail)||list(entry.data?.products).find(item=>String(item.sku)===d.sellerDetail);if(product)showProductDetail(product);return;}
    if('sellerClear'in d){entry.sku='';redraw(currentId());return;}
    if('sellerRefresh'in d)return refresh();
    if('sellerAiConfigRefresh'in d)return refreshAiConfig();
    if(d.sellerAiGenerate)return generateAi(currentId(),d.sellerAiGenerate,d.sellerAiForce==='true');
    if(d.sellerAiJob){
      const id=currentId(),sku=String(d.sellerSku||''),product=list(entry.data?.products).find(item=>String(item.sku)===sku);if(!product)return;
      const record={...aiRecord(entry,product),job_id:d.sellerAiJob,status:'queued',phase:'queued',error:''},job={key:id+':'+d.sellerAiJob,id,sku,record};
      entry.aiResults.set(sku,record);ai.jobs.set(job.key,job);redraw(id);await readAiJob(job);scheduleAiPoll();return;
    }
    if(d.sellerAiCopy){
      const id=currentId(),product=list(entry.data?.products).find(item=>String(item.sku)===String(d.sellerSku||''));if(!product)return;
      const drafts=aiPlan(entry,product)?.listing_drafts||{},[key,index]=d.sellerAiCopy.split(':');
      const text=key==='description'&&typeof drafts.description==='string'?drafts.description:key==='titles'&&Number.isInteger(Number(index))?strings(drafts.titles)[Number(index)]:['image_briefs','video_script'].includes(key)?strings(drafts[key]).join('\n'):'';
      if(!text)return;
      try{if(typeof navigator==='undefined'||!navigator.clipboard?.writeText)throw new Error('Trình duyệt chưa hỗ trợ sao chép tự động. Chọn nội dung bản nháp và sao chép thủ công.');await navigator.clipboard.writeText(text);entry.message='Đã sao chép bản nháp. Kiểm tra nội dung trước khi sử dụng.';}
      catch(error){entry.error=error.message||'Chưa sao chép được nội dung.';}redraw(id);return;
    }
    if(d.sellerCreateAction){
      const key=d.sellerCreateAction,sku=d.sellerSku||undefined;
      return mutate('strategy:'+key,async(e,id)=>{await sellerApi('/api/seller/actions'+query(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy_key:key,...(sku?{sku}:{})})});e.message='Đã thêm công việc vào Action Center.';});
    }
    if(d.sellerSaveAction){
      const id=d.sellerSaveAction,action=list(entry.data?.actions).find(item=>String(item.id)===id);if(!action)return;
      return mutate('action:'+id,async(e,shopId)=>{await sellerApi('/api/seller/actions/'+encodeURIComponent(id)+query(shopId),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:action.status,notes:e.notes.get(id)??action.notes??''})});e.message='Đã lưu ghi chú thay đổi.';});
    }
    if('sellerCreateReport'in d)return mutate('report',async(e,id)=>{await sellerApi('/api/seller/reports'+query(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period_days:e.reportDays})});e.message='Đã lưu báo cáo từ dữ liệu hiện tại.';});
  });

  window.MarketLensSeller=Object.freeze({render:renderView,refresh,openProduct,overview});
})();
