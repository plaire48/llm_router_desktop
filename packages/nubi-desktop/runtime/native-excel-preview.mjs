import {nativeExcelBindings} from './native-excel-bindings.mjs';
// Display projection only. Native execution always uses the original approved
// DTO. Addresses come from observed Range/Cells selectors, never handle names.
const column=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
export function nativeExcelPreview(observation,proposal,{maxRows=20,maxCols=12,maxCells=240}={}){
 const bindings=nativeExcelBindings(observation),{resolve}=bindings,sheets=new Map();let partial=false,unmappedChanges=0,total=0;
 const sheet=id=>{if(!sheets.has(id))sheets.set(id,{id,name:typeof id==='number'?`시트 ${id}`:String(id),cells:new Map()});return sheets.get(id);};
 function cells(o,value,property,change=false){
  const sh=sheet(o.sheet),r=o.range;if(!r)return;
  if(r.r2-r.r1+1>maxRows||r.c2-r.c1+1>maxCols||(r.r2-r.r1+1)*(r.c2-r.c1+1)>maxCells)partial=true;
  for(let row=r.r1;row<=Math.min(r.r2,r.r1+maxRows-1);row++)for(let col=r.c1;col<=Math.min(r.c2,r.c1+maxCols-1);col++){
   const address=column(col)+row;let cell=sh.cells.get(address);
   if(!cell){if(total>=maxCells){partial=true;continue;}cell={address,row,col,observed:false};sh.cells.set(address,cell);total++;}
   const v=Array.isArray(value)?(Array.isArray(value[row-r.r1])?value[row-r.r1][col-r.c1]:undefined):change||r.r1===r.r2&&r.c1===r.c2?value:undefined;
   if(v===undefined)continue;
   if(change){if(property==='expectedValue'){if(cell.value!==v){cell.changed=true;if(cell.observed&&!Object.hasOwn(cell,'beforeValue'))cell.beforeValue=cell.value;}cell.expectedValue=v;continue;}cell.changed=true;if(cell.observed&&!Object.hasOwn(cell,'beforeValue'))cell.beforeValue=cell.value;if(cell.formula!==undefined&&!Object.hasOwn(cell,'beforeFormula'))cell.beforeFormula=cell.formula;}
   else cell.observed=true;
   if(/^(?:Formula|FormulaLocal|FormulaArray)$/.test(property)){if(typeof v==='string'&&v.startsWith('='))cell.formula=v;else{delete cell.formula;if(!Object.hasOwn(cell,'value')||change)cell.value=v;}}else{cell.value=v;if(change)delete cell.formula;}
  }
 }
 for(const o of bindings.records){const v=o.value;if(o.kind==='sheet'&&o.property==='Name'&&typeof v==='string')sheet(o.sheet).name=v;if(o.kind==='range'&&['Value','Value2','Formula','FormulaLocal','FormulaArray'].includes(o.property))cells(o,v,o.property);}
 for(const s of proposal.steps||[]){
  if(s.action==='get')continue;const o=resolve(s);
  if(s.action==='set'&&o?.kind==='range'&&['Value','Value2','Formula','FormulaLocal','FormulaArray'].includes(o.property))cells(o,s.value,o.property,true);
  else unmappedChanges++;
 }
 for(const c of proposal.afterChecks||[]){const o=resolve(c.read);if(o?.kind==='range'&&['Value','Value2'].includes(o.property))cells(o,c.equals,'expectedValue',true);}
 const editTargets=[...sheets.values()].flatMap(s=>[...s.cells.values()].filter(c=>c.observed).map(c=>({id:JSON.stringify([s.id,c.address]),sheetId:s.id,address:c.address})));
 return {editTargets,sheets:[...sheets.values()].map(s=>({...s,cells:[...s.cells.values()].sort((a,b)=>a.row-b.row||a.col-b.col)})).filter(s=>s.cells.length),partial,unmappedChanges,scope:'observed_cells_and_proposed_changes',calculated:false};
}
