import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateCategoryUrl, inspectCategoryPage} from '../category.js';
import {validateShopUrl, isAllowedAppUrl, inspectShopPage} from '../collector.js';
import {validateProductUrl, inspectProductPage} from '../product-detail.js';
import {validateDiscoveryQuery, inspectSearchPage, inspectProductSeller, inspectShopProfile, validateSellerLink} from '../discovery.js';

const source=(await readFile(new URL('../background.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const locked=()=>new Error('Tabs cannot be edited right now (user may be dragging a tab).');
const actions=['categories','category','detail','collect','discover'];
function runtime({createError,updateError,removeError,verification=true,inspect}={}) {
  let listener,clock=0,created=false,currentUrl='',responses=0;
  const creates=[],updates=[],removes=[],reads=[];
  const chrome={runtime:{id:'tab-lock-test',getManifest:()=>({version:'1.3.4'}),onMessage:{addListener:fn=>{listener=fn;}}},
    tabs:{
      async create(options){creates.push(options);const error=createError?.(creates.length);if(error)throw error;
        created=true;currentUrl=verification?'https://shopee.vn/verify/captcha?tracking_id=private':options.url;return {id:81};},
      async get(id){assert.equal(id,81);assert.equal(created,true);return {id,status:'complete',url:currentUrl};},
      async update(id,options){if(!options.url)return {id,windowId:7};updates.push({id,...options});const error=updateError?.(updates.length);if(error)throw error;
        assert.equal(id,81);currentUrl=options.url;return {id,url:currentUrl};},
      async remove(id){removes.push(id);const error=removeError?.(removes.length);if(error)throw error;created=false;},
    },
    scripting:{async executeScript({func,args,target}){reads.push({name:func.name,args,url:currentUrl});
      assert.equal(target.tabId,81);return [{result:inspect?.(func.name,args[0],currentUrl)}];}},
  };
  const c=vm.createContext({chrome,URL,Map,Set,Error,Promise,Date:{now:()=>clock},setTimeout(fn,ms){clock+=ms;queueMicrotask(fn);},
    validateCategoryUrl,inspectCategoryPage,validateShopUrl,isAllowedAppUrl,inspectShopPage,validateProductUrl,inspectProductPage,
    validateDiscoveryQuery,inspectSearchPage,inspectProductSeller,inspectShopProfile,validateSellerLink});
  vm.runInContext(source,c);
  const request=action=>new Promise(resolve=>listener({source:'marketlens-bridge',requestId:action,action,
    url:action==='category'?'https://shopee.vn/A-cat.1':action==='collect'?'https://shopee.vn/own_shop':'https://shopee.vn/product/12/34',
    query:'rây inox',ownShopUrl:'https://shopee.vn/own_shop'},
    {id:'tab-lock-test',frameId:0,url:'http://127.0.0.1:8000/',tab:{windowId:7}},result=>{responses++;resolve(result);}));
  const edit=(operation,deadline)=>{c.testTabOperation=operation;c.testTabDeadline=deadline;return vm.runInContext('editChromeTab(testTabOperation,testTabDeadline)',c);};
  return {request,edit,creates,updates,removes,reads,get elapsed(){return clock;},get responses(){return responses;}};
}

test('ping advertises the runtime tab-edit-lock retry capability',async()=>{
  const result=await runtime().request('ping');
  assert.equal(result.ok,true);assert.equal(result.result.capabilities.tabEditRetry,true);
});
for(const action of actions) test(`${action} retries a transient Chrome create lock and then stops at manual verification`,async()=>{
  const r=runtime({createError:n=>n===1?locked():null});const result=await r.request(action);
  assert.equal(r.creates.length,2);assert.equal(JSON.stringify(r.creates[0]),JSON.stringify(r.creates[1]));
  assert.equal(result.ok,false);assert.equal(result.verificationRequired,true);assert.equal(result.verificationTabId,81);
  assert.equal(r.reads.length,0);assert.equal(r.removes.length,0);assert.equal(r.responses,1);assert.ok(r.elapsed>0);
});
test('persistent Chrome create lock stops within a bounded retry budget and returns an actionable error',async()=>{
  const r=runtime({createError:()=>locked()});const result=await r.request('category');
  assert.equal(result.ok,false);assert.equal(result.code,'chrome_tabs_busy');assert.equal(result.retryable,true);
  assert.equal(result.verificationRequired,false);assert.match(result.error,/Chrome/);assert.doesNotMatch(result.error,/Tabs cannot be edited/);
  assert.ok(r.creates.length>1&&r.creates.length<=9);assert.ok(r.elapsed>0&&r.elapsed<=6000);
  assert.equal(r.reads.length,0);assert.equal(r.removes.length,0);assert.equal(r.responses,1);
});
test('permanent Chrome create errors are returned without retrying',async()=>{
  const r=runtime({createError:()=>new Error('No window with id: 7.')});const result=await r.request('detail');
  assert.equal(result.ok,false);assert.match(result.error,/No window with id/);assert.equal(result.code,undefined);
  assert.equal(r.creates.length,1);assert.equal(r.elapsed,0);assert.equal(r.reads.length,0);assert.equal(r.responses,1);
});
test('a near request deadline bounds the wait and prevents another tab edit at the deadline',async()=>{
  const r=runtime();let calls=0;
  await assert.rejects(r.edit(async()=>{calls++;throw locked();},250),error=>error.code==='chrome_tabs_busy'&&error.retryable===true);
  assert.equal(calls,1);assert.equal(r.elapsed,250);
});
test('discovery retries only the locked update without repeating its search or revisiting product pages',async()=>{
  const r=runtime({verification:false,updateError:n=>n===1?locked():null,inspect:name=>{
    if(name==='inspectSearchPage')return {status:'ready',cards:[{url:'https://shopee.vn/product/20/1',name:'Rây inox'}]};
    if(name==='inspectProductSeller')return {status:'ready',shop_url:'https://shopee.vn/shop_20',name:'Shop Hai'};
    throw new Error('Unexpected inspector: '+name);
  }});
  const result=await r.request('discover');
  assert.equal(result.ok,true);assert.equal(result.result.candidates.length,1);assert.equal(result.result.errors.length,0);
  assert.equal(result.result.candidates[0].url,'https://shopee.vn/shop_20');
  assert.equal(r.updates.length,2);assert.equal(JSON.stringify(r.updates[0]),JSON.stringify(r.updates[1]));
  assert.deepEqual(r.reads.map(x=>x.name),['inspectSearchPage','inspectSearchPage','inspectProductSeller']);
  assert.deepEqual(r.removes,[81]);assert.equal(r.responses,1);
});
test('an exhausted discovery update lock stops before navigating to another candidate',async()=>{
  const r=runtime({verification:false,updateError:()=>locked(),inspect:name=>{
    assert.equal(name,'inspectSearchPage');return {status:'ready',cards:[
      {url:'https://shopee.vn/product/20/1',name:'Rây inox'},
      {url:'https://shopee.vn/product/30/1',name:'Rây lọc'},
    ]};
  }});
  const result=await r.request('discover');
  assert.equal(result.ok,false);assert.equal(result.code,'chrome_tabs_busy');assert.equal(result.retryable,true);
  assert.ok(r.updates.length>1&&r.updates.length<=9);
  assert.ok(r.updates.every(x=>x.id===81&&x.url==='https://shopee.vn/product/20/1'));
  assert.deepEqual(r.reads.map(x=>x.name),['inspectSearchPage','inspectSearchPage']);
  assert.deepEqual(r.removes,[81]);assert.equal(r.responses,1);
});
test('cleanup retries a locked remove without reading the completed product again or issuing a second result',async()=>{
  const detail={url:'https://shopee.vn/product/12/34',name:'Rây inox',price_text:'94.000₫',description:'Mô tả hiển thị'};
  const r=runtime({verification:false,removeError:n=>n===1?locked():null,inspect:name=>{
    assert.equal(name,'inspectProductPage');return {status:'ready',detail};
  }});
  const result=await r.request('detail');
  assert.equal(result.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(result.result.detail)),detail);
  assert.equal(r.creates.length,1);assert.equal(r.reads.length,4);assert.deepEqual(r.removes,[81,81]);assert.equal(r.responses,1);
});
test('an exhausted cleanup lock preserves the successful product and does not start collection again',async()=>{
  const r=runtime({verification:false,removeError:()=>locked(),inspect:()=>({status:'ready',detail:{
    url:'https://shopee.vn/product/12/34',name:'Rây inox',price_text:'94.000₫',
  }})});
  const result=await r.request('detail');
  assert.equal(result.ok,true);assert.equal(result.result.detail.name,'Rây inox');
  assert.equal(r.creates.length,1);assert.equal(r.reads.length,4);assert.equal(r.responses,1);
  assert.ok(r.removes.length>1&&r.removes.length<=9);assert.ok(r.elapsed<=4100);
});
