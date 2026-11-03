import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../static/shop-product-price.js',import.meta.url),'utf8');
function product(extra={}) {
  return {sku:'12.34',name:'Rây inox theo dữ liệu shop',url:'https://shopee.vn/product/12/34',category:'Đồ bếp',price:100000,
    inputs:{unit_cost:40000,platform_fee_pct:10,ad_cost_per_order:5000,packaging_cost:2000,payment_fee_pct:2,tax_pct:1,shipping_cost:3000,other_unit_cost:1000},
    metrics:{contribution_per_order:36000,orders_30d:17,conversion_pct:3.4,roas:2.6},optimizer:{cost_complete:true},
    segment_label:'Sản phẩm chủ lực',segment_reason:'Phân nhóm theo dữ liệu đã đối soát.',detail:{images:['https://down-vn.img.susercontent.com/file/vn-product']},...extra};
}
function setup() {
  const sandbox=vm.createContext({window:{},URL,Intl,Map,Number,String,Array,Object,Math,JSON,fetch(){throw new Error('No external requests are allowed in this module.');}});
  vm.runInContext(source,sandbox);const module=sandbox.window.MarketLensProductPrice;
  let redraws=0;const opened=[],summary={innerHTML:''};
  const ctx=(selected=product(),shopId='shop-a')=>({product:selected,shopId,redraw(){redraws++;},openProduct:(sku,view)=>opened.push({sku,view})});
  const input=(name,value,context)=>{
    const node={dataset:{intelligencePriceField:name},value,selectionStart:2,selectionEnd:2,closest:selector=>{assert.equal(selector,'[data-intelligence-price]');return {querySelector:selector=>{assert.equal(selector,'[data-intelligence-price-summary]');return summary;}};},focus(){throw new Error('Typing must not refocus or replace the form.');}};
    const handled=module.input(node,context);return {handled,node,summary:summary.innerHTML};
  };
  return {module,ctx,input,summary,opened,redraws:()=>redraws};
}
const metric=(html,title)=>{
  const cards=[...html.matchAll(/<article class="sw-pp-metric"><span>([^<]*)<\/span><strong>([^<]*)<\/strong>/g)];
  return cards.find(card=>card[1]===title)?.[2];
};
const field=(html,name)=>html.match(new RegExp(`data-intelligence-price-field="${name}" value="([^"]*)"`))?.[1];
const scenario=(html,key)=>html.match(new RegExp(`<button[^>]*data-intelligence-price-scenario="${key}"[\\s\\S]*?<\\/button>`))?.[0]||'';

test('Product Intelligence shows the selected SKU, actual image and source metrics without invented benchmarks',()=>{
  const app=setup(),ctx=app.ctx(),html=app.module.render('product',ctx);
  assert.match(html,/Rây inox theo dữ liệu shop/);assert.match(html,/SKU 12\.34/);
  assert.match(html,/src="https:\/\/down-vn.img.susercontent.com\/file\/vn-product"/);
  assert.match(html,/href="https:\/\/shopee.vn\/product\/12\/34"/);
  assert.equal(metric(html,'Giá bán đã lưu'),'100.000 ₫');assert.equal(metric(html,'Giá vốn / sản phẩm'),'40.000 ₫');
  assert.equal(metric(html,'Lãi đóng góp / đơn'),'36.000 ₫');assert.equal(metric(html,'Đơn thành công / 30 ngày'),'17');
  assert.equal(metric(html,'Tỷ lệ chuyển đổi'),'3,4%');assert.equal(metric(html,'ROAS'),'2,6');
  assert.match(html,/data-seller-intelligence-module="price"/);assert.match(html,/data-seller-optimize="12\.34"/);
  assert.match(html,/Phân nhóm theo dữ liệu đã đối soát/);assert.equal(app.redraws(),0);
});

