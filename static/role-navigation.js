'use strict';
(function(root){
  const userViews=['overview','myShops','shopAnalysis','products','optimizer','competitors','marketAnalysis','opportunities','strategy','actions','reports'];
  const systemViews=['crawler','categoryMarket','marketSchedules','imports','users'];
  function areaForView(view){return systemViews.includes(view)?'system':userViews.includes(view)?'user':null;}
  function url(view,shopId){const area=areaForView(view)||'user',query=new URLSearchParams({view:areaForView(view)?view:'myShops'});if(shopId)query.set('shop_id',shopId);return '/'+area+'?'+query.toString();}
  root.MarketLensRoutes={areaForView,url,defaultView:area=>area==='system'?'crawler':'myShops',canOpen:(role,view)=>role==='system'||role==='user'&&areaForView(view)==='user'};
})(window);
