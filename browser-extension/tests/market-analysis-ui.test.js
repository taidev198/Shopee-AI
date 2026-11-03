import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../static/market-analysis.js',import.meta.url),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>value==null?'—':new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(value);
const product=(extra={})=>({sku:'12.34',name:'Rây lọc inox',url:'https://shopee.vn/product/12/34',category_id:'10001',category:'Gia dụng',shop_id:'12',shop_name:'Kitchen',shop_url:'https://shopee.vn/kitchen_shop',price:89000,sold_total:1000,sold_approx:true,review_count:25,rating:4.9,day:'2026-10-14',collected_at:'2026-10-14T09:00:00+07:00',velocity:null,acceleration:null,trend_score:null,reason:'Cần thêm lịch sử.',...extra});
function response(extra={}) {
  return {filters:{category_id:'',days:7},basis:{sales:'public_cumulative',sales_label:'Số bán cộng dồn công khai; gồm giá trị làm tròn/cận dưới',window_start:'2026-10-08',window_end:'2026-10-14'},
    summary:{product_count:137,shop_count:11,category_count:1,snapshot_count:137,day_count:1,exact_sales_count:0,approx_sales_count:137,latest_at:'2026-10-14T09:00:00+07:00',history_ready_count:0},
    categories:[{id:'10001',name:'Gia dụng',product_count:137,shop_count:11,price_min:10000,price_median:89000,price_max:500000,sold_total:150000,sold_known:137,approx_count:137},
      {id:'10002',name:'Đời sống',product_count:0,shop_count:0,price_min:null,price_median:null,price_max:null,sold_total:null,sold_known:0,approx_count:0}],
    top_products:[product()],top_shops:[{shop_id:'12',shop_name:'Kitchen',shop_url:'https://shopee.vn/kitchen_shop',product_count:1,sold_total:1000,sold_known:1,approx_count:1,review_count:25,price_median:89000,latest_at:'2026-10-14T09:00:00+07:00'}],
    price_bands:[{label:'Dưới 50.000 ₫',min:0,max:50000,count:20},{label:'50.000 – 100.000 ₫',min:50000,max:100000,count:100},{label:'Trên 100.000 ₫',min:100000,max:null,count:17}],
    history:[{day:'2026-10-14',product_count:137,sold_known:137,exact_count:0}],trend_candidates:[],ml_candidates:[],
    coverage:{runs:27,pending:26,paused:1,done:0,partial:0,discovered:180,completed:137},
    model:{status:'waiting',algorithm:'kmeans_standardized_log_features',reason:'Cần đủ dữ liệu trong từng ngành.',training_product_count:0,groups_count:0,artifact_available:false},...extra};
}

function setup(apiHandler=async()=>response()) {
  const listeners={},requests=[],scheduled=[],renders=[],intervals=[];
  const context=vm.createContext({URL,URLSearchParams,Date,Intl,Number,String,Array,Map,Promise,
    S:{view:'marketAnalysis',data:null,shopId:null},esc:escape,num:number,money:value=>value==null?'—':number(value)+' ₫',
    document:{addEventListener(type,callback){listeners[type]=callback;}},
    setTimeout(callback){scheduled.push(callback);},render(){renders.push(true);},
    setInterval(callback,ms){intervals.push({callback,ms});},
    api:async(path,options)=>{requests.push({path,options});return apiHandler(path,options);},
  });
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  const click=async(id,dataset={})=>listeners.click({target:{closest:()=>({id,dataset,disabled:false})}});
  const change=async(id,value)=>listeners.change({target:{id,value}});
  return {context,requests,scheduled,renders,intervals,run,click,change,html:()=>run('renderMarketAnalysis()')};
}

test('analysis starts from the category database without a selected shop or demo fallback',async()=>{
  const app=setup();
  assert.match(app.html(),/Chưa có kết quả cho bộ lọc hiện tại/);
  assert.equal(app.scheduled.length,1);
  await app.scheduled[0]();
  assert.equal(app.requests[0].path,'/api/category-market/analysis?category_id=&days=7&limit=100&all_rows=true');
  assert.match(app.html(),/Rây lọc inox/);
  assert.match(app.html(),/137/);
  assert.ok(!app.requests.some(request=>request.path.includes('/dashboard')||request.path.includes('shop_id')));
});