test('unknown source metrics remain missing and cumulative units never become successful orders',()=>{
  const app=setup(),ctx=app.ctx(product({inputs:{unit_cost:null},cost:12345,metrics:{orders_30d:null,units_30d:999,sold_total:99999,contribution_per_order:null,conversion_pct:null,roas:null},detail:{images:[]},optimizer:{cost_complete:false}}));
  const html=app.module.render('product',ctx);
  for(const title of ['Giá vốn / sản phẩm','Lãi đóng góp / đơn','Đơn thành công / 30 ngày','Tỷ lệ chuyển đổi','ROAS'])assert.equal(metric(html,title),'—',title);
  assert.match(html,/Chưa có ảnh đã lưu/);assert.match(html,/Tạm tính; còn chi phí thiếu/);assert.doesNotMatch(html,/<img|99999|>999</);
  const zero=app.module.render('product',app.ctx(product({inputs:{unit_cost:0},metrics:{orders_30d:0,contribution_per_order:0,conversion_pct:0,roas:0}}),'shop-zero'));
  assert.equal(metric(zero,'Giá vốn / sản phẩm'),'0 ₫');assert.equal(metric(zero,'Đơn thành công / 30 ngày'),'0');assert.equal(metric(zero,'ROAS'),'0');
});

test('Price Optimizer includes every known fee and fixed cost in the contribution calculation',()=>{
  const app=setup(),html=app.module.render('price',app.ctx());
  assert.equal(metric(html,'Giá bán tình huống'),'100.000 ₫');assert.equal(metric(html,'Lãi đóng góp / đơn'),'36.000 ₫');
  assert.equal(metric(html,'Biên đóng góp'),'36%');assert.equal(metric(html,'Giá hòa vốn có điều kiện'),'58.620,69 ₫');
  assert.match(html,/Tổng chi phí cố định đã biết<\/dt><dd>51\.000 ₫/);assert.match(html,/Tổng phí và thuế đã biết<\/dt><dd>13%/);
  for(const name of ['price','unit_cost','platform_fee_pct','ad_cost_per_order','packaging_cost','payment_fee_pct','tax_pct','shipping_cost','other_unit_cost'])assert.ok(field(html,name)!==undefined,name);
  assert.match(html,/Đã có đủ các khoản trong mô hình chi phí này/);assert.match(html,/Không thay đổi giá trên Shopee hoặc lưu vào database/);
});

test('missing optional costs produce a conditional subtotal while missing core costs prevent a profit claim',()=>{
  const app=setup(),ctx=app.ctx(product({inputs:{unit_cost:40000,platform_fee_pct:10,packaging_cost:2000}}));
  let html=app.module.render('price',ctx);
  assert.equal(metric(html,'Lãi đóng góp tạm tính / đơn'),'48.000 ₫');
  const missing=html.match(/Chưa gồm: ([^.]+)\./)?.[1]||'';
  for(const label of ['Phí thanh toán','Thuế theo giả định','Quảng cáo / đơn thành công','Vận chuyển shop chịu / đơn','Chi phí khác / sản phẩm'])assert.ok(missing.includes(label),label);
  assert.equal(field(html,'payment_fee_pct'),'');assert.equal(field(html,'ad_cost_per_order'),'');assert.match(html,/Khoản thiếu chưa được xác nhận là 0/);
  app.input('unit_cost','',ctx);html=app.module.render('price',ctx);assert.equal(metric(html,'Lãi đóng góp tạm tính / đơn'),'—');assert.equal(metric(html,'Biên đóng góp'),'—');
  assert.match(html,/Cần bổ sung Giá vốn \/ sản phẩm/);
});

test('known zero costs remain explicit zeros and do not become missing or presumed positive costs',()=>{
  const app=setup(),ctx=app.ctx(product({inputs:{unit_cost:0,platform_fee_pct:0,ad_cost_per_order:0,packaging_cost:0,payment_fee_pct:0,tax_pct:0,shipping_cost:0,other_unit_cost:0}}));
  const html=app.module.render('price',ctx);
  assert.equal(metric(html,'Lãi đóng góp / đơn'),'100.000 ₫');assert.equal(metric(html,'Biên đóng góp'),'100%');
  for(const name of ['unit_cost','platform_fee_pct','ad_cost_per_order','packaging_cost','payment_fee_pct','tax_pct','shipping_cost','other_unit_cost'])assert.equal(field(html,name),'0');
  assert.doesNotMatch(html,/Khoản thiếu chưa được xác nhận/);
});

