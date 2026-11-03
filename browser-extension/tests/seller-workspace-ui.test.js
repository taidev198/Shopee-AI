import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../static/seller-workspace.js',import.meta.url),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value==null?'—':new Intl.NumberFormat('vi-VN').format(value);
function analysis(extra={}) {
  return {is_demo:false,summary:{product_count:2,revenue_30d:null,revenue_basis:'Chưa có báo cáo 30 ngày',units_30d:null,orders_30d:null,contribution_30d:null,eligible_count:0,coverage:{cost_complete:0}},
    health:{score:45,confidence:'Thấp',issues:['Chưa có chi phí đủ điều kiện.']},
    products:[{sku:'12.34',name:'Rây inox',category:'Gia dụng',price:99000,inputs:{},metrics:{orders_30d:null,units_30d:20,contribution_per_order:null},health:{score:40,confidence:'Thấp'},segment:'unknown',segment_label:'Chưa đủ dữ liệu phân nhóm',optimizer:{ready:false,missing:['unit_cost','platform_fee_pct'],cost_complete:false,actual_profit:null,scenarios:[],confidence:'Thấp'}},
      {sku:'12.35',name:'Bình nước',category:'Gia dụng',price:199000,inputs:{},metrics:{},health:{score:null},segment:'unknown',segment_label:'Chưa đủ dữ liệu phân nhóm',optimizer:{ready:false,missing:['unit_cost'],scenarios:[]}}],
    strategies:[{key:'cost-12.34',sku:'12.34',title:'Đối soát giá vốn',body:'Bổ sung chi phí trước khi thử giá.',evidence:['Giá vốn chưa được cung cấp.'],action:'Đối soát với hóa đơn và lưu chi phí.',stop:'Chưa đổi giá khi chưa đủ dữ liệu.',confidence:.7,confidence_label:'Trung bình',priority:1.2},
      {key:'cost-12.35',sku:'12.35',title:'Kiểm tra chi phí bình',evidence:[],action:'Nhập chi phí.',stop:'Chờ dữ liệu.',confidence_label:'Thấp',priority:.8}],
    actions:[],reports:[],...extra};
}

