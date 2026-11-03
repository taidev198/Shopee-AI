import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateCategoryUrl, inspectCategoryPage} from '../category.js';
import {isAllowedAppUrl} from '../collector.js';

const source=(await readFile(new URL('../background.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function runtime(read, currentUrl='https://shopee.vn/') {
  let listener,clock=0,created=0,reads=0;
  const removed=[];
  const chrome={runtime:{id:'category-test',onMessage:{addListener:fn=>{listener=fn;}}},
    tabs:{async create(){return {id:++created};},async get(id){return {id,status:'complete',url:currentUrl};},async remove(id){removed.push(id);}},
    scripting:{async executeScript({func,args}){assert.equal(func.name,'inspectCategoryPage');return [{result:read(++reads,args[0])}];}}};
  const c=vm.createContext({chrome,Date:{now:()=>clock},setTimeout(fn,ms){clock+=ms;queueMicrotask(fn);},
    Map,Set,URL,Error,Promise,validateCategoryUrl,inspectCategoryPage,isAllowedAppUrl});
  vm.runInContext(source,c);
  const request=(action='categories',url)=>new Promise(resolve=>{
    assert.equal(listener({source:'marketlens-bridge',requestId:`request-${clock}`,action,url},
      {id:'category-test',frameId:0,url:'http://127.0.0.1:8000/',tab:{windowId:7}},resolve),true);
  });
  return {request,removed,get elapsed(){return clock;},get reads(){return reads;}};
}
const category={name:'Ngành A',url:'https://shopee.vn/A-cat.1'};
test('category timeout keeps its Shopee tab with page-specific diagnostics and no verification claim',async()=>{
  const r=runtime(()=>({status:'loading',loading_reason:'pagination_mismatch'}),'https://shopee.vn/A-cat.1?page=3&tracking_id=private');
  const result=await r.request('category','https://shopee.vn/A-cat.1?page=3');
  assert.equal(result.ok,false);assert.equal(result.code,'category_page_timeout');
  assert.equal(result.inspectionRequired,true);assert.equal(result.verificationRequired,false);
  assert.match(result.error,/Số trang hiển thị chưa khớp/);assert.match(result.error,/Trang cần đọc: 4/);
  assert.equal(result.inspectionUrl,'https://shopee.vn/A-cat.1');assert.deepEqual(r.removed,[]);
});
test('home collector preserves discovered catalogue when next arrow stays enabled without movement',async()=>{
  const r=runtime(()=>({status:'ready',categories:[category],advanced:true,catalog_end:false,carousel_signature:'translateX(-20%)'}));
  const result=await r.request();
  assert.equal(result.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(result.result.categories)),[category]);assert.equal(result.result.catalog_complete,false);
  assert.match(result.result.note,/không xác nhận/);assert.ok(r.elapsed<35000);assert.deepEqual(r.removed,[1]);
});
test('home collector merges lazy carousel pages and verifies its terminal position',async()=>{
  const second={name:'Ngành B',url:'https://shopee.vn/B-cat.2'};
  const r=runtime(n=>({status:'ready',categories:n<3?[category]:[category,second],advanced:n<4,catalog_end:n>=4,carousel_signature:String(Math.min(n,4))}));
  const result=await r.request();
  assert.equal(result.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(result.result.categories)),[category,second]);assert.equal(result.result.catalog_complete,true);
  assert.deepEqual(r.removed,[1]);
});
test('partially loaded catalogue remains usable at the deadline without claiming completeness',async()=>{
  const r=runtime(n=>n===1?{status:'ready',categories:[category],catalog_end:false,carousel_signature:'0'}:{status:'loading'});
  const result=await r.request();
  assert.equal(result.ok,true);assert.equal(result.result.categories.length,1);assert.equal(result.result.catalog_complete,false);
  assert.match(result.result.note,/chưa tải xong/);assert.deepEqual(r.removed,[1]);
});
test('category listing settles URLs and ends on a genuine empty result',async()=>{
  const r=runtime(()=>({status:'ready',urls:[],has_next:false,empty:true}),'https://shopee.vn/A-cat.1?page=9');
  const result=await r.request('category','https://shopee.vn/A-cat.1?page=9');
  assert.equal(result.ok,true);assert.equal(result.result.urls.length,0);assert.equal(result.result.has_next,false);
  assert.ok(r.reads>=2);assert.deepEqual(r.removed,[1]);
});
test('verification after initial catalogue read stops capture and preserves the blocked signal',async()=>{
  const r=runtime(n=>n===1?{status:'ready',categories:[category],catalog_end:false}:{status:'blocked',error:'Shopee yêu cầu xác minh'});
  const result=await r.request();
  assert.equal(result.ok,false);assert.equal(result.blocked,true);assert.equal(result.verificationRequired,true);
  assert.equal(result.verificationTabId,1);assert.equal(result.verificationUrl,'https://shopee.vn/');
  assert.match(result.error,/xác minh/);assert.deepEqual(r.removed,[]);
});
test('category collector rejects navigation away from Shopee before injecting scripts',async()=>{
  const r=runtime(()=>{throw new Error('Must not execute');},'https://evil.test/');
  const result=await r.request();
  assert.equal(result.ok,false);assert.match(result.error,/rời Shopee/);assert.equal(r.reads,0);assert.deepEqual(r.removed,[1]);
});
