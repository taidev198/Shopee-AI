'use strict';

// Opens inside the product detail dialog: finds same-category competitors and
// similar products already stored for the shop, and lines them up against the
// selected product. Price comparison is only drawn from spec-equivalent rows.
(() => {
  const list=value=>Array.isArray(value)?value:[];
  const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const count=value=>known(value)==null?'—':new Intl.NumberFormat('vi-VN').format(value);
  const money=value=>known(value)==null?'—':count(value)+' ₫';
  const median=values=>{const sorted=values.filter(value=>known(value)!=null&&value>0).sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length?sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2:null;};
  const safeUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&['shopee.vn','www.shopee.vn'].includes(url.hostname)&&!url.port&&!url.username&&!url.password?'https://shopee.vn'+url.pathname:'';}catch{return '';}};
  const labels={equivalent:['Khớp quy cách','sp-ok'],review:['Cần xác minh quy cách','sp-warn'],different:['Khác quy cách','sp-diff']};

  function diff(price,base) {
    if(known(price)==null||known(base)==null||base<=0)return '';
    const pct=(price-base)/base*100;
    if(Math.abs(pct)<0.5)return '<small>≈ giá của bạn</small>';
    return `<small class="${pct<0?'sp-cheaper':'sp-pricier'}">${pct<0?'Rẻ hơn':'Đắt hơn'} bạn ${count(Math.round(Math.abs(pct)))}%</small>`;
  }

  function priceText(item) {
    const low=item.price_min,high=item.price_max;
    return known(low)!=null&&known(high)!=null&&low!==high?money(low)+' – '+money(high):money(known(item.price)??low);
  }

  function table(own,matches) {
    const rows=matches.map(item=>{
      const [label,tone]=labels[item.equivalence?.status]||labels.review,url=safeUrl(item.product_url);
      const price=known(item.price)??known(item.price_min);
      return `<tr><td><strong>${escape(item.source_shop||'Chưa rõ shop')}</strong><span>${escape(item.name||item.sku||'')}</span><small>${item.match_kind==='direct_search'?'Từ lượt tìm trực tiếp':'Tên giống '+count(Math.round(known(item.match_score)||0))+'%'}</small></td><td><span class="sp-badge ${tone}">${label}</span></td><td>${priceText(item)}${diff(price,own.price)}</td><td>${item.sold_lower_bound?'≥ ':''}${count(item.sold_total)}</td><td>${known(item.rating)==null?'—':'★ '+count(item.rating)}<small>${count(item.review_count)} đánh giá</small></td><td>${url?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Mở ↗</a>`:'—'}</td></tr>`;
    }).join('');
    const ownRow=`<tr class="sp-own"><td><strong>Sản phẩm của bạn</strong><span>${escape(own.name||own.sku||'')}</span></td><td><span class="sp-badge sp-self">Đang xem</span></td><td>${money(own.price)}</td><td>${count(own.sold_total)}</td><td>${known(own.rating)==null?'—':'★ '+count(own.rating)}<small>${count(own.review_count)} đánh giá</small></td><td>—</td></tr>`;
    return `<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Shop / sản phẩm</th><th>Quy cách</th><th>Giá</th><th>Đã bán</th><th>Đánh giá</th><th>Nguồn</th></tr></thead><tbody>${ownRow}${rows}</tbody></table></div>`;
  }

  // Only products whose title matches (same name search / name overlap) are shown; a bare
  // same-category pool is not "similar" and is deliberately left out.
  function body(own,result) {
    const matches=list(result.name_matches);
    if(!matches.length)return `<div class="sp-empty"><strong>Chưa có sản phẩm cùng tên trong dữ liệu đã lưu.</strong><p>Kết quả tìm trên toàn sàn ở trên chỉ để xem nhanh. Muốn lưu đối thủ cùng tên để theo dõi, bấm tìm và đọc chi tiết trong tab Đối thủ.</p><button class="btn btn-primary btn-sm" data-seller-competitors="${escape(own.sku)}">Tìm &amp; lưu đối thủ cùng tên →</button></div>`;
    const prices=matches.map(item=>known(item.price)??known(item.price_min)).filter(value=>value!=null&&value>0),mid=median(prices),price=known(own.price);
    const verdict=price!=null&&mid!=null?`<p class="sp-verdict">Giá của bạn <strong>${money(price)}</strong> ${Math.abs((price-mid)/mid)<.03?'ngang':price>mid?`cao hơn ${count(Math.round((price-mid)/mid*100))}% so với`:`thấp hơn ${count(Math.round((mid-price)/mid*100))}% so với`} trung vị <strong>${money(mid)}</strong> của ${count(prices.length)} sản phẩm cùng tên đã lưu.</p>`:'';
    const total=known(result.name_match_count)||matches.length;
    return `${verdict}${table(own,matches)}<p class="sp-foot">Sản phẩm cùng tên hoặc từ lượt tìm trực tiếp${total>matches.length?` · hiển thị ${count(matches.length)}/${count(total)}`:''}. Tên giống nhau chưa chứng minh cùng mẫu hoặc quy cách. Số đã bán là bộ đếm cộng dồn, không phải đơn 30 ngày.</p><button class="btn btn-soft btn-sm" data-seller-competitors="${escape(own.sku)}">Xem đầy đủ trong tab Đối thủ →</button>`;
  }

  function section(product) {
    if(product?.role!=='own')return '';
    return `<section class="product-detail-section sp-section" data-similar-products="${escape(product.sku)}"><h3>Đối thủ cùng ngành &amp; sản phẩm tương tự</h3><div class="sp-stored" data-sp-stored><h4>Sản phẩm cùng tên đã lưu từ phân tích đối thủ</h4><p class="sp-loading" role="status">Đang đọc dữ liệu đã lưu…</p></div><div class="sp-market" data-sp-market><p class="sp-loading" role="status">Đang chuẩn bị tìm trên toàn sàn Shopee…</p></div></section>`;
  }

  // ---- Whole-marketplace search (live, through the MarketLens Chrome extension) ----
  const marketCache=new Map();
  const stopWords=new Set(['chinh','hang','gia','re','sale','freeship','cao','cap','loai','tang','qua','hot','moi','new','giam','khuyen','mai','ship','cod','han','quoc','mau','size']);
  const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
  function defaultQuery(product) {
    const words=String(product.name||'').replace(/\[[^\]]*\]|\([^)]*\)/g,' ').replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(Boolean);
    const kept=words.filter(word=>!stopWords.has(fold(word))&&word.length>1).slice(0,6).join(' ');
    return kept||String(product.name||'').slice(0,60);
  }
  function categoryQuery(product) {
    const parts=String(product.category||'').split(/[>›/]/).map(part=>part.trim()).filter(Boolean);
    return parts.at(-1)||'';
  }
  const tokenSet=value=>new Set(fold(value).match(/[a-z0-9]{3,}/g)||[]);
  function relevance(own,name) {
    const left=tokenSet(own),right=tokenSet(name);
    if(!left.size||!right.size)return 0;
    let shared=0;for(const token of left)if(right.has(token))shared++;
    return shared/Math.sqrt(left.size*right.size);
  }

  function marketForm(product,query,busy) {
    const category=categoryQuery(product);
    return `<form class="sp-search" data-sp-form><label>Từ khóa tìm trên Shopee<input type="text" name="q" value="${escape(query)}" maxlength="100" ${busy?'disabled':''}></label><button class="btn btn-primary btn-sm" type="submit" ${busy?'disabled':''}>${busy?'Đang tìm…':'Tìm lại'}</button>${category&&fold(category)!==fold(query)?`<button class="btn btn-white btn-sm" type="button" data-sp-category="${escape(category)}" ${busy?'disabled':''}>Theo ngành: ${escape(category)}</button>`:''}</form>`;
  }

  function marketBody(product,state) {
    const form=marketForm(product,state.query,state.busy);
    const head='<h4>Trên toàn sàn Shopee (cùng ngành hàng, mọi shop)</h4>';
    if(state.busy)return `${head}${form}<p class="sp-loading" role="status">Chrome đang đọc kết quả tìm kiếm Shopee cho “${escape(state.query)}” — thường mất 15–40 giây. Đừng đóng cửa sổ Chrome.</p>`;
    if(state.error)return `${head}${form}<p class="sp-error" role="alert">${escape(state.error)}</p>`;
    const ownSeller=String(product.sku).split('.')[0];
    const cards=list(state.cards).filter(card=>String(card.seller_id)!==ownSeller&&`${card.seller_id}.${card.product_id}`!==String(product.sku))
      .map(card=>({...card,score:relevance(product.name,card.name)}));
    if(!cards.length)return `${head}${form}<p class="sp-foot">Không thấy sản phẩm của shop khác trong kết quả. Thử từ khóa ngắn hơn hoặc theo ngành hàng.</p>`;
    const prices=cards.map(card=>card.price).filter(value=>known(value)!=null&&value>0);
    const mid=median(prices),own=known(product.price);
    const cheaper=own==null?null:prices.filter(price=>price<own).length;
    const verdict=own!=null&&mid!=null?`<p class="sp-verdict">Giá của bạn <strong>${money(own)}</strong> ${Math.abs((own-mid)/mid)<.03?'ngang':own>mid?`cao hơn ${count(Math.round((own-mid)/mid*100))}% so với`:`thấp hơn ${count(Math.round((mid-own)/mid*100))}% so với`} trung vị thị trường <strong>${money(mid)}</strong>; có ${count(cheaper)}/${count(prices.length)} sản phẩm rẻ hơn bạn.</p>`:'';
    const stats=`<div class="sp-stats"><div><span>Sản phẩm đọc được</span><strong>${count(cards.length)}</strong></div><div><span>Giá trung vị</span><strong>${money(mid)}</strong></div><div><span>Khoảng giá</span><strong>${prices.length?money(Math.min(...prices))+' – '+money(Math.max(...prices)):'—'}</strong></div></div>`;
    const rows=cards.slice(0,15).map(card=>{const url=safeUrl(card.url);return `<tr><td><span class="sp-name">${escape(card.name)}</span><small>Tên giống ${count(Math.round(card.score*100))}%</small></td><td>${money(card.price)}${diff(card.price,own)}</td><td>${card.sold_lower_bound?'≥ ':''}${count(card.sold_total)}</td><td>${url?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Mở ↗</a>`:'—'}</td></tr>`;}).join('');
    const table=`<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Sản phẩm</th><th>Giá</th><th>Đã bán</th><th>Nguồn</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    return `${head}${form}${verdict}${stats}${table}<p class="sp-foot">Đọc trực tiếp từ trang tìm kiếm Shopee lúc ${escape(new Date(state.at).toLocaleTimeString('vi-VN'))}, xếp theo thứ tự Shopee. Giá là giá hiển thị trên thẻ (lấy mức thấp nhất nếu là khoảng giá). Chưa xác minh quy cách nên chỉ dùng để tham khảo.</p>`;
  }

  function marketRoot(product) {
    return document.querySelector(`[data-similar-products="${CSS.escape(String(product.sku))}"] [data-sp-market]`);
  }
  function draw(product,state) {
    const root=marketRoot(product);
    if(root?.isConnected)root.innerHTML=marketBody(product,state);
  }

  async function runMarket(product,query) {
    const key=JSON.stringify([String(S.shopId||''),String(product.sku)]);
    const state={query,busy:true,error:'',cards:[],at:Date.now()};
    marketCache.set(key,state);draw(product,state);
    try {
      const bridge=await window.MarketLensChrome?.ping?.();
      if(!bridge||bridge.capabilities?.similar!==true||typeof window.MarketLensChrome.similar!=='function')
        throw new Error('Tìm trên toàn sàn cần tiện ích MarketLens 1.9.0 trở lên. Mở chrome://extensions, bấm Tải lại ở tiện ích MarketLens rồi tải lại trang.');
      const result=await window.MarketLensChrome.similar(query);
      state.cards=list(result?.cards);state.at=Date.now();
      if(!state.cards.length)state.error='Shopee không trả sản phẩm nào cho từ khóa này.';
    }catch(error){
      state.error=error?.code==='bridge_timeout'?'Chưa kết nối tiện ích MarketLens trong Chrome. Cài hoặc tải lại tiện ích (bản 1.9.0) rồi mở lại sản phẩm.':(error?.message||'Chưa tìm được sản phẩm trên Shopee.');
    }finally{state.busy=false;draw(product,state);}
  }

  function startMarket(product,serverQuery) {
    const key=JSON.stringify([String(S.shopId||''),String(product.sku)]),cached=marketCache.get(key);
    if(cached&&!cached.busy&&!cached.error&&Date.now()-cached.at<10*60*1000){draw(product,cached);return;}
    if(cached?.busy){draw(product,cached);return;}
    runMarket(product,String(serverQuery||'').trim()||defaultQuery(product));
  }

  let current=null;
  document.addEventListener('submit',event=>{
    const form=event.target.closest?.('[data-sp-form]');
    if(!form||!current)return;
    event.preventDefault();
    const query=String(new FormData(form).get('q')||'').replace(/\s+/g,' ').trim();
    if(query.length<2){return;}
    runMarket(current,query);
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-sp-category]');
    if(!button||!current||button.disabled)return;
    runMarket(current,button.dataset.spCategory);
  });

  async function load(product,dialog) {
    const root=dialog?.querySelector?.('[data-sp-stored]');
    if(!root||typeof S==='undefined'||!S.shopId)return;
    current=product;
    const shopId=S.shopId,heading='<h4>Sản phẩm cùng tên đã lưu từ phân tích đối thủ</h4>';
    try {
      const result=await api('/api/seller/products/'+encodeURIComponent(String(product.sku))+'/market-evidence?shop_id='+encodeURIComponent(String(shopId)));
      if(!root.isConnected)return;
      if(String(result?.sku)!==String(product.sku))throw new Error('Kết quả không thuộc sản phẩm đang xem.');
      root.innerHTML=heading+body(product,result);
      startMarket(product,result.query);
    }catch(error){
      if(root.isConnected)root.innerHTML=heading+`<p class="sp-error" role="alert">${escape(error?.message||'Chưa tìm được đối thủ.')}</p>`;
      startMarket(product);
    }
  }

  window.MarketLensSimilar=Object.freeze({section,load});
})();
