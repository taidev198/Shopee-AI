import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCategoryUrl} from '../category.js';
test('category URL keeps a bounded page and rejects foreign paths', () => {
  assert.equal(validateCategoryUrl('https://shopee.vn/Nha-cua-cat.100.200?page=3&x=y'), 'https://shopee.vn/Nha-cua-cat.100.200?page=3');
  for (const value of ['https://evil.com/A-cat.1','https://shopee.vn/search','https://shopee.vn/A-cat.1?page=10000000','https://user@shopee.vn/A-cat.1','https://shopee.vn/A-cat.1?page=-1']) assert.throws(()=>validateCategoryUrl(value));
});

import vm from 'node:vm';
import {inspectCategoryPage} from '../category.js';
test('home discovery reads category names from DOM and advances only the category carousel',()=>{
  let clicks=0,scrolls=0;
  const link=(url,name,display='block')=>({innerText:name,children:[{closest:()=>null,getClientRects:()=>[{}]}],closest:()=>null,getClientRects:()=>[{}],getAttribute:key=>key==='href'?url:null,querySelector:()=>null,display});
  const next={closest:()=>null,getClientRects:()=>[{}],getAttribute:()=>null,classList:{contains:()=>false},click:()=>clicks++};
  const links=[link('/A-cat.1','Ngành A','contents'),link('/B-cat.2','Ngành B'),link('https://evil.com/C-cat.3','Ngoài Shopee'),link('/product/1/2','Sản phẩm')];
  const root={closest:()=>null,getClientRects:()=>[{}],querySelectorAll:selector=>selector==='a[href]'?links:selector.includes('.carousel-arrow--next')?[next]:[]};
  const document={body:{innerText:'Danh mục'},querySelectorAll:selector=>selector==='a[href]'?[...links,link('/Footer-cat.99','Không lấy link chân trang')]:selector.startsWith('.home-category-list,')?[root]:[]};
  const c=vm.createContext({URL,Map,document,location:{href:'https://shopee.vn/'},getComputedStyle:e=>({display:e.display||'block',visibility:'visible'}),window:{innerHeight:800,scrollBy:()=>scrolls++}});
  const result=vm.runInContext(`(${inspectCategoryPage.toString()})({home:true,action:'scroll'})`,c);
  assert.equal(JSON.stringify(result.categories),JSON.stringify([{name:'Ngành A',url:'https://shopee.vn/A-cat.1'},{name:'Ngành B',url:'https://shopee.vn/B-cat.2'}]));
  assert.equal(result.advanced,true);assert.equal(clicks,1);assert.equal(scrolls,1);
  assert.equal(result.catalog_end,false);
  c.location.href='https://shopee.vn/verify';
  assert.equal(vm.runInContext(`(${inspectCategoryPage.toString()})({home:true})`,c).status,'blocked');
});

