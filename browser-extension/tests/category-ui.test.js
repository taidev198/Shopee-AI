import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../static/category-market.js',import.meta.url),'utf8');

test('legacy Chrome tab-lock errors also show manual resume instructions without claiming a CAPTCHA',()=>{
  const {c}=context();
  c.tabError=new Error('Tabs cannot be edited right now (user may be dragging a tab).');
  const message=vm.runInContext('marketFailureMessage(tabError,true)',c);
  assert.match(message,/Chrome đang bận thao tác với tab/);
  assert.match(message,/Chạy \/ tiếp tục tất cả/);
  assert.doesNotMatch(message,/CAPTCHA|Tabs cannot be edited|xác minh/);
  assert.equal(vm.runInContext('marketTabBusy(new Error("No window with id: 7"))',c),false);
});

test('an older category collector is stopped before navigation with an actionable layout update',async()=>{
  const {c,events,click}=context();
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.3',capabilities:{categories:true,categoryCatalog:true,verificationPause:true}});
  let calls=0;c.MarketLensChrome.categories=async()=>{calls++;};
  await click('marketScanEverything');
  assert.equal(calls,0);assert.equal(events.length,0);
  assert.match(vm.runInContext('marketState.message',c),/bố cục danh sách ngành hàng mới/);
  assert.match(vm.runInContext('marketState.message',c),/1\.3\.7/);
});

test('an unsupported category page stays paused with retry instructions instead of failing products',async()=>{
  const {c,events}=context({MarketLensChrome:{category:async()=>{throw Object.assign(new Error('Chưa đọc được thẻ sản phẩm.'),{code:'category_page_timeout',inspectionRequired:true});}}});
  await vm.runInContext("runMarket(['a'],false)",c);
  assert.deepEqual(events.filter(e=>e.path.endsWith('/pause')).map(e=>e.path),['/api/category-market/runs/a/pause']);
  assert.ok(!events.some(e=>e.path.endsWith('/skip')||e.path.endsWith('/listing')));
  assert.match(vm.runInContext('marketState.message',c),/Hoàn tất 0\/1 ngành; 1 ngành còn lỗi/);
  assert.match(vm.runInContext('marketState.message',c),/Thử lại tất cả lỗi/);
  assert.equal(vm.runInContext('marketState.autoPaused',c),true);
});

test('connection status confirms tab-lock recovery only when the loaded extension supports it',async()=>{
  const {c}=context();
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.5',capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2,tabEditRetry:true}});
  await vm.runInContext('probeMarketChrome(true)',c);
  assert.match(vm.runInContext('marketChromeStatus()',c),/Tự chờ khi Chrome tạm khóa thao tác tab/);
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.5',capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
  await vm.runInContext('probeMarketChrome(true)',c);
  assert.doesNotMatch(vm.runInContext('marketChromeStatus()',c),/Tự chờ khi Chrome tạm khóa thao tác tab/);
});
function context(overrides={},concurrency=2) {
  const events=[],state={tasks:{}},listeners={};
  const c=vm.createContext({
    document:{addEventListener(type,callback){listeners[type]=callback;}},navigator:{locks:{request:async(name,options,callback)=>callback({name})}},
    S:{view:'overview',crawlSubmitting:false,competitor:{}},$(){return null},render(){},toast(){},
    esc:value=>String(value??''),num:value=>String(value),money:value=>String(value),kpi:()=>'',
    setInterval(){},setTimeout(fn,ms){if(ms===1500)fn();},URL,Map,Date,Promise,
    MarketLensChrome:{category:async()=>({urls:['https://shopee.vn/product/12/34'],has_next:false}),detail:async()=>({detail:{url:'https://shopee.vn/product/12/34',name:'SP'}})},
    window:{MarketLensChrome:{ping:async()=>({capabilities:{categories:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}})}},
    api:async(path,options)=>{
      events.push({path,body:options?.body?JSON.parse(options.body):null});
      if(path.split('?')[0].endsWith('/runs'))return [];
      if(path.endsWith('/schedules'))return [];
      if(path.includes('/products?'))return {products:[]};
      if(path.endsWith('/resume'))return {run_id:path.split('/').at(-2),status:'pending',requeued:0};
      if(path.includes('/next?')){const id=path.split('/').at(-2),index=state.tasks[id]||0;state.tasks[id]=index+1;return [{type:'listing',url:'https://shopee.vn/Test-cat.1?page=0',page:0},{type:'detail',url:'https://shopee.vn/product/12/34'},{type:'done'}][index];}
      return {};
    },...overrides
  });
  vm.runInContext(source,c);
  c.testConcurrency=concurrency;vm.runInContext('marketState.concurrency=testConcurrency',c);
  const click=async(id,disabled=false,dataset={})=>{
    const button={id,disabled,dataset};
    await listeners.click({target:{closest:()=>button}});
    return button;
  };
  return {c,events,click,change:async target=>listeners.change({target})};
}
test('market runner checkpoints listing then each product and completes',async()=>{
  const {c,events}=context();
  await vm.runInContext("runMarket(['run1'])",c);
  assert.deepEqual(events.filter(e=>e.body).map(e=>e.path),['/api/category-market/runs/run1/listing','/api/category-market/runs/run1/detail']);
  assert.equal(vm.runInContext('marketState.busy',c),false);
});

function queueRows() {
  const base={name:'Ngành hàng',created_at:'2026-10-15T09:00:00+07:00',full_scan:1,page:3,max_pages:5,max_products:150,completed:2,discovered:3,failed:0,error:'',superseded:false};
  return [{...base,id:'paused',status:'paused',error:'Chưa đọc được danh sách'},
    {...base,id:'pending',status:'pending',error:'Không thấy nút trang tiếp theo trên Shopee'},
    {...base,id:'partial',status:'partial',failed:1},
    {...base,id:'old',status:'partial',failed:1,superseded:true},
    {...base,id:'done',status:'done'},
    {...base,id:'partial-empty',status:'partial'}];
}

test('resumable rows and retry-all controls include failed products while excluding superseded runs',()=>{
  const {c}=context();c.rows=queueRows();vm.runInContext('marketState.runs=rows',c);
  const html=vm.runInContext('renderCategoryMarket()',c);
  assert.match(html,/data-market-run="paused"[^>]*>Tiếp tục/);
  assert.match(html,/data-market-run="partial"[^>]*>Thử lại SP lỗi/);
  assert.doesNotMatch(html,/data-market-run="old"|data-market-run="done"|data-market-run="partial-empty"/);
  assert.match(html,/Thử lại tất cả lỗi \(2\)/);
  assert.equal((html.match(/id="marketRetryErrorsHero"/g)||[]).length,1);
  assert.equal((html.match(/id="marketRetryErrors"/g)||[]).length,1);
});

