'use strict';
(function(root){
  const userViews=['overview','myShops','shopAnalysis','products','optimizer','competitors','marketAnalysis','opportunities','strategy','actions','reports','listings'];
  const sharedViews=['crawler'];
  const systemViews=['categoryMarket','marketSchedules','imports','users'];
  function areaForView(view,current){if(sharedViews.includes(view))return current==='system'?'system':'user';return systemViews.includes(view)?'system':userViews.includes(view)?'user':null;}
  function url(view,shopId,current){const area=areaForView(view,current)||'user',query=new URLSearchParams({view:areaForView(view,current)?view:'myShops'});if(shopId)query.set('shop_id',shopId);return '/'+area+'?'+query.toString();}
  root.MarketLensRoutes={areaForView,url,defaultView:area=>area==='system'?'crawler':'myShops',canOpen:(role,view)=>role==='system'||role==='user'&&(sharedViews.includes(view)||areaForView(view)==='user')};
})(window);
