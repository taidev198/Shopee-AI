import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

test('verification pause travels through the real content bridge to the app without implying it for legacy errors', async()=>{
  const listeners=[];
  let keepTab=true;
  const window={location:{origin:'http://127.0.0.1:8000'},
    addEventListener(type,fn){if(type==='message')listeners.push(fn);},
    postMessage(data,origin){queueMicrotask(()=>listeners.forEach(fn=>fn({data,origin,source:window})));}};
  window.top=window;
  const chrome={runtime:{sendMessage:async()=>({ok:false,blocked:true,
    verificationRequired:keepTab,error:'Shopee yêu cầu xác minh thủ công'})}};
  const context=vm.createContext({window,chrome,location:window.location,crypto:{randomUUID},setTimeout,clearTimeout,Map,Set,Error});
  vm.runInContext(await readFile(new URL('../bridge.js',import.meta.url),'utf8'),context);
  vm.runInContext(await readFile(new URL('../../static/chrome-client.js',import.meta.url),'utf8'),context);
  await assert.rejects(window.MarketLensChrome.category('https://shopee.vn/A-cat.1?page=0'),
    error=>error.blocked && error.verificationRequired && error.code==='blocked');
  keepTab=false;
  await assert.rejects(window.MarketLensChrome.categories(),
    error=>error.blocked && !error.verificationRequired && error.code==='blocked');
});

test('tab locks and retained inspection pages keep their error codes through the real bridge',async()=>{
  const listeners=[];
  let inspection=false;
  const window={location:{origin:'http://127.0.0.1:8000'},
    addEventListener(type,fn){if(type==='message')listeners.push(fn);},
    postMessage(data,origin){queueMicrotask(()=>listeners.forEach(fn=>fn({data,origin,source:window})));}};
  window.top=window;
  const chrome={runtime:{sendMessage:async()=>inspection
    ? {ok:false,code:'category_page_timeout',inspectionRequired:true,error:'Chưa thấy thẻ sản phẩm.'}
    : {ok:false,code:'chrome_tabs_busy',retryable:true,error:'Chrome đang khóa thao tác tab.'}}};
  const context=vm.createContext({window,chrome,location:window.location,crypto:{randomUUID},setTimeout,clearTimeout,Map,Set,Error});
  vm.runInContext(await readFile(new URL('../bridge.js',import.meta.url),'utf8'),context);
  vm.runInContext(await readFile(new URL('../../static/chrome-client.js',import.meta.url),'utf8'),context);
  await assert.rejects(window.MarketLensChrome.detail('https://shopee.vn/product/12/34'),
    error=>error.code==='chrome_tabs_busy' && error.retryable && !error.blocked && !error.verificationRequired);
  inspection=true;
  await assert.rejects(window.MarketLensChrome.category('https://shopee.vn/A-cat.1?page=0'),
    error=>error.code==='category_page_timeout' && error.inspectionRequired && !error.blocked && !error.verificationRequired);
});

test('detail waits longer than the extension deadline and preserves its typed retryable timeout',async()=>{
  const listeners=[],timeouts=[],cleared=[];
  const window={location:{origin:'http://127.0.0.1:8000'},
    addEventListener(type,fn){if(type==='message')listeners.push(fn);},
    postMessage(data,origin){queueMicrotask(()=>listeners.forEach(fn=>fn({data,origin,source:window})));}};
  window.top=window;
  const chrome={runtime:{sendMessage:async()=>({ok:false,code:'product_detail_timeout',retryable:true,
    error:'Shopee chưa tải trang chi tiết sản phẩm trong thời gian cho phép (90 giây).'})}};
  const context=vm.createContext({window,chrome,location:window.location,crypto:{randomUUID},
    setTimeout(fn,ms){timeouts.push(ms);return timeouts.length;},clearTimeout:id=>cleared.push(id),Map,Set,Error});
  vm.runInContext(await readFile(new URL('../bridge.js',import.meta.url),'utf8'),context);
  vm.runInContext(await readFile(new URL('../../static/chrome-client.js',import.meta.url),'utf8'),context);
  await assert.rejects(window.MarketLensChrome.detail('https://shopee.vn/product/12/34'),
    error=>error.code==='product_detail_timeout'&&error.retryable&&!error.blocked&&!error.verificationRequired);
  assert.deepEqual(timeouts,[120000]);assert.deepEqual(cleared,[1]);
});
