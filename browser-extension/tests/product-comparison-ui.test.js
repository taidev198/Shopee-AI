import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../../static/app.js',import.meta.url),'utf8')).split('// Delegated interactions')[0];
function own(id){return {role:'own',sku:`1_${id}`,source_shop:'my_shop',name:`Rây inox ${id}`,price:5000,sold_total:1000,sold_lower_bound:true,review_count:30,rating:4.9}}
function fixture(){const products=[1,2,3,4].map(own);return {shop:{name:'My shop',url:'https://shopee.vn/my_shop',is_demo:false},own_products:products,market_products:[],competitor_analysis:{summary:{product_count:0},product_comparisons:products.map((product,index)=>({own_product:product,ranking_basis:'cumulative_sold',query:`ray inox ${index+1}`,competitors:[],summary:{shop_count:0,product_count:0,sold_count:0,review_count_known:0}}))}}}
function setup(){
 const data=fixture(),events=[],calls=[];
 const context=vm.createContext({URL,Intl,document:{getElementById:()=>null},window:{MarketLensChrome:{}},fetch:async(path,options)=>{
   const body=JSON.parse(options.body);calls.push({path,body});events.push(path.endsWith('/result')?'save':'create');
   if(path.endsWith('/result'))return {ok:true,json:async()=>({status:'done'})};
   return {ok:true,json:async()=>({job_id:`job-${calls.length}`,result_token:'token'})};
 }});
 vm.runInContext(source,context);context.data=data;
 vm.runInContext('S.data=data;S.shopId="workspace";S.view="competitors";S.crawler={enabled:true};render=()=>{};loadReport=async()=>true',context);
 context.window.MarketLensChrome={ping:async()=>({version:'1.2.0',capabilities:{discover:true}}),discover:async query=>{events.push('discover:'+query);return {query,candidates:[1,2,3,4].map(id=>({url:`https://shopee.vn/seller_${id}`,name:`Seller ${id}`,product_url:`https://shopee.vn/product/${id}/${id+10}`,product_name:'Rây inox'}))}},detail:async url=>{events.push('read');return {detail:{url,name:'Rây đối thủ',description:'Chi tiết thật'}}}};
 return {data,context,calls,events,run:sku=>{context.ownSku=sku;return vm.runInContext('compareTopProducts(ownSku)',context)}};
}

test('per-product comparison shows each competitor range, sold count, review count, freshness and match label before shop summary',()=>{
 const {data,context}=setup();
 const rival={role:'market',sku:'2_12',source_shop:'Kitchen',name:'Rây tương tự',price:7500,price_min:7000,price_max:9000,sold_total:300,sold_lower_bound:true,review_count:27,rating:4.8,snapshot_date:'2026-10-14',detail_collected_at:'2026-10-14T09:00:00',match_label:'Tên tương tự; chưa xác nhận cùng quy cách'};
 data.competitor_analysis.product_comparisons[0].competitors=[rival];
 data.competitor_analysis.product_comparisons[0].summary={shop_count:1,product_count:1,price_min:7000,price_max:9000,sold_count:1,review_count_known:1};
 const html=vm.runInContext('renderCompetitors(data)',context);
 assert.ok(html.includes('Top sản phẩm của bạn đang cạnh tranh với ai?'));
 assert.ok(html.indexOf('product-comparison-card')<html.indexOf('competitor-kpis'));
 for(const text of ['Kitchen','7.000 ₫ – 9.000 ₫','≥ 300','27','★ 4.8','2026-10-14','Tên tương tự; chưa xác nhận cùng quy cách','THEO TỔNG ĐÃ BÁN'])assert.ok(html.includes(text),text);
 assert.equal(vm.runInContext('findProductByKey(data,productKey(data.competitor_analysis.product_comparisons[0].competitors[0])).name',context),'Rây tương tự');
});

