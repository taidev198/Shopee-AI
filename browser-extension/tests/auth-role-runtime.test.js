import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const files=['role-navigation','app','category-market','market-analysis','seller-workspace'];
const sources=await Promise.all(files.map(name=>readFile(new URL(`../../static/${name}.js`,import.meta.url),'utf8')));
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};

function fixture() {
  const product={sku:'12.34',name:'Rây inox đã lưu',category:'Gia dụng',price:99000,role:'own',source_shop:'shop_a',sold_total:100,review_count:8,rating:4.9,inputs:{},metrics:{},health:{score:null},segment:'unknown',segment_label:'Chưa đủ dữ liệu phân nhóm',optimizer:{ready:false,cost_complete:false,missing:['unit_cost'],scenarios:[]}};
  const shop={id:'shop-a',name:'Shop được cấp quyền',url:'https://shopee.vn/shop_a',is_demo:false};
  const seller={is_demo:false,shop,summary:{product_count:1,coverage:{}},health:{score:null,issues:[]},products:[product],strategies:[],actions:[],reports:[],ai_config:{enabled:true,model:'local-model'}};
  return {shop,own_products:[product],market_products:[],opportunities:[],categories:[],kpis:{own_products:1},seller_analysis:seller,competitor_analysis:{summary:{product_count:0,own_product_count:1},shops:[],categories:[],recommendations:[],product_comparisons:[],discovery_queries:[{query:'rây inox'}]}};
}

async function app({role='user',area='user',view='competitors',shops,apiHandler}={}) {
  const requests=[],chromeCalls=[],intervals=[],timers=[],redirects=[],nodes=new Map(),listeners=new Map(),dashboard=fixture();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',dataset:{},hidden:false,className:'',classList:{add(){},remove(){},toggle(){}},addEventListener(type,callback){const key=id+':'+type;listeners.set(key,[...(listeners.get(key)||[]),callback]);},close(){},focus(){}});
    return nodes.get(id);
  };
  const document={body:{dataset:{appRole:area}},hidden:false,getElementById:node,querySelector:selector=>selector==='.shop-strip'?node('shop-strip'):null,querySelectorAll:()=>[],addEventListener(type,callback){listeners.set(type,[...(listeners.get(type)||[]),callback]);}};
  const auth={ready:Promise.resolve(),session:{authenticated:true,account:{role,username:'Người dùng <b>thật</b>'}},isSystem:role==='system',canCollect:role==='system'&&area==='system',requireSession:()=>true,request:async(path,options={})=>{
    requests.push({path,options});
    if(apiHandler)return apiHandler(path,options,dashboard);
    if(path==='/api/shops')return shops??[dashboard.shop];
    if(path.startsWith('/api/dashboard?'))return dashboard;
    if(path.startsWith('/api/seller/analysis?'))return dashboard.seller_analysis;
    if(path==='/api/seller/ai/config')return {enabled:true,model:'auto-local-model',selected_model:'auto-local-model',selection_mode:'auto',available:true,model_installed:true};
    if(path.startsWith('/api/category-market/analysis?'))return {summary:{product_count:1},top_products:[],top_shops:[],categories:[],model:{status:'waiting'},coverage:{},basis:{}};
    throw new Error('Unexpected API: '+path);
  }};
  const location={origin:'http://127.0.0.1:8000',pathname:'/'+area,search:'?view='+view,assign:url=>redirects.push(url)};
  const chrome=new Proxy({},{get:(_,name)=>async()=>{chromeCalls.push(name);throw new Error('Collection must not start');}});
  const context=vm.createContext({window:{MarketLensAuth:auth,MarketLensChrome:chrome,document,location,scrollTo(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;}},document,location,history:{replaceState(){}},navigator:{},URL,URLSearchParams,Intl,Date,Map,Set,Number,String,Array,Object,Promise,AbortController,CSS:{escape:value=>value},MarketLensChrome:chrome,
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;}});
  for(const source of sources)vm.runInContext(source,context);
  await flush();
  const run=code=>vm.runInContext(code,context);
  const click=async(id,dataset={})=>{for(const callback of listeners.get('click')||[])await callback({target:{closest:()=>({id,dataset,disabled:false})},preventDefault(){}});};
  return {context,auth,requests,chromeCalls,intervals,timers,redirects,nodes,listeners,run,click,dashboard,html:()=>node('viewContainer').innerHTML};
}

test('User startup renders assigned shop data and all scheduled pollers avoid System requests',async()=>{
  const ui=await app();
  assert.equal(ui.run('S.view'),'competitors');
  assert.match(ui.html(),/PHÂN TÍCH TỪ DATABASE/);
  assert.doesNotMatch(ui.html(),/id="discoverCompetitors"|id="compareTopProductsHero"|form[^>]+data-crawl/);
  assert.deepEqual(ui.requests.map(item=>item.path.split('?')[0]),['/api/shops','/api/dashboard']);
  const reads=ui.requests.length;
  for(const interval of ui.intervals)await interval.fn();
  for(const timer of ui.timers.filter(timer=>timer.ms===5000))await timer.fn();
  await ui.run('refreshChromeConnection()');
  await ui.run('refreshCrawlerConfig()');
  await ui.run('refreshCrawlerLists()');
  assert.equal(ui.requests.length,reads);
  assert.equal(ui.chromeCalls.length,0);
  assert.equal(ui.nodes.get('authAccountName').textContent,'Người dùng <b>thật</b>');
});

