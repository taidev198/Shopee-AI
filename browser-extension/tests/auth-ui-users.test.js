import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../static/system-users.js',import.meta.url),'utf8');
const password='fixture-only-'+String('p').repeat(16);
const initial=()=>[{id:'system-id',username:'owner',role:'system',active:true,shop_ids:[]},{id:'user-a',username:'seller-a',role:'user',active:true,shop_ids:['shop-a']}];
function setup({system=true,handler,accounts=initial()}={}) {
  const requests=[],listeners={},scheduled=[],renders=[];
  let rows=structuredClone(accounts);const shops=[{id:'shop-a',name:'Shop A',url:'https://shopee.vn/shop_a'},{id:'shop-b',name:'Shop B',url:'https://shopee.vn/shop_b'}];
  const c=vm.createContext({window:{MarketLensAuth:{isSystem:system}},S:{view:'users'},Map,Set,Promise,JSON,Object,String,Array,
    document:{addEventListener(type,callback){listeners[type]=callback;}},setTimeout:callback=>scheduled.push(callback),render:()=>renders.push('users'),
    api:async(path,options={})=>{
      const body=options.body?JSON.parse(options.body):null;requests.push({path,options,body});if(handler)return handler(path,options,body);
      if(path==='/api/shops')return shops;if(!options.method)return {accounts:structuredClone(rows)};
      if(options.method==='POST'){rows.push({id:'new-user',username:body.username,role:'user',active:true,shop_ids:body.shop_ids});return rows.at(-1);}
      const id=path.split('/')[4],row=rows.find(row=>row.id===id);if(options.method==='PUT')row.shop_ids=body.shop_ids;if(options.method==='PATCH')row.active=body.active;return row;
    },
  });vm.runInContext(source,c);const module=c.window.MarketLensSystemUsers;
  return {c,module,requests,scheduled,renders,shops,rows:()=>rows,html:()=>module.render(),click:dataset=>listeners.click({target:{closest:()=>({dataset,disabled:false})}}),change:target=>listeners.change({target}),input:target=>listeners.input({target}),submit:(dataset,values={})=>listeners.submit({preventDefault(){},target:{dataset,querySelector:selector=>({value:values[selector.match(/name="([^"]+)"/)[1]]||''})}})};
}

test('account management loads actual accounts and shops only for System, with a stable paginated table',async()=>{
  const app=setup();app.html();assert.equal(app.scheduled.length,1);await app.scheduled.shift()();const html=app.html();
  assert.deepEqual(app.requests.map(request=>request.path),['/api/auth/accounts','/api/shops']);assert.match(html,/owner/);assert.match(html,/seller-a/);assert.match(html,/Shop A/);assert.match(html,/data-pagination-key="system-accounts"/);
  assert.match(html,/Toàn bộ shop · quản trị dữ liệu/);assert.doesNotMatch(html,/data-system-toggle-user="system-id"/);
  const user=setup({system:false});assert.match(user.html(),/dành cho System/);await user.module.refresh();assert.equal(user.requests.length,0);assert.equal(user.scheduled.length,0);
});

test('creating a User sends only the entered credentials and explicitly selected shop IDs',async()=>{
  const app=setup();await app.module.refresh();app.change({dataset:{systemShopChoice:'create'},value:'shop-b',checked:true});
  await app.submit({systemCreateUser:''},{username:'new-seller',password});
  const created=app.requests.find(request=>request.options.method==='POST');assert.equal(created.path,'/api/auth/accounts');assert.deepEqual(created.body,{username:'new-seller',password,shop_ids:['shop-b']});assert.equal(created.body.role,undefined);
  const html=app.html();assert.match(html,/new-seller/);assert.match(html,/Đã tạo tài khoản User/);assert.doesNotMatch(html,new RegExp(password));assert.match(html,/name="password"[^>]*autocomplete="new-password"/);assert.doesNotMatch(html,/name="password"[^>]*value=/);
});

test('shop assignment can be emptied deliberately and changes only the selected User',async()=>{
  const app=setup();await app.module.refresh();app.change({dataset:{systemShopChoice:'user-a'},value:'shop-a',checked:false});await app.submit({systemAssignShops:'user-a'});
  const saved=app.requests.find(request=>request.options.method==='PUT');assert.equal(saved.path,'/api/auth/accounts/user-a/shops');assert.deepEqual(saved.body,{shop_ids:[]});assert.match(app.html(),/Chưa được gán shop/);
  const count=app.requests.length;await app.submit({systemAssignShops:'system-id'});assert.equal(app.requests.length,count);
});

test('activate and deactivate actions persist the intended boolean through the authenticated API wrapper',async()=>{
  const app=setup();await app.module.refresh();await app.click({systemToggleUser:'user-a'});assert.deepEqual(app.requests.find(request=>request.options.method==='PATCH').body,{active:false});assert.match(app.html(),/Đã tạm khóa/);
  await app.click({systemToggleUser:'user-a'});assert.deepEqual(app.requests.filter(request=>request.options.method==='PATCH').at(-1).body,{active:true});assert.match(app.html(),/Đã mở lại User/);
});

test('validation, creation failures and failed initial reads show errors without fabricated success or infinite retry',async()=>{
  const invalid=setup();await invalid.module.refresh();await invalid.submit({systemCreateUser:''},{username:'x',password:'short'});assert.ok(!invalid.requests.some(request=>request.options.method));assert.match(invalid.html(),/3–80 ký tự/);
  const failed=setup({handler:async()=>{throw new Error('Không tải được danh sách tài khoản.');}});failed.html();await failed.scheduled.shift()();
  const count=failed.requests.length;failed.html();failed.html();assert.equal(failed.scheduled.length,0);assert.equal(failed.requests.length,count);assert.match(failed.html(),/Không tải được danh sách tài khoản/);assert.match(failed.html(),/Thử lại/);
});

test('untrusted account and shop text is escaped and role loss prevents reads or writes from retained UI',async()=>{
  const app=setup({accounts:[...initial(),{id:'bad',username:'<script>bad()</script>',role:'user',active:true,shop_ids:['<img src=x>']}]});await app.module.refresh();
  assert.match(app.html(),/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.match(app.html(),/&lt;img src=x&gt;/);assert.doesNotMatch(app.html(),/<script>|<img src=x>/);
  app.c.window.MarketLensAuth.isSystem=false;const count=app.requests.length;await app.click({systemToggleUser:'user-a'});await app.submit({systemAssignShops:'user-a'});await app.module.refresh();assert.equal(app.requests.length,count);assert.doesNotMatch(app.html(),/seller-a|bad\(\)/);
});
