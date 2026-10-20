import{expected}from'./dual-business-cases.mjs';
const norm=s=>String(s).replace(/[\s·()（）]/g,''),num=s=>{const v=String(s).replaceAll(',','').trim();return /^[-−]?\d+(?:\.\d+)?(?:%|만원|명|개|분|건)?$/.test(v)?Number(v.replace('−','-').replace(/[%만원명개분건]+$/,'')):null;};
export function inspectGroupedTables(c,tables,parts=[]){const checks=[];
 for(const [ti,t]of tables.entries())for(const [ri,row]of t.rows.entries()){
  if(row.some(v=>/^(?:FM|MV|CS)-\d+$/.test(String(v))))continue;let subset=structuredClone(c),matched=false;
  if(c.id==='maintenance'){for(const field of ['site','category']){const label=row.find(v=>c.datasets.jobs.some(x=>x[field]===v));if(label){subset.datasets.jobs=subset.datasets.jobs.filter(x=>x[field]===label);matched=true;}}}
  else if(c.id==='inventory'){
   // A slide can title a per-warehouse table while its rows contain only SKUs.
   // Infer scope only from an explicit leading heading, never a body mention.
   const heading=parts.find(p=>p.name===t.part)?.text??'',escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   let scopes=[...new Set(c.datasets.stock.map(x=>x.warehouse))].filter(label=>new RegExp('^'+escape(label)+'(?:\\s*창고)?(?:\\s*[:：|]|\\s+상세(?:\\s|$))').test(heading));
   const headerScopes=[...new Set(c.datasets.stock.map(x=>x.warehouse))].filter(label=>t.headers.some(h=>new RegExp('^'+escape(label)+'\\s+(?:품목|창고)(?:\\s|$)').test(h)));if(headerScopes.length===1)scopes=headerScopes;
   if(scopes.length===1&&!row.some(v=>c.datasets.stock.some(x=>x.warehouse===v)))for(const ds of ['stock','movements'])subset.datasets[ds]=subset.datasets[ds].filter(x=>x.warehouse===scopes[0]);
   for(const field of ['warehouse','sku']){const label=row.find(v=>c.datasets.stock.some(x=>x[field]===v));if(label){for(const ds of ['stock','movements'])subset.datasets[ds]=subset.datasets[ds].filter(x=>x[field]===label);matched=true;}}}
  else {const queue=row.find(v=>c.datasets.capacity.some(x=>x.queue===v));if(queue){subset.datasets.tickets=subset.datasets.tickets.filter(x=>x.queue===queue);subset.datasets.capacity=subset.datasets.capacity.filter(x=>x.queue===queue);matched=true;}}
  if(!matched)continue;const want=expected(subset);
  t.headers.forEach((h,ci)=>{h=norm(h);let metric;
   if(c.id==='maintenance'){if(/보류.*직접비/.test(h))metric='pending';else if(/승인.*자재/.test(h))metric='material';else if(/승인.*인건비/.test(h))metric='labor';else if(/승인.*직접비/.test(h))metric='approved';else if(/착수.*총예산/.test(h))metric='total';}
   else if(c.id==='inventory'){if(/가용.*기말|기말.*가용|가용재고/.test(h)&&!h.includes('평가'))metric='available';else if(/보충수량/.test(h))metric='replenish';else if(/보충금액/.test(h))metric='purchase';else if(/평가액/.test(h))metric='value';else if(/격리.*수량/.test(h))metric='quarantined';}
   else {if(/준수율/.test(h))metric='sla';else if(/^완료(?:건수|건)?$/.test(h))metric='closed';else if(/^준수(?:건수|건)?$/.test(h))metric='met';else if(/^위반(?:건수|건)?$/.test(h))metric='breached';else if(/잠재.*보상/.test(h))metric='potential';else if(/보상예정액|확정.*보상/.test(h))metric='credit';else if(/필요.*시간/.test(h))metric='work';else if(/가용.*시간/.test(h))metric='capacity';else if(/여유.*시간|시간.*여유/.test(h))metric='gap';}
   const actual=num(row[ci]);if(!metric||actual===null)return;const value=metric==='sla'&&String(row[ci]).includes('%')?want[metric]*100:want[metric],tol=metric==='sla'?.051:.011;checks.push({table:ti,row:ri,col:ci,metric,actual,expected:value,passed:Math.abs(actual-value)<=tol});
  });
 }return{checkedCells:checks.length,passed:checks.every(x=>x.passed),checks};}