test('one day of rounded sales is labeled cumulative and does not produce fake hot trends or model predictions',async()=>{
  const app=setup();await app.run('refreshMarketAnalysis()');
  const html=app.html();
  assert.match(html,/≥ 1\.000/);
  assert.match(html,/đây không phải lượng bán trong 7 ngày/);
  assert.match(html,/Chưa đủ lịch sử để xác định sản phẩm tăng tốc/);
  assert.match(html,/Cần ít nhất 3 ngày có số bán hoặc lượt đánh giá chính xác/);
  assert.match(html,/số bán dạng 1k \/ 1k\+ không dùng để suy diễn tăng trưởng/);
  assert.match(html,/không dự báo doanh số hoặc hot trend tương lai/);
  assert.match(html,/Chưa có kết quả mô hình/);
  assert.doesNotMatch(html,/class="ma-trend-card"/);
  assert.doesNotMatch(html,/href="\/api\/category-market\/ml\/export"/);
});

test('analysis passes all returned categories, trend cards and ML candidates to pagination beyond old previews',async()=>{
  const products=Array.from({length:25},(_,index)=>product({sku:`12.${index}`,name:`Mặt hàng ${index+1}`,trend_basis:'sales',velocity:2,acceleration:1,trend_score:60,ml_signal_score:70}));
  const categories=Array.from({length:27},(_,index)=>({id:String(index),name:`Ngành ${index+1}`,product_count:index<15?1:0,shop_count:1}));
  const app=setup(async()=>response({categories,trend_candidates:products,ml_candidates:products}));
  await app.run('refreshMarketAnalysis()');
  assert.match(app.run('analysisCategories(marketAnalysisState.data.categories)'),/Ngành 27/);
  assert.match(app.run('analysisTrends(marketAnalysisState.data.trend_candidates,marketAnalysisState.data.summary)'),/Mặt hàng 25/);
  assert.match(app.run('analysisModel(marketAnalysisState.data.model,marketAnalysisState.data.ml_candidates)'),/Mặt hàng 25/);
  await app.click('marketAnalysisCategoriesMore');
  const observed=app.run('analysisCategories(marketAnalysisState.data.categories)');
  assert.match(observed,/Ngành 15/);
  assert.doesNotMatch(observed,/Ngành 27/);
});

test('automatic refresh reads new database results without a manual train POST and pauses in other tabs',async()=>{
  let reads=0;
  const app=setup(async()=>response({generated_at:'2026-10-15T03:00:00Z',top_products:[product({name:`Dữ liệu lượt ${++reads}`})],
    learning:{enabled:true,state:'ready',interval_seconds:30,last_checked_at:'2026-10-15T03:00:00Z'},
    insights:[{title:'Nhận định từ DB',body:`Có ${reads} lượt dữ liệu`,kind:'test'}]}));
  await app.run('refreshMarketAnalysis()');
  assert.equal(app.intervals[0].ms,30000);
  await app.intervals[0].callback();
  assert.equal(reads,2);
  assert.match(app.html(),/Dữ liệu lượt 2/);
  assert.match(app.html(),/Tự học và cập nhật đang bật/);
  assert.match(app.html(),/Có 2 lượt dữ liệu/);
  assert.ok(app.requests.every(request=>!request.options?.method||request.options.method==='GET'));
  app.run("S.view='products'");
  await app.intervals[0].callback();
  assert.equal(reads,2);
  app.run("S.view='marketAnalysis';document.hidden=true");
  await app.intervals[0].callback();
  assert.equal(reads,2);
});

