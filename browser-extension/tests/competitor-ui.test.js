import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../../static/app.js',import.meta.url),'utf8')).split('// Delegated interactions')[0];
function setup(data={shop:{name:'Shop tôi',url:'https://shopee.vn/my_shop',is_demo:false},own_products:[],market_products:[]}){
 const submissions=[];
 const context=vm.createContext({URL,Intl,document:{getElementById:()=>null,querySelector:()=>({requestSubmit:()=>submissions.push(vm.runInContext('S.competitor.url',context))})},window:{MarketLensChrome:{}}});
 vm.runInContext(source,context);context.data=data;
 vm.runInContext('S.data=data;S.shopId="workspace";S.view="competitors";S.crawler={enabled:true};render=()=>{}',context);
 return {context,submissions,render:()=>vm.runInContext('renderCompetitors(data)',context)};
}
function product(id,extra={}){return {role:'market',sku:`1_${id}`,source_shop:'Kitchen',name:`Sản phẩm ${id}`,category:'Rây lọc',price:100,sold_total:null,rating:null,snapshot_date:'2026-10-14',...extra}}
function withAnalysis(extra={}){return {shop:{name:'Shop tôi',url:'https://shopee.vn/my_shop',is_demo:false},own_products:[product(1,{role:'own',source_shop:'my_shop',price:10}),product(2,{role:'own',source_shop:'my_shop',price:20})],market_products:[product(3,{price:25,sold_total:1000,sold_lower_bound:true})],competitor_analysis:{summary:{shop_count:1,product_count:1,own_product_count:2,own_median_price:15,market_median_price:25,price_count:1,sold_count:1,monthly_count:0},shops:[{source_shop:'Kitchen',product_count:1,median_price:25,price_count:1,rating_count:0,sold_total_sum:1000,sold_count:1,sold_lower_bound_count:1,detail_count:0,monthly_count:0,latest_snapshot:'2026-10-14'}],categories:[{category:'Rây lọc',own_count:2,market_count:1,own_median_price:15,market_median_price:25,gap_pct:66.7,shop_count:1}],recommendations:[],discovery_queries:[{query:'rây lọc inox',category:'Rây lọc',own_product_name:'Rây lọc'}]},...extra}}

test('empty real workspace offers automatic finding and secondary market scan without asking for a CSV',()=>{
 const {render}=setup(withAnalysis({market_products:[],competitor_analysis:{summary:{product_count:0},discovery_queries:[{query:'rây lọc inox'}]}}));
 const html=render();
 assert.ok(html.includes('Tự tìm &amp; phân tích')||html.includes('Tự tìm & phân tích'));
 assert.match(html,/id="discoverCompetitors"/);
 assert.match(html,/<details class="competitor-manual" >/);
 assert.match(html,/name="role" value="market"/);
 assert.match(html,/name="browser_mode" value="chrome"/);
 assert.match(html,/name="detail_limit"/);
 assert.match(html,/value="20" selected/);
 assert.match(html,/name="read_details" checked/);
 assert.ok(!html.includes('value="https://shopee.vn/my_shop"'));
 assert.ok(html.includes('Chưa có dữ liệu đối thủ để so sánh'));
});

test('comparison includes own shop, correct even median, partial coverage and cumulative sold labels',()=>{
 const {context,render}=setup(withAnalysis());const html=render();
 assert.equal(vm.runInContext('comparisonStats(data.own_products,"own").median_price',context),15);
 assert.match(html,/comparison-own/);assert.ok(html.includes('SHOP CỦA BẠN'));
 assert.ok(html.includes('15 ₫'));assert.ok(html.includes('25 ₫'));
 assert.ok(html.includes('≥ 1.000'));assert.ok(html.includes('TỔNG ĐÃ BÁN HIỂN THỊ'));
 assert.ok(html.includes('không phải lượng bán 30 ngày'));
 assert.ok(html.includes('Có số đã bán: 1/1 SP'));
 assert.ok(html.includes('+66,7% · cao hơn'));
 assert.ok(html.includes('chưa xác định được tốc độ bán 30 ngày'));
});

