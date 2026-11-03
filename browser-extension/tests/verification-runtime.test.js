import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateCategoryUrl, inspectCategoryPage} from '../category.js';
import {validateShopUrl, isAllowedAppUrl, inspectShopPage} from '../collector.js';
import {validateProductUrl, inspectProductPage} from '../product-detail.js';
import {validateDiscoveryQuery, inspectSearchPage, inspectProductSeller, inspectShopProfile, validateSellerLink} from '../discovery.js';

const source=(await readFile(new URL('../background.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const actions=['categories','category','detail','collect','discover'];
function runtime({url='https://shopee.vn/verify/captcha?tracking_id=secret#private',snapshot,afterUrl}={}) {
  let listener,reads=0,gets=0,clock=0;
  const removed=[];
  const chrome={runtime:{id:'verification-test',getManifest:()=>({version:'1.3.3'}),onMessage:{addListener:fn=>{listener=fn;}}},
    tabs:{async create(){return {id:81};},async get(){gets++;return {status:'loading',url:gets>1&&afterUrl?afterUrl:url};},async remove(id){removed.push(id);}},
    scripting:{async executeScript(){reads++;return [{result:snapshot}];}}};
  if(snapshot) chrome.tabs.get=async()=>({status:'complete',url});
  const c=vm.createContext({chrome,URL,Map,Set,Error,Promise,Date:{now:()=>clock},setTimeout(fn,ms){clock+=ms;queueMicrotask(fn);},
    validateCategoryUrl,inspectCategoryPage,validateShopUrl,isAllowedAppUrl,inspectShopPage,validateProductUrl,inspectProductPage,
    validateDiscoveryQuery,inspectSearchPage,inspectProductSeller,inspectShopProfile,validateSellerLink});
  vm.runInContext(source,c);
  const request=action=>new Promise(resolve=>listener({source:'marketlens-bridge',requestId:action,action,
    url:action==='category'?'https://shopee.vn/A-cat.1':action==='collect'?'https://shopee.vn/own_shop':'https://shopee.vn/product/12/34',
    query:'rây inox',ownShopUrl:'https://shopee.vn/own_shop'},
    {id:'verification-test',frameId:0,url:'http://127.0.0.1:8000/'},resolve));
  return {request,removed,get reads(){return reads;}};
}
test('ping advertises the installed runtime manual verification pause capability',async()=>{
  const result=await runtime().request('ping');
  assert.equal(result.ok,true);assert.equal(result.result.capabilities.verificationPause,true);
});
for(const action of actions) test(`${action} retains its verification tab before DOM injection and strips tracking from returned route`,async()=>{
  const r=runtime();const result=await r.request(action);
  assert.equal(result.ok,false);assert.equal(result.blocked,true);assert.equal(result.verificationRequired,true);
  assert.equal(result.verificationTabId,81);assert.equal(result.verificationUrl,'https://shopee.vn/verify/captcha');
  assert.match(result.error,/thủ công/);assert.match(result.error,/Tab Shopee được giữ mở/);
  assert.equal(r.reads,0);assert.deepEqual(r.removed,[]);
});
for(const action of actions) test(`${action} closes an offsite task tab and never labels it a verification tab`,async()=>{
  const r=runtime({url:'https://shopee.vn.evil.test/verify/captcha'});const result=await r.request(action);
  assert.equal(result.ok,false);assert.equal(result.verificationRequired,false);
  assert.equal(result.verificationTabId,undefined);assert.equal(result.verificationUrl,undefined);
  assert.equal(r.reads,0);assert.deepEqual(r.removed,[81]);
});
test('a retained verification tab that moves offsite is closed during cleanup',async()=>{
  const r=runtime({afterUrl:'https://evil.test/'});
  const result=await r.request('category');
  assert.equal(result.ok,false);assert.deepEqual(r.removed,[81]);
});
test('a wrong product is closed without suggesting manual CAPTCHA verification',async()=>{
  const r=runtime({url:'https://shopee.vn/product/12/34',snapshot:{status:'wrong_product',error:'Không đúng sản phẩm'}});
  const result=await r.request('detail');
  assert.equal(result.ok,false);assert.equal(result.blocked,false);assert.equal(result.verificationRequired,false);
  assert.deepEqual(r.removed,[81]);
});