test('automatic explanations and learning failures escape text and do not create unsafe source links',()=>{
  const app=setup();app.context.report={learning:{enabled:true,state:'error',last_error:'<script>unsafe</script>'},
    insights:[{title:'<img src=x>',body:'<script>text</script>',url:'javascript:alert(1)'}]};
  const html=app.run('analysisAutomatic(report)');
  assert.match(html,/&lt;script&gt;unsafe/);
  assert.doesNotMatch(html,/<script>|<img src=x>|href="javascript:/);
});

test('category and observation window controls fetch fresh data and preserve their selected values',async()=>{
  const app=setup();await app.run('loadMarketAnalysis()');
  await app.change('marketAnalysisCategory','10001');
  await app.change('marketAnalysisDays','30');
  assert.equal(app.requests.at(-1).path,'/api/category-market/analysis?category_id=10001&days=30&limit=100&all_rows=true');
  assert.match(app.html(),/value="10001" selected/);
  assert.match(app.html(),/value="30" selected/);
  await app.click('marketAnalysisRefresh');
  assert.equal(app.requests.at(-1).path,'/api/category-market/analysis?category_id=10001&days=30&limit=100&all_rows=true');
  await app.change('marketAnalysisDays','365');
  assert.equal(app.run('marketAnalysisState.days'),30);
});

test('late responses cannot overwrite a newer category filter or its loaded result',async()=>{
  const pending=[];
  const app=setup(()=>new Promise(resolve=>pending.push(resolve)));
  const first=app.run('loadMarketAnalysis()');
  const second=app.change('marketAnalysisCategory','10002');
  pending[1](response({top_products:[product({name:'New filtered product'})]}));
  await second;
  pending[0](response({top_products:[product({name:'Old stale product'})]}));
  await first;
  assert.match(app.html(),/New filtered product/);
  assert.doesNotMatch(app.html(),/Old stale product/);
  assert.equal(app.run('marketAnalysisState.categoryId'),'10002');
  assert.equal(app.run('marketAnalysisState.loading'),false);
});

test('changing filters hides previous-scope rankings while loading and after a failed update',async()=>{
  let calls=0,rejectNew;
  const app=setup(async()=>{
    calls++;
    if(calls===1) return response();
    return new Promise((resolve,reject)=>{rejectNew=reject;});
  });
  await app.run('loadMarketAnalysis()');
  assert.match(app.html(),/Rây lọc inox/);
  const changed=app.change('marketAnalysisCategory','10002');
  assert.match(app.html(),/value="10002" selected/);
  assert.match(app.html(),/Đang đọc dữ liệu phân tích cho bộ lọc hiện tại/);
  assert.doesNotMatch(app.html(),/Rây lọc inox|id="marketAnalysisProducts"/);
  rejectNew(new Error('Ngành mới chưa tải được'));await changed;
  const html=app.html();
  assert.match(html,/Ngành mới chưa tải được/);
  assert.match(html,/Kết quả của bộ lọc khác không được đưa vào báo cáo này/);
  assert.doesNotMatch(html,/Rây lọc inox|Đang giữ kết quả lần đọc trước/);
  assert.equal(app.run('marketAnalysisState.data.summary.product_count'),137);
});

test('source text is escaped and links allow only clean public Shopee URLs',async()=>{
  const app=setup(async()=>response({top_products:[product({name:'<img onerror="bad()">',url:'javascript:alert(1)',shop_name:'<script>seller</script>',shop_url:'https://shopee.vn.evil.com/shop'})],
    categories:[{id:'10001',name:'<script>category</script>',product_count:1,shop_count:1,price_min:null,price_max:null,price_median:null,sold_total:0,sold_known:1}],
    ml_candidates:[product({name:'<b>model</b>',url:'https://user@shopee.vn/product/12/34',segment:'<script>segment</script>',ml_reason:'<img src=x>',ml_signal_score:70})]}));
  await app.run('loadMarketAnalysis()');
  const html=app.html();
  assert.match(html,/&lt;img onerror=&quot;bad\(\)&quot;&gt;/);
  assert.match(html,/&lt;script&gt;seller&lt;\/script&gt;/);
  assert.match(html,/&lt;script&gt;category&lt;\/script&gt;/);
  assert.match(html,/&lt;script&gt;segment&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>|<img onerror|href="javascript|shopee\.vn\.evil\.com|href="https:\/\/user@/);
  assert.equal(app.run("analysisShopeeUrl('https://www.shopee.vn/product/12/34?tracking=discard')"),'https://shopee.vn/product/12/34');
  assert.equal(app.run("analysisShopeeUrl('https://shopee.vn:444/product/12/34')"),'');
});

test('known zeros remain zeros and missing numbers remain unavailable in tables',async()=>{
  const app=setup(async()=>response({top_products:[product({sold_total:0,sold_approx:false,review_count:0,rating:null,price:null})]}));
  await app.run('loadMarketAnalysis()');
  const table=app.run('analysisProductTable(marketAnalysisState.data.top_products,marketAnalysisState.data.summary)');
  assert.match(table,/<strong>0<\/strong>/);
  assert.match(table,/<td>0<\/td>/);
  assert.match(table,/<td class="numeric">—<\/td>/);
  assert.doesNotMatch(table,/≥ 0/);
});

test('shop review totals disclose approximate contributions and unknown totals remain missing',async()=>{
  const app=setup(async()=>response({top_shops:[{shop_id:'12',shop_name:'Kitchen',product_count:2,sold_total:0,sold_known:1,review_count:2000,review_known:2,review_approx_count:1},
    {shop_id:'13',shop_name:'Other',product_count:1,sold_total:null,sold_known:0,review_count:0,review_known:0,review_approx_count:0}]}));
  await app.run('loadMarketAnalysis()');
  const table=app.run('analysisShopTable(marketAnalysisState.data.top_shops)');
  assert.match(table,/≥ 2\.000/);
  assert.match(table,/Có số đánh giá làm tròn/);
  assert.match(table,/<td>—<\/td>/);
});

test('review-based trends have review units and never substitute their velocity for product sales',async()=>{
  const review=product({trend_basis:'reviews',sold_approx:true,review_approx:true,review_count:1000,review_velocity:2.5,review_acceleration:1.25,velocity:null,acceleration:null,reason:'Đánh giá tăng; không quy đổi thành số bán.'});
  const app=setup(async()=>response({top_products:[review],trend_candidates:[review],summary:{product_count:1,shop_count:1,day_count:3,history_ready_count:1}}));
  await app.run('loadMarketAnalysis()');
  const trends=app.run('analysisTrends(marketAnalysisState.data.trend_candidates,marketAnalysisState.data.summary)');
  assert.match(trends,/Tốc độ đánh giá quan sát/);
  assert.match(trends,/2\.50.*đánh giá\/ngày/);
  assert.match(trends,/\+1\.25.*đánh giá\/ngày/);
  assert.doesNotMatch(trends,/SP\/ngày|Tốc độ bán quan sát/);
  assert.match(app.html(),/Số đánh giá hiển thị làm tròn/);
});

test('price band and history bar sizes come from actual counts and explain observed coverage',async()=>{
  const app=setup();await app.run('loadMarketAnalysis()');
  const html=app.html();
  assert.match(html,/width:20%/);
  assert.match(html,/width:100%/);
  assert.match(html,/137 sản phẩm có giá/);
  assert.match(html,/Số SKU được quan sát mỗi ngày, không phải số bán/);
  assert.match(html,/1 ngày có ghi nhận trong cửa sổ 7 ngày/);
});

test('training is a real POST with loading state, then refreshes model scores from the database',async()=>{
  let trained=false,finish;
  const trainedModel={status:'trained',algorithm:'kmeans_standardized_log_features',training_product_count:137,training_cutoff:'2026-10-14T09:00:00+07:00',trained_at:'2026-10-14T10:00:00+07:00',groups_count:1,artifact_available:true};
  const app=setup(async(path,options)=>{
    if(options?.method==='POST') {await new Promise(resolve=>{finish=resolve;});trained=true;return {model:trainedModel};}
    return trained?response({model:trainedModel,ml_candidates:[product({ml_signal_score:82,segment:'Nhóm phổ biến',ml_reason:'Vị thế trong ngành đã học.'})]}):response();
  });
  await app.run('loadMarketAnalysis()');
  const training=app.click('marketAnalysisTrain');
  assert.equal(app.run('marketAnalysisState.training'),true);
  assert.match(app.html(),/id="marketAnalysisTrain" disabled/);
  assert.match(app.html(),/Đang huấn luyện…/);
  await app.click('marketAnalysisTrain');
  assert.equal(app.requests.filter(request=>request.options?.method==='POST').length,1);
  finish();await training;
  const post=app.requests.find(request=>request.options?.method==='POST');
  assert.equal(post.path,'/api/category-market/ml/train');assert.equal(post.options.body,'{}');
  assert.equal(app.run('marketAnalysisState.training'),false);
  assert.match(app.html(),/Nhóm phổ biến/);
  assert.match(app.html(),/>82<small>\/100/);
  assert.match(app.html(),/href="\/api\/category-market\/ml\/export"/);
  assert.match(app.html(),/không phải xác suất bán chạy/);
  assert.equal(app.requests.filter(request=>request.path.startsWith('/api/category-market/analysis?')).length,2);
});

test('training failures preserve the last saved model and expose an actionable error',async()=>{
  const model={status:'trained',training_product_count:137,artifact_available:true};
  const app=setup(async(path,options)=>{if(options?.method==='POST')throw new Error('Database đang bận');return response({model});});
  await app.run('loadMarketAnalysis()');await app.click('marketAnalysisTrain');
  assert.equal(app.run('marketAnalysisState.data.model.status'),'trained');
  assert.match(app.html(),/Huấn luyện chưa thành công: Database đang bận/);
  assert.match(app.html(),/Kết quả đã có được giữ lại/);
  assert.match(app.html(),/href="\/api\/category-market\/ml\/export"/);
});

test('successful training followed by a failed refresh explains why the previous scores are still shown',async()=>{
  let trained=false;
  const app=setup(async(path,options)=>{
    if(options?.method==='POST'){trained=true;return {model:{status:'trained'}};}
    if(trained) throw new Error('Chưa tải được kết quả');
    return response();
  });
  await app.run('loadMarketAnalysis()');await app.click('marketAnalysisTrain');
  assert.match(app.html(),/Mô hình đã huấn luyện, nhưng chưa tải được kết quả mới/);
  assert.match(app.html(),/Bấm Làm mới phân tích để đọc lại/);
  assert.match(app.html(),/Đang giữ kết quả lần đọc trước/);
  assert.equal(app.run('marketAnalysisState.data.model.status'),'waiting');
  assert.equal(app.run('marketAnalysisState.training'),false);
});

test('section navigation reaches products, shops, observed trends and the separate ML panel',async()=>{
  const app=setup(async()=>response({model:{status:'trained',stale:true,artifact_available:true}}));
  await app.run('loadMarketAnalysis()');
  const html=app.html();
  for(const section of ['Products','Shops','Trends','Model']){
    assert.match(html,new RegExp(`href="#marketAnalysis${section}"`));
    assert.match(html,new RegExp(`id="marketAnalysis${section}"`));
  }
  assert.match(html,/Kho dữ liệu đã thay đổi sau lần huấn luyện/);
});

test('refresh failure keeps the last analysis and announces it instead of showing synthetic replacements',async()=>{
  let fail=false;
  const app=setup(async()=>{if(fail)throw new Error('Không kết nối được máy chủ');return response();});
  await app.run('loadMarketAnalysis()');fail=true;await app.click('marketAnalysisRefresh');
  assert.match(app.html(),/Không kết nối được máy chủ/);
  assert.match(app.html(),/Đang giữ kết quả lần đọc trước/);
  assert.match(app.html(),/Rây lọc inox/);
  assert.equal(app.run('marketAnalysisState.loading'),false);
});

test('a finished background request updates cached analysis without rendering a different active tab',async()=>{
  let finish;const app=setup(()=>new Promise(resolve=>{finish=resolve;}));
  const request=app.run('loadMarketAnalysis()');
  app.run("S.view='products'");const count=app.renders.length;
  finish(response());await request;
  assert.equal(app.renders.length,count);
  assert.equal(app.run('marketAnalysisState.data.summary.product_count'),137);
});