function listingContext({page=0,counter='1/2',active=null,empty=false,blocked=false}={}) {
  const visible={closest:()=>null,getClientRects:()=>[{}],children:[]};
  const link={...visible,display:'contents',getClientRects:()=>[],children:[visible],getAttribute:key=>key==='href'?'/product/12/34':null};
  const root={...visible,querySelectorAll:selector=>selector==='a[href]'?[link]:[]};
  const arrow={...visible,disabled:false,getAttribute:()=>null,classList:{contains:()=>false}};
  const pagination={...visible,innerText:counter,querySelectorAll:selector=>selector.startsWith('[aria-current')?(active?[{...visible,innerText:String(active)}]:[]):[arrow]};
  const noResults={...visible,innerText:'Không tìm thấy sản phẩm phù hợp'};
  const document={body:{innerText:blocked?'Lưu lượng truy cập bất thường':'Ngành hàng'},querySelectorAll:selector=>
    selector.startsWith('.shopee-search-item-result,')?(empty?[]:[root]):
    selector.startsWith('.shopee-page-controller,')?[pagination]:
    selector.startsWith('.shopee-search-empty-result-section,')?(empty?[noResults]:[]):[]};
  const c=vm.createContext({URL,Map,Set,document,location:{href:`https://shopee.vn/A-cat.1?page=${page}`},
    getComputedStyle:e=>({display:e.display||'block',visibility:'visible'}),window:{innerHeight:800,scrollBy(){}}});
  const inspect=(expected=page)=>vm.runInContext(`(${inspectCategoryPage.toString()})({url:'https://shopee.vn/A-cat.1?page=${expected}',action:'read'})`,c);
  return {c,inspect};
}
test('category listing reads display-contents links and visible page counter overrides enabled last arrow',()=>{
  const first=listingContext().inspect();
  assert.equal(first.status,'ready');assert.equal(first.urls[0],'https://shopee.vn/product/12/34');assert.equal(first.has_next,true);
  const last=listingContext({page:1,counter:'2/2'}).inspect();
  assert.equal(last.has_next,false);
});
test('category listing waits for the requested page and its rendered active page',()=>{
  assert.equal(listingContext().inspect(1).status,'loading');
  assert.equal(listingContext({page:1,counter:'1/2'}).inspect().status,'loading');
  assert.equal(listingContext({page:1,counter:'',active:1}).inspect().status,'loading');
});
test('visible empty results end pagination but a loading page does not',()=>{
  const empty=listingContext({empty:true}).inspect();
  assert.equal(empty.status,'ready');assert.equal(empty.empty,true);assert.equal(empty.has_next,false);assert.equal(empty.urls.length,0);
  const loading=listingContext({empty:true});loading.c.document.querySelectorAll=()=>[];
  assert.equal(loading.inspect().status,'loading');
});
test('category listing stops at traffic verification without collecting products',()=>{
  assert.equal(listingContext({blocked:true}).inspect().status,'blocked');
});

function modernContext({page='0',category='11116484',slug='Tools-Home-Improvement',counter='1/2',links,withCards=true}={}) {
  const queries=[];
  const element=(tag,attrs={},text='',parent=null)=>({tag,attrs,parent,innerText:text,children:[],
    getAttribute:key=>attrs[key]??null,getClientRects:()=>attrs.hidden?[]:[{}],classList:{contains:()=>false},
    querySelectorAll:()=>[],closest(selector){
      for(let node=this;node;node=node.parent){
        if(selector.includes('[hidden]')&&(node.attrs.hidden||node.attrs['aria-hidden']==='true'))return node;
        if(selector.includes('[role="group"]')&&node.attrs.role==='group'&&String(node.attrs['aria-label']).startsWith('Product card'))return node;
        if(selector.split(',').some(part=>part.trim()===node.tag))return node;
      }
      return null;
    }});
  const main=element('main'),footer=element('footer',{},'',main);
  const card=element('div',{role:'group','aria-label':'Product card: Rây inox'},'Rây inox\n94.000₫',main);
  const inner=element('div',{role:'group','aria-label':'Product card'},'Rây inox',card);
  const product=element('a',{href:'/Ray-inox-i.12.34',display:'contents'},'Rây inox',inner);
  product.getClientRects=()=>[];product.children=[element('span')];
  const duplicate=element('a',{href:'/product/12/34'},'Rây inox',inner);
  card.querySelectorAll=inner.querySelectorAll=selector=>selector==='a[href]'?[product,duplicate]:[];
  const footerCard=element('div',{role:'group','aria-label':'Product card: Footer'},'Footer',footer);
  const footerProduct=element('a',{href:'/product/99/99'},'Footer product',footerCard);
  footerCard.querySelectorAll=selector=>selector==='a[href]'?[footerProduct]:[];
  const advertisement=element('div',{role:'group','aria-label':'Product card: Quảng cáo'},'Ad\nQuảng cáo',main);
  const adProduct=element('a',{href:'/product/88/88'},'Quảng cáo',advertisement);
  advertisement.querySelectorAll=selector=>selector==='a[href]'?[adProduct]:[];
  const outsideAd=element('a',{href:'/product/77/77'},'Banner quảng cáo ngoài danh sách',main);
  const nav=element('nav',{},'',main);
  const navigation=(links||[
    {href:'/',text:'Previous',disabled:true},
    {href:'/Tools-Home-Improvement-cat.11116484?page=0',text:'1'},
    {href:'/Tools-Home-Improvement-cat.11116484?page=1',text:'2'},
    {href:'/Tools-Home-Improvement-cat.11116484?page=1',text:'Next'},
  ]).map(item=>element('a',{href:item.href,'aria-disabled':item.disabled?'true':null},item.text,nav));
  nav.querySelectorAll=selector=>selector==='a[href]'?navigation:[];
  const cardCounter=element('span',{},'9/9',card);
  const pageCounter=element('div',{},counter,main);
  const document={body:{innerText:'Danh sách sản phẩm'},querySelectorAll(selector){
    queries.push(selector);
    if(selector.startsWith('.shopee-search-item-result,'))return withCards?[card,inner,footerCard,advertisement]:[];
    if(selector.startsWith('main nav,'))return [nav];
    if(selector==='main *, [role="main"] *')return [cardCounter,pageCounter];
    if(selector==='a[href]')return [product,duplicate,footerProduct,adProduct,outsideAd,...navigation];
    return [];
  }};
  const c=vm.createContext({URL,Map,Set,document,location:{href:`https://shopee.vn/${slug}-cat.${category}?page=${page}`},
    getComputedStyle:e=>({display:e.attrs?.display||'block',visibility:'visible'}),window:{innerHeight:800,scrollBy(){}}});
  const inspect=(expected=`https://shopee.vn/Tools-Home-Improvement-cat.11116484?page=${page}`)=>
    vm.runInContext(`(${inspectCategoryPage.toString()})(${JSON.stringify({url:expected,action:'read'})})`,c);
  return {c,inspect,queries};
}