test('typing recalculates only the readonly summary, preserves the input node and does not redraw or mutate source data',()=>{
  const app=setup(),original=product(),before=JSON.stringify(original),ctx=app.ctx(original);app.module.render('price',ctx);
  const update=app.input('price','120000',ctx);
  assert.equal(update.handled,true);assert.equal(update.node.value,'120000');assert.equal(update.node.selectionStart,2);assert.equal(app.redraws(),0);
  assert.equal(metric(update.summary,'Lãi đóng góp / đơn'),'53.400 ₫');assert.equal(metric(update.summary,'Biên đóng góp'),'44,5%');
  assert.equal(field(app.module.render('price',ctx),'price'),'120000');assert.equal(JSON.stringify(original),before);
});

test('price scenarios use backend rounding, select independently of form inputs and never predict order volume',()=>{
  const app=setup(),ctx=app.ctx(product({price:99000}));let html=app.module.render('price',ctx);
  assert.match(scenario(html,'lower'),/89\.000 ₫/);assert.match(scenario(html,'current'),/99\.000 ₫/);assert.match(scenario(html,'higher'),/109\.000 ₫/);
  assert.equal(app.module.click({dataset:{intelligencePriceScenario:'lower'}},ctx),true);html=app.module.render('price',ctx);
  assert.equal(metric(html,'Giá bán tình huống'),'89.000 ₫');assert.equal(metric(html,'Lãi đóng góp / đơn'),'26.430 ₫');assert.equal(field(html,'price'),'99000');
  assert.match(scenario(html,'lower'),/aria-pressed="true"/);assert.equal(app.redraws(),1);
  assert.match(html,/làm tròn đến 1\.000 ₫/);assert.match(html,/Chưa dự báo lượng đơn, chuyển đổi hay doanh thu/);
  const tie=app.module.render('price',app.ctx(product({sku:'tie',price:105000})));assert.match(scenario(tie,'lower'),/94\.000 ₫/);
});

test('reset uses the current SKU database values and preserves other shop and SKU simulations',()=>{
  const app=setup(),a=app.ctx(),b=app.ctx(product({price:200000}),'shop-b'),other=app.ctx(product({sku:'12.35',price:300000}));
  app.module.render('price',a);app.input('price','120000',a);app.module.render('price',b);app.input('unit_cost','80000',b);app.module.render('price',other);app.input('price','310000',other);
  assert.equal(field(app.module.render('price',a),'price'),'120000');assert.equal(field(app.module.render('price',b),'price'),'200000');assert.equal(field(app.module.render('price',other),'price'),'310000');
  a.product=product({price:110000,inputs:{...product().inputs,unit_cost:45000}});app.module.click({dataset:{intelligencePriceReset:''}},a);
  const html=app.module.render('price',a);assert.equal(field(html,'price'),'110000');assert.equal(field(html,'unit_cost'),'45000');assert.match(scenario(html,'current'),/aria-pressed="true"/);
  assert.equal(field(app.module.render('price',b),'unit_cost'),'80000');assert.equal(field(app.module.render('price',other),'price'),'310000');assert.equal(app.redraws(),1);
});

test('an untouched simulation follows refreshed source values while a local draft stays a deliberate assumption',()=>{
  const app=setup(),ctx=app.ctx();app.module.render('price',ctx);
  ctx.product=product({price:90000});assert.equal(field(app.module.render('price',ctx),'price'),'90000');
  app.input('price','120000',ctx);ctx.product=product({price:80000});assert.equal(field(app.module.render('price',ctx),'price'),'120000');
  app.module.click({dataset:{intelligencePriceReset:''}},ctx);assert.equal(field(app.module.render('price',ctx),'price'),'80000');
});

test('invalid prices, finite bounds, negative costs and fees of 100 percent never produce a contribution result',()=>{
  for(const [name,value]of [['price','0'],['price','-1'],['price','NaN'],['price','Infinity'],['unit_cost','-1'],['ad_cost_per_order','-1'],['platform_fee_pct','100'],['payment_fee_pct','101'],['tax_pct','-1']]){
    const app=setup(),ctx=app.ctx();app.module.render('price',ctx);const update=app.input(name,value,ctx);
    assert.match(update.summary,/role="alert"/,name+'='+value);assert.equal(metric(update.summary,'Lãi đóng góp tạm tính / đơn'),'—');assert.equal(metric(update.summary,'Biên đóng góp'),'—');
    assert.doesNotMatch(update.summary,/>NaN|>Infinity/);assert.equal(app.redraws(),0);
  }
  const app=setup(),ctx=app.ctx();app.module.render('price',ctx);app.input('platform_fee_pct','97',ctx);const update=app.input('payment_fee_pct','2',ctx);
  assert.match(update.summary,/Tổng phí nền tảng, phí thanh toán và thuế phải nhỏ hơn 100%/);assert.equal(metric(update.summary,'Lãi đóng góp tạm tính / đơn'),'—');
});

