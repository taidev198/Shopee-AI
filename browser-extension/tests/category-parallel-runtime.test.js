import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateCategoryUrl, inspectCategoryPage} from '../category.js';
import {validateShopUrl, isAllowedAppUrl, inspectShopPage} from '../collector.js';
import {validateProductUrl, inspectProductPage} from '../product-detail.js';
import {validateDiscoveryQuery, inspectSearchPage, inspectProductSeller, inspectShopProfile, validateSellerLink} from '../discovery.js';

const source=(await readFile(new URL('../background.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function runtime({hold=id=>true,urlForTab=(id,url)=>url,createError,removeError,snapshot,statusForTab=()=> 'complete'}={}) {
  let listener,clock=0,sequence=100,requestId=0;
  const tabs=new Map(),gates=new Map(),creates=[],reads=[],removes=[];
  const chrome={runtime:{id:'parallel-test',getManifest:()=>({version:'1.3.7'}),onMessage:{addListener:fn=>{listener=fn;}}},
    tabs:{
      async create(options){creates.push(options);const id=++sequence;const error=createError?.(id,options);if(error)throw error;
        tabs.set(id,urlForTab(id,options.url));return {id};},
      async get(id){assert.ok(tabs.has(id));return {id,status:statusForTab(id,clock),url:tabs.get(id)};},
      async update(id,options){assert.ok(tabs.has(id));tabs.set(id,options.url);return {id};},
      async remove(id){removes.push(id);const error=removeError?.(id);if(error)throw error;tabs.delete(id);},
    },
    scripting:{async executeScript({target,func,args}){
      const id=target.tabId;reads.push({id,name:func.name,action:args[0].action});
      if(!gates.has(id)){
        let release;const promise=new Promise(resolve=>{release=resolve;});gates.set(id,{release,promise});
        if(!hold(id))release();
        await promise;
      }
      let result=snapshot?.(id,func.name,args[0],clock);
      if(!result&&func.name==='inspectCategoryPage')result=args[0].home?
        {status:'ready',categories:[{name:'A',url:'https://shopee.vn/A-cat.1'}],catalog_end:true,carousel_signature:'end'}:
        {status:'ready',urls:[`https://shopee.vn/product/12/${id}`],has_next:false};
      if(!result&&func.name==='inspectProductPage')result={status:'ready',detail:{url:args[0].productUrl,name:`SP ${id}`,price_text:'94.000₫'}};
      if(!result&&func.name==='inspectShopPage')result={status:'ready',url:args[0].shopUrl,
        cards:[{href:'https://shopee.vn/product/12/34',name:'SP',text:'94.000₫'}],signature:'one-page',hasNext:false};
      if(!result&&func.name==='inspectSearchPage')result={status:'ready',cards:[{url:'https://shopee.vn/product/20/1',name:'Rây inox'}]};
      if(!result&&func.name==='inspectProductSeller')result={status:'ready',shop_url:'https://shopee.vn/shop_20',name:'Shop Hai'};
      assert.ok(result,'Unexpected inspector '+func.name);return [{result}];
    }},
  };
  const c=vm.createContext({chrome,URL,Map,Set,Error,Promise,Date:{now:()=>clock},setTimeout(fn,ms){clock+=ms;queueMicrotask(fn);},
    validateCategoryUrl,inspectCategoryPage,validateShopUrl,isAllowedAppUrl,inspectShopPage,validateProductUrl,inspectProductPage,
    validateDiscoveryQuery,inspectSearchPage,inspectProductSeller,inspectShopProfile,validateSellerLink});
  vm.runInContext(source,c);
  const request=(action,url)=>new Promise(resolve=>listener({source:'marketlens-bridge',requestId:String(++requestId),action,
    url:url||(action==='category'?'https://shopee.vn/A-cat.1':action==='collect'?'https://shopee.vn/own_shop':'https://shopee.vn/product/12/34'),
    query:'rây inox',ownShopUrl:'https://shopee.vn/own_shop'},
    {id:'parallel-test',frameId:0,url:'http://127.0.0.1:8000/',tab:{windowId:7}},resolve));
  return {request,tabs,creates,reads,removes,get clock(){return clock;},release:id=>{assert.ok(gates.has(id));gates.get(id).release();}};
}
function busy(result){assert.equal(result.ok,false);assert.equal(result.code,'chrome_collection_busy');assert.equal(result.retryable,true);}

test('ping advertises four simultaneous browser captures while campaigns can queue more categories',async()=>{
  const result=(await runtime().request('ping')).result;
  assert.equal(result.version,'1.3.7');assert.equal(result.capabilities.categoryParallel,4);
});
test('four held category/detail captures overlap and close only their own tabs while other workers remain active',async()=>{
  const r=runtime();r.tabs.set(999,'https://shopee.vn/existing_user_shop');
  const tasks=['category','detail','category','detail'].map(action=>r.request(action));await tick();
  assert.equal(r.creates.length,4);assert.deepEqual([...new Set(r.reads.map(x=>x.id))],[101,102,103,104]);
  for(const action of ['categories','collect','discover'])busy(await r.request(action));
  assert.equal(r.creates.length,4);
  r.release(101);assert.equal((await tasks[0]).ok,true);assert.deepEqual(r.removes,[101]);
  assert.ok([102,103,104,999].every(id=>r.tabs.has(id)));
  const fifth=r.request('category');await tick();assert.equal(r.creates.length,5);
  for(const id of [102,103,104,105])r.release(id);
  assert.ok((await Promise.all([...tasks.slice(1),fifth])).every(x=>x.ok));
  assert.deepEqual([...r.removes].sort((a,b)=>a-b),[101,102,103,104,105]);
  assert.equal(r.tabs.has(999),true);
});
test('four held tasks reject the fifth with a structured capacity limit, then every failure releases its slot',async()=>{
  const r=runtime({snapshot:(id,name)=>name==='inspectProductPage'?{status:'wrong_product',error:'Fixture product unavailable'}:null});
  r.tabs.set(999,'https://shopee.vn/existing_user_shop');
  const tasks=Array.from({length:4},()=>r.request('detail'));await tick();
  assert.equal(r.creates.length,4);assert.equal(new Set(r.reads.map(read=>read.id)).size,4);
  const rejected=await r.request('category');busy(rejected);
  assert.equal(rejected.maxParallel,4);assert.equal(rejected.activeCollections,4);assert.equal(rejected.busyReason,'capacity');
  assert.equal(r.creates.length,4);
  r.release(101);assert.equal((await tasks[0]).ok,false);assert.deepEqual(r.removes,[101]);
  const replacement=r.request('detail');await tick();assert.equal(r.creates.length,5);
  for(let id=102;id<=105;id++)r.release(id);
  assert.ok((await Promise.all([...tasks.slice(1),replacement])).every(result=>!result.ok));
  assert.deepEqual([...r.removes].sort((a,b)=>a-b),Array.from({length:5},(_,index)=>index+101));
  assert.deepEqual([...r.tabs.keys()],[999]);
  const exclusive=r.request('categories');await tick();r.release(106);assert.equal((await exclusive).ok,true);
  assert.equal(r.tabs.has(999),true);
});
for(const action of ['categories','collect','discover'])test(`${action} remains exclusive until its request finishes`,async()=>{
  const r=runtime();const exclusive=r.request(action);await tick();
  busy(await r.request('category'));busy(await r.request('detail'));busy(await r.request('categories'));
  assert.equal(r.creates.length,1);r.release(101);assert.equal((await exclusive).ok,true);
  const next=r.request('detail');await tick();assert.equal(r.creates.length,2);r.release(102);assert.equal((await next).ok,true);
  assert.deepEqual(r.removes,[101,102]);
});
test('a failed tab creation releases its slot while another category is still running',async()=>{
  const r=runtime({createError:id=>id===102?new Error('No window with id: 7.'):null});
  const first=r.request('category');await tick();
  const failed=await r.request('detail');assert.equal(failed.ok,false);assert.match(failed.error,/No window/);
  const replacement=r.request('detail');await tick();assert.equal(r.creates.length,3);busy(await r.request('categories'));
  r.release(101);r.release(103);assert.ok((await Promise.all([first,replacement])).every(x=>x.ok));
  assert.deepEqual([...r.removes].sort(),[101,103]);
});
test('a retained timeout inspection tab does not consume active worker capacity',async()=>{
  const r=runtime({hold:id=>id!==101,snapshot:id=>id===101?{status:'loading',loading_reason:'no_product_cards'}:null});
  const timedout=await r.request('category');
  assert.equal(timedout.code,'category_page_timeout');assert.equal(timedout.inspectionRequired,true);assert.equal(r.tabs.has(101),true);
  const second=r.request('category'),third=r.request('detail');await tick();assert.equal(r.creates.length,3);
  r.release(102);r.release(103);assert.ok((await Promise.all([second,third])).every(x=>x.ok));
  assert.deepEqual([...r.removes].sort(),[102,103]);assert.equal(r.tabs.has(101),true);
});
test('verification retains its tab without any read/retry and releases its active slot',async()=>{
  const r=runtime({urlForTab:(id,url)=>id===101?'https://shopee.vn/verify/captcha':url});
  const blocked=await r.request('detail');
  assert.equal(blocked.verificationRequired,true);assert.equal(r.tabs.has(101),true);assert.equal(r.reads.length,0);
  const second=r.request('category'),third=r.request('detail');await tick();assert.equal(r.creates.length,3);
  r.release(102);r.release(103);assert.ok((await Promise.all([second,third])).every(x=>x.ok));
  assert.equal(r.reads.some(x=>x.id===101),false);assert.deepEqual([...r.removes].sort(),[102,103]);
});
test('offsite failures are closed and release capacity without affecting another task tab',async()=>{
  const r=runtime({urlForTab:(id,url)=>id===101?'https://evil.test/':url});
  const failed=await r.request('category');
  assert.equal(failed.ok,false);assert.equal(failed.verificationRequired,false);assert.deepEqual(r.removes,[101]);
  const second=r.request('category'),third=r.request('detail');await tick();assert.equal(r.creates.length,3);
  r.release(102);r.release(103);assert.ok((await Promise.all([second,third])).every(x=>x.ok));
  assert.deepEqual([...r.removes].sort(),[101,102,103]);
});
test('cleanup failure still releases a successful task slot without touching another task',async()=>{
  const r=runtime({removeError:id=>id===101?new Error('No tab with id: 101.'):null});
  const first=r.request('detail');await tick();r.release(101);assert.equal((await first).ok,true);
  const second=r.request('detail'),third=r.request('category');await tick();assert.equal(r.creates.length,3);
  r.release(102);r.release(103);assert.ok((await Promise.all([second,third])).every(x=>x.ok));
  assert.deepEqual([...r.removes].sort(),[101,102,103]);
});

// Fake time advances polling without making a 90-second regression test slow.
test('a slow product can finish after 35 seconds while Chrome still reports loading',async()=>{
  const r=runtime({hold:()=>false,statusForTab:()=> 'loading',
    snapshot:(id,name,options,clock)=>name==='inspectProductPage'&&clock<40000?{status:'loading'}:null});
  const response=await r.request('detail');
  assert.equal(response.ok,true);assert.ok(r.clock>=40000);assert.ok(r.clock<90000);
  assert.ok(r.reads.length>4);assert.deepEqual(r.removes,[101]);
});
test('a product timeout is retryable, waits 90 seconds, and closes its own tab before another attempt',async()=>{
  const r=runtime({hold:()=>false,snapshot:()=>({status:'loading'})});
  r.tabs.set(999,'https://shopee.vn/existing_user_shop');
  const response=await r.request('detail');
  assert.equal(response.ok,false);assert.equal(response.code,'product_detail_timeout');assert.equal(response.retryable,true);
  assert.equal(response.blocked,false);assert.equal(response.verificationRequired,false);
  assert.ok(r.clock>=90000&&r.clock<91000);assert.deepEqual(r.removes,[101]);
  assert.deepEqual([...r.tabs.keys()],[999]);
});
test('a visible name without a price does not save incomplete detail at the deadline',async()=>{
  const r=runtime({hold:()=>false,snapshot:(id,name,options)=>({status:'ready',detail:{url:options.productUrl,name:'Partial product'}})});
  const response=await r.request('detail');
  assert.equal(response.code,'product_detail_timeout');assert.match(response.error,/giá/);assert.deepEqual(r.removes,[101]);
});
for(const interrupt of ['loading','navigation'])test(`detail stability resets after ${interrupt} interrupts the product summary`,async()=>{
  let count=0;
  const r=runtime({hold:()=>false,snapshot:(id,name,options)=>{
    count++;
    if(count===4){if(interrupt==='navigation')throw new Error('Frame was removed');return {status:'loading'};}
    return {status:'ready',detail:{url:options.productUrl,name:'Stable product',price_text:'94.000₫'}};
  }});
  assert.equal((await r.request('detail')).ok,true);assert.equal(count,7);assert.deepEqual(r.removes,[101]);
});

test('repeated category timeouts retain at most four diagnostic tabs without touching existing user tabs',async()=>{
  const r=runtime({hold:()=>false,snapshot:()=>({status:'loading'})});
  r.tabs.set(999,'https://shopee.vn/existing_user_shop');
  for(let i=0;i<6;i++)assert.equal((await r.request('category')).code,'category_page_timeout');
  assert.deepEqual([...r.tabs.keys()].sort((a,b)=>a-b),[103,104,105,106,999]);
  assert.deepEqual(r.removes,[101,102]);
});
test('diagnostic cleanup leaves tabs the user navigated to verification or another page open',async()=>{
  const r=runtime({hold:()=>false,snapshot:()=>({status:'loading'})});
  await r.request('category');r.tabs.set(101,'https://shopee.vn/verify/captcha');
  await r.request('category');r.tabs.set(102,'https://shopee.vn/my_other_shop');
  for(let i=0;i<4;i++)await r.request('category');
  assert.equal(r.tabs.get(101),'https://shopee.vn/verify/captcha');
  assert.equal(r.tabs.get(102),'https://shopee.vn/my_other_shop');
  assert.deepEqual(r.removes,[]);
});

test('a failed diagnostic removal stays tracked and is retried on the next timeout',async()=>{
  let fail=true;
  const r=runtime({hold:()=>false,snapshot:()=>({status:'loading'}),removeError:id=>id===101&&fail?new Error('Cleanup temporarily failed'):null});
  for(let i=0;i<5;i++)await r.request('category');
  assert.ok(r.tabs.has(101));assert.deepEqual(r.removes,[101]);
  fail=false;await r.request('category');
  assert.deepEqual(r.removes,[101,101,102]);assert.deepEqual([...r.tabs.keys()],[103,104,105,106]);
});
