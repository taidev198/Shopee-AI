'use strict';
(() => {
  const state={accounts:null,shops:[],loading:false,scheduled:false,request:0,error:'',message:'',busy:new Set(),username:'',createShops:new Set(),assignments:new Map(),audit:{events:[],total:0,account:'',q:'',loading:false,error:''},resetting:''};
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
      state.accounts=list(accounts.accounts);state.shops=list(shops);loadAudit(true);return true;
    }catch(error){if(request===state.request)state.error=error.message||'Chưa tải được danh sách tài khoản.';return false;}
    finally{if(request===state.request){state.loading=false;redraw();}}
  }
  async function loadAudit(reset=true) {
    if(!allowed()||state.audit.loading)return;
    const a=state.audit;a.loading=true;a.error='';if(reset)a.events=[];redraw();
    try {
      const query=new URLSearchParams({limit:'50',offset:String(reset?0:a.events.length)});
      if(a.account)query.set('account_id',a.account);if(a.q)query.set('q',a.q);
      const data=await api('/api/auth/audit?'+query);
      a.events=reset?list(data.events):a.events.concat(list(data.events));a.total=Number(data.total)||0;
    }catch(error){a.error=error.message||'Chưa tải được nhật ký hoạt động.';}
    finally{a.loading=false;redraw();}
  }
  const when=value=>value?createdAt(value):'Chưa có';
  function renderAudit() {
    const a=state.audit;
    const options=['<option value="">Tất cả tài khoản</option>'].concat(list(state.accounts).map(x=>`<option value="${escape(x.id)}" ${a.account===String(x.id)?'selected':''}>${escape(x.username)} (${x.role==='system'?'System':'User'})</option>`)).join('');
    const rows=a.events.map(e=>`<tr><td>${escape(createdAt(e.ts))}</td><td><strong>${escape(e.username||'—')}</strong><small>${e.role==='system'?'System':e.role==='user'?'User':''}</small></td><td>${escape(e.action)}</td><td>${escape(e.shop_name||e.shop_id||'—')}</td><td><span class="su-account-status ${Number(e.status)&&Number(e.status)<400?'is-active':'is-inactive'}">${e.status||'—'}</span></td><td><small>${escape(e.ip||'')}</small></td></tr>`).join('');
    return `<section class="panel su-audit"><div class="su-list-heading"><div><h3>Nhật ký hoạt động</h3><p>Các thao tác thay đổi dữ liệu và đăng nhập của mọi tài khoản · lưu 90 ngày · ${a.total} sự kiện</p></div></div><form class="su-audit-filter" data-audit-filter><select data-audit-account>${options}</select><input name="q" value="${escape(a.q)}" placeholder="Tìm theo hành động / tài khoản" maxlength="80"><button class="btn btn-white btn-sm" type="submit">Lọc</button></form>${a.error?`<div class="su-error" role="alert">${escape(a.error)}</div>`:''}<div class="table-wrap"><table class="data-table"><thead><tr><th>Thời gian</th><th>Tài khoản</th><th>Hành động</th><th>Shop</th><th>Kết quả</th><th>IP</th></tr></thead><tbody>${rows||`<tr><td colspan="6">${a.loading?'Đang tải…':'Chưa có hoạt động nào.'}</td></tr>`}</tbody></table></div>${a.events.length<a.total?`<button class="btn btn-soft btn-sm" data-audit-more ${a.loading?'disabled':''}>${a.loading?'Đang tải…':'Xem thêm'}</button>`:''}</section>`;
  }
  function renderUsers() {
    if(!allowed())return '<section class="panel su-workspace"><h2>Quản lý tài khoản dành cho System</h2><p>Đăng nhập bằng tài khoản System để quản lý User và quyền truy cập shop.</p></section>';
    if(!state.accounts&&!state.loading&&!state.scheduled&&!state.error){state.scheduled=true;setTimeout(()=>{state.scheduled=false;return refresh();},0);}
    const header=`<div class="su-heading"><div><span class="su-eyebrow">SYSTEM · ACCESS MANAGEMENT</span><h2>Tài khoản và quyền dữ liệu shop</h2><p>Mỗi User chỉ phân tích những shop được gán. System quản lý thu thập và nguồn dữ liệu.</p></div><button class="btn btn-white btn-sm" data-system-users-refresh ${state.loading?'disabled':''}>${state.loading?'Đang tải…':state.error?'Thử lại':'Làm mới danh sách'}</button></div>${state.error?`<div class="su-error" role="alert">${escape(state.error)}</div>`:''}${state.message?`<div class="su-status" role="status">${escape(state.message)}</div>`:''}`;
    if(!state.accounts)return `<div class="su-workspace">${header}<div class="su-empty">${state.loading||state.scheduled?'Đang đọc tài khoản từ hệ thống…':'Chưa tải được tài khoản. Bấm Thử lại để kiểm tra kết nối.'}</div></div>`;
    return `<div class="su-workspace">${header}<section class="panel su-create"><div><h3>Tạo tài khoản User</h3><p>Tự đặt mật khẩu riêng cho người dùng. Không có mật khẩu mặc định; quyền phân tích có hiệu lực theo danh sách shop được gán.</p></div><form data-system-create-user><div class="su-fields"><label>Tên đăng nhập<input name="username" autocomplete="off" minlength="3" maxlength="80" required value="${escape(state.username)}" data-system-create-username placeholder="3–80 ký tự"></label><label>Mật khẩu khởi tạo<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required placeholder="Ít nhất 12 ký tự"></label></div><label class="su-field-label">Shop được cấp quyền</label>${choices(state.createShops,'create')}<p class="su-muted">Có thể để trống danh sách shop. User chưa được gán shop sẽ chưa có dữ liệu để phân tích.</p><button class="btn btn-primary" type="submit" ${state.busy.has('create')?'disabled':''}>${state.busy.has('create')?'Đang tạo tài khoản…':'Tạo User'}</button></form></section><section class="panel"><div class="su-list-heading"><div><h3>Tài khoản trên hệ thống</h3><p>${state.accounts.length} tài khoản · ${state.shops.length} shop có thể cấp quyền</p></div></div><div class="table-wrap"><table class="data-table su-accounts" data-pagination-key="system-accounts"><thead><tr><th>Tài khoản</th><th>Vai trò / trạng thái</th><th>Shop được truy cập</th><th>Hoạt động</th><th>Thao tác</th></tr></thead><tbody>${state.accounts.map(account=>{
      const id=String(account.id),system=account.role==='system',selected=assignment(account),names=list(account.shop_ids).map(shopId=>state.shops.find(shop=>String(shop.id)===String(shopId))?.name||String(shopId));
      return `<tr data-pagination-id="${escape(id)}"><td><strong>${escape(account.username)}</strong><small>${escape(createdAt(account.created_at))}</small></td><td><span class="su-role">${system?'System':'User'}</span><span class="su-account-status ${account.active?'is-active':'is-inactive'}">${account.active?'Đang hoạt động':'Đã tạm khóa'}</span></td><td>${system?'<p class="su-muted">Toàn bộ shop · quản trị dữ liệu</p>':`<p>${names.length?names.map(escape).join(' · '):'<span class="su-unassigned">Chưa được gán shop</span>'}</p><details class="su-assignment"><summary>Điều chỉnh quyền shop</summary><form data-system-assign-shops="${escape(id)}">${choices(selected.ids,id)}<button class="btn btn-soft btn-sm" type="submit" ${state.busy.has('shops:'+id)?'disabled':''}>${state.busy.has('shops:'+id)?'Đang lưu…':'Lưu quyền shop'}</button></form></details>`}</td><td><small>Đăng nhập gần nhất: ${escape(when(account.last_login))}<br>Hoạt động gần nhất: ${escape(when(account.last_active))}<br>${Number(account.actions_30d)||0} thao tác / 30 ngày</small></td><td>${system?'<small>Vai trò quản trị hệ thống</small>':`<button class="btn btn-white btn-sm" data-system-toggle-user="${escape(id)}" ${state.busy.has('active:'+id)?'disabled':''}>${state.busy.has('active:'+id)?'Đang lưu…':account.active?'Tạm khóa User':'Mở lại User'}</button><details class="su-assignment"><summary>Đặt lại mật khẩu</summary><form data-system-reset-password="${escape(id)}"><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required placeholder="Mật khẩu mới (≥ 12 ký tự)"><button class="btn btn-soft btn-sm" type="submit" ${state.busy.has('pw:'+id)?'disabled':''}>Lưu mật khẩu</button></form></details>`}</td></tr>`;
    }).join('')||'<tr><td colspan="5">Chưa có tài khoản.</td></tr>'}</tbody></table></div></section>${renderAudit()}</div>`;
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
    if(event.target.dataset.auditAccount!==undefined){state.audit.account=event.target.value;return loadAudit(true);}
    const target=event.target,prefix=target.dataset.systemShopChoice;if(prefix===undefined||!allowed())return;
    const account=state.accounts?.find(item=>String(item.id)===prefix),draft=prefix==='create'?state.createShops:account?assignment(account).ids:null;if(!draft)return;
    if(target.checked)draft.add(String(target.value));else draft.delete(String(target.value));if(account)assignment(account).dirty=true;
  });
  document.addEventListener('submit',async event=>{
    const form=event.target,d=form.dataset||{};
    if(d.auditFilter!==undefined){event.preventDefault();state.audit.q=String(form.querySelector('[name="q"]').value||'').trim();return loadAudit(true);}
    if(d.systemResetPassword!==undefined){
      event.preventDefault();if(!allowed())return;const rid=String(d.systemResetPassword),pw=String(form.querySelector('[name="password"]').value||'');
      if([...pw].length<12||[...pw].length>256){state.error='Mật khẩu cần 12–256 ký tự.';redraw();return;}
      return mutate('pw:'+rid,()=>post('/api/auth/accounts/'+encodeURIComponent(rid)+'/password','PUT',{password:pw}),'Đã đặt lại mật khẩu. Các phiên đăng nhập cũ của User đã bị đăng xuất.');
    }
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
    if(button.dataset.auditMore!==undefined)return loadAudit(false);
    if(button.dataset.systemUsersRefresh!==undefined)return refresh();
    if(button.dataset.systemToggleUser){
      const id=String(button.dataset.systemToggleUser),account=state.accounts?.find(item=>String(item.id)===id);if(!account||account.role!=='user')return;
      return mutate('active:'+id,()=>post('/api/auth/accounts/'+encodeURIComponent(id),'PATCH',{active:!account.active}),account.active?'Đã tạm khóa User.':'Đã mở lại User.');
    }
  });
  window.MarketLensSystemUsers=Object.freeze({render:renderUsers,refresh});
})();