test('empty input remains null, and overflowing totals are explained rather than rendered as Infinity',()=>{
  const app=setup(),ctx=app.ctx();app.module.render('price',ctx);const missing=app.input('price','',ctx);
  assert.match(missing.summary,/Cần bổ sung Giá bán tham chiếu/);assert.equal(metric(missing.summary,'Giá bán tình huống'),'—');
  app.input('price','100000',ctx);app.input('unit_cost','1e308',ctx);const overflow=app.input('shipping_cost','1e308',ctx);
  assert.match(overflow.summary,/vượt phạm vi tính toán/);assert.equal(metric(overflow.summary,'Lãi đóng góp tạm tính / đơn'),'—');assert.doesNotMatch(overflow.summary,/>Infinity|>NaN/);
});

test('product names, SKU attributes and image/source URLs are escaped and restricted to safe Shopee hosts',()=>{
  const app=setup(),unsafe=product({sku:'12.34" onclick="bad()',name:'<img src=x onerror=bad()>',category:'<script>bad()</script>',segment_reason:'<b>fake</b>',url:'javascript:bad()',detail:{images:['https://susercontent.com.evil.test/file/attack','data:image/svg+xml,bad','http://down-vn.img.susercontent.com/file/insecure']}});
  let html=app.module.render('product',app.ctx(unsafe));assert.match(html,/&lt;img src=x onerror=bad\(\)&gt;/);assert.match(html,/&quot; onclick=&quot;bad\(\)/);assert.match(html,/Chưa có ảnh đã lưu/);
  assert.doesNotMatch(html,/<img|<script>|<b>fake|href="javascript:|src="http:/);
  html=app.module.render('price',app.ctx(unsafe));assert.doesNotMatch(html,/ onclick="bad|<img|<script>/);
  const valid=app.module.render('product',app.ctx(product({name:'Rây "nhỏ" & đẹp',url:'https://shopee.vn/product/12/34?a=1&b=2',detail:{images:['https://down-vn.img.susercontent.com/file/p?a=1&b=2']}}),'safe-shop'));
  assert.match(valid,/alt="Rây &quot;nhỏ&quot; &amp; đẹp"/);assert.match(valid,/a=1&amp;b=2/);
  const credentials=app.module.render('product',app.ctx(product({url:'https://user:secret@shopee.vn/product/12/34',detail:{images:['https://down-vn.img.susercontent.com:444/file/p']}}),'credentials-shop'));
  assert.doesNotMatch(credentials,/<img|href=/);
});

test('unknown events remain available to the parent dispatcher and missing products produce a useful empty state',()=>{
  const app=setup(),ctx=app.ctx();assert.equal(app.module.input({dataset:{intelligencePriceField:'invented'},value:'1'},ctx),false);
  assert.equal(app.module.click({dataset:{intelligencePriceScenario:'invented'}},ctx),false);assert.equal(app.module.click({dataset:{sellerOptimize:'12.34'}},ctx),false);
  assert.equal(app.redraws(),0);assert.match(app.module.render('product',{shopId:'empty'}),/Chọn sản phẩm của shop/);
  assert.equal(app.module.click({dataset:{intelligencePriceReset:''}},{shopId:'empty'}),false);
});

test('the real own-product product_url opens its public Shopee source without needing a url alias',()=>{
  const app=setup(),html=app.module.render('product',app.ctx(product({url:undefined,product_url:'https://shopee.vn/Ray-inox-i.12.34'})));
  assert.match(html,/href="https:\/\/shopee.vn\/Ray-inox-i.12.34"/);assert.match(html,/Xem nguồn Shopee/);
});