test('filters combine shop, category and query; numeric sorts retain unknown metrics at the end',()=>{
 const {context}=setup();
 context.products=[product(1,{name:'Rây A',price:20,sold_total:0}),product(2,{name:'Rây B',price:null,sold_total:null}),product(3,{source_shop:'Other',name:'Rây C',price:5,sold_total:50}),product(4,{category:'Nồi',name:'Nồi',price:10,sold_total:20})];
 context.filters={shop:'Kitchen',category:'Rây lọc',query:'rây',sort:'price_asc'};
 assert.equal(vm.runInContext('filteredCompetitorProducts(products,filters).map(p=>p.sku).join(",")',context),'1_1,1_2');
 context.filters={shop:'',category:'',query:'',sort:'sold'};
 assert.equal(vm.runInContext('filteredCompetitorProducts(products,filters).map(p=>p.sku).join(",")',context),'1_3,1_4,1_1,1_2');
});

test('table paginates at 50 products and discloses total analysis versus server display cap',()=>{
 const data=withAnalysis({market_products:Array.from({length:151},(_,index)=>product(index+10)),market_products_total:400,market_products_truncated:true});
 data.competitor_analysis.summary.product_count=400;
 const {context,render}=setup(data);const first=render();
 assert.equal((first.match(/data-product-key=/g)||[]).length,100);
 assert.ok(first.includes('1–50 / 151 sản phẩm'));assert.ok(first.includes('Trang 1 / 4'));
 assert.ok(first.includes('toàn bộ 400 sản phẩm'));
 vm.runInContext('S.competitor.page=4',context);const last=render();
 assert.equal((last.match(/data-product-key=/g)||[]).length,2);
 assert.ok(last.includes('151–151 / 151 sản phẩm'));
});

test('recommendations disclose broad category matches and escape product names and reasons',()=>{
 const data=withAnalysis();data.competitor_analysis.recommendations=[product(3,{name:'<img onerror=alert(1)>',score:54,confidence:'Rất thấp',category_match:'parent',category_match_label:'Cùng nhóm hàng rộng',price_gap_pct:-10,reasons:['<script>alert(1)</script>','Chưa biết lượng bán 30 ngày']})];
 const html=setup(data).render();
 assert.ok(html.includes('Cùng nhóm hàng rộng'));assert.ok(html.includes('-10%'));
 assert.ok(html.includes('&lt;img onerror=alert(1)&gt;'));
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img onerror'));
});

test('competitor paging accepts a selected size, clamps the last page and preserves it on rerender',()=>{
 const data=withAnalysis({market_products:Array.from({length:151},(_,index)=>product(index+10))});
 const {context,render}=setup(data);
 vm.runInContext('S.competitor.pageSize=20;S.competitor.page=8',context);
 const last=render();
 assert.ok(last.includes('141–151 / 151 sản phẩm'));
 assert.ok(last.includes('Trang 8 / 8'));
 assert.ok(last.includes('value="20" selected'));
 assert.ok(last.includes('« Đầu'));
 assert.ok(last.includes('Cuối »'));
 assert.equal((last.match(/data-product-key=/g)||[]).length,22);
 assert.ok(render().includes('Trang 8 / 8'));
 context.data.market_products=data.market_products.slice(0,11);
 assert.ok(render().includes('Trang 1 / 1'));
});

test('all matching categories and recommendations reach the pagination layer beyond twelve entries',()=>{
 const data=withAnalysis();
 data.competitor_analysis.categories=Array.from({length:30},(_,index)=>({category:`Nhóm ${index+1}`,own_count:1,market_count:1,own_median_price:10,market_median_price:20,gap_pct:100,shop_count:1}));
 data.competitor_analysis.recommendations=Array.from({length:20},(_,index)=>product(index+100,{name:`Gợi ý ${index+1}`,score:60,reasons:[]}));
 const html=setup(data).render();
 assert.ok(html.includes('Nhóm 30'));
 assert.ok(html.includes('Gợi ý 20'));
 assert.ok(html.includes('data-pagination-key="competitor-recommendations"'));
 assert.ok(!html.includes('Đang hiển thị 12 nhóm đầu'));
});

