'use strict';
(function (root) {
  let session = {authenticated:false};
  const unsafe = method => !['GET','HEAD','OPTIONS'].includes(method);
  function authRedirect() {
    const next = root.location.pathname + root.location.search;
    root.location.assign((session.setup_required?'/setup':'/login')+'?next='+encodeURIComponent(next));
  }
  async function send(path, options={}) {
    const url = new URL(path, root.location.origin);
    if (url.origin!==root.location.origin) throw new Error('Chỉ gửi yêu cầu đến MarketLens trên máy này.');
    const method=String(options.method||'GET').toUpperCase(), headers=new Headers(options.headers||{});
    if (unsafe(method)&&session.csrf_token) headers.set('X-CSRF-Token',session.csrf_token);
    const response=await fetch(url.pathname+url.search,{...options,method,headers,credentials:'same-origin'});
    let result;
    try {result=await response.json();} catch {result={detail:'Không đọc được phản hồi từ máy chủ.'};}
    if (!response.ok) {
      if (response.status===401&&!url.pathname.startsWith('/api/auth/')) authRedirect();
      const detail=typeof result.detail==='string'?result.detail:'Yêu cầu không thành công.';
      throw Object.assign(new Error(detail),{status:response.status,detail:result.detail});
    }
    return result;
  }
  let ready;
  function refreshSession() {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    ready=send('/api/auth/me',{signal:controller.signal}).then(value=>{session=value;return value;})
      .catch(error=>{throw new Error(error.name==='AbortError'?'Máy chủ chưa phản hồi sau 20 giây.':error.message);})
      .finally(()=>clearTimeout(timer));
    return ready;
  }
  refreshSession();
  root.MarketLensAuth={
    get ready(){return ready;},
    refreshSession,
    get session(){return session;},
    get isSystem(){return session.authenticated&&session.account?.role==='system';},
    get canManageSystem(){return this.isSystem;},
    get canCollect(){return this.isSystem&&root.document.body.dataset.appRole==='system';},
    get canCrawlShop(){return session.authenticated&&['system','user'].includes(session.account?.role)&&session.account.role===root.document.body.dataset.appRole;},
    async request(path,options={}){await ready;return send(path,options);},
    async logout(){await ready;await send('/api/auth/logout',{method:'POST'});session={authenticated:false};root.location.assign('/login');},
    requireSession(){if(!session.authenticated){authRedirect();return false;}return true;},
  };
})(window);