test('ranking labels distinguish reported, estimated, cumulative and missing sale periods',()=>{
 const {data,context}=setup();
 data.competitor_analysis.product_comparisons[0].ranking_basis='reported_30d';data.competitor_analysis.product_comparisons[0].own_product.units_30d=50;
 data.competitor_analysis.product_comparisons[1].ranking_basis='estimated_30d';data.competitor_analysis.product_comparisons[1].own_product.units_30d=40;
 data.competitor_analysis.product_comparisons[3].ranking_basis='unknown';data.competitor_analysis.product_comparisons[3].own_product.sold_total=null;
 const html=vm.runInContext('productComparisonSection(data,data.competitor_analysis)',context);
 assert.ok(html.includes('Bán 30 ngày: 50'));assert.ok(html.includes('Ước tính Bán 30 ngày: 40'));
 assert.ok(html.includes('THEO TỔNG ĐÃ BÁN'));assert.ok(html.includes('CHƯA CÓ SỐ BÁN'));assert.ok(html.includes('Chưa có số bán; tham chiếu lượt đánh giá'));
});

test('deep automatic flow searches only top three and checkpoints at most three fresh product pages per query',async()=>{
 const {calls,events,context,run}=setup();await run();
 assert.equal(events.filter(event=>event.startsWith('discover:')).length,3);
 assert.equal(events.filter(event=>event==='read').length,9);
 assert.equal(calls.filter(call=>call.path.endsWith('/result')).length,9);
 for(let index=0;index<events.length;index++)if(events[index]==='read'){assert.equal(events[index-1],'create');assert.equal(events[index+1],'save')}
 assert.deepEqual([...new Set(calls.filter(call=>!call.path.endsWith('/result')).map(call=>call.body.own_sku))],['1_1','1_2','1_3']);
 assert.equal(calls[1].body.detail.description,'Chi tiết thật');
 assert.equal(vm.runInContext('S.crawlRun.completed',context),9);assert.equal(vm.runInContext('S.crawlSubmitting',context),false);
});

test('targeted row refresh searches exactly that own product and keeps other top products untouched',async()=>{
 const {calls,events,run}=setup();await run('1_4');
 assert.deepEqual(events.filter(event=>event.startsWith('discover:')),['discover:ray inox 4']);
 assert.ok(calls.filter(call=>call.body.own_sku).every(call=>call.body.own_sku==='1_4'));
});

test('blocked product detail is saved as failure and stops later products and queries',async()=>{
 const {context,calls,events,run}=setup();let reads=0;
 context.window.MarketLensChrome.detail=async url=>{events.push('read');if(++reads===2)throw Object.assign(new Error('Yêu cầu xác minh'),{blocked:true,code:'blocked'});return {detail:{url,name:'Rây'}}};
 await run();
 assert.equal(reads,2);assert.equal(calls.at(-1).body.error,'Yêu cầu xác minh');
 assert.equal(vm.runInContext('S.crawlRun.completed',context),1);assert.equal(vm.runInContext('S.crawlRun.failed',context),1);
 assert.equal(events.filter(event=>event.startsWith('discover:')).length,1);
});

test('requested stop persists current detail, then stops before the next page',async()=>{
 const {context,calls,run}=setup();let reads=0;
 context.window.MarketLensChrome.detail=async url=>{reads++;vm.runInContext('S.crawlRun.stopRequested=true',context);return {detail:{url,name:'Đã đọc trước khi dừng'}}};
 await run();assert.equal(reads,1);assert.equal(calls.at(-1).body.detail.name,'Đã đọc trước khi dừng');
 assert.match(vm.runInContext('S.crawlRun.message',context),/Đã dừng theo yêu cầu/);
});

test('callback failure or unconfirmed status is never counted as a saved product and stops further reads',async()=>{
 const {context,events,run}=setup();
 context.fetch=async(path)=>({ok:true,json:async()=>path.endsWith('/result')?{status:'running'}:{job_id:'job',result_token:'token'}});
 await run();assert.equal(events.filter(event=>event==='read').length,1);assert.equal(vm.runInContext('S.crawlRun.completed',context),0);
 assert.match(vm.runInContext('S.crawlRun.message',context),/chưa xác nhận đã lưu/);
});

test('blocked discovery with retained candidates never opens product detail or writes product jobs',async()=>{
 const {context,calls,events,run}=setup();
 context.window.MarketLensChrome.discover=async()=>({blocked:true,candidates:[{url:'https://shopee.vn/seller_1',product_url:'https://shopee.vn/product/1/11'}],errors:['Shopee yêu cầu xác minh']});
 await run();assert.equal(calls.length,0);assert.equal(events.filter(event=>event==='read').length,0);
});

