'use strict';
(() => {
  const state={mode:window.location.pathname==='/setup'?'setup':window.location.pathname==='/register'?'register':'login',ready:false,busy:false};
  const $=id=>document.getElementById(id);
  const next=new URLSearchParams(window.location.search).get('next');
  function internalNext(value) {
    if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(value))return '';
    try {const url=new URL(value,window.location.origin);return url.origin===window.location.origin&&['/user','/system'].includes(url.pathname)?url.pathname+url.search+url.hash:'';}catch{return '';}
  }
  function safeNext(value,role) {const home=role==='system'?'/system':'/user',next=internalNext(value);return next&&(role==='system'||new URL(next,window.location.origin).pathname==='/user')?next:home;}
  const switchPage=path=>{const destination=internalNext(next);return path+(destination?'?next='+encodeURIComponent(destination):'');};
  function status(message,error=false) { $('authStatus').textContent=message;$('authStatus').className='auth-status'+(error?' auth-status-error':'');$('authStatus').setAttribute('role',error?'alert':'status'); }
  function paint() {
    const setup=state.mode==='setup',register=state.mode==='register',confirm=setup||register;
    $('authTitle').textContent=setup?'Tạo tài khoản System đầu tiên':register?'Đăng ký tài khoản':'Đăng nhập';
    $('authModeLabel').textContent=setup?'KHỞI TẠO HỆ THỐNG':register?'TẠO TÀI KHOẢN USER':'MARKETLENS WORKSPACE';
    $('authDescription').textContent=setup?'Tài khoản này quản lý dữ liệu và cấp quyền shop cho User trên máy này.':register?'Tạo tài khoản User để thêm shop bằng link và thu thập sản phẩm của chính bạn.':'Dùng tài khoản của bạn để vào không gian làm việc.';
    $('authHelp').textContent=setup?'Hãy tự chọn tên đăng nhập và mật khẩu riêng. Hệ thống không cung cấp tài khoản hoặc mật khẩu mặc định.':register?'Tên đăng nhập 3–80 ký tự, không có khoảng trắng. Hãy dùng mật khẩu riêng, không dùng lại mật khẩu ở nơi khác.':'Quên mật khẩu? Liên hệ người quản trị System.';
    const sw=$('authSwitch');sw.textContent='';
    if(!setup){const link=document.createElement('a'),query=next?'?next='+encodeURIComponent(next):'';
      link.href=(register?'/login':'/register')+query;link.textContent=register?'Đăng nhập':'Đăng ký ngay';
      sw.append(register?'Đã có tài khoản? ':'Chưa có tài khoản? ',link);}
    $('authConfirmWrap').hidden=!confirm;$('authConfirmPassword').required=confirm;
    $('authPassword').autocomplete=confirm?'new-password':'current-password';
    for(const id of ['authUsername','authPassword','authConfirmPassword','authSubmit'])$(id).disabled=!state.ready||state.busy;
    $('authSubmit').textContent=state.busy?'Đang xác nhận…':setup?'Tạo tài khoản System →':register?'Đăng ký →':'Đăng nhập →';
  }
  async function request(path,body) {
    const controller=new AbortController();let timer;
    const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>{reject(new Error('Máy chủ chưa phản hồi sau 20 giây. Hãy thử lại.'));controller.abort();},20000);});
    try {
      const response=await Promise.race([fetch(path,{credentials:'same-origin',signal:controller.signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),deadline]);
      let data;try{data=await response.json();}catch{throw new Error('Chưa đọc được phản hồi từ hệ thống.');}
      if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Kiểm tra tên đăng nhập và mật khẩu rồi thử lại.');
      return data;
    }finally{clearTimeout(timer);}
  }
  async function initialize() {
    if(state.busy)return;state.busy=true;state.ready=false;$('authRetry').hidden=true;paint();status('Đang kiểm tra hệ thống…');
    try {
      const session=await request('/api/auth/me');
      if(session.authenticated&&session.account){window.location.replace(safeNext(next,session.account.role));return;}
      if(session.setup_required&&state.mode!=='setup'){window.location.replace(switchPage('/setup'));return;}
      if(!session.setup_required&&state.mode==='setup'){window.location.replace(switchPage('/login'));return;}
      state.ready=true;status(state.mode==='setup'?'Hệ thống chưa có tài khoản. Khởi tạo System để bắt đầu.':state.mode==='register'?'Điền thông tin để tạo tài khoản.':'Đăng nhập để mở không gian làm việc.');
    }catch(error){status(error.message,true);$('authRetry').hidden=false;}
    finally{state.busy=false;paint();}
  }
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='authForm')return;event.preventDefault();if(!state.ready||state.busy)return;
    const username=$('authUsername').value.trim(),password=$('authPassword').value;
    if([...username].length<3||[...username].length>80||/[\s\u0000-\u001f\u007f]/.test(username)||[...password].length<12||[...password].length>256){status('Tên đăng nhập cần 3–80 ký tự, không có khoảng trắng; mật khẩu cần 12–256 ký tự.',true);return;}
    if(state.mode!=='login'&&password!==$('authConfirmPassword').value){status('Mật khẩu nhập lại chưa khớp.',true);return;}
    state.busy=true;paint();status(state.mode==='setup'?'Đang khởi tạo tài khoản System…':state.mode==='register'?'Đang tạo tài khoản…':'Đang đăng nhập…');
    try {
      const session=await request('/api/auth/'+state.mode,{username,password});
      if(!session.authenticated||!['system','user'].includes(session.account?.role))throw new Error('Máy chủ chưa xác nhận tài khoản. Hãy thử lại.');
      window.location.assign(safeNext(next,session.account.role));
    }catch(error){status(error.message,true);$('authPassword').value='';$('authConfirmPassword').value='';}
    finally{state.busy=false;paint();}
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.id==='authRetry')return initialize();
    if(button.id==='authShowPassword'){const show=$('authPassword').type==='password';$('authPassword').type=show?'text':'password';button.textContent=show?'Ẩn':'Hiện';button.setAttribute('aria-pressed',String(show));}
  });
  document.addEventListener('DOMContentLoaded',initialize,{once:true});
  window.MarketLensAuthPage=Object.freeze({safeNext});
})();
