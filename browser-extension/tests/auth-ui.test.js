import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../static/auth.js',import.meta.url),'utf8');
const userHtml=await readFile(new URL('../../static/index.html',import.meta.url),'utf8'),systemHtml=await readFile(new URL('../../static/system.html',import.meta.url),'utf8'),authHtml=await readFile(new URL('../../static/auth.html',import.meta.url),'utf8');
const testPassword='fixture-only-'+String('z').repeat(14);
function setup({path='/login',search='',handler}={}) {
  const listeners={},nodes={},requests=[],redirects=[],timers=new Map();let nextTimer=0;
  for(const id of ['authStatus','authTitle','authModeLabel','authDescription','authHelp','authConfirmWrap','authConfirmPassword','authUsername','authPassword','authSubmit','authRetry','authShowPassword','authSwitch'])nodes[id]={append(){},id,value:'',textContent:'',hidden:false,disabled:false,type:id==='authPassword'?'password':'text',attrs:{},setAttribute(name,value){this.attrs[name]=value;}};
  const context=vm.createContext({window:{location:{pathname:path,search,origin:'http://127.0.0.1:8000',assign:url=>redirects.push({method:'assign',url}),replace:url=>redirects.push({method:'replace',url})}},URL,URLSearchParams,AbortController,Promise,Object,String,
    document:{createElement:()=>({}),getElementById:id=>nodes[id],addEventListener(type,callback){listeners[type]=callback;}},
    setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options)=>{requests.push({url,options,body:options.body?JSON.parse(options.body):null});const result=handler?await handler(url,options):{authenticated:false,setup_required:false};return {ok:result.ok!==false,json:async()=>result.data||result};},
  });vm.runInContext(source,context);
  return {nodes,requests,redirects,timers,page:context.window.MarketLensAuthPage,init:()=>listeners.DOMContentLoaded(),submit:()=>listeners.submit({target:{id:'authForm'},preventDefault(){}}),click:id=>listeners.click({target:{closest:()=>nodes[id]}})};
}

