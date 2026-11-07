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

  function verdict(own,reference,candidates) {
    const price=known(own.price);
    const matched=candidates.filter(item=>item.equivalence?.status==='equivalent');
    const pool=matched.length?matched:candidates;
    const mid=median(pool.map(item=>item.price));
    if(price==null||mid==null)return '';
    const pct=(price-mid)/mid*100,basis=matched.length?`${count(matched.length)} sản phẩm khớp quy cách`:`${count(candidates.length)} sản phẩm cùng ngành (chưa xác minh quy cách)`;
    const word=Math.abs(pct)<3?'ngang mức thị trường':pct>0?`cao hơn trung vị ${count(Math.round(pct))}%`:`thấp hơn trung vị ${count(Math.round(-pct))}%`;
    return `<p class="sp-verdict">Giá của bạn <strong>${money(price)}</strong> ${word} (<strong>${money(mid)}</strong>, tính trên ${basis}).</p>`;
  }

  function table(own,candidates) {
    const rows=candidates.slice(0,10).map(item=>{
      const [label,tone]=labels[item.equivalence?.status]||labels.review,url=safeUrl(item.product_url);
      const similarity=known(item.similarity)==null?'':`<small>Tên giống ${count(Math.round(item.similarity*100))}%</small>`;
      return `<tr><td><strong>${escape(item.source_shop||'Chưa rõ shop')}</strong><span>${escape(item.name||item.sku||'')}</span>${similarity}</td><td><span class="sp-badge ${tone}">${label}</span></td><td>${money(item.price)}${diff(item.price,own.price)}</td><td>${item.sold_lower_bound?'≥ ':item.sold_approx?'≈ ':''}${count(item.sold_total)}</td><td>${known(item.rating)==null?'—':'★ '+count(item.rating)}<small>${count(item.review_count)} đánh giá</small></td><td>${url?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Mở ↗</a>`:'—'}</td></tr>`;
    }).join('');
    const ownRow=`<tr class="sp-own"><td><strong>Sản phẩm của bạn</strong><span>${escape(own.name||own.sku||'')}</span></td><td><span class="sp-badge sp-self">Đang xem</span></td><td>${money(own.price)}</td><td>${count(own.sold_total)}</td><td>${known(own.rating)==null?'—':'★ '+count(own.rating)}<small>${count(own.review_count)} đánh giá</small></td><td>—</td></tr>`;
    return `<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Shop / sản phẩm</th><th>Quy cách</th><th>Giá</th><th>Đã bán</th><th>Đánh giá</th><th>Nguồn</th></tr></thead><tbody>${ownRow}${rows}</tbody></table></div>`;
  }

  function body(own,result) {
    const reference=result.competitors||{},candidates=list(reference.candidates);
    if(!candidates.length)return `<div class="sp-empty"><strong>Chưa có đối thủ cùng ngành trong dữ liệu đã lưu.</strong><p>Quét ngành hàng hoặc đọc đối thủ cho sản phẩm này để có giá, số bán và đánh giá thực tế. Không có dữ liệu không có nghĩa là thị trường không có đối thủ.</p><button class="btn btn-primary btn-sm" data-seller-competitors="${escape(own.sku)}">Tìm đối thủ cho sản phẩm này →</button></div>`;
    const extra=reference.candidates_truncated?` · hiển thị ${count(Math.min(10,candidates.length))}/${count(reference.candidate_count)} gần nhất`:candidates.length>10?` · hiển thị 10/${count(candidates.length)} gần nhất`:'';
    return `${verdict(own,reference,candidates)}<div class="sp-stats"><div><span>Cùng ngành</span><strong>${count(reference.candidate_count||candidates.length)}</strong></div><div><span>Khớp quy cách</span><strong>${count(reference.count)}</strong></div><div><span>Khoảng giá khớp</span><strong>${known(reference.min)==null?'—':money(reference.min)+(reference.min===reference.max?'':' – '+money(reference.max))}</strong></div></div>${table(own,candidates)}<p class="sp-foot">Xếp theo mức khớp quy cách rồi độ giống tên${escape(extra)}. Số đã bán là bộ đếm cộng dồn công khai, không phải số đơn 30 ngày. Chỉ so giá trực tiếp khi quy cách khớp.</p><button class="btn btn-soft btn-sm" data-seller-competitors="${escape(own.sku)}">Xem đầy đủ trong tab Đối thủ →</button>`;
  }

  function section(product) {
    if(product?.role!=='own')return '';
    return `<section class="product-detail-section sp-section" data-similar-products="${escape(product.sku)}"><h3>Đối thủ cùng ngành &amp; sản phẩm tương tự</h3><p class="sp-loading" role="status">Đang tìm đối thủ và sản phẩm tương tự…</p></section>`;
  }

  async function load(product,dialog) {
    const root=dialog?.querySelector?.('[data-similar-products]');
    if(!root||typeof S==='undefined'||!S.shopId)return;
    const shopId=S.shopId,heading='<h3>Đối thủ cùng ngành &amp; sản phẩm tương tự</h3>';
    try {
      const result=await api('/api/seller/products/'+encodeURIComponent(String(product.sku))+'/market-evidence?shop_id='+encodeURIComponent(String(shopId)));
      if(!root.isConnected)return;
      if(String(result?.sku)!==String(product.sku))throw new Error('Kết quả không thuộc sản phẩm đang xem.');
      root.innerHTML=heading+body(product,result);
    }catch(error){
      if(root.isConnected)root.innerHTML=heading+`<p class="sp-error" role="alert">${escape(error?.message||'Chưa tìm được đối thủ.')}</p>`;
    }
  }

  window.MarketLensSimilar=Object.freeze({section,load});
})();