test('switching workspace keeps the current authorized checkpoint but never reads the next product',async()=>{
 const {context,calls,run}=setup();let reads=0;
 context.window.MarketLensChrome.detail=async url=>{reads++;vm.runInContext('S.shopId="other";S.competitor={}',context);return {detail:{url,name:'Current product'}}};
 await run();assert.equal(reads,1);assert.equal(calls.at(-1).body.detail.name,'Current product');assert.equal(vm.runInContext('S.crawlSubmitting',context),false);
});

test('a discovery result with no candidates retains its returned error and reports actual own-product coverage',async()=>{
 const {context,calls,run}=setup(),discover=context.window.MarketLensChrome.discover;
 context.window.MarketLensChrome.discover=async query=>query==='ray inox 2'?{candidates:[],errors:['Trang sản phẩm chưa hiển thị liên kết Xem shop.']}:discover(query);
 await run();
 assert.equal(calls.filter(call=>call.path.endsWith('/result')).length,6);
 assert.equal(vm.runInContext('S.crawlRun.completed',context),6);
 assert.equal(vm.runInContext('S.crawlRun.searched',context),3);
 assert.equal(vm.runInContext('S.crawlRun.savedOwn',context),2);
 assert.equal(vm.runInContext('S.crawlRun.skipped',context),1);
 assert.match(vm.runInContext('S.crawlRun.message',context),/Đã lưu 6 sản phẩm đối thủ cho 2\/3 sản phẩm của bạn/);
 assert.ok(vm.runInContext('S.competitor.deepErrors.some(error=>error.includes("Rây inox 2")&&error.includes("ray inox 2")&&error.includes("liên kết Xem shop"))',context));
});

test('partial discovery warnings keep their product context while valid candidates are still saved',async()=>{
 const {context,calls,run}=setup(),discover=context.window.MarketLensChrome.discover;
 context.window.MarketLensChrome.discover=async query=>({...await discover(query),errors:[{message:'Một người bán chưa tải được trang.'}]});
 await run('1_2');
 assert.equal(calls.filter(call=>call.path.endsWith('/result')).length,3);
 assert.equal(vm.runInContext('S.crawlRun.savedOwn',context),1);
 assert.match(vm.runInContext('S.competitor.deepErrors[0]',context),/Rây inox 2.*ray inox 2.*Một người bán/);
 assert.match(vm.runInContext('S.crawlRun.message',context),/cho 1\/1 sản phẩm của bạn/);
});

test('empty discovery without an error explains which product has no candidate',async()=>{
 const {context,calls,run}=setup();
 context.window.MarketLensChrome.discover=async()=>({candidates:[]});
 await run('1_3');
 assert.equal(calls.length,0);
 assert.equal(vm.runInContext('S.crawlRun.skipped',context),1);
 assert.match(vm.runInContext('S.competitor.deepErrors[0]',context),/Rây inox 3.*Chưa tìm được sản phẩm đối thủ/);
 assert.match(vm.runInContext('S.crawlRun.message',context),/cho 0\/1 sản phẩm của bạn/);
});

test('server-declared failed callbacks are visible and do not count toward saved own-product coverage',async()=>{
 const {context,run}=setup();
 context.fetch=async path=>({ok:true,json:async()=>path.endsWith('/result')?{status:'failed',error:'Trang chi tiết không đủ dữ liệu.'}:{job_id:'job',result_token:'token'}});
 await run('1_1');
 assert.equal(vm.runInContext('S.crawlRun.completed',context),0);
 assert.equal(vm.runInContext('S.crawlRun.failed',context),3);
 assert.equal(vm.runInContext('S.crawlRun.savedOwn',context),0);
 assert.equal(vm.runInContext('S.crawlRun.skipped',context),1);
 assert.match(vm.runInContext('S.competitor.deepErrors[0]',context),/Rây inox 1.*Seller 1.*Trang chi tiết không đủ dữ liệu/);
 assert.match(vm.runInContext('S.crawlRun.message',context),/3 lượt đọc lỗi/);
});
