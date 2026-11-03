import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../../static/app.js',import.meta.url),'utf8')).split('// Delegated interactions')[0];
function setup(detail,checkpoint){
 const calls=[];
 const context=vm.createContext({URL,Intl,document:{getElementById:()=>null},window:{MarketLensChrome:{detail}},fetch:async(path,options)=>{
   const body=JSON.parse(options.body);calls.push({path,body});
   const result=checkpoint?await checkpoint(path,body):{};
   return {ok:true,json:async()=>result};
 }});
 vm.runInContext(source,context);
 const run={jobId:'live-job',stopRequested:false};context.run=run;
 vm.runInContext('S.crawlRun=run',context);
 const products=[1,2,3].map(id=>({sku:`1_${id}`,name:`Sản phẩm ${id}`,product_url:`https://shopee.vn/product/1/${id}`}));
 context.products=products;
 return {calls,run,context,collect:()=>vm.runInContext('collectProductDetails(run,products,"one-use-token")',context)};
}

test('detail flow reads sequentially and checkpoints every fresh product before the next read',async()=>{
 let active=0;const events=[];
 const {calls,collect}=setup(async url=>{
   assert.equal(active,0);active++;events.push('read:'+url);
   await new Promise(resolve=>setImmediate(resolve));active--;
   return {detail:{url,name:'Tên mới',description:'Mô tả thật'}};
 },async(path,body)=>{events.push(path.endsWith('product-result')?'save:'+body.product_url:'finish');return {}});
 const result=await collect();
 assert.equal(result.detail_completed,3);assert.equal(result.detail_failed,0);
 assert.deepEqual(events,['read:https://shopee.vn/product/1/1','save:https://shopee.vn/product/1/1','read:https://shopee.vn/product/1/2','save:https://shopee.vn/product/1/2','read:https://shopee.vn/product/1/3','save:https://shopee.vn/product/1/3','finish']);
 assert.equal(calls.length,4);assert.equal(calls[0].body.detail.description,'Mô tả thật');
 assert.equal(calls.at(-1).body.result_token,'one-use-token');assert.equal(calls.at(-1).body.error,undefined);
});

test('blocked detail page is recorded, then collection stops while finishing the saved listing',async()=>{
 let reads=0;
 const {calls,collect}=setup(async url=>{
   if(++reads===2)throw Object.assign(new Error('Shopee yêu cầu xác minh'),{blocked:true,code:'blocked'});
   return {detail:{url,name:'Đã đọc'}};
 });
 const result=await collect();
 assert.equal(reads,2);assert.equal(result.stopped,true);assert.equal(result.detail_completed,1);assert.equal(result.detail_failed,1);
 assert.equal(calls[1].body.error,'Shopee yêu cầu xác minh');
 assert.ok(calls.at(-1).path.endsWith('/finish-details'));assert.equal(calls.at(-1).body.error,'Shopee yêu cầu xác minh');
});

test('ordinary missing product continues, while stopping after current product preserves its checkpoint',async()=>{
 let reads=0;
 const setupResult=setup(async url=>{
   if(++reads===1)throw new Error('Sản phẩm không còn tồn tại');
   setupResult.run.stopRequested=true;
   return {detail:{url,name:'Vẫn lưu trước khi dừng'}};
 });
 const result=await setupResult.collect();
 assert.equal(reads,2);assert.equal(result.detail_failed,1);assert.equal(result.detail_completed,1);
 assert.equal(setupResult.calls[1].body.detail.name,'Vẫn lưu trước khi dừng');
 assert.match(setupResult.calls.at(-1).body.error,/Đã dừng theo yêu cầu/);
});

test('checkpoint failure stops subsequent reads and reports why the detail phase ended',async()=>{
 let reads=0;
 const {calls,collect}=setup(async url=>{reads++;return {detail:{url,name:'Sản phẩm'}}},async path=>{
   if(path.endsWith('/product-result'))throw new Error('Không kết nối máy chủ');
   return {};
 });
 const result=await collect();
 assert.equal(reads,1);assert.equal(result.stopped,true);
 assert.ok(calls.at(-1).path.endsWith('/finish-details'));
 assert.match(calls.at(-1).body.error,/Không lưu được tiến độ đọc chi tiết/);
});

test('detail display escapes source text, rejects unsafe links and preserves last good detail on failure',()=>{
 const {context}=setup(async()=>({}));
 context.product={name:'Tên <b>mới</b>',product_url:'javascript:alert(1)',detail:{collected_at:'2026-10-14T10:00:00',last_error:'<img onerror=alert(1)>',description:'Mô tả\n<script>alert(1)</script>',attributes:[{name:'<b>Thông số</b>',value:'<svg onload=alert(1)>'}],variants:[{name:'Màu',options:['<iframe>']}],images:['https://down-vn.img.susercontent.com/file/example','javascript:alert(1)','https://tracking.example/image']}};
 const html=vm.runInContext('productDetailContent(product)',context);
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(html.includes('lần đọc thành công trước đó'));
 assert.ok(html.includes('https://down-vn.img.susercontent.com/file/example'));
 for(const unsafe of ['<script>','<iframe>','<svg ','javascript:','tracking.example'])assert.equal(html.includes(unsafe),false,unsafe);
 assert.equal(vm.runInContext('supportsProductDetails("1.0.2")',context),false);
 assert.equal(vm.runInContext('supportsProductDetails("1.1.0")',context),true);
 const form=vm.runInContext('S.crawler={enabled:true};renderCrawler({shop:{is_demo:false,url:"https://shopee.vn/shop"}})',context);
 assert.match(form,/name="read_details" checked/);
});
