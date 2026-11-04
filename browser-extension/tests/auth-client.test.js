import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const authSource=await readFile(new URL('../../static/auth-client.js',import.meta.url),'utf8');
const routesSource=await readFile(new URL('../../static/role-navigation.js',import.meta.url),'utf8');
function client({role='system',area='system',authenticated=true,reply,meFailures=0}={}) {
  const calls=[],redirects=[],session={authenticated,account:{role,username:'test'},csrf_token:'test-csrf'};
  const window={document:{body:{dataset:{appRole:area}}},location:{origin:'http://127.0.0.1:8000',pathname:'/'+area,search:'?view=users',assign:url=>redirects.push(url)}};
  const context=vm.createContext({window,URL,URLSearchParams,Headers,AbortController,setTimeout,clearTimeout,fetch:async(path,options)=>{
    calls.push({path,options});if(path==='/api/auth/me'&&meFailures-->0)throw new Error('Máy chủ chưa kết nối');const response=path==='/api/auth/me'?{ok:true,json:async()=>session}:reply||{ok:true,json:async()=>({ok:true})};return response;
  }});
  vm.runInContext(authSource,context);vm.runInContext(routesSource,context);
  return {auth:window.MarketLensAuth,routes:window.MarketLensRoutes,calls,redirects};
}

test('signed mutation carries session CSRF while multipart content type stays browser owned',async()=>{
  const app=client();await app.auth.ready;
  const body={multipart:'placeholder'};
  await app.auth.request('/api/import',{method:'POST',body});
  const request=app.calls[1];assert.equal(request.options.headers.get('X-CSRF-Token'),'test-csrf');
  assert.equal(request.options.headers.has('Content-Type'),false);assert.equal(request.options.body,body);
  assert.equal(request.options.credentials,'same-origin');
});

test('cross origin requests never receive a session CSRF token',async()=>{
  const app=client();await app.auth.ready;
  await assert.rejects(()=>app.auth.request('https://example.com/api/data',{method:'POST'}),/Chỉ gửi yêu cầu/);
  assert.equal(app.calls.length,1);
});

test('only System in its collection area enables browser collection',async()=>{
  const system=client();await system.auth.ready;assert.equal(system.auth.canCollect,true);
  const user=client({role:'user',area:'user'});await user.auth.ready;assert.equal(user.auth.canCollect,false);assert.equal(user.auth.canCrawlShop,true);assert.equal(user.auth.isSystem,false);
  const analytics=client({role:'system',area:'user'});await analytics.auth.ready;assert.equal(analytics.auth.canCollect,false);assert.equal(analytics.auth.isSystem,true);
});

test('expired protected requests redirect to login with a local return path',async()=>{
  const app=client({reply:{ok:false,status:401,json:async()=>({detail:'Phiên đã hết hạn'})}});await app.auth.ready;
  await assert.rejects(()=>app.auth.request('/api/dashboard'),/Phiên đã hết hạn/);
  assert.equal(app.redirects[0],'/login?next=%2Fsystem%3Fview%3Dusers');
});

test('logout revokes the signed session through a CSRF protected request',async()=>{
  const app=client();await app.auth.logout();
  assert.equal(app.calls[1].path,'/api/auth/logout');assert.equal(app.calls[1].options.method,'POST');
  assert.equal(app.calls[1].options.headers.get('X-CSRF-Token'),'test-csrf');assert.equal(app.redirects[0],'/login');
  assert.equal(app.auth.session.authenticated,false);
});

test('canonical role navigation encodes shop values and denies User collection routes',()=>{
  const {routes}=client();
  assert.equal(routes.url('imports','shop&a=b'),'/system?view=imports&shop_id=shop%26a%3Db');
  assert.equal(routes.url('shopAnalysis','shop 1'),'/user?view=shopAnalysis&shop_id=shop+1');
  assert.equal(routes.canOpen('user','crawler'),true);assert.equal(routes.areaForView('crawler','user'),'user');assert.equal(routes.areaForView('crawler','system'),'system');assert.equal(routes.url('crawler','s1','user'),'/user?view=crawler&shop_id=s1');assert.equal(routes.canOpen('user','imports'),false);assert.equal(routes.canOpen('user','users'),false);
  assert.equal(routes.canOpen('user','shopAnalysis'),true);assert.equal(routes.canOpen('system','users'),true);
  assert.equal(routes.defaultView('user'),'myShops');assert.equal(routes.defaultView('system'),'crawler');
});


test('an explicit session refresh recovers after an initial connection failure',async()=>{
 const app=client({meFailures:1});await assert.rejects(()=>app.auth.ready,/chưa kết nối/);
 await app.auth.refreshSession();await app.auth.request('/api/shops');
 assert.equal(app.auth.session.authenticated,true);assert.equal(app.calls.filter(call=>call.path==='/api/auth/me').length,2);
 assert.equal(app.calls.at(-1).path,'/api/shops');
});