test('detail lookup includes recommendations outside the capped product list and prefers current full records',()=>{
 const data=withAnalysis();data.competitor_analysis.recommendations=[product(900,{name:'Recommendation beyond cap'})];data.opportunities=[product(3,{name:'Older ranked copy'})];
 const {context}=setup(data);
 assert.equal(vm.runInContext('findProductByKey(data,productKey(data.competitor_analysis.recommendations[0])).name',context),'Recommendation beyond cap');
 assert.equal(vm.runInContext('findProductByKey(data,productKey(data.opportunities[0])).name',context),'Sản phẩm 3');
});

test('discovery uses fresh sequential queries, excludes own and duplicates, then automatically submits first shop',async()=>{
 const {context,submissions}=setup(withAnalysis());let active=0;const queries=[];
 context.data.competitor_analysis.discovery_queries.push({query:'lọc thực phẩm'});
 context.window.MarketLensChrome={ping:async()=>({version:'1.2.0',capabilities:{discover:true}}),discover:async query=>{
   assert.equal(active,0);active++;queries.push(query);await new Promise(resolve=>setImmediate(resolve));active--;
   return {query,candidates:[{url:'https://www.shopee.vn/MY_SHOP',name:'own'},{url:'https://shopee.vn/kitchen_shop',name:'Kitchen',product_url:'https://shopee.vn/product/2/3',product_name:'Rây inox'},{url:'https://www.shopee.vn/KITCHEN_SHOP',name:'duplicate'},{url:'javascript:alert(1)',name:'unsafe'}]};
 }};
 await vm.runInContext('discoverCompetitors()',context);
 assert.deepEqual(queries,['rây lọc inox','lọc thực phẩm']);
 assert.equal(vm.runInContext('S.competitor.candidates.length',context),1);
 assert.equal(vm.runInContext('S.competitor.discovering',context),false);
 assert.equal(vm.runInContext('S.competitor.detailLimit',context),20);
 assert.deepEqual(submissions,['https://shopee.vn/kitchen_shop']);
});

test('blocked discovery retains evidence but never automatically scans or sends further queries',async()=>{
 const {context,submissions}=setup(withAnalysis());let calls=0;
 context.data.competitor_analysis.discovery_queries.push({query:'another query'});
 context.window.MarketLensChrome={ping:async()=>({version:'1.2.0',capabilities:{discover:true}}),discover:async query=>{calls++;return {query,blocked:true,errors:['Shopee yêu cầu xác minh'],candidates:[{url:'https://shopee.vn/kitchen_shop',name:'Kitchen',product_name:'Rây',query}]}}};
 await vm.runInContext('discoverCompetitors()',context);
 assert.equal(calls,1);assert.equal(submissions.length,0);
 assert.equal(vm.runInContext('S.competitor.candidates.length',context),1);
 assert.ok(vm.runInContext('S.competitor.discoveryStatus',context).includes('đã dừng'));
});

test('switching workspaces during discovery prevents auto scan in the newly selected workspace',async()=>{
 const {context,submissions}=setup(withAnalysis());
 context.window.MarketLensChrome={ping:async()=>({version:'1.2.0',capabilities:{discover:true}}),discover:async()=>{
   vm.runInContext('S.shopId="another-workspace";S.competitor={shop:"",category:"",query:"",sort:"sold",page:1,url:""}',context);
   return {candidates:[{url:'https://shopee.vn/kitchen_shop'}]};
 }};
 await vm.runInContext('discoverCompetitors()',context);
 assert.equal(submissions.length,0);assert.equal(vm.runInContext('S.competitor.url',context),'');
});

test('discovery requires the actual installed capability before opening or scanning any shop',async()=>{
 const {context,submissions}=setup(withAnalysis());let calls=0;
 context.window.MarketLensChrome={ping:async()=>({version:'1.2.0'}),discover:async()=>{calls++;return {candidates:[]}}};
 await vm.runInContext('discoverCompetitors()',context);
 assert.equal(calls,0);assert.equal(submissions.length,0);
 assert.match(vm.runInContext('S.competitor.discoveryError',context),/tiện ích MarketLens 1.7.0/);
});