test('User and System shells have separate canonical role menus while preserving shared application IDs',()=>{
  assert.match(userHtml,/<body data-app-role="user">/);assert.match(systemHtml,/<body data-app-role="system">/);
  assert.deepEqual([...userHtml.matchAll(/data-view="([^"]+)"/g)].map(match=>match[1]),['crawler','overview','myShops','shopAnalysis','products','optimizer','competitors','marketAnalysis','strategy','actions','reports']);
  assert.deepEqual([...systemHtml.matchAll(/data-view="([^"]+)"/g)].map(match=>match[1]),['crawler','categoryMarket','marketSchedules','imports','users']);
  for(const html of [userHtml,systemHtml]){
    for(const id of ['navigation','shopSelect','shopUrl','dataBadge','shopModal','shopForm','importShortcut','refreshButton','newShopButton','closeShopModal','cancelShop','viewContainer','pageTitle','mainHeading','demoWarning','toast','logoutButton','authAccountName','authRoleBadge'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id);
    assert.ok(html.indexOf('/static/auth-client.js')<html.indexOf('/static/app.js'));assert.ok(html.indexOf('/static/role-navigation.js')<html.indexOf('/static/app.js'));
    assert.doesNotMatch(html,/20261016-content-15/);
  }
  assert.doesNotMatch(userHtml,/id="newShopButton" hidden/);assert.match(userHtml,/id="importShortcut" hidden/);assert.doesNotMatch(userHtml,/href="\/system"/);assert.doesNotMatch(systemHtml,/href="\/user"/);
  assert.doesNotMatch(authHtml,/<input[^>]*name="password"[^>]*value=/);assert.doesNotMatch(authHtml,/<input[^>]*name="username"[^>]*value=/);
});

test('a login uses the entered credentials only and redirects to the same-role internal destination',async()=>{
  const app=setup({search:'?next='+encodeURIComponent('/user?view=products&tag=đồ+bếp&tag=inox'),handler:async url=>url.endsWith('/me')?{authenticated:false,setup_required:false}:{authenticated:true,account:{role:'user'}}});
  await app.init();assert.equal(app.nodes.authSubmit.disabled,false);app.nodes.authUsername.value='seller-one';app.nodes.authPassword.value=testPassword;await app.submit();
  assert.equal(app.requests[1].url,'/api/auth/login');assert.deepEqual(app.requests[1].body,{username:'seller-one',password:testPassword});assert.equal(app.requests[1].options.credentials,'same-origin');
  assert.equal(app.redirects[0].method,'assign');assert.match(app.redirects[0].url,/^\/user\?view=products&tag=/);assert.match(app.redirects[0].url,/&tag=inox$/);
  assert.doesNotMatch(app.nodes.authStatus.textContent,new RegExp(testPassword));assert.equal(app.timers.size,0);
});

test('unsafe and external next values are rejected while only System can choose both canonical areas',()=>{
  const app=setup();
  for(const next of ['https://evil.test/x','//evil.test/x','/\\evil.test/x','javascript:bad()','/user/../system','/user\n?x=1','/login?next=//evil.test','/workspace?view=crawler'])assert.equal(app.page.safeNext(next,'user'),'/user',next);
  assert.equal(app.page.safeNext('/system?view=users','user'),'/user');assert.equal(app.page.safeNext('/user?view=products','system'),'/user?view=products');
  assert.equal(app.page.safeNext('/system?view=users&shop_id=a&shop_id=b','system'),'/system?view=users&shop_id=a&shop_id=b');
});

test('switching between bootstrap and login preserves an encoded canonical next and drops external destinations',async()=>{
  const next='/user?view=products&shop_id=shop-a&tag=đồ&tag=inox',search='?next='+encodeURIComponent(next);
  const first=setup({search,handler:async()=>({authenticated:false,setup_required:true})});await first.init();
  const destination=new URL(first.redirects[0].url,'http://127.0.0.1:8000');assert.equal(destination.pathname,'/setup');assert.equal(new URL(destination.searchParams.get('next'),'http://127.0.0.1:8000').searchParams.getAll('tag').join(','),'đồ,inox');
  const existing=setup({path:'/setup',search,handler:async()=>({authenticated:false,setup_required:false})});await existing.init();assert.match(existing.redirects[0].url,/^\/login\?next=/);
  const unsafe=setup({search:'?next='+encodeURIComponent('//evil.test'),handler:async()=>({authenticated:false,setup_required:true})});await unsafe.init();assert.equal(unsafe.redirects[0].url,'/setup');
});

test('first setup requires matching user-chosen passwords and receives the System role from the server',async()=>{
  const app=setup({path:'/setup',handler:async url=>url.endsWith('/me')?{authenticated:false,setup_required:true}:{authenticated:true,account:{role:'system'}}});await app.init();
  assert.equal(app.nodes.authConfirmWrap.hidden,false);assert.equal(app.nodes.authConfirmPassword.required,true);assert.match(app.nodes.authTitle.textContent,/System đầu tiên/);
  app.nodes.authUsername.value='system-owner';app.nodes.authPassword.value=testPassword;app.nodes.authConfirmPassword.value='different-password';await app.submit();
  assert.equal(app.requests.length,1);assert.match(app.nodes.authStatus.textContent,/chưa khớp/);
  app.nodes.authConfirmPassword.value=testPassword;await app.submit();assert.equal(app.requests[1].url,'/api/auth/setup');assert.deepEqual(app.requests[1].body,{username:'system-owner',password:testPassword});assert.equal(app.redirects[0].url,'/system');
});

test('auth validation and login errors remain visible, clear passwords and never redirect or auto retry',async()=>{
  const app=setup({handler:async url=>url.endsWith('/me')?{authenticated:false,setup_required:false}:{ok:false,data:{detail:'Tên đăng nhập hoặc mật khẩu không đúng.'}}});await app.init();
  app.nodes.authUsername.value='a';app.nodes.authPassword.value='short';await app.submit();assert.equal(app.requests.length,1);
  app.nodes.authUsername.value='seller-one';app.nodes.authPassword.value=testPassword;await app.submit();
  assert.match(app.nodes.authStatus.textContent,/không đúng/);assert.equal(app.nodes.authStatus.attrs.role,'alert');assert.equal(app.nodes.authPassword.value,'');assert.equal(app.nodes.authSubmit.disabled,false);assert.equal(app.redirects.length,0);assert.equal(app.requests.length,2);
});

test('bootstrap and existing sessions choose the appropriate setup or signed-in route without another credential POST',async()=>{
  const first=setup({handler:async()=>({authenticated:false,setup_required:true})});await first.init();assert.equal(first.redirects[0].url,'/setup');
  const already=setup({path:'/setup',handler:async()=>({authenticated:false,setup_required:false})});await already.init();assert.equal(already.redirects[0].url,'/login');
  const signed=setup({handler:async()=>({authenticated:true,account:{role:'system'}})});await signed.init();assert.equal(signed.redirects[0].url,'/system');
  for(const app of [first,already,signed])assert.equal(app.requests.length,1);
});

test('duplicate submit is ignored while the login is pending and show-password only changes the input type',async()=>{
  let finish;const app=setup({handler:async url=>url.endsWith('/me')?{authenticated:false,setup_required:false}:new Promise(resolve=>{finish=resolve;})});await app.init();
  app.nodes.authUsername.value='seller-one';app.nodes.authPassword.value=testPassword;
  await app.click('authShowPassword');assert.equal(app.nodes.authPassword.type,'text');assert.equal(app.nodes.authPassword.value,testPassword);assert.equal(app.nodes.authShowPassword.attrs['aria-pressed'],'true');
  const first=app.submit();await app.submit();assert.equal(app.requests.length,2);assert.equal(app.nodes.authSubmit.disabled,true);
  finish({authenticated:true,account:{role:'user'}});await first;assert.equal(app.redirects.length,1);
});

test('a stalled initial auth check times out and requires an explicit retry',async()=>{
  let stall=true;const app=setup({handler:async()=>stall?new Promise(()=>{}):{authenticated:false,setup_required:false}});const pending=app.init();
  const timer=[...app.timers.values()][0];assert.equal(timer.delay,20000);timer.callback();await pending;
  assert.match(app.nodes.authStatus.textContent,/20 giây/);assert.equal(app.nodes.authRetry.hidden,false);assert.equal(app.nodes.authSubmit.disabled,true);assert.equal(app.requests[0].options.signal.aborted,true);
  stall=false;await app.click('authRetry');assert.equal(app.requests.length,2);assert.equal(app.nodes.authSubmit.disabled,false);
});

test('register mode confirms the password, posts to /api/auth/register and lands in the user workspace',async()=>{
  const app=setup({path:'/register',handler:async url=>url.endsWith('/me')?{authenticated:false,setup_required:false}:{authenticated:true,account:{role:'user'}}});await app.init();
  assert.equal(app.nodes.authConfirmWrap.hidden,false);assert.match(app.nodes.authTitle.textContent,/Đăng ký/);assert.match(app.nodes.authSubmit.textContent,/Đăng ký/);
  app.nodes.authUsername.value='new-seller';app.nodes.authPassword.value=testPassword;app.nodes.authConfirmPassword.value='different-password';await app.submit();
  assert.equal(app.requests.length,1);assert.match(app.nodes.authStatus.textContent,/chưa khớp/);
  app.nodes.authConfirmPassword.value=testPassword;await app.submit();
  assert.equal(app.requests[1].url,'/api/auth/register');assert.deepEqual(app.requests[1].body,{username:'new-seller',password:testPassword});assert.equal(app.redirects[0].url,'/user');
});

test('guest home links to login and register',async()=>{
  const html=await readFile(new URL('../../static/guest.html',import.meta.url),'utf8');
  assert.match(html,/href="\/login"/);assert.match(html,/href="\/register"/);
});
