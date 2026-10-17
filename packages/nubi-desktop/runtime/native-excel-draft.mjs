import {nativeExcelPreview} from './native-excel-preview.mjs';
import {nativeExcelBindings} from './native-excel-bindings.mjs';
import {calculateNativeExcelDraft} from './native-excel-calculation.mjs';
import {hash,fail} from './files.mjs';
const sig=s=>JSON.stringify([s.target??'document',s.member,s.args??[]]);
const cellRead=(id,address,property)=>({action:'get',member:'Worksheets.Item.Range.'+property,args:[id,address]});
export function excelDraftChanges(observation,base,changes){
 if(!Array.isArray(changes)||!changes.length||changes.length>100)fail('native_office_draft_invalid');
 const targets=new Map(nativeExcelPreview(observation,base).editTargets.map(t=>[t.id,t])),seen=new Set();
 return changes.map(c=>{if(!c||Object.keys(c).some(k=>!['id','kind','value'].includes(k))||seen.has(c.id)||!['value','formula'].includes(c.kind))fail('native_office_draft_invalid');seen.add(c.id);const target=targets.get(c.id);if(!target)fail('native_office_draft_target_changed');
  let value=c.value;if(c.kind==='formula'){if(typeof value!=='string'||!value.startsWith('=')||value.length>8192||value.startsWith('=='))fail('native_excel_formula_invalid');}
  else if(value!==null&&!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>16000)fail('native_office_draft_value_invalid');
  // A value beginning with = must never silently become executable Formula.
  if(c.kind==='value'&&typeof value==='string'&&/^[=+\-@]/.test(value))fail('native_excel_value_requires_text_format');
  return {...target,kind:c.kind,value};
 });
}
export function excelDraftReads(observation,base,changes){
 const edits=excelDraftChanges(observation,base,changes),steps=structuredClone(observation.steps),keys=new Set(steps.map(sig)),add=step=>{for(const k of Object.keys(step))if(step[k]===undefined)delete step[k];if(!keys.has(sig(step))){steps.push(step);keys.add(sig(step));}};
 for(const o of nativeExcelBindings(observation).records){
  if(o.kind!=='range'||!['Value','Value2','Formula'].includes(o.property))continue;
  add({...o.step,action:'get',member:o.step.member.replace(/(?:Value2?|Formula)$/,'Formula'),id:undefined});
  add({...o.step,action:'get',member:o.step.member.replace(/(?:Value2?|Formula)$/,'Value2'),id:undefined});
 }
 const sheetIds=new Set(nativeExcelPreview(observation,base).sheets.map(s=>s.id));
 for(const id of sheetIds)add({action:'get',member:'Worksheets.Item.Name',args:[id]});
 for(const e of edits)for(const property of ['Value2','Formula'])add(cellRead(e.sheetId,e.address,property));
 if(steps.length>100)fail('native_office_approval_limit');return steps;
}
export async function buildNativeExcelDraft(observation,base,changes,signal){
 const edits=excelDraftChanges(observation,base,changes),args=structuredClone(base),bindings=nativeExcelBindings(observation);
 for(const e of edits){const read=cellRead(e.sheetId,e.address,e.kind==='formula'?'Formula':'Value2'),cell=bindings.resolve(read),overlap=args.steps.filter(s=>{const o=bindings.resolve(s);return s.action==='set'&&o?.kind==='range'&&o.sheet===e.sheetId&&cell.range.r1>=o.range.r1&&cell.range.r1<=o.range.r2&&cell.range.c1>=o.range.c1&&cell.range.c1<=o.range.c2;});
  if(overlap.some(s=>{const r=bindings.resolve(s).range;return r.r1!==r.r2||r.c1!==r.c2;}))fail('native_excel_overlapping_range_write');
  if(overlap.length){for(const step of overlap){const old=sig(step);step.member=step.member.replace(/(?:Value2?|Formula)$/,e.kind==='formula'?'Formula':'Value2');step.value=e.value;for(const check of args.checks)if(sig(check.read)===old){check.read.member=step.member;check.equals=e.value;}}}else args.steps.push({...read,action:'set',value:e.value});
 }
 for(const o of bindings.records){if(o.kind==='range'&&(o.range.r2-o.range.r1+1)*(o.range.c2-o.range.c1+1)>12000)fail('native_excel_snapshot_limit');}
 const snapshot=nativeExcelPreview(observation,{steps:args.steps},{maxRows:12000,maxCols:12000,maxCells:12000});if(snapshot.partial)fail('native_excel_snapshot_limit');
 if(args.steps.some(s=>s.action!=='get'&&(s.action!=='set'||!['Value','Value2','Formula'].includes(bindings.resolve(s)?.property))))fail('native_excel_draft_operation_unsupported');
 if(snapshot.sheets.reduce((n,s)=>n+s.cells.length,0)>12000)fail('native_excel_snapshot_limit');
 for(const sheet of snapshot.sheets)sheet.cells=sheet.cells.filter(c=>c.observed);
 const calculation=await calculateNativeExcelDraft(snapshot.sheets,{signal}),calculated=new Map(calculation.values.map(v=>[JSON.stringify([v.sheetId,v.address]),v.value]));
 const sheets=new Map(snapshot.sheets.map(s=>[s.id,new Map(s.cells.map(c=>[`${c.row}:${c.col}`,c]))]));
 function readValue(read,calculatedValue=false){const o=bindings.resolve(read);if(o?.kind!=='range'||!['Value','Value2','Formula'].includes(o.property))return {known:false};const {r1,r2,c1,c2}=o.range,sh=sheets.get(o.sheet);if((r2-r1+1)*(c2-c1+1)>12000)fail('native_excel_snapshot_limit');const rows=[];
  for(let row=r1;row<=r2;row++){const values=[];for(let col=c1;col<=c2;col++){const c=sh?.get(`${row}:${col}`);if(!c)return {known:false};values.push(o.property==='Formula'?c.formula??c.value??null:calculatedValue&&c.formula?calculated.get(JSON.stringify([o.sheet,c.address])):c.value??null);}rows.push(values);}return {known:true,value:r1===r2&&c1===c2?rows[0][0]:rows};
 }
 // All set checks describe the final candidate, including a cell addressed via
 // a prior handle and then overridden through its exact observed cell selector.
 const mutators=new Set(args.steps.filter(s=>s.action==='set').map(sig));
 for(const check of args.checks){if(mutators.has(sig(check.read))){const v=readValue(check.read);if(!v.known)fail('native_excel_check_unobserved');check.equals=v.value;}}
 for(const s of args.steps.filter(s=>s.action==='set')){const read={...s,action:'get'};delete read.value;delete read.id;const v=readValue(read);if(!v.known)fail('native_excel_check_unobserved');const c=args.checks.find(c=>sig(c.read)===sig(read));if(c)c.equals=v.value;else args.checks.push({read,equals:v.value});}
 for(const check of args.afterChecks||[]){const v=readValue(check.read,true);if(v.known)check.equals=v.value;else fail('native_excel_check_unobserved');}
 args.afterChecks ||= [];
 for(const s of args.steps.filter(s=>s.action==='set'&&/Formula$/.test(s.member))){const read={...s,action:'get',member:s.member.replace(/Formula$/,'Value2')};delete read.value;delete read.id;const v=readValue(read,true);if(!v.known)fail('native_excel_check_unobserved');const existing=args.afterChecks.find(c=>sig(c.read)===sig(read));if(existing)existing.equals=v.value;else args.afterChecks.push({read,equals:v.value});}
 for(const v of calculation.values){const read=cellRead(v.sheetId,v.address,'Value2');if(!args.afterChecks.some(c=>sig(c.read)===sig(read)))args.afterChecks.push({read,equals:v.value});}
 // Preservation checks that are not writes must remain requirements, not be
 // rewritten to bless an accidental collateral change.
 for(const check of args.checks)if(!mutators.has(sig(check.read))){const v=readValue(check.read,true);if(v.known&&JSON.stringify(v.value)!==JSON.stringify(check.equals))fail('native_excel_preservation_conflict');}
 if(args.steps.length>100||args.checks.length>100||args.afterChecks.length>100||JSON.stringify(args).length>39000)fail('native_office_approval_limit');
 return {args,hash:hash(JSON.stringify(args)),calculation:{...calculation,values:calculation.values}};
}