function setup({data=analysis(),apiHandler,embedded=true,authRole,numFormatter=number}={}) {
  const listeners={},requests=[],scheduled=[],renders=[],views=[],nodes={},details=[],copied=[],timers=new Map();let nextTimer=0;
  const state={shopId:'shop-a',view:'shopAnalysis',shops:[{id:'shop-a',name:'Shop A',url:'https://shopee.vn/shop_a',is_demo:false},{id:'shop-b',name:'Shop B',url:'https://shopee.vn/shop_b',is_demo:false}],data:{shop:{id:'shop-a',name:'Shop A',is_demo:false},own_products:data.products,...(embedded?{seller_analysis:data}:{})}};
  const context=vm.createContext({window:authRole?{MarketLensAuth:{isSystem:authRole==='system',canCollect:authRole==='system'}}:{},S:state,URL,Map,Set,Date,Number,String,Array,Object,Promise,Intl,AbortController,
    esc:escape,num:numFormatter,money:value=>value==null?'—':number(value)+' ₫',kpi:(title,value,hint)=>`<article>${escape(title)}:${value}<small>${escape(hint)}</small></article>`,
    document:{addEventListener(type,callback){listeners[type]=callback;},getElementById:id=>nodes[id]||null},
    navigator:{clipboard:{writeText:async text=>copied.push(text)}},
    setTimeout(callback,delay=0){const id=++nextTimer,fire=()=>{timers.delete(id);return callback();};timers.set(id,{callback:fire,delay});if(!delay)scheduled.push(fire);return id;},clearTimeout(id){timers.delete(id);},render(){renders.push(state.shopId);},
    setView(view){state.view=view;views.push(view);},loadReport:async()=>{},showProductDetail:product=>details.push(product),
    api:async(path,options)=>{requests.push({path,options,body:options?.body?JSON.parse(options.body):null});return apiHandler?apiHandler(path,options):data;},
  });
  vm.runInContext(source,context);const seller=context.window.MarketLensSeller;
  const click=async(dataset={},id='')=>listeners.click({target:{closest:()=>({id,dataset,disabled:false})}});
  const change=async(target)=>listeners.change({target:{dataset:{},...target}});
  const input=target=>listeners.input({target:{dataset:{},closest:()=>null,...target}});
  const submit=async(sku,values={})=>listeners.submit({preventDefault(){},target:{dataset:{sellerOptimizer:sku},matches:()=>true,querySelector:selector=>({value:String(values[selector.match(/name="([^"]+)"/)[1]]??'')})}});
  const expireRequest=()=>{const timer=[...timers].find(([,timer])=>timer.delay===20000);assert.ok(timer,'a bounded request deadline exists');timers.delete(timer[0]);timer[1].callback();};
  const pollAi=async()=>{const timer=[...timers].find(([,timer])=>timer.delay===2000);assert.ok(timer,'one bounded AI polling timer exists');timers.delete(timer[0]);await timer[1].callback();};
  const submitAiConfig=async()=>listeners.submit({preventDefault(){},target:{dataset:{sellerAiConfig:''}}});
  const toggleCosts=open=>listeners.toggle({target:{dataset:{sellerCosts:''},open,isConnected:true}});
  return {context,state,seller,requests,scheduled,renders,views,nodes,details,copied,timers,expireRequest,pollAi,submitAiConfig,toggleCosts,click,change,input,submit,html:view=>seller.render(view||state.view,state.data)};
}

test('embedded seller analysis renders immediately without an extra API or invented profit and orders',()=>{
  const app=setup();const html=app.html();
  assert.match(html,/SHOP HEALTH SCORE/);assert.match(html,/45/);
  assert.match(html,/Đơn thành công:—/);
  assert.match(html,/Lãi đóng góp 30 ngày:—/);
  assert.match(html,/Rây inox/);
  assert.equal(app.requests.length,0);assert.equal(app.scheduled.length,0);
});

test('optimizer leaves unknown costs blank and never turns units into orders or missing costs into zero',()=>{
  const app=setup();const html=app.html('optimizer');
  assert.match(html,/name="unit_cost"[^>]*value=""/);
  assert.match(html,/name="platform_fee_pct"[^>]*value=""/);
  assert.match(html,/name="orders_30d"[^>]*value=""/);
  assert.match(html,/Chỉ nhập 0 khi bạn xác nhận/);
  assert.match(html,/chưa xác định được lợi nhuận thực tế/);
  assert.match(html,/Chưa tính được kịch bản giá/);
});

test('saving explicit costs calls the real inputs and optimization endpoints then retains the fresh response over the old embedded object',async()=>{
  const base=analysis(),updated=analysis();
  updated.products[0].optimizer={ready:true,cost_complete:false,confidence:'Có điều kiện',missing:[],break_even_price:80000,target_price:110000,max_discount_pct:10,
    scenarios:[{key:'lower',label:'Giá thấp hơn',price:89000,contribution:13650,margin_pct:15.34,fee_amount:13350,cost_complete:false},{key:'current',label:'Giá hiện tại',price:99000,contribution:22150,margin_pct:22.37,fee_amount:14850,cost_complete:false},{key:'higher',label:'Thử giá cao hơn',price:109000,contribution:30650,margin_pct:28.12,fee_amount:16350,cost_complete:false}]};
  const app=setup({data:base,apiHandler:async(path,options)=>options?.method?{}:updated});app.html('optimizer');
  await app.submit('12.34',{unit_cost:45000,platform_fee_pct:15,packaging_cost:5000,ad_cost_per_order:12000});
  assert.deepEqual(app.requests.map(request=>request.path),['/api/seller/products/12.34/inputs?shop_id=shop-a','/api/seller/optimize?shop_id=shop-a','/api/seller/analysis?shop_id=shop-a']);
  assert.equal(app.requests[0].options.method,'PUT');assert.equal(app.requests[1].options.method,'POST');
  assert.equal(app.requests[0].body.unit_cost,45000);assert.equal(app.requests[0].body.tax_pct,null);assert.equal(app.requests[0].body.orders_30d,null);
  const html=app.html('optimizer');
  assert.match(html,/30\.650 ₫/);assert.match(html,/Có điều kiện/);assert.match(html,/chi phí còn thiếu/i);
  assert.match(html,/name="unit_cost"[^>]*value="45000"/);
});

test('derived ad allocation stays an input blank so changing successful orders can recompute it',()=>{
  const data=analysis();data.products[0].inputs={ad_cost_per_order:12000,ad_spend:120000,orders_30d:10,ad_allocation_basis:'ad_spend_divided_by_successful_orders'};
  const app=setup({data});const html=app.html('optimizer');
  assert.match(html,/name="ad_cost_per_order"[^>]*value=""/);
  assert.match(html,/name="ad_spend"[^>]*value="120000"/);
  assert.match(html,/name="orders_30d"[^>]*value="10"/);
});

test('invalid costs and fractional order counts do not reach the backend',async()=>{
  for(const values of [{unit_cost:-1},{platform_fee_pct:101},{orders_30d:1.5}]){
    const app=setup();app.html('optimizer');await app.submit('12.34',values);
    assert.equal(app.requests.length,0);assert.match(app.html('optimizer'),/số đơn và lượt truy cập phải là số nguyên/);
  }
});

test('optimizer renders impossible-target errors and uses only verified equivalent competitor prices',()=>{
  const data=analysis();data.products[0].optimizer.errors=['Biên mục tiêu không khả thi.'];
  data.products[0].competitor_range={count:0,candidate_count:10,review_count:10,min:null,max:null,basis:'Cần đối chiếu kích thước.'};
  const app=setup({data});const html=app.html('optimizer');
  assert.match(html,/Biên mục tiêu không khả thi/);
  assert.match(html,/Chưa có sản phẩm đối thủ đủ bằng chứng tương đương/);
  assert.match(html,/10 ứng viên cần kiểm tra thêm/);
});

test('SKU context moves between optimizer, strategy and actions without selecting a different product',async()=>{
  const app=setup();app.html();
  await app.click({sellerOptimize:'12.35'});assert.equal(app.state.view,'optimizer');
  assert.match(app.html(),/value="12\.35" selected/);
  await app.click({sellerStrategy:'12.35'});const html=app.html();
  assert.match(html,/AI STRATEGY ENGINE/);assert.match(html,/Kiểm tra chi phí bình/);assert.doesNotMatch(html,/Đối soát giá vốn/);
  await app.click({sellerTask:'12.35'});assert.equal(app.state.view,'actions');
  assert.match(app.html(),/Bình nước/);
});

test('strategy creation persists the exact key and SKU, and only unfinished tasks disable the create button',async()=>{
  let saved=false;const data=analysis();
  const app=setup({data,apiHandler:async(path,options)=>{if(options?.method==='POST'){saved=true;return {id:'action-a'};}return analysis({actions:saved?[{id:'action-a',strategy_key:'cost-12.34',sku:'12.34',status:'todo'}]:[]});}});
  app.html('strategy');await app.click({sellerCreateAction:'cost-12.34',sellerSku:'12.34'});
  assert.equal(app.requests[0].path,'/api/seller/actions?shop_id=shop-a');
  assert.deepEqual(app.requests[0].body,{strategy_key:'cost-12.34',sku:'12.34'});
  assert.match(app.html('strategy'),/Đã có trong Action Center/);
  const completed=analysis({actions:[{id:'done-action',strategy_key:'cost-12.34',sku:'12.34',status:'done'}]});
  const done=setup({data:completed});assert.doesNotMatch(done.html('strategy'),/Đã có trong Action Center/);
});

test('action status and implementation notes are saved to their own shop through PATCH',async()=>{
  const action={id:'a1',strategy_key:'cost-12.34',sku:'12.34',title:'Đối soát',status:'todo',notes:'',priority:1,confidence:'Trung bình'};
  const app=setup({data:analysis({actions:[action]})});app.html('actions');
  app.input({dataset:{sellerActionNotes:'a1'},value:'Đã đối soát hóa đơn 15/10.'});
  await app.change({dataset:{sellerActionStatus:'a1'},value:'doing'});
  assert.equal(app.requests[0].path,'/api/seller/actions/a1?shop_id=shop-a');
  assert.equal(app.requests[0].options.method,'PATCH');
  assert.deepEqual(app.requests[0].body,{status:'doing',notes:'Đã đối soát hóa đơn 15/10.'});
  assert.match(app.html('actions'),/Đã lưu trạng thái công việc/);
});

test('report creation uses the selected 14-day interval and exports actual saved report IDs',async()=>{
  const report={id:'report-a',title:'Đối chiếu 14 ngày',period_days:14,kind:'action_review',status:'comparison',created_at:'2026-10-15T09:00:00+07:00',comparison:[{metric:'orders_30d',before:10,after:12,delta:2,delta_pct:20}],limitations:['Chưa có nhóm đối chứng.']};
  const app=setup({apiHandler:async(path,options)=>options?.method?report:analysis({reports:[report]})});app.html('reports');
  await app.change({id:'sellerReportPeriod',value:'14'});await app.click({sellerCreateReport:''});
  assert.equal(app.requests[0].path,'/api/seller/reports?shop_id=shop-a');assert.deepEqual(app.requests[0].body,{period_days:14});
  const html=app.html('reports');
  assert.match(html,/report-a\/export\?shop_id=shop-a&format=json/);
  assert.match(html,/\+20\.00%/);assert.match(html,/không quy toàn bộ cải thiện cho AI/);
});

test('unsafe names, notes, source URLs, strategy evidence and report text are escaped',()=>{
  const data=analysis();data.products[0].name='<img onerror=bad()>';data.strategies[0].title='<script>bad()</script>';data.strategies[0].evidence=['<img src=x>'];
  data.actions=[{id:'a',title:'<b>task</b>',status:'todo',notes:'</textarea><script>bad()</script>'}];
  const app=setup({data});app.state.shops[0].url='javascript:alert(1)';
  const combined=app.html('shopAnalysis')+app.html('strategy')+app.html('actions')+app.html('myShops');
  assert.match(combined,/&lt;img onerror=bad\(\)&gt;/);assert.match(combined,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(combined,/<script>|<img onerror|href="javascript:/);
});

test('late shop requests are cached for their own shop and never overwrite the newly selected shop',async()=>{
  let finish;
  const app=setup({embedded:false,apiHandler:async()=>new Promise(resolve=>{finish=resolve;})});
  app.html();assert.equal(app.scheduled.length,1);
  const old=app.scheduled[0]();
  app.state.shopId='shop-b';app.state.data={shop:{id:'shop-b',name:'Shop B'},seller_analysis:analysis({health:{score:99,confidence:'Cao'}})};
  assert.match(app.html(),/>99<small>/);
  const renders=app.renders.length;finish(analysis({health:{score:12}}));await old;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.renders.length,renders);assert.match(app.html(),/>99<small>/);assert.doesNotMatch(app.html(),/>12<small>/);
});

test('overview uses embedded data synchronously and demo workspaces are clearly labeled',()=>{
  const app=setup({data:analysis({is_demo:true})});
  assert.match(app.seller.overview(app.state.data),/SHOP HEALTH SCORE/);
  assert.equal(app.requests.length,0);
  assert.match(app.html('shopAnalysis'),/DỮ LIỆU MINH HỌA/);
  const fresh=setup({embedded:false});assert.equal(fresh.seller.overview(fresh.state.data),'');assert.equal(fresh.requests.length,0);
});

test('all six workspace views expose stable pagination keys for their actual lists',()=>{
  const app=setup({data:analysis({actions:[{id:'a1',title:'Công việc',status:'todo'}],reports:[{id:'r1',period_days:7,status:'snapshot'}]})});
  for(const [view,key]of [['myShops','seller-shops'],['shopAnalysis','seller-products'],['strategy','seller-strategies'],['actions','seller-actions'],['reports','seller-reports']])assert.match(app.html(view),new RegExp(`data-pagination-key="${key}"`));
});

test('a failed initial load stays visible without an automatic retry loop and the explicit retry recovers',async()=>{
  let fail=true;
  const app=setup({embedded:false,apiHandler:async()=>{if(fail)throw new Error('API phân tích chưa sẵn sàng (404).');return analysis();}});
  assert.match(app.html(),/Đang đọc dữ liệu shop/);await app.scheduled.shift()();
  for(let i=0;i<4;i++){
    const html=app.html();assert.match(html,/API phân tích chưa sẵn sàng \(404\)/);assert.match(html,/↻ Thử lại/);assert.doesNotMatch(html,/Đang đọc dữ liệu shop/);
  }
  assert.equal(app.requests.length,1);assert.equal(app.scheduled.length,0);assert.equal(app.timers.size,0);
  fail=false;await app.click({sellerRefresh:''});
  assert.equal(app.requests.length,2);assert.match(app.html(),/SHOP HEALTH SCORE/);assert.doesNotMatch(app.html(),/404|↻ Thử lại/);
});

test('a stalled request aborts after 20 seconds and can be retried without late results overwriting fresh analysis',async()=>{
  let stalled=true,finish;
  const app=setup({embedded:false,apiHandler:async()=>stalled?new Promise(resolve=>{finish=resolve;}):analysis({health:{score:88}})});
  const loading=app.seller.refresh();assert.match(app.html(),/Đang đọc dữ liệu shop/);
  const signal=app.requests[0].options.signal;assert.equal(signal.aborted,false);
  app.expireRequest();assert.equal(await loading,false);assert.equal(signal.aborted,true);
  assert.match(app.html(),/Máy chủ chưa xác nhận kết quả sau 20 giây/);assert.match(app.html(),/↻ Thử lại/);
  app.html();app.html();assert.equal(app.requests.length,1);assert.equal(app.scheduled.length,0);
  stalled=false;await app.click({sellerRefresh:''});finish(analysis({health:{score:2}}));await new Promise(resolve=>setImmediate(resolve));
  assert.match(app.html(),/>88<small>/);assert.doesNotMatch(app.html(),/>2<small>/);assert.equal(app.timers.size,0);
});

function attachSalesPlan(data=analysis()) {
  data.products[0].sales_plan={summary:'Ưu tiên ảnh quy cách và hiệu quả quảng cáo của Rây inox.',diagnosis:[
    {channel:'ads',label:'Quảng cáo',status:'missing',evidence:['Có chi quảng cáo 120.000 ₫.'],missing:['Chưa có số nhấp cùng kỳ 30 ngày.']},
    {channel:'reviews',label:'Đánh giá',status:'review',evidence:['Điểm đánh giá 4,2 / 5.'],missing:[]},
    {channel:'images',label:'Hình ảnh',status:'review',evidence:['Có 2 ảnh sản phẩm.'],missing:['Thiếu ảnh kích thước.']},
    {channel:'title',label:'Tiêu đề',status:'ready',evidence:['Tiêu đề có chất liệu inox.'],missing:[]},
    {channel:'description',label:'Mô tả',status:'missing',evidence:[],missing:['Chưa có mô tả được lưu.']},
    {channel:'video',label:'Video',status:'missing',evidence:[],missing:['Chưa xác nhận sản phẩm có video.']},
  ],strategies:[
    {key:'ads-12.34',sku:'12.34',channel:'ads',title:'Đối soát quảng cáo Rây inox',body:'Chưa có CTR để kết luận hiệu quả.',evidence:['Chi quảng cáo đã nhập.'],action:'Đối chiếu báo cáo cùng kỳ.',steps:['Ghi hiển thị và nhấp 30 ngày.'],measurement:['CTR sau khi có đủ hiển thị và nhấp.'],prerequisites:['Báo cáo quảng cáo cùng kỳ.'],stop:'Chưa tăng ngân sách nếu chưa đối soát.',confidence_label:'Cần bổ sung',priority:2,status:'needs_data'},
    {key:'images-12.34',sku:'12.34',channel:'images',title:'Bổ sung ảnh quy cách Rây inox',body:'Đối chiếu hình ảnh đã lưu.',evidence:['Chỉ có 2 ảnh đã quan sát.'],action:'Chụp ảnh kích thước thực tế.',steps:['Chụp cạnh thước đo.','Lưu ảnh thể hiện lòng rây.'],measurement:['Lượt truy cập và tỷ lệ chuyển đổi.'],prerequisites:['Đúng quy cách SKU 12.34.'],stop:'Dừng nếu ảnh không đúng sản phẩm.',confidence_label:'Trung bình',priority:4,status:'ready'},
    {key:'wrong-12.35',sku:'12.35',title:'Không thuộc SKU đang chọn',priority:99},
  ]};
  data.products[1].sales_plan={summary:'Kế hoạch riêng cho bình.',diagnosis:[],strategies:[{key:'video-12.35',sku:'12.35',title:'Video dung tích bình',evidence:['Chưa xác nhận có video.'],steps:['Đo dung tích thực tế.'],measurement:['Chuyển đổi của bình.'],prerequisites:['Bình mẫu đúng dung tích.'],stop:'Chưa đăng nếu sai thông số.',priority:3}]};
  data.strategies_available=[...data.strategies,...data.products.flatMap(product=>product.sales_plan.strategies)];
  return data;
}

test('optimizer leads with SKU sales diagnosis and evidence-based tasks before its secondary price form',()=>{
  const app=setup({data:attachSalesPlan()});const html=app.html('optimizer');
  assert.match(html,/Kế hoạch bán hàng cho từng sản phẩm/);
  for(const label of ['Quảng cáo','Đánh giá','Hình ảnh','Tiêu đề','Mô tả','Video'])assert.match(html,new RegExp(`<h3>${label}</h3>`));
  for(const evidence of ['Điểm đánh giá 4,2 / 5.','Thiếu ảnh kích thước.','Chưa có số nhấp cùng kỳ 30 ngày.','Chưa xác nhận sản phẩm có video.'])assert.ok(html.includes(evidence));
  assert.ok(html.indexOf('Bổ sung ảnh quy cách Rây inox')<html.indexOf('Đối soát quảng cáo Rây inox'));
  assert.ok(html.indexOf('Bổ sung ảnh quy cách Rây inox')<html.indexOf('name="unit_cost"'));
  assert.match(html,/Các bước thực hiện/);assert.match(html,/Chỉ số theo dõi/);assert.match(html,/Cần chuẩn bị/);
  assert.match(html,/<details class="sw-cost-details"/);assert.doesNotMatch(html,/Không thuộc SKU đang chọn|Video dung tích bình/);
  assert.equal((html.match(/id="sellerProductSelect"/g)||[]).length,1);
  assert.match(html,/data-pagination-key="seller-sales-plan-12\.34"/);
});

test('SKU selection reads its own backend plan and strategy view searches the full available set beyond top ten',async()=>{
  const app=setup({data:attachSalesPlan()});app.html('optimizer');
  await app.change({id:'sellerProductSelect',value:'12.35'});const html=app.html('optimizer');
  assert.match(html,/Video dung tích bình/);assert.doesNotMatch(html,/Bổ sung ảnh quy cách Rây inox|Đối soát quảng cáo Rây inox/);
  await app.click({sellerStrategy:'12.35'});assert.match(app.html('strategy'),/Video dung tích bình/);
  await app.click({sellerTask:'12.35'});assert.match(app.html('actions'),/Video dung tích bình/);
});

test('an actual sales-plan button persists its exact task and the saved plan remains readable in Action Center',async()=>{
  const data=attachSalesPlan();let action;
  const app=setup({data,apiHandler:async(path,options)=>{
    if(options?.method==='POST'){
      const body=JSON.parse(options.body),strategy=data.strategies_available.find(item=>item.key===body.strategy_key&&item.sku===body.sku);
      action={id:'a-images',strategy_key:strategy.key,sku:strategy.sku,title:strategy.title,status:'todo',plan:strategy};return action;
    }
    return {...data,actions:action?[action]:[]};
  }});
  const html=app.html('optimizer'),button=html.match(/data-seller-create-action="(images-[^"]+)" data-seller-sku="([^"]+)"/);
  assert.ok(button);await app.click({sellerCreateAction:button[1],sellerSku:button[2]});
  assert.deepEqual(app.requests[0].body,{strategy_key:'images-12.34',sku:'12.34'});assert.match(app.html('optimizer'),/Đã có trong Action Center/);
  const tasks=app.html('actions');assert.match(tasks,/Kế hoạch đã lưu cùng công việc/);assert.match(tasks,/Chụp cạnh thước đo/);assert.match(tasks,/Lượt truy cập và tỷ lệ chuyển đổi/);assert.match(tasks,/Dừng nếu ảnh không đúng sản phẩm/);
});

test('new advertising counts stay nullable, use integer inputs, and save only supplied values',async()=>{
  const app=setup();let html=app.html('optimizer');
  for(const name of ['ad_impressions','ad_clicks','ad_orders_30d'])assert.match(html,new RegExp(`name="${name}"[^>]*step="1"[^>]*value=""`));
  assert.match(html,/Nhấp quảng cáo \/ cùng kỳ 30 ngày/);
  await app.submit('12.34',{ad_impressions:1200,ad_clicks:0,ad_orders_30d:3});
  assert.equal(app.requests[0].body.ad_impressions,1200);assert.equal(app.requests[0].body.ad_clicks,0);assert.equal(app.requests[0].body.ad_orders_30d,3);assert.equal(app.requests[0].body.unit_cost,null);
  for(const name of ['ad_impressions','ad_clicks','ad_orders_30d']){
    const invalid=setup();invalid.html('optimizer');await invalid.submit('12.34',{[name]:1.5});assert.equal(invalid.requests.length,0);assert.match(invalid.html('optimizer'),/cũng phải là số nguyên/);
  }
});

test('sales-plan evidence, missing fields, steps and saved plan text are escaped without invented fallback recommendations',()=>{
  const data=attachSalesPlan();data.products[0].sales_plan.summary='<b>summary</b>';
  data.products[0].sales_plan.diagnosis[0].missing=['<img src=x onerror=bad()>'];
  data.products[0].sales_plan.strategies[0].steps=['<script>bad()</script>'];
  const app=setup({data});const html=app.html('optimizer');
  assert.match(html,/&lt;b&gt;summary&lt;\/b&gt;/);assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|<img src=x/);
  const absent=setup().html('optimizer');assert.match(absent,/Chưa có chẩn đoán bán hàng cho SKU này/);assert.match(absent,/Chưa có kế hoạch đủ cơ sở/);assert.doesNotMatch(absent,/Bổ sung ảnh quy cách|Tăng ngân sách|Video dung tích/);
});

const aiConfig={enabled:true,model:'qwen-local:9b',mode:'local_ollama',available:true,installed_models:['qwen-local:9b','small-local:4b'],error:''};
function aiResult(extra={}) {
  return {source:'ollama',model:'qwen-local:9b',generated_at:'2026-10-15T12:00:00+07:00',summary:'Kế hoạch AI riêng cho Rây inox từ dữ liệu đã lưu.',diagnosis:[{channel:'ads',label:'Đối chiếu quảng cáo bằng AI',status:'unknown',evidence:['Chưa có số nhấp cùng kỳ.'],missing:['Nhấp quảng cáo 30 ngày.']}],
    strategies:[{key:'ai-job-a-images',sku:'12.34',source:'ollama',title:'AI: bổ sung ảnh kích thước Rây inox',evidence:['Có hai ảnh trong dữ liệu.'],steps:['Chụp ảnh với thước đo.'],measurement:['Chuyển đổi cùng kỳ.'],prerequisites:['Sản phẩm mẫu đúng SKU.'],stop:'Dừng nếu ảnh sai quy cách.',confidence_label:'Có điều kiện',priority:3}],
    listing_drafts:{titles:['Rây inox 12 cm — kiểm tra quy cách'],description:'Mô tả từ dữ liệu.\nCần đối soát kích thước.',image_briefs:['Ảnh cạnh thước đo.','Ảnh lòng rây.'],video_script:['Cảnh 1: đo đường kính.','Cảnh 2: minh họa thao tác.']},...extra};
}
function withAi(data=attachSalesPlan(),record={job_id:'job-a',status:'done',model:'qwen-local:9b',result:aiResult(),stale:false}) {
  data.products[0].ai_analysis=record;data.ai_config={enabled:true,model:'qwen-local:9b',mode:'local_ollama'};
  data.strategies_available=[...(data.strategies_available||data.strategies),...(record.result?.strategies||[])];return data;
}

test('AI overview keeps source SKU metrics, their bases and data gaps before model strategies',()=>{
  const data=withAi(),product=data.products[0];
  Object.assign(product,{sold_total:1000,rating:4.9,review_count:119,detail:{sold_text:'1k+ đã bán',images:['https://example.test/image'],description:'Rây inox 304.'}});
  Object.assign(product.metrics,{sold_total:1000,rating:4.9,review_count:119,contribution_per_order:2404.4,break_even_roas:26.55,roas:null,orders_30d:null,conversion_pct:null});
  product.optimizer={...product.optimizer,cost_complete:true,scenarios:[{key:'baseline',margin_pct:3.76}]};
  const html=setup({data}).html('optimizer'),overview=html.match(/<section class="sw-ai-overview"[\s\S]*?<\/section>/)?.[0]||'';
  for(const text of ['TỔNG QUAN SẢN PHẨM','Sản lượng bán công khai','1k+ đã bán','không phải đơn 30 ngày','4,9/5','119','2.404,4 ₫','3,76%','26,55','ROAS ghi nhận','đơn thành công 30 ngày Chưa có dữ liệu','Nhận định tổng quan từ AI'])assert.ok(overview.includes(text),text);
  assert.ok(html.indexOf('sw-ai-overview')<html.indexOf('Chiến lược AI cho'));
  assert.doesNotMatch(overview,/đơn thành công 30 ngày 1\.000|Lợi nhuận thực tế|lượt xem ảnh/);
});

test('AI overview never substitutes unknown costs or advertising figures with zero and preserves observed zero values',()=>{
  const data=withAi(),product=data.products[0];
  product.metrics={sold_total:0,rating:null,review_count:0,contribution_per_order:null,roas:null,orders_30d:0,conversion_pct:0};
  product.optimizer={cost_complete:false,missing:['unit_cost','platform_fee_pct'],scenarios:[]};
  const html=setup({data}).html('optimizer'),overview=html.match(/<section class="sw-ai-overview"[\s\S]*?<\/section>/)?.[0]||'';
  assert.match(overview,/<dt>Sản lượng bán công khai<\/dt><dd>0<\/dd>/);
  assert.match(overview,/<dt>Lượt đánh giá<\/dt><dd>0<\/dd>/);
  assert.match(overview,/<dt>Lãi đóng góp \/ đơn<\/dt><dd>Chưa có dữ liệu<\/dd>/);
  assert.match(overview,/<dt>Biên đóng góp<\/dt><dd>Chưa có dữ liệu<\/dd>/);
  assert.match(overview,/<dt>ROAS hòa vốn<\/dt><dd>Chưa có dữ liệu<\/dd>/);
  assert.match(overview,/đơn thành công 30 ngày 0 · chuyển đổi 0%/);
  assert.match(overview,/Chưa đủ; thiếu Giá vốn \/ sản phẩm, Phí nền tảng/);
  assert.match(overview,/ảnh chưa ghi nhận · mô tả chưa ghi nhận/);
});

test('AI overview preserves metric decimals independently from the application integer formatter',()=>{
  const data=withAi(),product=data.products[0];
  const integerFormat=value=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(value);
  Object.assign(product.metrics,{rating:4.9,review_count:119,break_even_roas:26.5515,roas:2.346,conversion_pct:1.2345});
  product.optimizer={cost_complete:true,scenarios:[{key:'baseline',margin_pct:3.76}]};
  let html=setup({data,numFormatter:integerFormat}).html('optimizer');
  assert.match(html,/<dt>Điểm đánh giá<\/dt><dd>4,9\/5<\/dd>/);
  assert.match(html,/<dt>Biên đóng góp<\/dt><dd>3,76%<\/dd>/);
  assert.match(html,/<dt>ROAS hòa vốn<\/dt><dd>26,55<\/dd>/);
  assert.match(html,/<dt>ROAS ghi nhận<\/dt><dd>2,35<\/dd>/);
  assert.match(html,/chuyển đổi 1,23%/);
  Object.assign(product.metrics,{rating:0,break_even_roas:0,roas:0});product.optimizer.scenarios[0].margin_pct=0;
  html=setup({data,numFormatter:integerFormat}).html('optimizer');
  assert.match(html,/<dt>Điểm đánh giá<\/dt><dd>0,0\/5<\/dd>/);
  assert.match(html,/<dt>Biên đóng góp<\/dt><dd>0,00%<\/dd>/);
  assert.match(html,/<dt>ROAS hòa vốn<\/dt><dd>0,00<\/dd>/);
  assert.match(html,/<dt>ROAS ghi nhận<\/dt><dd>0,00<\/dd>/);
  Object.assign(product.metrics,{rating:null,break_even_roas:null,roas:null});product.optimizer.scenarios[0].margin_pct=null;
  html=setup({data,numFormatter:integerFormat}).html('optimizer');
  for(const label of ['Điểm đánh giá','Biên đóng góp','ROAS hòa vốn','ROAS ghi nhận'])assert.ok(html.includes('<dt>'+label+'</dt><dd>Chưa có dữ liệu</dd>'));
});

test('AI overview retains every model-summary paragraph and diagnosis narrative without hiding later aspects',()=>{
  const paragraphs=['Định vị của rây '+('theo quy cách đã ghi nhận. '.repeat(70)),'Điểm cần kiểm chứng từ dữ liệu cuối đoạn.'];
  const channels=['ads','reviews','images','title','description','video','price','promotion','bundles','variants','service','positioning'];
  const result=aiResult({summary:paragraphs.join('\n\n'),diagnosis:channels.map(channel=>({channel,label:'Khía cạnh '+channel,status:'test',insight:'Phân tích riêng '+channel+'.',recommendation:'Bước xử lý riêng '+channel+'.',evidence:[],missing:[]}))});
  const html=setup({data:withAi(attachSalesPlan(),{status:'done',result})}).html('optimizer');
  const overview=html.match(/<section class="sw-ai-overview"[\s\S]*?<\/section>/)?.[0]||'';
  for(const paragraph of paragraphs)assert.ok(overview.includes('<p>'+escape(paragraph)+'</p>'));
  assert.match(overview,/12 khía cạnh được AI trả về/);
  assert.doesNotMatch(overview,/data-pagination-list|data-pagination-size|<details/);
  for(const channel of channels){assert.ok(overview.includes('Phân tích riêng '+channel+'.'));assert.ok(overview.includes('Bước xử lý riêng '+channel+'.'));}
  assert.match(html,/data-pagination-key="seller-diagnosis-12\.34" data-pagination-size="6"/);
});

test('new diagnosis narratives remain visible alongside full source evidence and escape model markup',()=>{
  const evidence='Chi tiết nguồn '+('Nguồn sản phẩm. '.repeat(35));
  const result=aiResult({diagnosis:[{channel:'images',label:'Hình ảnh',status:'test',insight:'<script>Không đọc pixel.</script>',recommendation:'<b>Chụp đúng quy cách.</b>',evidence:[evidence],missing:['Thiếu dữ liệu đơn.']}]});
  const html=setup({data:withAi(attachSalesPlan(),{status:'done',result})}).html('optimizer');
  const article=html.match(/<article data-pagination-id="images">[\s\S]*?<\/article>/)?.[0]||'';
  const details=article.match(/<details class="sw-diagnosis-evidence">[\s\S]*?<\/details>/)?.[0]||'';
  assert.ok(details.includes(evidence));const visible=article.replace(details,'');
  assert.match(visible,/&lt;script&gt;Không đọc pixel\.&lt;\/script&gt;/);
  assert.match(visible,/&lt;b&gt;Chụp đúng quy cách\.&lt;\/b&gt;/);
  assert.match(visible,/Thiếu dữ liệu đơn\./);assert.doesNotMatch(article,/<script>|<b>/);
});

test('older stored AI diagnoses remain readable without invented insight or recommendation',()=>{
  const html=setup({data:withAi()}).html('optimizer');
  const overview=html.match(/<section class="sw-ai-overview"[\s\S]*?<\/section>/)?.[0]||'';
  assert.match(overview,/Kế hoạch AI riêng cho Rây inox từ dữ liệu đã lưu\./);
  assert.match(overview,/Đối chiếu quảng cáo bằng AI/);assert.match(overview,/Chưa có số nhấp cùng kỳ\./);
  assert.doesNotMatch(overview,/sw-diagnosis-insight|sw-diagnosis-recommendation|Tăng ngân sách|Giảm giá 10/);
});

test('Optimizer automatically checks its read-only AI connection once for both roles and never runs inference on render',async()=>{
  for(const authRole of ['user','system']){
    const app=setup({authRole,apiHandler:async path=>{assert.equal(path,'/api/seller/ai/config');return {...aiConfig,selection_mode:'auto',selected_model:aiConfig.model,model_installed:true};}});
    app.html('shopAnalysis');app.html('strategy');app.seller.overview(app.state.data);await new Promise(resolve=>setImmediate(resolve));assert.equal(app.requests.length,0);
    app.state.view='optimizer';const initial=app.html();assert.match(initial,/AI tự kết nối/);assert.match(initial,/Đang tự kết nối/);
    await new Promise(resolve=>setImmediate(resolve));const html=app.html();assert.match(html,/Đã kết nối/);assert.match(html,/qwen-local:9b/);
    assert.doesNotMatch(html,/data-seller-ai-config(?:[\s=>])|sellerAiModel|seller-ai-enabled|Lưu cấu hình|Bật AI cục bộ/);
    app.html();await new Promise(resolve=>setImmediate(resolve));await app.submitAiConfig();assert.equal(app.requests.length,1);
    assert.ok(!app.requests.some(request=>request.options.method));assert.equal(app.requests.filter(request=>request.path.includes('/generate')).length,0);
  }
});

test('AI generate enqueues exactly the selected SKU once and polls until a genuine saved model result is done',async()=>{
  let phase='running';const completed=withAi();
  const app=setup({data:attachSalesPlan(),apiHandler:async(path,options)=>{
    if(path==='/api/seller/ai/config')return aiConfig;
    if(path==='/api/seller/ai/generate')return {job_id:'job-a',status:'queued',cached:false};
    if(path.startsWith('/api/seller/ai/jobs/'))return {job_id:'job-a',shop_id:'shop-a',sku:'12.34',status:phase,model:'qwen-local:9b',...(phase==='done'?{result:aiResult()}:{}),error:''};
    return completed;
  }});
  let html=app.html('optimizer');const button=html.match(/data-seller-ai-generate="([^"]+)" data-seller-ai-force="([^"]+)"/);assert.ok(button);
  assert.match(html,/chưa đọc trực tiếp ảnh/);
  const first=app.click({sellerAiGenerate:button[1],sellerAiForce:button[2]});await app.click({sellerAiGenerate:'12.34'});await first;
  assert.equal(app.requests.filter(request=>request.path.endsWith('/generate')).length,1);
  assert.deepEqual(app.requests.find(request=>request.path.endsWith('/generate')).body,{shop_id:'shop-a',sku:'12.34',force:false});
  html=app.html('optimizer');assert.match(html,/Đang chờ AI/);assert.doesNotMatch(html,/AI đã hoàn tất/);
  assert.equal([...app.timers.values()].filter(timer=>timer.delay===2000).length,1);
  await app.pollAi();assert.match(app.html('optimizer'),/AI đang phân tích/);
  phase='done';await app.pollAi();html=app.html('optimizer');
  assert.match(html,/AI đã hoàn tất/);assert.match(html,/Kế hoạch AI riêng cho Rây inox/);assert.match(html,/AI cục bộ · #1/);assert.match(html,/Bản nháp nội dung từ AI/);
  assert.ok(html.indexOf('KẾT QUẢ TỪ MÔ HÌNH OLLAMA')<html.indexOf('KIỂM TRA BẰNG QUY TẮC TỪ DATABASE'));
  assert.equal(app.timers.size,0);assert.equal(app.requests.at(-1).path,'/api/seller/analysis?shop_id=shop-a');
});

test('AI queued work retains its shop and SKU when the user changes views and shops during polling',async()=>{
  const original=attachSalesPlan(),completed=withAi();
  const app=setup({data:original,apiHandler:async(path)=>path.endsWith('/config')?aiConfig:path.endsWith('/generate')?{job_id:'job-a',status:'queued'}:path.includes('/jobs/')?{job_id:'job-a',status:'done',model:'qwen-local:9b',result:aiResult()}:completed});
  app.html('optimizer');await app.click({sellerAiGenerate:'12.34'});
  app.state.shopId='shop-b';app.state.view='reports';app.state.data={shop:{id:'shop-b',name:'Shop B'},seller_analysis:analysis()};app.html();
  const before=app.renders.length;await app.pollAi();
  assert.equal(app.renders.length,before);assert.equal(app.state.shopId,'shop-b');assert.equal(app.state.view,'reports');
  assert.ok(app.requests.some(request=>request.path==='/api/seller/ai/jobs/job-a?shop_id=shop-a'));
  app.state.shopId='shop-a';app.state.data={shop:{id:'shop-a'},seller_analysis:original};app.state.view='optimizer';
  assert.match(app.html(),/Kế hoạch AI riêng cho Rây inox/);
  await app.change({id:'sellerProductSelect',value:'12.35'});assert.doesNotMatch(app.html(),/Kế hoạch AI riêng cho Rây inox/);
});

test('unavailable Ollama and polling errors remain actionable without generating fallback AI or leaking timers',async()=>{
  const unavailable=setup({apiHandler:async path=>{if(path.endsWith('/generate'))throw new Error('Ollama đang tải mô hình.');return {...aiConfig,available:false,error:'Ollama đang tải mô hình.'};}});unavailable.state.view='optimizer';unavailable.html();await new Promise(resolve=>setImmediate(resolve));await unavailable.click({sellerAiGenerate:'12.34'});
  assert.equal(unavailable.requests.length,2);assert.match(unavailable.html('optimizer'),/Ollama đang tải mô hình/);assert.match(unavailable.html('optimizer'),/Mở Ollama và chờ mô hình cục bộ sẵn sàng/);assert.doesNotMatch(unavailable.html('optimizer'),/AI đã hoàn tất/);
  let pollFails=true;
  const app=setup({data:withAi(),apiHandler:async(path)=>{
    if(path.endsWith('/config'))return aiConfig;if(path.endsWith('/generate'))return {job_id:'job-new',status:'queued'};
    if(path.includes('/jobs/')){if(pollFails)throw new Error('Chưa kết nối được API trạng thái.');return {job_id:'job-new',status:'done',result:aiResult({summary:'Kết quả AI mới.'})};}
    return withAi(attachSalesPlan(),{job_id:'job-new',status:'done',result:aiResult({summary:'Kết quả AI mới.'})});
  }});
  app.html('optimizer');await app.click({sellerAiGenerate:'12.34',sellerAiForce:'true'});await app.pollAi();
  let html=app.html('optimizer');assert.match(html,/Chưa xác nhận được trạng thái AI/);assert.match(html,/Kế hoạch AI riêng cho Rây inox/);assert.match(html,/Kiểm tra lại tác vụ/);assert.equal(app.timers.size,0);
  pollFails=false;await app.click({sellerAiJob:'job-new',sellerSku:'12.34'});html=app.html('optimizer');
  assert.match(html,/Kết quả AI mới/);assert.match(html,/AI đã hoàn tất/);assert.equal(app.timers.size,0);
});

test('AI stale outputs stay labeled and each draft copy uses the actual stored result without publishing',async()=>{
  const app=setup({data:withAi(attachSalesPlan(),{job_id:'job-a',status:'done',model:'qwen-local:9b',stale:true,result:aiResult()})});
  const html=app.html('optimizer');assert.match(html,/Dữ liệu SKU đã thay đổi/);assert.match(html,/data-seller-ai-force="true"/);assert.match(html,/chưa được đăng lên Shopee/);
  await app.click({sellerAiCopy:'titles:0',sellerSku:'12.34'});await app.click({sellerAiCopy:'description',sellerSku:'12.34'});await app.click({sellerAiCopy:'image_briefs',sellerSku:'12.34'});await app.click({sellerAiCopy:'video_script',sellerSku:'12.34'});
  const drafts=aiResult().listing_drafts;assert.deepEqual(app.copied,[drafts.titles[0],drafts.description,drafts.image_briefs.join('\n'),drafts.video_script.join('\n')]);assert.equal(app.requests.length,0);
  assert.match(app.html('optimizer'),/Đã sao chép bản nháp/);
});

test('stale AI drafts remain readable but cannot create an obsolete action',()=>{
  const data=withAi(attachSalesPlan(),{job_id:'job-a',status:'done',stale:true,result:aiResult()});
  data.strategies_available=data.strategies_available.filter(item=>item.source!=='ollama');
  const html=setup({data}).html('optimizer');
  assert.match(html,/Kế hoạch AI riêng cho Rây inox/);
  assert.match(html,/data-seller-create-action="ai-job-a-images"[^>]*disabled[^>]*>Phân tích lại trước khi tạo việc/);
});

test('AI output and installed-model text are escaped, and AI actions use the existing persisted Action Center flow',async()=>{
  const result=aiResult({summary:'<script>bad()</script>',listing_drafts:{titles:['<img src=x>'],description:'</textarea><script>bad()</script>',image_briefs:[],video_script:[]}});
  const data=withAi(attachSalesPlan(),{job_id:'job-a',status:'done',result}),app=setup({data,apiHandler:async(path,options)=>options?.method?{id:'a-ai'}:{...data,actions:[{id:'a-ai',strategy_key:'ai-job-a-images',sku:'12.34',status:'todo'}]}});
  const html=app.html('optimizer');assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.match(html,/&lt;\/textarea&gt;/);assert.doesNotMatch(html,/<script>|<img src=x/);
  await app.click({sellerCreateAction:'ai-job-a-images',sellerSku:'12.34'});assert.deepEqual(app.requests[0].body,{strategy_key:'ai-job-a-images',sku:'12.34'});assert.match(app.html('optimizer'),/Đã có trong Action Center/);
});

test('the optional cost form remains open across analysis rerenders after the user expands it',()=>{
  const app=setup();app.html('optimizer');app.toggleCosts(true);
  assert.match(app.html('optimizer'),/<details class="sw-cost-details" open data-seller-costs>/);
  app.toggleCosts(false);assert.doesNotMatch(app.html('optimizer'),/<details class="sw-cost-details" open data-seller-costs>/);
});

test('a pending AI task restored from the database polls once across repeated renders and stops on a real failure',async()=>{
  const prior=aiResult(),pending={job_id:'restored-job',status:'running',model:'qwen-local:9b',previous_result:prior};
  const failed={job_id:'restored-job',status:'failed',model:'qwen-local:9b',error:'Ollama hết thời gian suy luận.',previous_result:prior};
  const app=setup({data:withAi(attachSalesPlan(),pending),apiHandler:async path=>path.includes('/jobs/')?failed:withAi(attachSalesPlan(),failed)});
  app.html('optimizer');app.html('optimizer');app.html('strategy');
  assert.equal([...app.timers.values()].filter(timer=>timer.delay===2000).length,1);assert.equal(app.requests.length,0);
  await app.pollAi();const html=app.html('optimizer');
  assert.match(html,/Phân tích AI thất bại/);assert.match(html,/Ollama hết thời gian suy luận/);assert.match(html,/Kế hoạch AI riêng cho Rây inox/);assert.doesNotMatch(html,/AI đã hoàn tất/);
  assert.equal(app.timers.size,0);assert.equal(app.requests.filter(request=>request.path.endsWith('/generate')).length,0);
});

test('AI polling exposes a genuine repair phase and actual timings then keeps the prior result after a rejected output',async()=>{
  const prior=aiResult(),pending={job_id:'repair-job',status:'queued',phase:'queued',model:'auto-local:9b',previous_result:prior};
  let finished=false;
  const record=()=>({job_id:'repair-job',status:finished?'failed':'running',phase:finished?'failed':'repairing',model:'auto-local:9b',previous_result:prior,
    telemetry:{attempt_count:2,repair_count:1,duration_ms:finished?179390:120000,queue_duration_ms:84683,prompt_eval_count:1234,eval_count:456},
    validation_diagnostics:[{attempt:1,field:'strategies.0.hypothesis',type:'string_too_short'}],error:finished?'AI chưa đạt kiểm tra cấu trúc sau lượt hoàn thiện.':''});
  const app=setup({data:withAi(attachSalesPlan(),pending),apiHandler:async path=>path.includes('/jobs/')?record():withAi(attachSalesPlan(),record())});
  app.html('optimizer');await app.pollAi();let html=app.html('optimizer');
  assert.match(html,/AI đang hoàn thiện lại kết quả/);assert.match(html,/đầu ra chưa đạt kiểm tra/);
  assert.match(html,/<dt>Chờ lượt<\/dt><dd>1 phút 25 giây<\/dd>/);assert.match(html,/<dt>Xử lý<\/dt><dd>2 phút<\/dd>/);
  assert.match(html,/<dt>Lượt xử lý<\/dt><dd>2<\/dd>/);assert.match(html,/<dt>Hoàn thiện lại<\/dt><dd>1 lần<\/dd>/);
  assert.match(html,/Kế hoạch AI riêng cho Rây inox/);assert.doesNotMatch(html,/AI đã hoàn tất|Còn khoảng|Dự kiến|prompt_eval_count|string_too_short|strategies\.0\.hypothesis/);
  finished=true;await app.pollAi();html=app.html('optimizer');
  assert.match(html,/Phân tích AI thất bại/);assert.match(html,/chưa có kết quả AI mới được chấp nhận/);assert.match(html,/Kết quả AI trước đó được giữ lại/);
  assert.match(html,/<dt>Xử lý<\/dt><dd>2 phút 59 giây<\/dd>/);assert.match(html,/Thử phân tích lại bằng AI/);
  assert.doesNotMatch(html,/AI đang hoàn thiện lại kết quả|AI đã hoàn tất/);assert.equal(app.timers.size,0);
});

test('retrying a failed AI output explicitly forces a new SKU job instead of reusing a cached earlier result',async()=>{
  const failed={job_id:'failed-job',status:'failed',phase:'failed',error:'Đầu ra chưa đạt kiểm tra chất lượng.',previous_result:aiResult()};
  const app=setup({data:withAi(attachSalesPlan(),failed),apiHandler:async path=>path.endsWith('/generate')?{job_id:'retry-job',status:'queued',phase:'queued',model:'auto-local:4b'}:aiConfig});
  const html=app.html('optimizer'),button=html.match(/data-seller-ai-generate="([^"]+)" data-seller-ai-force="([^"]+)"[^>]*>Thử phân tích lại bằng AI/);
  assert.ok(button);assert.equal(button[2],'true');await app.click({sellerAiGenerate:button[1],sellerAiForce:button[2]});
  assert.deepEqual(app.requests[0].body,{shop_id:'shop-a',sku:'12.34',force:true});assert.match(app.html('optimizer'),/Đang chờ AI/);
  assert.match(app.html('optimizer'),/Kế hoạch AI riêng cho Rây inox/);assert.match(app.html('optimizer'),/auto-local:4b/);
  assert.doesNotMatch(app.html('optimizer'),/Đầu ra chưa đạt kiểm tra chất lượng|AI đã hoàn tất/);
});

test('completed AI jobs show persisted processing time with a timestamp fallback for older records and no invented timing',()=>{
  const finished={job_id:'legacy-job',status:'done',result:aiResult(),created_at:'2026-10-16T13:18:26.916Z',started_at:'2026-10-16T13:18:26.919Z',completed_at:'2026-10-16T13:21:23.983Z'};
  let html=setup({data:withAi(attachSalesPlan(),finished)}).html('optimizer');
  assert.match(html,/<dt>Xử lý<\/dt><dd>2 phút 57 giây<\/dd>/);assert.match(html,/<dt>Chờ lượt<\/dt><dd>0 giây<\/dd>/);
  const invalid={...finished,created_at:null,started_at:'invalid',completed_at:'invalid',telemetry:{duration_ms:NaN,queue_duration_ms:-1,attempt_count:-1,repair_count:0}};
  html=setup({data:withAi(attachSalesPlan(),invalid)}).html('optimizer');assert.doesNotMatch(html,/sw-ai-telemetry|NaN giây|Xử lý<\/dt>/);
  html=setup({data:withAi(attachSalesPlan(),{...finished,telemetry:{duration_ms:60500,queue_duration_ms:1000,attempt_count:1,repair_count:0}})}).html('optimizer');
  assert.match(html,/<dt>Xử lý<\/dt><dd>1 phút 1 giây<\/dd>/);assert.doesNotMatch(html,/<dt>Hoàn thiện lại/);
});

test('repair telemetry and failure messages remain scoped to the matching shop and SKU',async()=>{
  const pending={job_id:'scoped-repair',status:'running',phase:'generating',model:'local:9b'};
  const repair={...pending,phase:'repairing',telemetry:{duration_ms:90000,attempt_count:2,repair_count:1}};
  const app=setup({data:withAi(attachSalesPlan(),pending),apiHandler:async()=>repair});app.html('optimizer');
  await app.change({id:'sellerProductSelect',value:'12.35'});await app.pollAi();let html=app.html('optimizer');
  assert.doesNotMatch(html,/AI đang hoàn thiện lại kết quả|1 phút 30 giây/);
  app.state.shopId='shop-b';app.state.data={shop:{id:'shop-b',name:'Shop B'},seller_analysis:analysis()};html=app.html('optimizer');
  assert.doesNotMatch(html,/AI đang hoàn thiện lại kết quả|1 phút 30 giây/);
  app.state.shopId='shop-a';app.state.data={shop:{id:'shop-a',name:'Shop A'}};await app.change({id:'sellerProductSelect',value:'12.34'});html=app.html('optimizer');
  assert.match(html,/AI đang hoàn thiện lại kết quả/);assert.match(html,/1 phút 30 giây/);
});

test('a cached completed AI response is read from its job and refreshed without an unnecessary polling loop',async()=>{
  const app=setup({apiHandler:async path=>path.endsWith('/config')?aiConfig:path.endsWith('/generate')?{job_id:'job-a',status:'done',cached:true}:path.includes('/jobs/')?{job_id:'job-a',status:'done',result:aiResult()}:withAi()});
  app.html('optimizer');await app.click({sellerAiGenerate:'12.34'});
  assert.match(app.html('optimizer'),/AI đã hoàn tất/);assert.match(app.html('optimizer'),/Kế hoạch AI riêng cho Rây inox/);
  assert.equal(app.timers.size,0);assert.deepEqual(app.requests.map(request=>request.path),['/api/seller/ai/generate','/api/seller/ai/jobs/job-a?shop_id=shop-a','/api/seller/analysis?shop_id=shop-a']);
});

test('an explicit analysis refresh replaces a polling error with the persisted finished AI result',async()=>{
  let finished=false;
  const app=setup({data:withAi(attachSalesPlan(),{job_id:'job-a',status:'running'}),apiHandler:async path=>{
    if(path.includes('/jobs/'))throw new Error('Mất kết nối trạng thái.');
    return withAi(attachSalesPlan(),finished?{job_id:'job-a',status:'done',result:aiResult({summary:'Kết quả đã lưu sau khi kết nối lại.'})}:{job_id:'job-a',status:'running'});
  }});
  app.html('optimizer');await app.pollAi();assert.match(app.html('optimizer'),/Chưa xác nhận được trạng thái AI/);
  finished=true;await app.click({sellerRefresh:''});const html=app.html('optimizer');
  assert.match(html,/AI đã hoàn tất/);assert.match(html,/Kết quả đã lưu sau khi kết nối lại/);assert.doesNotMatch(html,/Mất kết nối trạng thái|Kiểm tra lại tác vụ/);assert.equal(app.timers.size,0);
});

test('automatic connection failures do not loop and a deliberate reconnect refreshes the readonly model status',async()=>{
  let fail=true;
  const app=setup({apiHandler:async path=>{assert.equal(path,'/api/seller/ai/config');if(fail)throw new Error('Ollama chưa khởi động.');return {...aiConfig,selected_model:'auto-ready:4b',model_installed:true};}});
  app.state.view='optimizer';app.html();await new Promise(resolve=>setImmediate(resolve));
  assert.match(app.html(),/Ollama chưa khởi động/);assert.match(app.html(),/Kết nối lại/);
  app.html();await new Promise(resolve=>setImmediate(resolve));assert.equal(app.requests.length,1);
  fail=false;await app.click({sellerAiConfigRefresh:''});const html=app.html();assert.match(html,/Đã kết nối/);assert.match(html,/auto-ready:4b/);assert.doesNotMatch(html,/Ollama chưa khởi động/);
  assert.equal(app.requests.length,2);assert.ok(!app.requests.some(request=>request.options.method));
});

test('Analyze lets the backend recover from stale unavailable config and uses the actual model pinned to its job',async()=>{
  const data=withAi();data.ai_config={enabled:false,model:'old-model',available:false,error:'Kết nối cũ chưa sẵn sàng.'};
  const app=setup({data,apiHandler:async path=>path.endsWith('/config')?{...data.ai_config,selected_model:'old-model'}:path.endsWith('/generate')?{job_id:'recovered',status:'queued',model:'auto-fallback:4b'}:{job_id:'recovered',status:'failed',model:'auto-fallback:4b',error:'Tác vụ cần được kiểm tra.'}});
  app.state.view='optimizer';app.html();await new Promise(resolve=>setImmediate(resolve));
  await app.click({sellerAiGenerate:'12.34',sellerAiForce:'true'});
  const request=app.requests.find(request=>request.path.endsWith('/generate'));assert.ok(request);assert.deepEqual(request.body,{shop_id:'shop-a',sku:'12.34',force:true});
  const html=app.html(),status=html.match(/<div class="sw-ai-run">[\s\S]*?<\/div><button/)?.[0]||'';
  assert.match(status,/auto-fallback:4b/);assert.doesNotMatch(status,/old-model/);assert.match(html,/Đang chờ AI/);
  assert.ok(!app.requests.some(request=>request.options.method==='PUT'));
});

test('an explicit System AI pause stays readable and never receives a green ready indicator or enable control',async()=>{
  const app=setup({authRole:'system',apiHandler:async()=>({...aiConfig,enabled:false,model_installed:true})});app.state.view='optimizer';app.html();await new Promise(resolve=>setImmediate(resolve));
  const html=app.html(),connection=html.match(/<div class="sw-ai-connection"[\s\S]*?<div class="sw-ai-connection-footer"/)?.[0]||'';
  assert.match(connection,/AI đang được System tạm dừng/);assert.match(connection,/is-paused/);assert.doesNotMatch(connection,/is-ready|Đã kết nối|Bật AI/);
});

test('SKU AI strategies expose all returned directions, source ranking, hypotheses and tradeoffs without filling a generic checklist',()=>{
  const channels=['price','promotion','bundles','variants','service','positioning','ads','images'];
  const result=aiResult({summary:'Kế hoạch đa hướng cho đúng rây inox.',strategies:channels.map((channel,index)=>({
    key:'ai-specific-'+channel,sku:'12.34',channel,source:'ollama',rank:index+1,priority_basis:'ai_rank',priority:100-index,priority_tier:index<2?'now':index<6?'next':'later',
    title:'Chiến lược '+channel+' theo quy cách rây',evidence:['Bằng chứng riêng '+channel+' của SKU 12.34.'],hypothesis:'Giả thuyết '+channel+' cần đo.',tradeoff:'Đánh đổi '+channel+' cần kiểm tra.',
    steps:['Bước triển khai riêng '+channel+'.'],measurement:['Chỉ số riêng '+channel+'.'],prerequisites:['Điều kiện của '+channel+'.'],stop:'Ngưỡng dừng '+channel+'.',confidence_label:'Cần kiểm chứng',
  }))});
  const app=setup({data:withAi(attachSalesPlan(),{job_id:'diverse',status:'done',result})}),html=app.html('optimizer');
  assert.match(html,/8 chiến lược từ dữ liệu SKU · 8 hướng triển khai/);assert.match(html,/data-pagination-key="seller-ai-strategies-12\.34" data-pagination-size="10"/);
  for(const channel of channels){assert.match(html,new RegExp(`data-seller-strategy-channel="${channel}"`));assert.ok(html.includes('Bằng chứng riêng '+channel));assert.ok(html.includes('Giả thuyết '+channel));assert.ok(html.includes('Đánh đổi '+channel));}
  for(const label of ['Giá &amp; biên lợi nhuận','Khuyến mại','Combo &amp; bán kèm','Phân loại &amp; quy cách','Dịch vụ &amp; hậu mãi','Định vị &amp; khách hàng'])assert.ok(html.includes(label),label);
  assert.match(html,/AI cục bộ · #1 · Làm trước/);assert.match(html,/AI cục bộ · #8 · Theo dõi sau/);
  assert.ok(html.indexOf('Chiến lược price theo quy cách rây')<html.indexOf('Chiến lược images theo quy cách rây'));assert.doesNotMatch(html,/AI cục bộ · Ưu tiên 100/);
  const legacy=aiResult({strategies:result.strategies.slice(0,3)}),old=setup({data:withAi(attachSalesPlan(),{job_id:'legacy',status:'done',result:legacy})}).html('optimizer');
  assert.match(old,/3 chiến lược từ dữ liệu SKU · 3 hướng triển khai/);assert.doesNotMatch(old,/Chiến lược service theo quy cách rây/);
});

test('new strategy hypothesis and tradeoff text are escaped together with automatic model names',async()=>{
  const result=aiResult();result.strategies[0].hypothesis='<script>hypothesis()</script>';result.strategies[0].tradeoff='<img src=x onerror=bad()>';
  const app=setup({data:withAi(attachSalesPlan(),{job_id:'safe',status:'done',result}),apiHandler:async()=>({...aiConfig,selected_model:'<b>model</b>'})});app.state.view='optimizer';app.html();await new Promise(resolve=>setImmediate(resolve));
  const html=app.html();assert.match(html,/&lt;script&gt;hypothesis\(\)&lt;\/script&gt;/);assert.match(html,/&lt;img src=x onerror=bad\(\)&gt;/);assert.match(html,/&lt;b&gt;model&lt;\/b&gt;/);assert.doesNotMatch(html,/<script>|<img src=x|<b>model/);
});

test('long strategy sources stay complete and escaped in closed native details while the plan stays visible',()=>{
  const evidence='Mô tả nguồn SKU: '+('Rây inox 304 có tay cầm dài. '.repeat(25))+'<script>source()</script>';
  const result=aiResult();result.strategies[0]={...result.strategies[0],rank:1,priority_tier:'now',evidence:[evidence],hypothesis:'Giả thuyết cần đo riêng.',tradeoff:'Đánh đổi cần kiểm tra riêng.',steps:['Đo kích thước thực tế của rây.']};
  const app=setup({data:withAi(attachSalesPlan(),{job_id:'evidence-job',status:'done',result})}),html=app.html('optimizer');
  const article=html.match(/<article class="sw-strategy" data-pagination-id="ai-job-a-images">[\s\S]*?<\/article>/)?.[0]||'';
  const details=article.match(/<details class="sw-strategy-evidence">[\s\S]*?<\/details>/)?.[0]||'';assert.ok(details);
  assert.match(details,/<summary>1 căn cứ từ dữ liệu<\/summary>/);assert.ok(details.includes(escape(evidence)));assert.doesNotMatch(details,/<details[^>]*\bopen\b|<script>/);
  const visible=article.replace(details,'');
  for(const text of ['AI cục bộ · #1 · Làm trước','Giả thuyết cần đo riêng.','Đánh đổi cần kiểm tra riêng.','Đo kích thước thực tế của rây.'])assert.ok(visible.includes(text),text+' remains outside the collapsed evidence');
  assert.equal(app.requests.length,0);
});

test('multiple facts collapse by their real count and short evidence remains directly readable',()=>{
  const data=analysis();data.strategies[0].evidence=['Căn cứ một.','Căn cứ hai.','Căn cứ ba.'];
  let html=setup({data}).html('strategy');assert.match(html,/<details class="sw-strategy-evidence"><summary>3 căn cứ từ dữ liệu<\/summary>/);
  for(const fact of data.strategies[0].evidence)assert.ok(html.includes(escape(fact)));
  data.strategies[0].evidence=['Căn cứ ngắn.','Căn cứ thứ hai.'];html=setup({data}).html('strategy');
  assert.doesNotMatch(html,/sw-strategy-evidence/);assert.match(html,/<dd><p>Căn cứ ngắn\.<\/p><p>Căn cứ thứ hai\.<\/p><\/dd>/);
});

test('diagnostic full sources collapse without hiding the label, status or missing data and remain escaped in native details',()=>{
  const evidence='Mô tả đầy đủ: '+('Rây lọc inox304, kích thước 16,5 x 30cm. '.repeat(35))+'</details><script>source()</script>';
  const result=aiResult({diagnosis:[{channel:'description',label:'Đối chiếu mô tả đúng SKU',status:'needs_data',evidence:[evidence],missing:['Báo cáo đơn <b>cùng kỳ</b>.']}]});
  const html=setup({data:withAi(attachSalesPlan(),{job_id:'full-source-job',status:'done',result})}).html('optimizer');
  const article=html.match(/<article data-pagination-id="description">[\s\S]*?<\/article>/)?.[0]||'';
  const details=article.match(/<details class="sw-diagnosis-evidence">[\s\S]*?<\/details>/)?.[0]||'';assert.ok(details);
  assert.match(details,/<summary>1 căn cứ từ dữ liệu<\/summary>/);assert.ok(details.includes(escape(evidence)));assert.doesNotMatch(details,/<details[^>]*\bopen\b|<script>/);
  const visible=article.replace(details,'');
  for(const text of ['Đối chiếu mô tả đúng SKU','Cần bổ sung dữ liệu','Cần bổ sung:','Báo cáo đơn &lt;b&gt;cùng kỳ&lt;/b&gt;.'])assert.ok(visible.includes(text),text+' remains outside the closed source');
});

test('diagnostic short facts stay visible up to the readable limit and many facts collapse with their exact count',()=>{
  const render=evidence=>setup({data:withAi(attachSalesPlan(),{job_id:'diagnosis-size',status:'done',result:aiResult({diagnosis:[{channel:'ads',label:'Dữ liệu quảng cáo',status:'unknown',evidence,missing:[]}]})})}).html('optimizer');
  let html=render(['A'.repeat(180),'B'.repeat(180)]);assert.doesNotMatch(html,/sw-diagnosis-evidence/);assert.ok(html.includes('<li>'+'A'.repeat(180)+'</li>'));
  html=render(['A'.repeat(181),'B'.repeat(180)]);assert.match(html,/<details class="sw-diagnosis-evidence"><summary>2 căn cứ từ dữ liệu<\/summary>/);
  html=render(['Một.','Hai.','Ba.']);assert.match(html,/<details class="sw-diagnosis-evidence"><summary>3 căn cứ từ dữ liệu<\/summary>/);
  for(const fact of ['Một.','Hai.','Ba.'])assert.ok(html.includes('<li>'+fact+'</li>'));
});

function shopAnalysisFixture(extra={}) {
  const base=analysis(),segments=['chief','growth','growth','low_margin','slow','unknown','unknown'];
  const labels={chief:'Sản phẩm chủ lực',growth:'Có tiềm năng tăng trưởng',low_margin:'Biên lợi nhuận thấp',slow:'Bán chậm',unknown:'Chưa đủ dữ liệu phân nhóm'};
  const products=segments.map((segment,index)=>({...base.products[0],sku:'shop-product-'+index,name:'Sản phẩm nhóm '+segment+' '+index,segment,segment_label:labels[segment],segment_reason:'Cơ sở của SKU '+index}));
  return {...base,summary:{...base.summary,product_count:products.length},health:{score:67,confidence:'Trung bình',coverage:{known:3,total:6,pct:50},issues:['Cần bổ sung dữ liệu chi phí.']},products,
    strategies:[{...base.strategies[0],key:'priority-shop-product-0',sku:products[0].sku,title:'Ưu tiên riêng từ dữ liệu shop đang chọn',body:'Đối soát chi phí của sản phẩm chủ lực trước.',priority:4}],...extra};
}
const segmentButton=(html,segment)=>html.match(new RegExp(`<button\\b[^>]*data-seller-segment="${segment}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0]||'';
const plainText=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const shopProductTable=html=>html.match(/<table\b[^>]*data-pagination-key="seller-products"[^>]*>[\s\S]*?<\/table>/)?.[0]||'';

test('Shop Analysis attention panel uses the actual health score and counts every product in its real segment',()=>{
  const data=shopAnalysisFixture(),app=setup({data}),html=app.html('shopAnalysis');
  assert.match(html,/Điều gì cần được chú ý trước\?/);assert.match(html,/SHOP HEALTH SCORE/);assert.match(html,/>67(?:<|\s)/);
  for(const [segment,count]of [['chief',1],['growth',2],['low_margin',1],['slow',1],['unknown',2]]){
    const button=segmentButton(html,segment);assert.ok(button,segment+' has a real filter button');assert.match(plainText(button),new RegExp(`\\b${count}\\b`),segment+' count matches current products');
  }
  assert.equal(app.requests.length,0);
  for(const product of data.products)assert.ok(shopProductTable(html).includes(escape(product.name)));
});

test('Shop Analysis group filters and all reset operate on real product rows without calling a fabricated dataset',async()=>{
  const data=shopAnalysisFixture(),app=setup({data});app.html('shopAnalysis');
  await app.click({sellerSegment:'growth'});let html=app.html('shopAnalysis'),table=shopProductTable(html);assert.ok(segmentButton(html,'all'),'a filtered group has a real all-products reset button');
  for(const product of data.products)assert.equal(table.includes(escape(product.name)),product.segment==='growth',product.sku);
  await app.click({sellerSegment:'low_margin'});table=shopProductTable(app.html('shopAnalysis'));
  for(const product of data.products)assert.equal(table.includes(escape(product.name)),product.segment==='low_margin',product.sku);
  await app.click({sellerSegment:'all'});table=shopProductTable(app.html('shopAnalysis'));
  for(const product of data.products)assert.ok(table.includes(escape(product.name)));
  assert.equal(app.requests.length,0);
});

test('Shop Analysis segment selection belongs to its shop and does not filter another workspace',async()=>{
  const a=shopAnalysisFixture(),b=shopAnalysisFixture({products:[{...a.products[0],sku:'b-chief',name:'Chủ lực riêng shop B',segment:'chief'},{...a.products[4],sku:'b-slow',name:'Bán chậm riêng shop B',segment:'slow'}]}),app=setup({data:a});
  app.html('shopAnalysis');await app.click({sellerSegment:'growth'});
  app.state.shopId='shop-b';app.state.data={shop:{id:'shop-b',name:'Shop B'},seller_analysis:b};
  let table=shopProductTable(app.html('shopAnalysis'));assert.match(table,/Chủ lực riêng shop B/);assert.match(table,/Bán chậm riêng shop B/);assert.doesNotMatch(table,/Sản phẩm nhóm growth/);
  await app.click({sellerSegment:'slow'});table=shopProductTable(app.html('shopAnalysis'));assert.match(table,/Bán chậm riêng shop B/);assert.doesNotMatch(table,/Chủ lực riêng shop B/);
  app.state.shopId='shop-a';app.state.data={shop:{id:'shop-a',name:'Shop A'},seller_analysis:a};table=shopProductTable(app.html('shopAnalysis'));
  for(const product of a.products)assert.equal(table.includes(escape(product.name)),product.segment==='growth',product.sku);
  assert.equal(app.requests.length,0);
});

test('Shop Analysis remains honest for empty products, missing score and a known zero score',()=>{
  for(const health of [{score:null,confidence:'Thiếu dữ liệu'},{},null]){
    const app=setup({data:shopAnalysisFixture({products:[],strategies:[],summary:{product_count:0},health})}),html=app.html('shopAnalysis');
    assert.match(html,/Điều gì cần được chú ý trước\?/);assert.match(html,/SHOP HEALTH SCORE/);assert.match(html,/—/);
    assert.doesNotMatch(html,/>67(?:<|\s)|>82(?:<|\s)|DỮ LIỆU MINH HỌA/);
    for(const segment of ['chief','growth','low_margin','slow'])assert.match(plainText(segmentButton(html,segment)),/\b0\b/);
    assert.equal(segmentButton(html,'unknown'),'');assert.equal(shopProductTable(html),'');assert.equal(app.requests.length,0);
  }
  const zero=setup({data:shopAnalysisFixture({health:{score:0,confidence:'Thiếu dữ liệu'}})}).html('shopAnalysis');
  assert.match(zero,/>0(?:<|\s)/);assert.doesNotMatch(zero,/>82(?:<|\s)/);
  const known=shopAnalysisFixture();known.products=known.products.filter(product=>product.segment!=='unknown');
  assert.equal(segmentButton(setup({data:known}).html('shopAnalysis'),'unknown'),'');
});

test('Shop Analysis priority banner and module buttons navigate to the actual product or shop strategy',async()=>{
  for(const sku of ['shop-product-0',null]){
    const data=shopAnalysisFixture();data.strategies[0].sku=sku;
    const app=setup({data});app.html('shopAnalysis');
    if(!sku)await app.click({sellerOptimize:'shop-product-2'});
    const html=app.html('shopAnalysis');assert.match(html,/Ưu tiên riêng từ dữ liệu shop đang chọn/);
    const banner=html.match(/<div\b[^>]*class="sw-shop-priority"[^>]*>[\s\S]*?(?=<details\b[^>]*class="sw-health-basis")/)?.[0]||html.slice(html.indexOf(escape(data.strategies[0].title)));
    if(sku){
      const button=banner.match(/data-seller-optimize="([^"]+)"/);assert.ok(button,'priority SKU has an actual optimizer button');assert.equal(button[1],sku);
      await app.click({sellerOptimize:button[1]});assert.equal(app.state.view,'optimizer');assert.match(app.html(),new RegExp(`value="${sku}" selected`));
    }else{
      assert.match(banner,/data-seller-view="strategy" data-seller-reset-sku/);await app.click({sellerView:'strategy',sellerResetSku:''});assert.equal(app.state.view,'strategy');
      assert.match(app.html(),/Ưu tiên riêng từ dữ liệu shop đang chọn/);assert.doesNotMatch(app.html(),/SKU ĐANG PHÂN TÍCH/);
    }
  }
  const app=setup({data:shopAnalysisFixture()});
  for(const mode of ['product','price','competitors','opportunities','shop']){
    const html=app.html('shopAnalysis');assert.match(html,new RegExp(`data-seller-intelligence-module="${mode}"`));
    await app.click({sellerIntelligenceModule:mode});assert.equal(app.state.view,'shopAnalysis');
    assert.match(app.html('shopAnalysis'),new RegExp(`id="sellerModule-${mode}"[^>]*aria-selected="true"`));
  }
  assert.equal(app.requests.length,0);
});

test('Shop Analysis escapes product names, priority copy and shop names in its new panels',()=>{
  const data=shopAnalysisFixture();data.products[0].name='<img src=x onerror=bad()>';data.strategies[0].title='<script>bad()</script>';data.strategies[0].body='<b>unsafe priority</b>';
  const app=setup({data});app.state.shops[0].name='<img onerror=shop()>';const html=app.html('shopAnalysis');
  assert.match(html,/&lt;img src=x onerror=bad\(\)&gt;/);assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.match(html,/&lt;img onerror=shop\(\)&gt;/);
  assert.doesNotMatch(html,/<script>|<img src=x|<img onerror|<b>unsafe priority/);
});


test('the five internal Shop Analysis modules keep one selected SKU and isolate selection between shops',async()=>{
  const data=shopAnalysisFixture(),app=setup({data}),seen=[];
  const capture=(mode,ctx)=>{seen.push({mode,sku:ctx.product.sku,shop:ctx.shopId});return `<p>Module ${mode}: ${escape(ctx.product.name)}</p>`;};
  app.context.window.MarketLensProductPrice={render:capture,click:()=>false};
  app.context.window.MarketLensShopMarket={render:capture,ensure:()=>Promise.resolve()};
  app.html('shopAnalysis');await app.click({sellerIntelligenceModule:'product'});await app.change({id:'sellerIntelligenceSku',value:data.products[3].sku});
  for(const mode of ['product','price','competitors','opportunities']){
    await app.click({sellerIntelligenceModule:mode});const html=app.html('shopAnalysis');
    assert.match(html,new RegExp(`value="${data.products[3].sku}" selected`));
    assert.deepEqual(seen.at(-1),{mode,sku:data.products[3].sku,shop:'shop-a'});assert.equal(app.state.view,'shopAnalysis');
  }
  const other=shopAnalysisFixture({products:[{...data.products[1],sku:'other-sku',name:'Shop B only'}]});
  app.state.shopId='shop-b';app.state.data={shop:{id:'shop-b'},seller_analysis:other};
  await app.click({sellerIntelligenceModule:'product'});let html=app.html('shopAnalysis');assert.match(html,/other-sku/);assert.doesNotMatch(html,/shop-product-3/);
  app.state.shopId='shop-a';app.state.data={shop:{id:'shop-a'},seller_analysis:data};html=app.html('shopAnalysis');
  assert.match(html,/id="sellerModule-opportunities"[^>]*aria-selected="true"/);assert.match(html,new RegExp(`value="${data.products[3].sku}" selected`));
  assert.equal(app.requests.length,0);
});