test('System using the User area also leaves collection and schedule polling inactive',async()=>{
  const ui=await app({role:'system'}),reads=ui.requests.length;
  assert.match(ui.html(),/Mở thu thập System/);
  for(const interval of ui.intervals)await interval.fn();
  await ui.run('pollMarketSchedules()');
  await ui.run("runMarket(['run-a'])");
  await ui.run('scanAllMarket()');
  await ui.run('discoverCompetitors()');
  await ui.run('compareTopProducts()');
  assert.equal(ui.requests.length,reads);
  assert.equal(ui.chromeCalls.length,0);
});

test('User cannot navigate into or forge clicks that initiate System collection',async()=>{
  const ui=await app(),reads=ui.requests.length;
  ui.run("setView('categoryMarket');setView('imports');setView('users')");
  assert.equal(ui.run('S.view'),'competitors');assert.deepEqual(ui.redirects,[]);
  await ui.click('marketDiscover');await ui.click('marketScanEverything');await ui.click('marketSaveSchedule');
  await ui.run("runMarket(['run-a'])");await ui.run('discoverCompetitors()');await ui.run('compareTopProducts()');
  assert.equal(ui.requests.length,reads);assert.equal(ui.chromeCalls.length,0);
});

test('User market analysis remains readable while training controls and writes are disabled',async()=>{
  const ui=await app();ui.run("setView('marketAnalysis')");
  await ui.run('refreshMarketAnalysis()');
  assert.match(ui.html(),/System quản lý kho thu thập/);
  assert.match(ui.html(),/<button hidden[^>]*id="marketAnalysisTrain"/);
  assert.doesNotMatch(ui.html(),/data-action="categoryMarket"/);
  assert.match(ui.html(),/href="\/api\/category-market\/export\?/);
  const reads=ui.requests.length;await ui.click('marketAnalysisTrain');
  assert.equal(ui.requests.length,reads);
  assert.ok(ui.requests.every(item=>!item.options.method||item.options.method==='GET'));
});

test('User My Shops renders an honest empty assignment state without an extra dashboard request',async()=>{
  const ui=await app({view:'myShops',shops:[]});
  assert.match(ui.html(),/Chưa được cấp quyền shop/);
  assert.doesNotMatch(ui.html(),/id="sellerAddShop"|Shop được cấp quyền<\/h3>/);
  assert.deepEqual(ui.requests.map(item=>item.path),['/api/shops']);
  assert.equal(ui.chromeCalls.length,0);
});

test('both roles get automatic read-only AI status in Optimizer without exposing or submitting configuration',async()=>{
  for(const role of ['user','system']){
    const ui=await app({role});ui.run("setView('optimizer')");await flush();
    assert.match(ui.html(),/data-seller-ai-generate="12.34"/);assert.match(ui.html(),/AI tự kết nối/);assert.match(ui.html(),/auto-local-model/);
    assert.doesNotMatch(ui.html(),/form[^>]+data-seller-ai-config|sellerAiModel|seller-ai-enabled|Lưu cấu hình AI/);
    const reads=ui.requests.length;
    for(const callback of ui.listeners.get('submit')||[])await callback({target:{dataset:{sellerAiConfig:''}},preventDefault(){}});
    assert.equal(ui.requests.length,reads);assert.equal(ui.requests.filter(request=>request.path==='/api/seller/ai/config').length,1);
    assert.ok(!ui.requests.some(request=>request.path==='/api/seller/ai/generate'||request.options.method==='PUT'));
  }
});

test('switching to a shop whose dashboard fails clears the previous shop before fetching and never renders its products',async()=>{
  let rejectDashboard;
  const pendingDashboard=new Promise((resolve,reject)=>{rejectDashboard=reject;});
  const ui=await app({view:'products',apiHandler:async(path,options,data)=>{
    if(path==='/api/shops')return [data.shop,{id:'shop-b',name:'Shop thứ hai',url:'https://shopee.vn/shop_b'}];
    if(path.startsWith('/api/dashboard?'))return new URL(path,'http://localhost').searchParams.get('shop_id')==='shop-b'?pendingDashboard:data;
    throw new Error('Unexpected API: '+path);
  }});
  assert.match(ui.html(),/Rây inox đã lưu/);
  const change=ui.listeners.get('shopSelect:change')[0];
  const request=change({target:{value:'shop-b'}});
  assert.equal(ui.run('S.shopId'),'shop-b');
  assert.equal(ui.run('S.data'),null,'old shop data must be cleared while the new dashboard loads');
  assert.doesNotMatch(ui.html(),/Rây inox đã lưu/);
  rejectDashboard(Object.assign(new Error('Shop chưa tải được dữ liệu.'),{status:503}));
  await request;
  assert.equal(ui.run('S.data'),null);
  assert.doesNotMatch(ui.html(),/Rây inox đã lưu/);
  assert.equal(ui.run('S.shopId'),'shop-b');
});

test('refresh after session or shop access is lost removes same-shop data for 401, 403 and 404',async()=>{
  for(const status of [401,403,404]){
    let failure=false;
    const ui=await app({view:'products',apiHandler:async(path,options,data)=>{
      if(path==='/api/shops')return [data.shop];
      if(path.startsWith('/api/dashboard?')){
        if(failure)throw Object.assign(new Error('Không còn quyền đọc shop.'),{status});
        return data;
      }
      throw new Error('Unexpected API: '+path);
    }});
    assert.match(ui.html(),/Rây inox đã lưu/);
    failure=true;
    assert.equal(await ui.run('loadReport()'),false);
    assert.equal(ui.run('S.data'),null,'no cached dashboard after access failure '+status);
    assert.doesNotMatch(ui.html(),/Rây inox đã lưu/);
  }
});
