import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const code=await readFile(new URL('../../static/shop-market-intelligence.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(handler) {
  const requests=[],redraws=[];
  const c=vm.createContext({window:{},URL,Map,Set,Date,Intl,Number,String,Array,Object,Promise,AbortController,setTimeout,clearTimeout,
    api:async(path,options)=>{requests.push({path,options});return handler?handler(path,options):evidence();}});
  vm.runInContext(code,c);
  const entry={intelligenceSku:'12.1'};
  const ctx={shopId:'shop-a',entry,product:{sku:'12.1',name:'Rây của shop mình',category:'Gia dụng',price:99000,metrics:{},optimizer:{cost_complete:false}},
    data:{shop:{id:'shop-a'},generated_at:'revision-1',competitor_research:{}},redraw:()=>redraws.push(entry.intelligenceSku)};
  return {module:c.window.MarketLensShopMarket,ctx,requests,redraws};
}
function candidate(name,status='review',extra={}) {
  return {sku:'20.1',source_shop:'Shop được ghi nhận',name,price:88000,product_url:'https://shopee.vn/product/20/1',
    equivalence:{status,missing:[],conflicts:[],specifications:{}},...extra};
}
function evidence(extra={}) {return {shop_id:'shop-a',sku:'12.1',history:[],competitors:{count:0,min:null,max:null,candidates:[],candidate_count:0},...extra};}

test('render uses recorded reference immediately and never starts network itself',()=>{
  const a=setup();a.ctx.data.competitor_research['12.1']={count:1,min:88000,max:88000,review_count:1,different_count:1,
    candidates:[candidate('Rây tương đương','equivalent'),candidate('Ứng viên giá rẻ','review',{price:1000}),candidate('Khác quy cách','different',{price:999000})]};
  const html=a.module.render('competitors',a.ctx);
  assert.match(html,/Rây tương đương/);assert.match(html,/88\.000 ₫/);assert.match(html,/Khớp quy cách đã ghi nhận/);
  assert.match(html,/Chưa xác minh đủ quy cách/);assert.match(html,/Khác quy cách/);assert.equal(a.requests.length,0);
  assert.equal(a.module.render('unknown',a.ctx),'');
});

test('equivalent and same-function candidates sort before broad category matches without changing range',()=>{
  const a=setup();a.ctx.data.competitor_research['12.1']={count:1,min:88000,max:88000,review_count:3,different_count:0,
    candidates:[candidate('Dao broad','review',{equivalence:{status:'review',missing:['matching_function']}}),
      candidate('Rây gần A'),candidate('Rây tương đương','equivalent'),candidate('Rây gần B')]};
  const html=a.module.render('competitors',a.ctx);
  assert.ok(html.indexOf('Rây tương đương')<html.indexOf('Rây gần A'));
  assert.ok(html.indexOf('Rây gần A')<html.indexOf('Rây gần B'));
  assert.ok(html.indexOf('Rây gần B')<html.indexOf('Dao broad'));
  assert.match(html,/Chỉ cùng ngành; chưa xác nhận cùng công dụng/);assert.match(html,/88\.000 ₫/);
  assert.equal(a.ctx.data.competitor_research['12.1'].candidates[0].name,'Dao broad');
});

test('lazy ensure deduplicates a pending request and adds actual sold/review/source evidence',async()=>{
  const gate=deferred(),a=setup(()=>gate.promise);
  const first=a.module.ensure(a.ctx),second=a.module.ensure(a.ctx);await tick();
  assert.equal(first,second);assert.equal(a.requests.length,1);assert.match(a.requests[0].path,/products\/12\.1\/market-evidence\?shop_id=shop-a/);
  gate.resolve(evidence({competitors:{count:1,min:88000,max:88000,candidates:[candidate('Đối thủ thật','equivalent',{sold_total:1234,review_count:56,rating:4.8,sold_approx:true})]}}));
  assert.equal(await first,true);const html=a.module.render('competitors',a.ctx);
  assert.match(html,/≈ 1\.234/);assert.match(html,/>56/);assert.match(html,/Mở sản phẩm/);
  await a.module.ensure(a.ctx);assert.equal(a.requests.length,1);assert.equal(a.redraws.length,1);
});

test('read failure is visible and only an explicit retry restarts the request',async()=>{
  let failed=true;const a=setup(()=>{if(failed)throw new Error('Dữ liệu tạm chưa đọc được');return evidence();});
  assert.equal(await a.module.ensure(a.ctx),false);
  assert.match(a.module.render('competitors',a.ctx),/Dữ liệu tạm chưa đọc được/);
  await a.module.ensure(a.ctx);await a.module.ensure(a.ctx);assert.equal(a.requests.length,1);
  failed=false;assert.equal(a.module.click({dataset:{smiRetry:''}},a.ctx),true);await tick();
  assert.equal(a.requests.length,2);assert.doesNotMatch(a.module.render('competitors',a.ctx),/Dữ liệu tạm chưa đọc được/);
  assert.equal(a.module.click({dataset:{sellerView:'marketAnalysis'}},a.ctx),false);
});

test('late response for a previous SKU cannot overwrite or redraw the selected SKU',async()=>{
  const first=deferred(),second=deferred(),a=setup(path=>path.includes('/12.1/')?first.promise:second.promise);
  const old=a.module.ensure(a.ctx);await tick();a.ctx.entry.intelligenceSku='12.2';
  const next={...a.ctx,product:{...a.ctx.product,sku:'12.2',name:'Bình được chọn'}};
  const current=a.module.ensure(next);await tick();second.resolve(evidence({sku:'12.2',competitors:{candidates:[candidate('Đối thủ của bình')]}}));await current;
  first.resolve(evidence({competitors:{candidates:[candidate('Đối thủ của rây cũ')]}}));await old;
  const html=a.module.render('competitors',next);assert.match(html,/Đối thủ của bình/);assert.doesNotMatch(html,/rây cũ/);
  assert.deepEqual(a.redraws,['12.2']);
});

test('shop scopes and refreshed dashboard revision have separate evidence requests',async()=>{
  const a=setup(path=>evidence({shop_id:path.endsWith('shop-b')?'shop-b':'shop-a'}));
  await a.module.ensure(a.ctx);
  const other={...a.ctx,shopId:'shop-b',data:{...a.ctx.data,shop:{id:'shop-b'}}};await a.module.ensure(other);
  assert.equal(a.requests.length,2);
  a.ctx.data.generated_at='revision-2';await a.module.ensure(a.ctx);assert.equal(a.requests.length,3);
});

test('a mismatched API response is rejected and a mismatched selected shop performs no request',async()=>{
  const a=setup(()=>evidence({shop_id:'shop-b'}));
  assert.equal(await a.module.ensure(a.ctx),false);assert.match(a.module.render('competitors',a.ctx),/không thuộc shop hoặc SKU/);
  const other={...a.ctx,shopId:'shop-c'};assert.equal(await a.module.ensure(other),false);
  assert.equal(a.requests.length,1);assert.match(a.module.render('opportunities',other),/Chọn sản phẩm thuộc shop/);
});

test('one real history day produces only observed points and explicitly cannot establish a trend',async()=>{
  const a=setup(()=>evidence({history:[{day:'2026-10-15',sold_total:123,review_count:9,price:99000,source:'chrome_live_dom'}]}));
  await a.module.ensure(a.ctx);const html=a.module.render('opportunities',a.ctx);
  assert.equal((html.match(/<circle /g)||[]).length,2);assert.match(html,/Mới có 1 ngày dữ liệu/);
  assert.match(html,/2026-10-15/);assert.match(html,/1 · QUAN TÂM/);assert.match(html,/2 · TĂNG TRƯỞNG/);assert.match(html,/3 · KHẢ NĂNG KINH DOANH/);
  assert.match(html,/Không phải lượng tìm kiếm/);assert.match(html,/Cần bổ sung chi phí/);assert.doesNotMatch(html,/NaN|Infinity|Dự báo tăng/);
});

test('sparse counters retain missing gaps, zero is real, and invalid days are excluded',async()=>{
  const a=setup(()=>evidence({history:[{day:'2026-10-13',sold_total:0,review_count:0},
    {day:'2026-10-14',sold_total:null,review_count:null},{day:'2026-10-15',sold_total:100,review_count:2},
    {day:'2026-02-31',sold_total:10000,review_count:10000}]}));
  await a.module.ensure(a.ctx);const html=a.module.render('opportunities',a.ctx);
  assert.equal((html.match(/<circle /g)||[]).length,4);assert.doesNotMatch(html,/2026-02-31|NaN|Infinity/);
  assert.match(html,/Độ chính xác của bộ đếm/);assert.match(html,/2026-10-13/);
});

test('missing history has no fabricated chart and saved model score is clearly descriptive',async()=>{
  const a=setup(()=>evidence({ml:{ml_signal_score:72,segment:'Nhóm nhu cầu ghi nhận cao',reason:'Từ cụm đã học',created_at:'2026-10-15',basis:'Vị thế đã lưu; không phải dự báo.'}}));
  await a.module.ensure(a.ctx);const html=a.module.render('opportunities',a.ctx);
  assert.match(html,/Chưa có lịch sử quan sát/);assert.doesNotMatch(html,/<svg/);assert.match(html,/72\/100/);assert.match(html,/không phải dự báo/);
  assert.match(html,/data-seller-view="marketAnalysis"/);assert.match(html,/data-seller-optimize="12.1"/);
});

test('untrusted text and invalid source URLs cannot create executable markup',async()=>{
  const attack='<img src=x onerror=alert(1)>',a=setup(()=>evidence({competitors:{candidates:[candidate(attack,'review',{
    source_shop:attack,product_url:'https://name@shopee.vn/product/20/1',equivalence:{status:'review',missing:[attack],specifications:{brand:{own:attack,competitor:attack}}}})]}}));
  a.ctx.product.name=attack;await a.module.ensure(a.ctx);const html=a.module.render('competitors',a.ctx);
  assert.doesNotMatch(html,/<img|href="https:\/\/name@/);assert.match(html,/&lt;img/);
  assert.match(html,/Chưa có URL nguồn/);
});


test('title relevance ranks a related discovery candidate before unrelated same-category items without proving equivalence',()=>{
  const a=setup();a.ctx.product.name='Rây lọc thực phẩm inox 304';
  const broad={status:'review',missing:['matching_function','brand','pack'],conflicts:[],specifications:{}};
  const source=[candidate('Dao thái cán nhựa nhà bếp','review',{equivalence:broad,price:1000}),
    candidate('Rây lọc bột inox 304','review',{equivalence:broad,price:93000})];
  a.ctx.data.competitor_research['12.1']={count:0,min:null,max:null,candidates:source};
  const html=a.module.render('competitors',a.ctx);
  assert.ok(html.indexOf('Rây lọc bột')<html.indexOf('Dao thái'));
  assert.match(html,/Chưa đủ giá để đối chiếu/);assert.match(html,/Chưa xác minh đủ quy cách/);
  assert.match(html,/Chỉ cùng ngành; chưa xác nhận cùng công dụng/);assert.equal(source[0].name,'Dao thái cán nhựa nhà bếp');
});