test('the actual row action resumes only the selected failed products before reading their fresh details',async()=>{
  const {c,events,click}=context();c.rows=queueRows();vm.runInContext('marketState.runs=rows',c);
  const original=c.api;let tasks=0;
  c.api=async(path,options)=>{
    if(path.includes('/next?')){events.push({path});return tasks++===0?{type:'detail',url:'https://shopee.vn/product/12/35'}:{type:'done'};}
    if(path.endsWith('/resume')){events.push({path,body:JSON.parse(options.body)});return {run_id:'partial',status:'pending',requeued:1};}
    return original(path,options);
  };
  c.MarketLensChrome.detail=async url=>{
    assert.ok(events.some(event=>event.path==='/api/category-market/runs/partial/resume'));
    return {detail:{url,name:'Đọc lại giá mới',price_text:'99.000₫'}};
  };
  await click('',false,{marketRun:'partial'});
  const mutations=events.filter(event=>event.body);
  assert.deepEqual(mutations.map(event=>event.path),['/api/category-market/runs/partial/resume','/api/category-market/runs/partial/detail']);
  assert.equal(mutations[1].body.url,'https://shopee.vn/product/12/35');
  assert.equal(mutations[1].body.price_text,'99.000₫');
  assert.ok(!mutations.some(event=>event.path.includes('/old/')||event.path.endsWith('/skip')));
});

test('both actual retry-all buttons retry paused and partial-failed runs without restarting clean pending work',async()=>{
  for(const id of ['marketRetryErrorsHero','marketRetryErrors']){
    const {c,events,click}=context();c.rows=queueRows();vm.runInContext('marketState.runs=rows',c);
    const original=c.api;
    c.api=async(path,options)=>path.includes('/next?')?{type:'done'}:original(path,options);
    await click(id);
    assert.deepEqual(events.filter(event=>event.path.endsWith('/resume')).map(event=>event.path),['/api/category-market/runs/paused/resume','/api/category-market/runs/partial/resume']);
  }
});

test('the actual continue-all action includes pending, paused and partial failures but never superseded runs',async()=>{
  const {c,events,click}=context();c.rows=queueRows();vm.runInContext('marketState.runs=rows',c);
  const original=c.api;c.api=async(path,options)=>path.includes('/next?')?{type:'done'}:original(path,options);
  await click('marketRunAll');
  assert.deepEqual(events.filter(event=>event.path.endsWith('/resume')).map(event=>event.path),['/api/category-market/runs/paused/resume','/api/category-market/runs/pending/resume','/api/category-market/runs/partial/resume']);
});

