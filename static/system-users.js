'use strict';
(() => {
  const state={accounts:null,shops:[],loading:false,scheduled:false,request:0,error:'',message:'',busy:new Set(),username:'',createShops:new Set(),assignments:new Map()};
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const list=value=>Array.isArray(value)?value:[];
  function createdAt(value){const date=new Date(typeof value==='number'?value*1000:value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(date);}
  const allowed=()=>window.MarketLensAuth?.isSystem===true;
  const redraw=()=>{if(typeof S!=='undefined'&&S.view==='users'&&typeof render==='function')render();};
  const post=(path,method,body)=>api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  function assignment(account) {
    const id=String(account.id),signature=JSON.stringify(list(account.shop_ids).map(String).sort());
    if(!state.assignments.has(id)||(!state.assignments.get(id).dirty&&state.assignments.get(id).signature!==signature))state.assignments.set(id,{ids:new Set(list(account.shop_ids).map(String)),signature,dirty:false});
    return state.assignments.get(id);
  }
  function choices(selected,prefix) {
    return state.shops.length?`<div class="su-shop-choices">${state.shops.map(shop=>`<label><input type="checkbox" name="shop_ids" value="${escape(shop.id)}" data-system-shop-choice="${escape(prefix)}" ${selected.has(String(shop.id))?'checked':''}><span>${escape(shop.name||shop.id)}<small>${escape(shop.url||'')}</small></span></label>`).join('')}</div>`:'<p class="su-muted">Chưa có shop. Tạo shop ở System trước, sau đó gán quyền cho User.</p>';
  }
  async function refresh() {
    if(!allowed())return false;
    const request=++state.request;state.loading=true;state.error='';redraw();
    try {
      const [accounts,shops]=await Promise.all([api('/api/auth/accounts'),api('/api/shops')]);
      if(request!==state.request)return false;
      state.accounts=list(accounts.accounts);state.shops=list(shops);return true;
    }catch(error){if(request===state.request)state.error=error.message||'Chưa tải được danh sách tài khoản.';return false;}
    finally{if(request===state.request){state.loading=false;redraw();}}
  }
  function renderUsers() {
    if(!allowed())return '<section class="panel su-workspace"><h2>Quản lý tài khoản dành cho System</h2><p>Đăng nhập bằng tài khoản System để quản lý User và quyền truy cập shop.</p></section>';
    if(!state.accounts&&!state.loading&&!state.scheduled&&!state.error){state.scheduled=true;setTimeout(()=>{state.scheduled=false;return refresh();},0);}
    const header=`<div class="su-heading"><div><span class="su-eyebrow">SYSTEM · ACCESS MANAGEMENT</span><h2>Tài khoản và quyền dữ liệu shop</h2><p>Mỗi User chỉ phân tích những shop được gán. System quản lý thu thập và nguồn dữ liệu.</p></div><button class="btn btn-white btn-sm" data-system-users-refresh ${state.loading?'disabled':''}>${state.loading?'Đang tải…':state.error?'Thử lại':'Làm mới danh sách'}</button></div>${state.error?`<div class="su-error" role="alert">${escape(state.error)}</div>`:''}${state.message?`<div class="su-status" role="status">${escape(state.message)}</div>`:''}`;
    if(!state.accounts)return `<div class="su-workspace">${header}<div class="su-empty">${state.loading||state.scheduled?'Đang đọc tài khoản từ hệ thống…':'Chưa tải được tài khoản. Bấm Thử lại để kiểm tra kết nối.'}</div></div>`;
    return `<div class="su-workspace">${header}<section class="panel su-create"><div><h3>Tạo tài khoản User</h3><p>Tự đặt mật khẩu riêng cho người dùng. Không có mật khẩu mặc định; quyền phân tích có hiệu lực theo danh sách shop được gán.</p></div><form data-system-create-user><div class="su-fields"><label>Tên đăng nhập<input name="username" autocomplete="off" minlength="3" maxlength="80" required value="${escape(state.username)}" data-system-create-username placeholder="3–80 ký tự"></label><label>Mật khẩu khởi tạo<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required placeholder="Ít nhất 12 ký tự"></label></div><label class="su-field-label">Shop được cấp quyền</label>${choices(state.createShops,'create')}<p class="su-muted">Có thể để trống danh sách shop. User chưa được gán shop sẽ chưa có dữ liệu để phân tích.</p><button class="btn btn-primary" type="submit" ${state.busy.has('create')?'disabled':''}>${state.busy.has('create')?'Đang tạo tài khoản…':'Tạo User'}</button></form></section><section class="panel"><div class="su-list-heading"><div><h3>Tài khoản trên hệ thống</h3><p>${state.accounts.length} tài khoản · ${state.shops.length} shop có thể cấp quyền</p></div></div><div class="table-wrap"><table class="data-table su-accounts" data-pagination-key="system-accounts"><thead><tr><th>Tài khoản</th><th>Vai trò / trạng thái</th><th>Shop được truy cập</th><th>Thao tác</th></tr></thead><tbody>${state.accounts.map(account=>{
      const id=String(account.id),system=account.role==='system',selected=assignment(account),names=list(account.shop_ids).map(shopId=>state.shops.find(shop=>String(shop.id)===String(shopId))?.name||String(shopId));
      return `<tr data-pagination-id="${escape(id)}"><td><strong>${escape(account.username)}</strong><small>${escape(createdAt(account.created_at))}</small></td><td><span class="su-role">${system?'System':'User'}</span><span class="su-account-status ${account.active?'is-active':'is-inactive'}">${account.active?'Đang hoạt động':'Đã tạm khóa'}</span></td><td>${system?'<p class="su-muted">Toàn bộ shop · quản trị dữ liệu</p>':`<p>${names.length?names.map(escape).join(' · '):'<span class="su-unassigned">Chưa được gán shop</span>'}</p><details class="su-assignment"><summary>Điều chỉnh quyền shop</summary><form data-system-assign-shops="${escape(id)}">${choices(selected.ids,id)}<button class="btn btn-soft btn-sm" type="submit" ${state.busy.has('shops:'+id)?'disabled':''}>${state.busy.has('shops:'+id)?'Đang lưu…':'Lưu quyền shop'}</button></form></details>`}</td><td>${system?'<small>Vai trò quản trị hệ thống</small>':`<button class="btn btn-white btn-sm" data-system-toggle-user="${escape(id)}" ${state.busy.has('active:'+id)?'disabled':''}>${state.busy.has('active:'+id)?'Đang lưu…':account.active?'Tạm khóa User':'Mở lại User'}</button>`}</td></tr>`;
    }).join('')||'<tr><td colspan="4">Chưa có tài khoản.</td></tr>'}</tbody></table></div></section></div>`;
  }
  async function mutate(key,operation,message) {
    if(!allowed()||state.busy.has(key))return;
    state.busy.add(key);state.error='';state.message='';redraw();
    try{await operation();state.message=message;await refresh();}
    catch(error){state.error=error.message||'Chưa lưu được thay đổi.';}
    finally{state.busy.delete(key);redraw();}
  }
  document.addEventListener('input',event=>{if(event.target.dataset.systemCreateUsername!==undefined)state.username=event.target.value;});
  document.addEventListener('change',event=>{
    const target=event.target,prefix=target.dataset.systemShopChoice;if(prefix===undefined||!allowed())return;
    const account=state.accounts?.find(item=>String(item.id)===prefix),draft=prefix==='create'?state.createShops:account?assignment(account).ids:null;if(!draft)return;
    if(target.checked)draft.add(String(target.value));else draft.delete(String(target.value));if(account)assignment(account).dirty=true;
  });
  document.addEventListener('submit',async event=>{
    const form=event.target,d=form.dataset||{};
    if(d.systemCreateUser===undefined&&d.systemAssignShops===undefined)return;event.preventDefault();if(!allowed())return;
    if(d.systemCreateUser!==undefined){
      const username=String(form.querySelector('[name="username"]').value||'').trim(),password=String(form.querySelector('[name="password"]').value||'');
      if([...username].length<3||[...username].length>80||/[\s\u0000-\u001f\u007f]/.test(username)||[...password].length<12||[...password].length>256){state.error='Tên đăng nhập cần 3–80 ký tự, không có khoảng trắng; mật khẩu cần 12–256 ký tự.';redraw();return;}
      const shop_ids=[...state.createShops];
      return mutate('create',async()=>{await post('/api/auth/accounts','POST',{username,password,shop_ids});state.username='';state.createShops.clear();},'Đã tạo tài khoản User.');
    }
    const id=String(d.systemAssignShops),account=state.accounts?.find(item=>String(item.id)===id);if(!account||account.role!=='user')return;
    return mutate('shops:'+id,async()=>{await post('/api/auth/accounts/'+encodeURIComponent(id)+'/shops','PUT',{shop_ids:[...assignment(account).ids]});state.assignments.delete(id);},'Đã lưu quyền shop cho User.');
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||button.disabled||!allowed())return;
    if(button.dataset.systemUsersRefresh!==undefined)return refresh();
    if(button.dataset.systemToggleUser){
      const id=String(button.dataset.systemToggleUser),account=state.accounts?.find(item=>String(item.id)===id);if(!account||account.role!=='user')return;
      return mutate('active:'+id,()=>post('/api/auth/accounts/'+encodeURIComponent(id),'PATCH',{active:!account.active}),account.active?'Đã tạm khóa User.':'Đã mở lại User.');
    }
  });
  window.MarketLensSystemUsers=Object.freeze({render:renderUsers,refresh});
})();