test('observed modern product-card groups work without legacy search classes and exclude footer/ad products',()=>{
  const context=modernContext();const result=context.inspect();
  assert.equal(result.status,'ready');assert.equal(JSON.stringify(result.urls),JSON.stringify(['https://shopee.vn/product/12/34']));
  assert.equal(result.has_next,true);
  assert.ok(context.queries.some(selector=>selector.includes('[role="main"] [role="group"]')));
  assert.ok(!context.queries.includes('a[href]'),'never read every product link on the document');
});
test('localized category slugs bind to the same complete category ID chain and page',()=>{
  assert.equal(modernContext({slug:'Dụng-Cụ-Sửa-Chữa'}).inspect().status,'ready');
  const different=modernContext({category:'9.11116484'}).inspect();
  assert.equal(different.status,'loading');assert.equal(different.loading_reason,'wrong_category');
  const sameLeafDifferentParent=modernContext({category:'9.2'}).inspect('https://shopee.vn/A-cat.1.2?page=0');
  assert.equal(sameLeafDifferentParent.loading_reason,'wrong_category');
});
test('modern main counter overrides a stale enabled next link at the last page',()=>{
  const context=modernContext({page:'1',counter:'2/2',links:[{href:'/Tools-Home-Improvement-cat.11116484?page=2',text:'Next'}]});
  assert.equal(context.inspect().has_next,false);
});
test('modern navigation uses only enabled same-category links to exactly the next page',()=>{
  for(const links of [
    [{href:'/Other-cat.999?page=1',text:'Next'}],
    [{href:'https://evil.test/Tools-cat.11116484?page=1',text:'Next'}],
    [{href:'/Tools-cat.11116484?page=2',text:'Next'}],
    [{href:'/Tools-cat.11116484?page=1',text:'Next',disabled:true}],
  ]) assert.equal(modernContext({links}).inspect().has_next,false);
});
test('modern page URL and rendered counter mismatches provide distinct diagnostics',()=>{
  assert.equal(modernContext({page:'1',counter:'2/2'}).inspect('https://shopee.vn/A-cat.11116484?page=0').loading_reason,'wrong_page_url');
  assert.equal(modernContext({counter:'2/2'}).inspect().loading_reason,'pagination_mismatch');
  assert.equal(modernContext({page:'bad'}).inspect('https://shopee.vn/A-cat.11116484?page=0').loading_reason,'wrong_page_url');
  assert.equal(modernContext({page:'10000000'}).inspect('https://shopee.vn/A-cat.11116484?page=0').loading_reason,'wrong_page_url');
});
test('a modern page without supported product-card groups reports no_product_cards instead of reading banners',()=>{
  const result=modernContext({withCards:false}).inspect();
  assert.equal(result.status,'loading');assert.equal(result.loading_reason,'no_product_cards');assert.equal(result.urls.length,0);
});
