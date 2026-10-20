/** Compare business table cells with raw records. Never fixes a candidate or dictates its layout. */
const numeric=value=>{const s=String(value).replaceAll(',','').trim();return /^[-−]?\d+(?:\.\d+)?(?:%|만원|명|개|분|건|일|월)?$/.test(s)?Number(s.replace('−','-').replace(/[%만원명개분건일월]+$/,'')):null;};
const normalize=s=>String(s).replace(/[\s·()（）]/g,'');
export function inspectBusinessTables(c,tables){
 const checks=[];const add=(table,row,col,actual,expected)=>{if(actual===null)return;checks.push({table,row,col,actual,expected,passed:Math.abs(actual-expected)<.011});};
 for(const [ti,t]of tables.entries()){
  if(!Array.isArray(t.headers)||!Array.isArray(t.rows))continue;const h=t.headers.map(normalize);
  for(const [ri,row]of t.rows.entries()){
   if(row.some(v=>Object.values(c.datasets).some(records=>records.some(r=>r.id===v))))continue;
   if(c.id==='procurement'){
    const supplier=row.find(v=>c.datasets.suppliers.some(s=>s.name===v));if(!supplier)continue;let raw=c.datasets.orders.filter(r=>r.supplier===supplier),month;
    const mi=h.findIndex(x=>x==='월'||x==='납품월');if(mi>=0){month=numeric(row[mi]);if(month!==null)raw=raw.filter(r=>r.month===month);}
    const valid=raw.filter(r=>r.state==='유효'),accepted=valid.reduce((s,r)=>s+(r.delivered-r.rejected)*r.unitPrice,0),backlog=valid.reduce((s,r)=>s+r.ordered-r.delivered,0);
    h.forEach((header,ci)=>{
     let want;if(header.includes('미납')&&!header.includes('사유')&&!header.includes('대응'))want=backlog;
     else if(/유효주문/.test(header))want=valid.length;
     else if(header==='불량'||header==='불량개')want=valid.reduce((s,r)=>s+r.rejected,0);
     else if(/인정액/.test(header)&&!header.includes('비중'))want=accepted;
     else if(header==='VAT')want=accepted*.1;
     else if(/보류금/.test(header))want=accepted*.05;
     else if(/지급예정액/.test(header)&&!header.includes('비중'))want=accepted*1.05;
     if(want!==undefined)add(ti,ri,ci,numeric(row[ci]),want);
    });
   }else if(c.id==='training'){
    const course=row.find(v=>c.datasets.courses.some(s=>s.name===v));if(!course)continue;const raw=c.datasets.registrations.filter(r=>r.course===course),courseData=c.datasets.courses.find(s=>s.name===course),confirmed=raw.filter(r=>r.state==='확정').length;
    const revenue=raw.reduce((s,r)=>s+(r.state==='대기'?0:r.fee*(1-r.discount)*(r.state==='환불'?.1:1)),0),cost=courseData.instructor+courseData.room+confirmed*2;
    h.forEach((header,ci)=>{let want;if(/^확정(?:인원|명)?$/.test(header))want=confirmed;else if(/^환불(?:인원|명)?$/.test(header))want=raw.filter(r=>r.state==='환불').length;else if(/^대기(?:인원|명)?$/.test(header))want=raw.filter(r=>r.state==='대기').length;else if(header.includes('잔여좌석'))want=courseData.capacity-confirmed;else if(header==='수입'||header==='수입만원')want=revenue;else if(header==='직접비용')want=cost;else if(header==='직접비용차감후')want=revenue-cost;if(want!==undefined)add(ti,ri,ci,numeric(row[ci]),want);});
   }else if(c.id==='migration'){
    const system=row.find(v=>c.datasets.systems.some(s=>s.name===v));if(!system)continue;const raw=c.datasets.tasks.filter(r=>r.system===system),systemData=c.datasets.systems.find(s=>s.name===system);
    h.forEach((header,ci)=>{let want;if(/작업시간|직렬시간/.test(header))want=raw.reduce((s,r)=>s+r.duration,0);else if(/복구시간/.test(header))want=systemData.rollbackMinutes;else if(/작업비용/.test(header))want=raw.reduce((s,r)=>s+r.duration*r.people*r.unitRate,0);else if(/^대기(?:건수|작업수)?$/.test(header))want=raw.filter(r=>r.state==='대기').length;if(want!==undefined)add(ti,ri,ci,numeric(row[ci]),want);});
   }
  }
 }
 return {checkedCells:checks.length,passed:checks.every(c=>c.passed),checks};
}
