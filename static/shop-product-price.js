'use strict';

(() => {
  const states=new Map();
  const fields=[
    ['price','Giá bán tham chiếu','₫'],['unit_cost','Giá vốn / sản phẩm','₫'],
    ['platform_fee_pct','Phí nền tảng','%'],['ad_cost_per_order','Quảng cáo / đơn thành công','₫'],
    ['packaging_cost','Đóng gói / đơn','₫'],['payment_fee_pct','Phí thanh toán','%'],
    ['tax_pct','Thuế theo giả định','%'],['shipping_cost','Vận chuyển shop chịu / đơn','₫'],
    ['other_unit_cost','Chi phí khác / sản phẩm','₫'],
  ];
  const feeFields=['platform_fee_pct','payment_fee_pct','tax_pct'];
  const fixedFields=['unit_cost','ad_cost_per_order','packaging_cost','shipping_cost','other_unit_cost'];
  const costFields=[...feeFields,...fixedFields];
  const scenarios=[{key:'lower',label:'Giảm 10%',factor:.9},{key:'current',label:'Giữ giá nhập',factor:1},{key:'higher',label:'Tăng 10%',factor:1.1}];
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const known=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  const format=value=>known(value)==null?'—':new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(value);
  const money=value=>known(value)==null?'—':format(value)+' ₫';
  const percent=value=>known(value)==null?'—':format(value)+'%';
  const label=name=>fields.find(field=>field[0]===name)?.[1]||name;
  const blank=value=>value==null?'':String(value);

  function safeUrl(value,image=false) {
    try {
      const url=new URL(value),host=url.hostname.toLowerCase();
      if(url.protocol!=='https:'||url.username||url.password||url.port)return '';
      if(image?!['shopee.vn','susercontent.com','shopeeusercontent.com'].some(domain=>host===domain||host.endsWith('.'+domain)):!['shopee.vn','www.shopee.vn'].includes(host))return '';
      return url.href;
    }catch{return '';}
  }

  function savedValues(product) {
    const inputs=product.inputs||{};
    return Object.fromEntries(fields.map(([name])=>{
      const value=name==='price'?product.price:own(inputs,name)?inputs[name]:own(product,name)?product[name]:name==='unit_cost'?product.cost:null;
      return [name,blank(value)];
    }));
  }

  function entryFor(ctx) {
    const key=JSON.stringify([String(ctx.shopId??''),String(ctx.product?.sku??'')]),values=savedValues(ctx.product||{}),signature=JSON.stringify(values);
    if(!states.has(key))states.set(key,{values,signature,selected:'current',dirty:false});
    const entry=states.get(key);
    if(!entry.dirty&&entry.signature!==signature){entry.values=values;entry.signature=signature;entry.selected='current';}
    return entry;
  }

  function calculate(values,factor=1) {
    const parsed={},errors=[];
    for(const [name,,unit]of fields){
      const raw=values[name];
      if(raw==null||String(raw).trim()===''){parsed[name]=null;continue;}
      const value=typeof raw==='boolean'?NaN:Number(raw);
      if(!Number.isFinite(value)||value<0||(name==='price'&&value<=0)||(unit==='%'&&value>=100)){
        errors.push(label(name)+(name==='price'?' phải lớn hơn 0.':unit==='%'?' phải từ 0 đến dưới 100%.':' phải là số hữu hạn không âm.'));parsed[name]=null;
      }else parsed[name]=value;
    }
    const missing=fields.filter(([name])=>parsed[name]==null).map(([name])=>name);
    const required=['price','unit_cost','platform_fee_pct'].filter(name=>parsed[name]==null);
    const feePct=feeFields.reduce((sum,name)=>sum+(parsed[name]??0),0);
    const fixedCost=fixedFields.reduce((sum,name)=>sum+(parsed[name]??0),0);
    const price=parsed.price==null?null:scenarioPrice(parsed.price,factor);
    if(feePct>=100)errors.push('Tổng phí nền tảng, phí thanh toán và thuế phải nhỏ hơn 100%.');
    if(!Number.isFinite(fixedCost)||!Number.isFinite(feePct)||(price!=null&&!Number.isFinite(price)))errors.push('Tổng tiền vượt phạm vi tính toán; kiểm tra lại giá và chi phí.');
    const ready=!required.length&&!errors.length,complete=ready&&!costFields.some(name=>parsed[name]==null);
    const feeAmount=ready?price*feePct/100:null,contribution=ready?price-feeAmount-fixedCost:null;
    const margin=ready?100*contribution/price:null,breakEven=ready?fixedCost/(1-feePct/100):null;
    if(ready&&![feeAmount,contribution,margin,breakEven].every(Number.isFinite)){
      errors.push('Kết quả vượt phạm vi tính toán; kiểm tra lại giá và chi phí.');
      return {parsed,missing,required,errors,ready:false,complete:false,price:null,feePct,fixedCost,feeAmount:null,contribution:null,margin:null,breakEven:null};
    }
    return {parsed,missing,required,errors,ready,complete,price,feePct,fixedCost,feeAmount,contribution,margin,breakEven};
  }

  function scenarioPrice(price,factor) {
    if(factor===1)return price;
    const quantum=price>=10000?1000:1,scaled=price*factor/quantum,lower=Math.floor(scaled);
    // Match the saved backend's rounding, including ties to the even integer.
    const rounded=scaled-lower===.5?lower+(lower%2):Math.round(scaled);
    return Math.max(1,rounded*quantum);
  }

  function metricCard(title,value,detail='') {
    return `<article class="sw-pp-metric"><span>${escape(title)}</span><strong>${value}</strong>${detail?`<small>${escape(detail)}</small>`:''}</article>`;
  }

  function productView(product) {
    const metrics=product.metrics||{},inputs=product.inputs||{},saved=savedValues(product);
    const cost=calculate(saved).parsed.unit_cost,images=Array.isArray(product.detail?.images)?product.detail.images:[];
    const image=[...images,product.image_url,product.image,product.thumbnail].map(value=>safeUrl(value,true)).find(Boolean),url=safeUrl(product.product_url||product.url);
    const contribution=known(metrics.contribution_per_order)??known(product.contribution_per_order)??known(product.optimizer?.contribution_per_order),complete=product.optimizer?.cost_complete===true&&!metrics.contribution_conditional;
    const orders=known(metrics.orders_30d)??known(inputs.orders_30d)??known(product.orders_30d),conversion=known(metrics.conversion_pct)??known(product.conversion_pct),roas=known(metrics.roas)??known(product.roas);
    return `<section class="sw-pp-product" data-intelligence-product><div class="sw-pp-section-head"><div><span class="sw-pp-eyebrow">PRODUCT INTELLIGENCE</span><h2>Hiểu hiệu quả từng sản phẩm</h2><p>Thông tin đã lưu của SKU đang chọn; các chỉ số thiếu được giữ là chưa biết.</p></div><span class="sw-pp-chip">${escape(product.segment_label||'Chưa đủ dữ liệu phân nhóm')}</span></div><div class="sw-pp-product-grid"><article class="sw-pp-profile"><div class="sw-pp-image">${image?`<img src="${escape(image)}" alt="${escape(product.name||'Sản phẩm đang chọn')}" loading="lazy" referrerpolicy="no-referrer">`:'<div class="sw-pp-placeholder" role="img" aria-label="Chưa có ảnh sản phẩm"><span aria-hidden="true">▧</span><small>Chưa có ảnh đã lưu</small></div>'}</div><div class="sw-pp-product-info"><span class="sw-pp-eyebrow">SKU ${escape(product.sku)}</span><h3>${escape(product.name||'Chưa có tên sản phẩm')}</h3><p>${escape(product.category||'Chưa có ngành hàng')}</p>${url?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Xem nguồn Shopee ↗</a>`:''}</div></article><div class="sw-pp-product-data"><div class="sw-pp-metrics">${metricCard('Giá bán đã lưu',money(known(product.price)))}${metricCard('Giá vốn / sản phẩm',money(cost),'Theo dữ liệu chi phí đã nhập')}${metricCard('Lãi đóng góp / đơn',money(contribution),complete?'Theo chi phí đã nhập':'Tạm tính; còn chi phí thiếu')}${metricCard('Đơn thành công / 30 ngày',format(orders),'Không thay số đơn bằng sản lượng hoặc tổng đã bán')}${metricCard('Tỷ lệ chuyển đổi',percent(conversion),'Trong phạm vi dữ liệu cùng kỳ')}${metricCard('ROAS',format(roas),'Doanh thu quảng cáo / chi quảng cáo')}</div><div class="sw-pp-observation"><strong>Cơ sở phân tích của SKU</strong><p>${escape(product.segment_reason||'Chưa có đủ bằng chứng để kết luận nhóm hiệu quả của sản phẩm này.')}</p><small>Lãi đóng góp theo chi phí đã biết chưa phải lợi nhuận ròng; chưa dự báo nhu cầu khi đổi giá.</small></div><div class="sw-pp-actions"><button class="btn btn-primary" data-seller-intelligence-module="price">Thử kịch bản giá →</button><button class="btn btn-white" data-seller-optimize="${escape(product.sku)}">Mở kế hoạch bán hàng</button></div></div></div></section>`;
  }

  function priceSummary(entry) {
    const chosen=scenarios.find(scenario=>scenario.key===entry.selected)||scenarios[1],result=calculate(entry.values,chosen.factor);
    const missingCosts=result.missing.filter(name=>name!=='price');
    const note=result.errors.length?`<div class="sw-pp-error" role="alert">${result.errors.map(escape).join(' ')}</div>`:result.required.length?`<div class="sw-pp-warning">Cần bổ sung ${result.required.map(name=>escape(label(name))).join(', ')} để tính kịch bản.</div>`:missingCosts.length?`<div class="sw-pp-warning">Tạm tính theo phần chi phí đã biết. Chưa gồm: ${missingCosts.map(name=>escape(label(name))).join(', ')}. Khoản thiếu chưa được xác nhận là 0.</div>`:'<div class="sw-pp-note">Đã có đủ các khoản trong mô hình chi phí này. Kết quả vẫn là giả định cho một đơn vị SKU trong một đơn thành công.</div>';
    const breakdown=[['price','Giá bán trong tình huống',result.price],...feeFields.map(name=>[name,label(name),result.ready&&result.parsed[name]!=null?result.price*result.parsed[name]/100:null]),...fixedFields.map(name=>[name,label(name),result.parsed[name]])];
    return `${note}<div class="sw-pp-summary-heading"><div><span class="sw-pp-eyebrow">${escape(chosen.label.toUpperCase())} · GIẢ ĐỊNH</span><h3>Lãi đóng góp trong tình huống đang chọn</h3></div><span class="sw-pp-chip">${result.complete?'Đủ dữ liệu chi phí':'Chi phí còn thiếu / cần kiểm tra'}</span></div><div class="sw-pp-price-metrics">${metricCard('Giá bán tình huống',money(result.errors.length?null:result.price))}${metricCard(result.complete?'Lãi đóng góp / đơn':'Lãi đóng góp tạm tính / đơn',money(result.contribution),'Theo các khoản đã nhập')}${metricCard('Biên đóng góp',percent(result.margin))}${metricCard('Giá hòa vốn có điều kiện',money(result.breakEven))}</div><div class="sw-pp-scenarios" aria-label="Chọn kịch bản giá">${scenarios.map(scenario=>{const estimate=calculate(entry.values,scenario.factor);return `<button type="button" class="sw-pp-scenario" data-intelligence-price-scenario="${scenario.key}" aria-pressed="${entry.selected===scenario.key}"><span>${scenario.label}</span><strong>${money(estimate.errors.length?null:estimate.price)}</strong><small>Lãi đóng góp ${money(estimate.contribution)}${estimate.complete?'':' · tạm tính'}</small></button>`;}).join('')}</div><details class="sw-pp-breakdown"><summary>Xem các khoản chi phí trong phép tính</summary><dl>${breakdown.map(([key,title,value])=>`<div data-intelligence-price-cost="${key}"><dt>${escape(title)}</dt><dd>${money(known(value))}</dd></div>`).join('')}<div class="sw-pp-cost-total"><dt>Tổng chi phí cố định đã biết</dt><dd>${result.errors.length?'—':money(result.fixedCost)}</dd></div><div><dt>Tổng phí và thuế đã biết</dt><dd>${result.errors.length?'—':percent(result.feePct)}</dd></div></dl></details><p class="sw-pp-footnote">Các mức ±10% tính từ giá nhập trong form, làm tròn đến 1.000 ₫ khi giá tham chiếu từ 10.000 ₫; giá nhỏ hơn làm tròn đến 1 ₫ như mô hình đã lưu. Chưa dự báo lượng đơn, chuyển đổi hay doanh thu; chưa mô hình hóa tổn thất đổi trả hoặc chi phí ngoài các khoản trên. Không thay đổi giá trên Shopee hoặc lưu vào database.</p>`;
  }

  function priceView(ctx) {
    const entry=entryFor(ctx),product=ctx.product;
    return `<section class="sw-pp-price" data-intelligence-price><div class="sw-pp-section-head"><div><span class="sw-pp-eyebrow">PRICE OPTIMIZER · THỬ KỊCH BẢN</span><h2>Thử giá trên cơ sở chi phí của bạn</h2><p>${escape(product.name||product.sku)} · SKU ${escape(product.sku)}. Thay đổi dưới đây chỉ là giả định cục bộ.</p></div><button class="btn btn-white btn-sm" data-intelligence-price-reset>Đặt lại theo dữ liệu SKU</button></div><div class="sw-pp-price-grid"><div class="sw-pp-price-form" role="group" aria-label="Giả định giá và chi phí"><h3>Giả định cho một đơn thành công</h3><div class="sw-pp-field-grid">${fields.slice(0,5).map(([name,title,unit])=>field(entry,name,title,unit)).join('')}</div><details class="sw-pp-other-costs" ${costFields.some(name=>entry.values[name]==='')?'open':''}><summary>Các khoản phí và chi phí khác</summary><div class="sw-pp-field-grid">${fields.slice(5).map(([name,title,unit])=>field(entry,name,title,unit)).join('')}</div></details><p class="sw-pp-footnote">Để trống khi chưa biết; chỉ nhập 0 khi đã xác nhận bằng 0. Chi phí phải cùng cơ sở một đơn vị SKU trong một đơn thành công.</p><button type="button" class="btn btn-soft" data-seller-optimize="${escape(product.sku)}">Lưu chi phí thực tế trong kế hoạch bán hàng →</button></div><div class="sw-pp-price-result" data-intelligence-price-summary aria-live="polite">${priceSummary(entry)}</div></div></section>`;
  }

  function field(entry,name,title,unit) {
    return `<label>${escape(title)} <span>${unit}</span><div><input type="number" name="intelligence_${name}" data-intelligence-price-field="${name}" value="${escape(entry.values[name])}" min="${name==='price'?'0.01':'0'}" ${unit==='%'?'max="99.99"':''} step="any" placeholder="Chưa cung cấp"><span>${unit}</span></div></label>`;
  }

  function render(mode,ctx={}) {
    if(!ctx.product)return '<div class="sw-pp-empty">Chọn sản phẩm của shop để phân tích. Chưa có dữ liệu SKU trong phạm vi này.</div>';
    return mode==='price'?priceView(ctx):productView(ctx.product);
  }

  function input(target,ctx={}) {
    const name=target?.dataset?.intelligencePriceField;
    if(!ctx.product||!fields.some(field=>field[0]===name))return false;
    const entry=entryFor(ctx);entry.values[name]=String(target.value??'');entry.dirty=true;
    const summary=target.closest?.('[data-intelligence-price]')?.querySelector?.('[data-intelligence-price-summary]');
    if(summary)summary.innerHTML=priceSummary(entry);
    return true;
  }

  function click(button,ctx={}) {
    const data=button?.dataset||{};
    if(!ctx.product)return false;
    if(own(data,'intelligencePriceReset')){
      const entry=entryFor(ctx);entry.values=savedValues(ctx.product);entry.signature=JSON.stringify(entry.values);entry.selected='current';entry.dirty=false;ctx.redraw?.();return true;
    }
    if(scenarios.some(scenario=>scenario.key===data.intelligencePriceScenario)){
      entryFor(ctx).selected=data.intelligencePriceScenario;ctx.redraw?.();return true;
    }
    return false;
  }

  window.MarketLensProductPrice=Object.freeze({render,input,click});
})();