test('manual retry never changes a queue before its busy, cross-tab-lock and capability checks pass',async()=>{
  for(const kind of ['busy','locked','old-extension']){
    const {c,events,click}=context();c.rows=queueRows();vm.runInContext('marketState.runs=rows',c);
    if(kind==='busy')c.S.crawlSubmitting=true;
    if(kind==='locked')c.navigator.locks.request=async(name,options,callback)=>callback(null);
    if(kind==='old-extension')c.window.MarketLensChrome.ping=async()=>({version:'1.3.0',capabilities:{categories:true}});
    await click('',false,{marketRun:'paused'});
    assert.ok(!events.some(event=>event.path.endsWith('/resume')||event.path.includes('/next?')),kind);
  }
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function parallelRows() {
  const base=queueRows()[1];
  return ['a','b','c','d'].map((id,index)=>({...base,id,name:`Ngành ${id}`,category_id:String(index+1),status:'pending',completed:0,discovered:1}));
}

test('two category captures overlap, row and all actions join the same pool, and active or queued IDs never duplicate',async()=>{
  const {c,events,click}=context();c.rows=parallelRows();vm.runInContext('marketState.runs=rows',c);
  let locks=0;c.navigator.locks.request=async(name,options,callback)=>{locks++;return callback({name});};
  const pending=new Map(),reads=[],steps=[],indices={},number={a:34,b:35,c:36,d:37};
  let active=0,maxActive=0;
  const original=c.api;
  c.api=async(path,options)=>{
    if(path.split('?')[0].endsWith('/runs')){events.push({path});return c.rows;}
    if(path.includes('/next?')){
      events.push({path});const id=path.split('/').at(-2),index=indices[id]||0;indices[id]=index+1;
      if(index===0)return {type:'listing',url:`https://shopee.vn/${id}-cat.${number[id]}?page=0`,page:0};
      if(index===1)return {type:'detail',url:`https://shopee.vn/product/12/${number[id]}`};
      c.rows.find(row=>row.id===id).status='done';return {type:'done'};
    }
    if(options?.method==='POST')steps.push(path);
    return original(path,options);
  };
  c.MarketLensChrome.category=url=>{
    const id=new URL(url).pathname.slice(1,2),wait=deferred();pending.set(id,wait);reads.push(id);
    active++;maxActive=Math.max(maxActive,active);
    return wait.promise.finally(()=>{active--;});
  };
  c.MarketLensChrome.detail=async url=>{
    const item=Number(new URL(url).pathname.split('/').at(-1)),id=Object.keys(number).find(key=>number[key]===item);
    assert.ok(steps.includes(`/api/category-market/runs/${id}/listing`),'listing checkpoint precedes its product detail');
    steps.push(`detail-read-${id}`);
    return {detail:{url,name:`Sản phẩm ${id}`,price_text:'99.000₫'}};
  };
  const work=vm.runInContext("runMarket(['a'],false,true)",c);await tick();
  assert.deepEqual(reads,['a']);
  await click('',false,{marketRun:'b'});await tick();
  assert.deepEqual(reads,['a','b']);assert.equal(active,2);assert.equal(maxActive,2);
  assert.match(vm.runInContext('marketState.message',c),/Đang quét 2 ngành cùng lúc/);
  assert.match(vm.runInContext('marketRunActions(rows[0])',c),/disabled>Đang quét/);
  assert.equal(vm.runInContext('marketRunAvailable(rows[2])',c),true);
  await click('marketRunAll');await tick();
  assert.equal(vm.runInContext('marketState.runner.queue.length',c),2);
  assert.match(vm.runInContext('marketRunActions(rows[2])',c),/disabled>Đã xếp hàng đợi/);
  await click('',false,{marketRun:'c'});
  await vm.runInContext("runMarket(['a','b','c'],false,true)",c);
  assert.equal(vm.runInContext('marketState.runner.assigned.size',c),4);assert.equal(locks,1);
  const release=id=>pending.get(id).resolve({urls:[`https://shopee.vn/product/12/${number[id]}`],has_next:false});
  release('a');await tick();
  assert.deepEqual(reads,['a','b','c']);assert.equal(active,2);
  release('b');await tick();
  assert.deepEqual(reads,['a','b','c','d']);assert.equal(active,2);
  release('c');release('d');await work;
  assert.equal(maxActive,2);assert.equal(locks,1);
  for(const id of ['a','b','c','d']){
    assert.equal(events.filter(event=>event.path===`/api/category-market/runs/${id}/resume`).length,1);
    assert.equal(events.filter(event=>event.path===`/api/category-market/runs/${id}/listing`).length,1);
    assert.equal(events.filter(event=>event.path===`/api/category-market/runs/${id}/detail`).length,1);
    assert.ok(steps.indexOf(`detail-read-${id}`)<steps.indexOf(`/api/category-market/runs/${id}/detail`));
  }
  assert.match(vm.runInContext('marketState.message',c),/Hoàn tất 4\/4 ngành; 0 ngành còn lỗi/);
  assert.equal(vm.runInContext('marketState.runner',c),null);
});

test('global verification, tab-busy, network and callback failures drain the other active checkpoint before pausing all assigned runs',async()=>{
  for(const failure of ['verification','tab-busy','network','callback']){
    const {c,events,click}=context();c.rows=parallelRows();vm.runInContext('marketState.runs=rows',c);
    const first=deferred(),second=deferred();let saved=false;
    const original=c.api;
    c.api=async(path,options)=>{
      if(path.split('?')[0].endsWith('/runs')){events.push({path});return c.rows;}
      if(path.includes('/products?')){events.push({path});return {products:saved?[{name:'Đã lưu khi dừng',price:99000}]:[]};}
      if(path.includes('/next?')){events.push({path});return path.includes('/runs/a/')?{type:'listing',url:'https://shopee.vn/A-cat.1?page=0',page:0}:{type:'detail',url:'https://shopee.vn/product/12/35'};}
      if(path.endsWith('/listing')&&failure==='callback')throw new Error('Lưu con trỏ trang thất bại');
      if(path.endsWith('/detail'))saved=true;
      return original(path,options);
    };
    let categoryReads=0,detailReads=0;
    c.MarketLensChrome.category=()=>{categoryReads++;return first.promise;};
    c.MarketLensChrome.detail=()=>{detailReads++;return second.promise;};
    const work=vm.runInContext("runMarket(['a','b','c'],false,true)",c);await tick();
    assert.equal(categoryReads,1);assert.equal(detailReads,1);
    if(failure==='callback')first.resolve({urls:['https://shopee.vn/product/12/34'],has_next:false});
    else first.reject(failure==='verification'?Object.assign(new Error('Shopee yêu cầu xác minh.'),{blocked:true,verificationRequired:true,code:'category_page_timeout'})
      :failure==='tab-busy'?Object.assign(new Error('Tabs cannot be edited right now'),{code:'chrome_tabs_busy',retryable:true}):new Error('Không kết nối được Chrome'));
    await tick();
    assert.equal(vm.runInContext('marketState.runner.accepting',c),false,failure);
    assert.ok(!events.some(event=>event.path.endsWith('/pause')),failure);
    await click('',false,{marketRun:'c'});await click('marketRunAll');
    assert.ok(!events.some(event=>event.path==='/api/category-market/runs/c/resume'),failure);
    second.resolve({detail:{url:'https://shopee.vn/product/12/35',name:'Đã lưu khi dừng',price_text:'99.000₫'}});await work;
    assert.equal(categoryReads,1);assert.equal(detailReads,1);
    const checkpoint=events.findIndex(event=>event.path.endsWith('/detail')),pause=events.findIndex(event=>event.path.endsWith('/pause'));
    assert.ok(checkpoint>=0&&pause>checkpoint,failure);
    assert.deepEqual(events.filter(event=>event.path.endsWith('/pause')).map(event=>event.path),['/api/category-market/runs/a/pause','/api/category-market/runs/b/pause','/api/category-market/runs/c/pause']);
    assert.equal(vm.runInContext('marketState.products[0].price',c),99000);
    assert.equal(vm.runInContext('marketState.autoPaused',c),true);
    assert.equal(vm.runInContext('marketState.busy',c),false);
    const count=events.length;await vm.runInContext('pollMarketSchedules()',c);assert.equal(events.length,count);
  }
});

test('manual stop drains both in-flight product reads and never dispatches the queued category',async()=>{
  const {c,events,click}=context();c.rows=parallelRows();vm.runInContext('marketState.runs=rows',c);
  const pending=new Map(),reads=[];
  const original=c.api;
  c.api=async(path,options)=>{
    if(path.split('?')[0].endsWith('/runs')){events.push({path});return c.rows;}
    if(path.includes('/next?')){events.push({path});const id=path.split('/').at(-2);return {type:'detail',url:`https://shopee.vn/product/12/${id==='a'?34:35}`};}
    return original(path,options);
  };
  c.MarketLensChrome.detail=url=>{const wait=deferred();pending.set(url,wait);reads.push(url);return wait.promise;};
  const work=vm.runInContext("runMarket(['a','b','c'],false,true)",c);await tick();
  assert.equal(reads.length,2);await click('marketStop');
  assert.equal(vm.runInContext('marketState.runner.accepting',c),false);
  pending.get(reads[1]).resolve({detail:{url:reads[1],name:'Sản phẩm B đã lưu'}});await tick();
  assert.equal(events.filter(event=>event.path.endsWith('/detail')).length,1);
  assert.ok(!events.some(event=>event.path.endsWith('/pause')));
  pending.get(reads[0]).resolve({detail:{url:reads[0],name:'Sản phẩm A đã lưu'}});await work;
  assert.equal(reads.length,2);
  assert.equal(events.filter(event=>event.path.endsWith('/detail')).length,2);
  assert.ok(!events.some(event=>event.path.includes('/runs/c/resume')||event.path.includes('/runs/c/next?')));
  const lastDetail=Math.max(...events.map((event,index)=>event.path.endsWith('/detail')?index:-1));
  assert.ok(events.findIndex(event=>event.path.endsWith('/pause'))>lastDetail);
  assert.equal(events.filter(event=>event.path.endsWith('/pause')).length,3);
  assert.match(vm.runInContext('marketState.message',c),/Đã dừng và lưu tiến độ/);
});

test('an installed category runtime without two-worker support cannot change queues or open pages',async()=>{
  const {c,events}=context();let reads=0;
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.5',capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:1}});
  c.MarketLensChrome.category=async()=>{reads++;};
  await vm.runInContext("runMarket(['a'],false,true)",c);
  assert.equal(reads,0);
  assert.ok(!events.some(event=>event.path.endsWith('/resume')||event.path.includes('/next?')));
  assert.match(vm.runInContext('marketState.message',c),/chưa hỗ trợ mức 2 ngành đồng thời.*1\.3\.7/);
});

test('a category page timeout pauses only that category and continues collecting the next category',async()=>{
  for(const legacy of [false,true]){
    const {c,events}=context();const queues={a:[{type:'listing',url:'https://shopee.vn/A-cat.1?page=0',page:0}],b:[{type:'listing',url:'https://shopee.vn/B-cat.2?page=0',page:0},{type:'detail',url:'https://shopee.vn/product/12/34'},{type:'done'}]};
    const original=c.api;
    c.api=async(path,options)=>{
      if(path.includes('/next?')){events.push({path});return queues[path.split('/').at(-2)].shift();}
      return original(path,options);
    };
    const reads=[];
    c.MarketLensChrome.category=async url=>{
      reads.push(url);
      if(url.includes('/A-cat.'))throw legacy?new Error('Trang ngành hàng chưa tải đủ hoặc cấu trúc trang chưa được hỗ trợ. Hãy kiểm tra Chrome rồi tiếp tục.')
        :Object.assign(new Error('Danh sách chưa hiển thị.'),{code:'category_page_timeout',inspectionRequired:true});
      return {urls:['https://shopee.vn/product/12/34'],has_next:false};
    };
    await vm.runInContext("runMarket(['a','b'])",c);
    assert.deepEqual(reads,['https://shopee.vn/A-cat.1?page=0','https://shopee.vn/B-cat.2?page=0']);
    assert.deepEqual(events.filter(event=>event.path.endsWith('/pause')).map(event=>event.path),['/api/category-market/runs/a/pause']);
    assert.equal(events.filter(event=>event.path.endsWith('/detail')).length,1);
    assert.ok(!events.some(event=>event.path.endsWith('/skip')));
    assert.match(vm.runInContext('marketState.message',c),/Hoàn tất 1\/2 ngành; 1 ngành còn lỗi/);
    const count=events.length;await vm.runInContext('pollMarketSchedules()',c);assert.equal(events.length,count);
  }
});

test('callback failures remain global stops even when a callback error mentions category page timeout',async()=>{
  const {c,events}=context();let reads=0;
  const original=c.api;c.api=async(path,options)=>{
    if(path.endsWith('/listing'))throw Object.assign(new Error('Không lưu được con trỏ trang'),{code:'category_page_timeout'});
    return original(path,options);
  };
  c.MarketLensChrome.category=async()=>{reads++;return {urls:['https://shopee.vn/product/12/34'],has_next:false};};
  await vm.runInContext("runMarket(['a','b'])",c);
  assert.equal(reads,2);
  assert.deepEqual(events.filter(event=>event.path.endsWith('/pause')).map(event=>event.path),['/api/category-market/runs/a/pause','/api/category-market/runs/b/pause']);
});

test('requested stop saves the current detail and never resumes or navigates the queued third category',async()=>{
  const {c,events,click}=context();let reads=0;
  c.MarketLensChrome.detail=async url=>{reads++;await click('marketStop');return {detail:{url,name:'Đã lưu trước khi dừng'}};};
  await vm.runInContext("runMarket(['a','b','c'],false,true)",c);
  assert.equal(reads,1);
  assert.deepEqual(events.filter(event=>event.path.endsWith('/resume')).map(event=>event.path),['/api/category-market/runs/a/resume','/api/category-market/runs/b/resume']);
  assert.equal(events.filter(event=>event.path.endsWith('/detail')).length,1);
  assert.ok(!events.some(event=>event.path.includes('/runs/c/next?')));
  assert.deepEqual(events.filter(event=>event.path.endsWith('/pause')).map(event=>event.path),['/api/category-market/runs/a/pause','/api/category-market/runs/b/pause','/api/category-market/runs/c/pause']);
  assert.match(vm.runInContext('marketState.message',c),/Đã dừng và lưu tiến độ/);
});
test('failed Chrome capture pauses all queued runs and disables automatic retries',async()=>{
  const {c,events}=context({MarketLensChrome:{category:async()=>{throw new Error('captcha')}}});
  await vm.runInContext("runMarket(['a','b'],true)",c);
  assert.deepEqual(events.filter(e=>e.path.endsWith('/pause')).map(e=>e.path),['/api/category-market/runs/a/pause','/api/category-market/runs/b/pause']);
  assert.equal(vm.runInContext('marketState.autoPaused',c),true);
  assert.ok(!events.some(e=>e.path.endsWith('/detail')));
});
test('scheduled task respects a schedule disabled in another tab',async()=>{
  const {c,events}=context({api:async(path)=>path.includes('/next?')?{type:'paused'}:path.includes('/products?')?{products:[]}:[]});
  let calls=0;c.MarketLensChrome.category=async()=>{calls++;};
  await vm.runInContext("runMarket(['a'],true)",c);
  assert.equal(calls,0);
});

test('one click discovers fresh categories and starts every category in full mode without form fields',async()=>{
  const {c,events,click}=context();
  c.window.MarketLensChrome.ping=async()=>({capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
  c.MarketLensChrome.categories=async()=>({categories:[{name:'A',url:'https://shopee.vn/A-cat.1'},{name:'B',url:'https://shopee.vn/B-cat.2'}]});
  const original=c.api;
  c.api=async(path,options)=>{
    if(path.endsWith('/campaigns')) {events.push({path,body:JSON.parse(options.body)});return {run_ids:['a','b']};}
    if(path.includes('/next?')) {events.push({path});return {type:'done'};}
    return original(path,options);
  };
  vm.runInContext("marketState.categories=[{name:'Old',url:'https://shopee.vn/Old-cat.99',selected:true}]",c);
  await click('marketScanEverything');
  const campaign=events.find(e=>e.path.endsWith('/campaigns')).body;
  assert.equal(campaign.full_scan,true);
  assert.deepEqual(campaign.categories.map(x=>x.name),['A','B']);
  assert.deepEqual(events.filter(e=>e.path.includes('/next?')).map(e=>e.path),['/api/category-market/runs/a/next?automatic=false','/api/category-market/runs/b/next?automatic=false']);
});
test('empty catalogue never falls back to stale categories or creates a campaign',async()=>{
  const {c,events}=context();
  c.window.MarketLensChrome.ping=async()=>({capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
  c.MarketLensChrome.categories=async()=>({categories:[]});
  await vm.runInContext('scanAllMarket()',c);
  assert.ok(!events.some(e=>e.path.endsWith('/campaigns')));
  assert.equal(vm.runInContext('marketState.busy',c),false);
  assert.match(vm.runInContext('marketState.message',c),/chưa hiển thị danh mục/);
});

test('refresh shows the installed extension version before the user presses scan',async()=>{
  const {c,events}=context();
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.0',capabilities:{categories:true}});
  await vm.runInContext('refreshMarket()',c);
  const hero=vm.runInContext('marketScanAllPanel()',c);
  assert.match(hero,/MarketLens v1\.3\.0/);
  assert.match(hero,/Reload tiện ích MarketLens 1\.3\.7/);
  assert.match(hero,/id="marketChromeStatus"/);
  assert.ok(!events.some(e=>e.path.endsWith('/campaigns')));
});

test('old connected extension produces persistent actionable status and creates no queue',async()=>{
  const {c,events,click}=context();
  let captures=0;
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.0',capabilities:{categories:true}});
  c.MarketLensChrome.categories=async()=>{captures++;return {categories:[]};};
  await click('marketScanEverything');
  assert.equal(captures,0);
  assert.ok(!events.some(e=>e.path.endsWith('/campaigns')));
  assert.match(vm.runInContext('marketState.message',c),/v1\.3\.0.*1\.3\.7/);
  assert.match(vm.runInContext('marketScanAllPanel()',c),/id="marketScanAllProgress"[^>]*>Chưa bắt đầu quét/);
  assert.equal(vm.runInContext('marketState.busy',c),false);
});

test('missing extension connection remains visible next to the scan button',async()=>{
  const {c,click}=context();
  c.window.MarketLensChrome.ping=async()=>{throw new Error('Tiện ích chưa kết nối');};
  await click('marketScanEverything');
  assert.match(vm.runInContext('marketScanAllPanel()',c),/Chưa kết nối Chrome: Tiện ích chưa kết nối/);
  assert.equal(vm.runInContext('marketState.busy',c),false);
});

test('catalogue verification keeps the user on manual verification without creating or automatically retrying a queue',async()=>{
  const {c,events,click}=context();
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.5',capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
  let captures=0;
  c.MarketLensChrome.categories=async()=>{
    captures++;
    throw Object.assign(new Error('Shopee yêu cầu xác minh CAPTCHA.'),{blocked:true,verificationRequired:true});
  };
  await click('marketScanEverything');
  assert.equal(captures,1);
  assert.ok(!events.some(e=>e.path.endsWith('/campaigns')));
  const message=vm.runInContext('marketState.message',c);
  assert.match(message,/Tab Shopee yêu cầu xác minh được giữ mở/);
  assert.match(message,/bấm “Quét tất cả ngành hàng”.*chưa tạo hàng đợi/);
  assert.match(message,/không tự chạy lại/);
  assert.equal(vm.runInContext('marketState.autoPaused',c),true);
  assert.equal(vm.runInContext('marketState.busy',c),false);
  await vm.runInContext('pollMarketSchedules()',c);
  assert.equal(captures,1);
  assert.equal(events.length,0);
});

test('an old runtime that supports category capture cannot start before it supports retaining verification tabs',async()=>{
  const {c,click}=context();
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.2',capabilities:{categories:true,categoryCatalog:true}});
  let captures=0;
  c.MarketLensChrome.categories=async()=>{captures++;throw Object.assign(new Error('Shopee yêu cầu xác minh.'),{blocked:true});};
  await click('marketScanEverything');
  const message=vm.runInContext('marketState.message',c);
  assert.equal(captures,0);
  assert.match(message,/v1\.3\.2.*chưa hỗ trợ giữ tab.*1\.3\.7/);
  assert.doesNotMatch(message,/Tab Shopee yêu cầu xác minh được giữ mở/);
  assert.doesNotMatch(vm.runInContext('marketChromeStatus()',c),/sẵn sàng quét/);
  assert.equal(vm.runInContext('marketState.autoPaused',c),true);
});

test('verification on a later listing pauses the run, keeps saved details and requires an explicit resume',async()=>{
  const {c,events}=context();
  const product={sku:'12.34',name:'Sản phẩm đã lưu'};
  const tasks=[{type:'listing',url:'https://shopee.vn/Test-cat.1?page=0',page:0},
    {type:'detail',url:'https://shopee.vn/product/12/34'},
    {type:'listing',url:'https://shopee.vn/Test-cat.1?page=1',page:1}];
  let task=0,captures=0,saved=false;
  c.MarketLensChrome.category=async()=>{
    captures++;
    if(captures===2) throw Object.assign(new Error('Shopee yêu cầu xác minh CAPTCHA.'),{blocked:true,verificationRequired:true});
    return {urls:['https://shopee.vn/product/12/34'],has_next:true};
  };
  const original=c.api;
  c.api=async(path,options)=>{
    if(path.includes('/next?')) {events.push({path});return tasks[task++];}
    if(path.endsWith('/detail')) saved=true;
    if(path.includes('/products?')) {events.push({path});return {products:saved?[product]:[],product_count:saved?1:0};}
    return original(path,options);
  };
  await vm.runInContext("runMarket(['a'],true)",c);
  assert.equal(captures,2);assert.equal(task,3);
  assert.equal(events.filter(e=>e.path.endsWith('/detail')).length,1);
  assert.equal(events.filter(e=>e.path.endsWith('/listing')).length,1);
  assert.deepEqual(events.filter(e=>e.path.endsWith('/pause')).map(e=>e.path),['/api/category-market/runs/a/pause']);
  assert.ok(events.findIndex(e=>e.path.endsWith('/detail'))<events.findIndex(e=>e.path.endsWith('/pause')));
  assert.equal(vm.runInContext('marketState.products[0].name',c),'Sản phẩm đã lưu');
  assert.equal(vm.runInContext('marketState.autoPaused',c),true);
  assert.equal(vm.runInContext('marketState.busy',c),false);
  assert.match(vm.runInContext('marketState.message',c),/Tab Shopee yêu cầu xác minh được giữ mở/);
  assert.match(vm.runInContext('marketState.message',c),/bấm “Chạy \/ tiếp tục tất cả”.*tiến độ đã lưu/);
  const eventCount=events.length;
  await vm.runInContext('pollMarketSchedules()',c);
  assert.equal(events.length,eventCount);assert.equal(captures,2);
});

test('exhausted Chrome tab-busy errors before catalogue discovery create no queue and explain how to retry manually',async()=>{
  const {c,events,click}=context();
  c.window.MarketLensChrome.ping=async()=>({capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
  let captures=0;
  c.MarketLensChrome.categories=async()=>{
    captures++;
    throw Object.assign(new Error('Tabs cannot be edited right now (user may be dragging a tab).'),{code:'chrome_tabs_busy',retryable:true});
  };
  await click('marketScanEverything');
  assert.equal(captures,1);
  assert.ok(!events.some(e=>e.path.endsWith('/campaigns')));
  assert.match(vm.runInContext('marketState.message',c),/Chrome đang bận thao tác với tab.*hãy thả chuột/);
  assert.match(vm.runInContext('marketState.message',c),/bấm “Quét tất cả ngành hàng”.*chưa tạo hàng đợi/);
  assert.doesNotMatch(vm.runInContext('marketState.message',c),/CAPTCHA|Tabs cannot be edited/);
  assert.equal(vm.runInContext('marketState.autoPaused',c),true);
  assert.equal(vm.runInContext('marketState.busy',c),false);
  await vm.runInContext('pollMarketSchedules()',c);
  assert.equal(captures,1);assert.equal(events.length,0);
});

test('exhausted Chrome tab-busy errors pause all queues without failing products or changing saved detail results',async()=>{
  const {c,events}=context();
  const savedProduct={sku:'12.34',name:'Sản phẩm đã lưu',price:89000};
  const tasks=[{type:'listing',url:'https://shopee.vn/Test-cat.1?page=0',page:0},
    {type:'detail',url:'https://shopee.vn/product/12/34'},
    {type:'listing',url:'https://shopee.vn/Test-cat.1?page=1',page:1},
    {type:'detail',url:'https://shopee.vn/product/12/35'}];
  let task=0,detailReads=0,saved=false;
  c.MarketLensChrome.category=async url=>({urls:[`https://shopee.vn/product/12/${url.endsWith('page=0')?'34':'35'}`],has_next:url.endsWith('page=0')});
  c.MarketLensChrome.detail=async url=>{
    detailReads++;
    if(detailReads===2) throw Object.assign(new Error('Tabs cannot be edited right now (user may be dragging a tab).'),{code:'chrome_tabs_busy',retryable:true});
    return {detail:{url,name:savedProduct.name,price_text:'89.000₫'}};
  };
  const original=c.api;
  c.api=async(path,options)=>{
    if(path.includes('/next?')) {events.push({path});return tasks[task++];}
    if(path.endsWith('/detail')) saved=true;
    if(path.includes('/products?')) {events.push({path});return {products:saved?[savedProduct]:[],product_count:saved?1:0};}
    return original(path,options);
  };
  await vm.runInContext("runMarket(['a','b'],true)",c);
  assert.equal(detailReads,2);assert.equal(task,4);
  assert.equal(events.filter(e=>e.path.endsWith('/detail')).length,1);
  assert.deepEqual(events.filter(e=>e.path.endsWith('/pause')).map(e=>e.path),['/api/category-market/runs/a/pause','/api/category-market/runs/b/pause']);
  assert.ok(!events.some(e=>e.path.endsWith('/skip')));
  const checkpoint=events.find(e=>e.path.endsWith('/detail'));
  assert.equal(checkpoint.body.url,'https://shopee.vn/product/12/34');
  assert.equal(checkpoint.body.price_text,'89.000₫');
  assert.equal(vm.runInContext('marketState.products[0].price',c),savedProduct.price);
  assert.match(vm.runInContext('marketState.message',c),/Chrome đang bận thao tác với tab.*bấm “Chạy \/ tiếp tục tất cả”/);
  assert.ok(events.filter(e=>e.path.endsWith('/pause')).every(e=>/hãy thả chuột/.test(e.body.error)));
  assert.equal(vm.runInContext('marketState.autoPaused',c),true);
  assert.equal(vm.runInContext('marketState.busy',c),false);
  const eventCount=events.length;
  await vm.runInContext('pollMarketSchedules()',c);
  assert.equal(events.length,eventCount);assert.equal(detailReads,2);
});

test('unavailable cross-tab lock stores the reason without calling Chrome or creating a queue',async()=>{
  const {c,events,click}=context({navigator:{locks:{request:async(name,options,callback)=>callback(null)}}});
  let pings=0;c.window.MarketLensChrome.ping=async()=>{pings++;};
  await click('marketScanEverything');
  assert.match(vm.runInContext('marketState.message',c),/Một tab MarketLens khác đang thu thập/);
  assert.match(vm.runInContext('marketScanAllPanel()',c),/Chờ tab đó hoàn tất/);
  assert.equal(pings,0);assert.equal(events.length,0);
});

test('another active Chrome task explains why all-category scan cannot start',async()=>{
  const {c,events,click}=context();c.S.crawlSubmitting=true;
  await click('marketScanEverything');
  assert.match(vm.runInContext('marketState.message',c),/Đang có tác vụ Chrome khác/);
  assert.equal(events.length,0);
});

test('partial catalogue preserves discovered names without claiming or queuing an all-category scan',async()=>{
  const {c,events,click}=context();
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.5',capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
  c.MarketLensChrome.categories=async()=>({catalog_complete:false,note:'Carousel chưa tải xong.',categories:[{name:'A',url:'https://shopee.vn/A-cat.1'}]});
  await click('marketScanEverything');
  assert.ok(!events.some(e=>e.path.endsWith('/campaigns')));
  assert.equal(vm.runInContext('marketState.categories[0].name',c),'A');
  assert.match(vm.runInContext('marketState.message',c),/danh mục chưa tải đủ.*Chưa tạo hàng đợi quét tất cả/);
  assert.match(vm.runInContext('marketState.message',c),/Carousel chưa tải xong/);
  assert.equal(vm.runInContext('marketState.busy',c),false);
});

test('advanced catalogue discovery discloses incomplete scope and keeps manual subset selection available',async()=>{
  const {c,events,click}=context();
  c.MarketLensChrome.categories=async()=>({catalog_complete:false,note:'Chưa xác nhận trang cuối.',categories:[{name:'A',url:'https://shopee.vn/A-cat.1'}]});
  await click('marketDiscover');
  assert.match(vm.runInContext('marketState.message',c),/danh mục chưa tải đủ.*Chưa xác nhận trang cuối/);
  assert.match(vm.runInContext('marketState.message',c),/chọn trong các ngành đã đọc để quét riêng/);
  assert.equal(vm.runInContext('marketState.categories[0].selected',c),true);
  assert.ok(!events.some(e=>e.path.endsWith('/campaigns')));
});

test('catalogue notes are bounded before being shown in scan errors',async()=>{
  const {c,click}=context();
  c.window.MarketLensChrome.ping=async()=>({capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
  c.MarketLensChrome.categories=async()=>({catalog_complete:false,note:'N'.repeat(1000),categories:[{name:'A',url:'https://shopee.vn/A-cat.1'}]});
  await click('marketScanEverything');
  const message=vm.runInContext('marketState.message',c);
  assert.ok(message.includes('N'.repeat(300)));
  assert.ok(!message.includes('N'.repeat(301)));
});

test('stop while discovering categories prevents campaign creation and appears next to the main button',async()=>{
  const {c,events,click}=context();
  c.window.MarketLensChrome.ping=async()=>({capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
  let heroDuringCapture;
  c.MarketLensChrome.categories=async()=>{
    heroDuringCapture=vm.runInContext('marketScanAllPanel()',c);
    await click('marketStopAll');
    return {categories:[{name:'A',url:'https://shopee.vn/A-cat.1'}]};
  };
  await click('marketScanEverything');
  assert.match(heroDuringCapture,/id="marketStopAll"/);
  assert.ok(!events.some(e=>e.path.endsWith('/campaigns')));
  assert.match(vm.runInContext('marketState.message',c),/Đã dừng trước khi tạo hàng đợi/);
  assert.equal(vm.runInContext('marketState.autoPaused',c),true);
});

test('invalid or oversized catalogues never reach the campaign API',async()=>{
  const invalid=[{categories:{}},{categories:[null]},{categories:[{name:'A',url:'https://evil.com/A-cat.1'}]},
    {categories:[{name:'A',url:'https://shopee.vn/search'}]},
    {categories:Array.from({length:101},(_,index)=>({name:`A${index}`,url:`https://shopee.vn/A-cat.${index+1}`}))}];
  for(const result of invalid){
    const {c,events,click}=context();
    c.window.MarketLensChrome.ping=async()=>({capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
    c.MarketLensChrome.categories=async()=>result;
    await click('marketScanEverything');
    assert.ok(!events.some(e=>e.path.endsWith('/campaigns')));
    assert.match(vm.runInContext('marketState.message',c),/Chưa bắt đầu quét/);
  }
});

test('refresh preserves the advanced form values while showing new connection status',async()=>{
  let fields={marketCategoryName:{value:'Đồ gia dụng'},marketCategoryUrl:{value:'https://shopee.vn/Gia-dung-cat.1'},marketPages:{value:'7'},marketMode:{value:'sample'}};
  const {c}=context({S:{view:'categoryMarket',crawlSubmitting:false,competitor:{}},$:id=>fields[id]||null,
    render:()=>{fields=Object.fromEntries(Object.keys(fields).map(id=>[id,{value:''}]));}});
  c.window.MarketLensChrome.ping=async()=>({version:'1.3.5',capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});
  await vm.runInContext('refreshMarket()',c);
  assert.equal(fields.marketCategoryName.value,'Đồ gia dụng');
  assert.equal(fields.marketPages.value,'7');assert.equal(fields.marketMode.value,'sample');
  assert.match(vm.runInContext('marketChromeStatus()',c),/v1\.3\.5 · sẵn sàng/);
});

test('category views load complete datasets and expose stable table and row pagination keys',async()=>{
  const {c,events}=context();
  const original=c.api;
  c.api=async(path,options)=>{
    if(path.split('?')[0].endsWith('/runs')){events.push({path});return queueRows();}
    if(path.includes('/products?')){events.push({path});return {product_count:701,products:[{sku:'12.34',name:'Sản phẩm',url:'https://shopee.vn/product/12/34',category:'Gia dụng',day:'2026-10-15',price:100,sold_total:10}]};}
    if(path.endsWith('/schedules')){events.push({path});return [{id:'schedule1',name:'Gia dụng',interval_hours:24,next_run_at:'2026-10-16T09:00:00+07:00',enabled:1,full_scan:1}];}
    return original(path,options);
  };
  vm.runInContext("marketState.filter='10001'",c);
  await vm.runInContext('refreshMarket()',c);
  assert.ok(events.some(event=>event.path==='/api/category-market/runs?all_rows=true'));
  assert.ok(events.some(event=>event.path==='/api/category-market/products?all_rows=true&category_id=10001'));
  const categories=vm.runInContext('renderCategoryMarket()',c),schedules=vm.runInContext('renderMarketSchedules()',c);
  assert.match(categories,/data-pagination-key="category-runs"/);
  assert.match(categories,/data-pagination-key="category-dataset"/);
  assert.match(categories,/id="marketFilter" data-pagination-filter/);
  assert.match(categories,/data-pagination-id="paused"/);
  assert.match(categories,/data-pagination-id="12\.34"/);
  assert.match(categories,/Đã tải 1\/701 sản phẩm trong bộ lọc/);
  assert.doesNotMatch(categories,/Hiển thị tối đa 500 sản phẩm/);
  assert.match(schedules,/data-pagination-key="category-schedules"/);
  assert.match(schedules,/data-pagination-id="schedule1"/);
});


test('four, legacy eight and all selections queue every category but never open more than four captures',async()=>{
  for(const selection of [4,8,'all'])for(const advertised of [4,100]){
    const {c,click}=context({},selection);
    c.rows=Array.from({length:8},(_,i)=>({...parallelRows()[0],id:String(i),category_id:String(i),name:`Ngành ${i}`}));
    vm.runInContext('marketState.runs=rows',c);
    c.window.MarketLensChrome.ping=async()=>({version:advertised===100?'1.3.6':'1.3.7',capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:advertised}});
    const waits=[];let active=0,maxActive=0;
    c.MarketLensChrome.category=()=>{const wait=deferred();waits.push(wait);active++;maxActive=Math.max(maxActive,active);return wait.promise.finally(()=>active--);};
    const work=click('marketRunAll');await tick();
    const expected=4;
    assert.equal(active,expected);assert.equal(waits.length,expected);
    assert.equal(vm.runInContext('marketState.runner.assigned.size',c),8);
    assert.equal(vm.runInContext('marketState.runner.queue.length',c),8-expected);
    assert.match(vm.runInContext('marketConcurrencyControl()',c),/Toàn bộ ngành · tối đa 4 tab/);
    assert.doesNotMatch(vm.runInContext('marketConcurrencyControl()',c),/option value="8"/);
    assert.match(vm.runInContext('marketChromeStatus()',c),/toàn bộ hàng đợi, tối đa 4 tab cùng lúc/);
    for(const wait of waits.slice())wait.resolve({urls:['https://shopee.vn/product/12/34'],has_next:false});
    await tick();
    for(const wait of waits)wait.resolve({urls:['https://shopee.vn/product/12/34'],has_next:false});
    await work;assert.equal(maxActive,expected);
  }
});

test('the old saved eight-worker preference migrates to four and only two, four and all remain selectable',async()=>{
  const storage=new Map([['marketlens.categoryConcurrency','8']]);
  const {c,change}=context();c.window.localStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
  assert.equal(vm.runInContext('marketSavedConcurrency()',c),4);
  await change({id:'marketConcurrency',value:'8'});assert.equal(vm.runInContext('marketState.concurrency',c),4);assert.equal(storage.get('marketlens.categoryConcurrency'),'4');
  const html=vm.runInContext('marketConcurrencyControl()',c);assert.match(html,/option value="2"/);assert.match(html,/option value="4" selected/);assert.match(html,/option value="all"/);assert.doesNotMatch(html,/option value="8"/);
});

test('clicking another row and all during the initial extension check joins one pending pool',async()=>{
  const {c,click}=context({},4);c.rows=parallelRows();vm.runInContext('marketState.runs=rows',c);
  const ping=deferred();c.window.MarketLensChrome.ping=()=>ping.promise;
  const waits=[];c.MarketLensChrome.category=()=>{const wait=deferred();waits.push(wait);return wait.promise;};
  const work=vm.runInContext("runMarket(['a'],false,true)",c);await tick();
  assert.equal(vm.runInContext('marketRunAvailable(rows[1])',c),true);
  await click('',false,{marketRun:'b'});await click('marketRunAll');
  assert.equal(vm.runInContext('marketState.runner.assigned.size',c),4);
  ping.resolve({capabilities:{categories:true,verificationPause:true,categoryCardsV2:true,categoryParallel:100}});await tick();
  assert.equal(waits.length,4);
  for(const wait of waits)wait.resolve({urls:['https://shopee.vn/product/12/34'],has_next:false});
  await work;
});

test('all prefers the current run for each category and a late resume conflict does not halt other categories',async()=>{
  const {c,events,click}=context();
  c.rows=[{...parallelRows()[0],id:'old',status:'partial',failed:1,created_at:'2026-10-14'},
    {...parallelRows()[0],id:'new',created_at:'2026-10-15'},parallelRows()[1]];vm.runInContext('marketState.runs=rows',c);
  await click('marketRunAll');
  assert.ok(!events.some(e=>e.path.includes('/old/')));
  assert.ok(events.some(e=>e.path.includes('/new/resume')));assert.ok(events.some(e=>e.path.includes('/b/resume')));
  const second=context();second.c.rows=parallelRows();vm.runInContext('marketState.runs=rows',second.c);
  const original=second.c.api;second.c.api=async(path,options)=>{if(path.endsWith('/a/resume'))throw Object.assign(new Error('Lượt khác cùng ngành đang chờ'),{status:409});return original(path,options);};
  await vm.runInContext("runMarket(['a','b'],false,true)",second.c);
  assert.ok(second.events.some(e=>e.path.endsWith('/b/detail')));
  assert.ok(!second.events.some(e=>e.path.endsWith('/pause')));
});

test('a two-slot extension cannot silently downgrade the requested four-slot mode',async()=>{
 const {c,events}=context({},4);c.window.MarketLensChrome.ping=async()=>({version:'1.3.5',capabilities:{categories:true,categoryCatalog:true,verificationPause:true,categoryCardsV2:true,categoryParallel:2}});await vm.runInContext("runMarket(['a'],false,true)",c);
 assert.ok(!events.some(e=>e.body||e.path.includes('/next?')));assert.match(vm.runInContext('marketState.message',c),/4 ngành đồng thời.*1\.3\.7/);
 assert.equal(vm.runInContext('marketSavedConcurrency()',c),4);
});

test('a detail timeout retries only the same product once and saves its successful second read',async()=>{
  for(const legacy of [false,true]){
    const {c,events}=context();const reads=[];
    c.MarketLensChrome.detail=async url=>{
      reads.push(url);if(reads.length===1)throw legacy?new Error('Shopee chưa tải trang chi tiết sản phẩm trong thời gian cho phép.')
        :Object.assign(new Error('Trang chi tiết chưa hiển thị.'),{code:'product_detail_timeout',retryable:true});
      return {detail:{url,name:'Chi tiết đã tải lần hai',price_text:'79.000₫'}};
    };
    await vm.runInContext("runMarket(['a'])",c);
    assert.deepEqual(reads,['https://shopee.vn/product/12/34','https://shopee.vn/product/12/34']);
    assert.equal(events.filter(event=>event.path.endsWith('/detail')).length,1);
    assert.equal(events.find(event=>event.path.endsWith('/detail')).body.name,'Chi tiết đã tải lần hai');
    assert.ok(!events.some(event=>event.path.endsWith('/skip')||event.path.endsWith('/pause')));
    assert.match(vm.runInContext('marketState.message',c),/Hoàn tất 1\/1 ngành; 0 ngành còn lỗi/);
  }
});

test('two detail timeouts checkpoint only that failed SKU, continue other products and categories, and can resume failed SKUs only',async()=>{
  const {c,events,click}=context();c.rows=parallelRows().slice(0,3);vm.runInContext('marketState.runs=rows',c);
  const bad='https://shopee.vn/product/12/34',good='https://shopee.vn/product/12/35',other='https://shopee.vn/product/13/34',third='https://shopee.vn/product/14/34';
  const queues={a:[{url:bad,status:'pending'},{url:good,status:'pending'}],b:[{url:other,status:'pending'}],c:[{url:third,status:'pending'}]},reads=[],snapshots=[{sku:'12.33',name:'Checkpoint cũ',url:'https://shopee.vn/product/12/33',price:19000}];
  const held=deferred();let failBad=true;const original=c.api;
  c.api=async(path,options)=>{
    const body=options?.body?JSON.parse(options.body):null,id=path.split('/').at(-2),row=c.rows.find(item=>item.id===id);
    if(path.split('?')[0].endsWith('/runs')){events.push({path});return c.rows;}
    if(path.includes('/products?')){events.push({path});return {products:snapshots};}
    if(path.endsWith('/resume')){events.push({path,body});for(const item of queues[id])if(item.status==='failed')item.status='pending';row.status='pending';row.failed=0;return {status:'pending'};}
    if(path.includes('/next?')){
      events.push({path});const next=queues[id].find(item=>item.status==='pending');
      if(next)return {type:'detail',url:next.url};row.status=queues[id].some(item=>item.status==='failed')?'partial':'done';return {type:'done'};
    }
    if(path.endsWith('/skip')||path.endsWith('/detail')){
      events.push({path,body});const item=queues[id].find(item=>item.url===body.url);assert.ok(item);assert.equal(item.status,'pending');
      item.status=path.endsWith('/skip')?'failed':'done';row.failed=queues[id].filter(item=>item.status==='failed').length;row.completed=queues[id].filter(item=>item.status==='done').length;
      if(item.status==='done')snapshots.push({url:body.url,name:body.name,price:99000});return {skipped:true,saved:true};
    }
    return original(path,options);
  };
  c.MarketLensChrome.detail=async url=>{
    reads.push(url);if(url===bad&&failBad)throw Object.assign(new Error('Trang chi tiết chưa tải.'),{code:'product_detail_timeout',retryable:true});
    if(url===other)return held.promise;return {detail:{url,name:'Đã lưu '+url,price_text:'99.000₫'}};
  };
  const work=vm.runInContext("runMarket(['a','b','c'],false,true)",c);await tick();
  assert.equal(reads.filter(url=>url===bad).length,2);assert.ok(reads.includes(good));assert.ok(reads.includes(third));
  assert.equal(c.rows[0].status,'partial');assert.equal(c.rows[0].failed,1);
  assert.match(vm.runInContext('marketRunActions(rows[0])',c),/data-market-run="a" >Thử lại SP lỗi/);
  const skips=events.filter(event=>event.path.endsWith('/skip'));assert.equal(skips.length,1);assert.equal(skips[0].body.url,bad);assert.match(skips[0].body.error,/Đã thử 2 lần/);
  assert.ok(!events.some(event=>event.path.endsWith('/pause')));assert.ok(snapshots.some(item=>item.name==='Checkpoint cũ'));
  held.resolve({detail:{url:other,name:'Sản phẩm ngành B',price_text:'88.000₫'}});await work;
  assert.match(vm.runInContext('marketState.message',c),/Hoàn tất 2\/3 ngành; 1 ngành còn lỗi/);
  assert.equal(vm.runInContext('marketState.autoPaused',c),true);
  failBad=false;const previous=reads.length;await click('',false,{marketRun:'a'});
  assert.deepEqual(reads.slice(previous),[bad]);assert.equal(c.rows[0].status,'done');assert.equal(c.rows[0].failed,0);
  assert.equal(reads.filter(url=>url===good).length,1);assert.equal(events.filter(event=>event.path.endsWith('/skip')).length,1);
  assert.equal(events.filter(event=>event.path==='/api/category-market/runs/a/resume').length,2);
});

test('user stop during the bounded timeout delay prevents a second detail read and leaves the SKU pending',async()=>{
  const delays=[],{c,events,click}=context({setTimeout(fn,ms){if(ms===1500)delays.push(fn);}});const original=c.api;let reads=0;
  c.api=async(path,options)=>path.includes('/next?')?{type:'detail',url:'https://shopee.vn/product/12/34'}:original(path,options);
  c.MarketLensChrome.detail=async()=>{reads++;throw Object.assign(new Error('Trang chi tiết chưa tải.'),{code:'product_detail_timeout',retryable:true});};
  const work=vm.runInContext("runMarket(['a'])",c);await tick();assert.equal(delays.length,1);assert.equal(reads,1);
  await click('marketStop');delays.shift()();await work;
  assert.equal(reads,1);assert.ok(!events.some(event=>event.path.endsWith('/skip')||event.path.endsWith('/detail')));
  assert.deepEqual(events.filter(event=>event.path.endsWith('/pause')).map(event=>event.path),['/api/category-market/runs/a/pause']);
  assert.match(vm.runInContext('marketState.message',c),/Đã dừng và lưu tiến độ/);
});

test('verification, tab locks, network failures and detail callback errors never enter product-timeout retries',async()=>{
  for(const kind of ['verification','login','tab-busy','network','callback','skip-callback']){
    const {c,events}=context();let reads=0;const original=c.api;
    c.api=async(path,options)=>{
      if(path.includes('/next?'))return {type:'detail',url:'https://shopee.vn/product/12/34'};
      if(kind==='callback'&&path.endsWith('/detail')||kind==='skip-callback'&&path.endsWith('/skip'))throw Object.assign(new Error('Không lưu được checkpoint.'),{code:'product_detail_timeout'});
      return original(path,options);
    };
    c.MarketLensChrome.detail=async url=>{
      reads++;
      if(kind==='verification')throw Object.assign(new Error('Shopee yêu cầu CAPTCHA.'),{code:'product_detail_timeout',blocked:true,verificationRequired:true,inspectionRequired:true});
      if(kind==='login')throw Object.assign(new Error('Shopee yêu cầu đăng nhập.'),{code:'product_detail_timeout',blocked:true});
      if(kind==='tab-busy')throw Object.assign(new Error('Chrome đang khóa tab.'),{code:'chrome_tabs_busy',retryable:true});
      if(kind==='network')throw new Error('Không kết nối được Chrome.');
      if(kind==='skip-callback')throw Object.assign(new Error('Trang chi tiết chưa tải.'),{code:'product_detail_timeout'});
      return {detail:{url,name:'Checkpoint chưa xác nhận'}};
    };
    await vm.runInContext("runMarket(['a'])",c);
    assert.equal(reads,kind==='skip-callback'?2:1,kind);
    assert.deepEqual(events.filter(event=>event.path.endsWith('/pause')).map(event=>event.path),['/api/category-market/runs/a/pause'],kind);
    assert.equal(vm.runInContext('marketState.autoPaused',c),true,kind);
    if(kind==='verification')assert.match(vm.runInContext('marketState.message',c),/Tab Shopee yêu cầu xác minh được giữ mở/);
    if(kind!=='skip-callback')assert.ok(!events.some(event=>event.path.endsWith('/skip')),kind);
  }
});
