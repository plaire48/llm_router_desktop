// Reproducible draft packet size and exact-retrieval checks; not model quality.
import {createHash} from 'node:crypto';
import {draftWindow,readDraft} from '../worker/document-context.mjs';
import {normalizeSheet} from '../worker/document-schema.mjs';
const cases=[];
for(const count of [16,40,100]){
  const cells=Array.from({length:count},(_,i)=>({address:'A'+(i+1),value:('항목 '+i+' ').repeat(Math.floor(45000/count/7))}));
  const source=normalizeSheet({name:'보고',address:'A1:A'+count,cells,formats:[{address:'A1:A'+count,style:{wrapText:true}}]}, {name:'보고'},['보고']);
  const before=JSON.stringify(source),view=draftWindow(source,['A'+count]);
  const visible=new Map(view.cells.map(c=>[c.address,c]));
  for(const address of view.draftView?.omittedCellAddresses??[])visible.set(address,readDraft({sheet:'보고',address,viewId:view.draftView.viewId},[],source).cells[0]);
  if(source.cells.some(c=>JSON.stringify(c)!==JSON.stringify(visible.get(c.address)))||JSON.stringify(source)!==before)throw new Error('draft_preservation_failed');
  const after=JSON.stringify(view);
  cases.push({cells:count,rawChars:before.length,windowChars:after.length,reductionPercent:Math.round((1-after.length/before.length)*1000)/10,omittedCells:view.draftView?.omittedCellAddresses.length??0,allCellsExactlyRetrievable:true,rawDraftUnchanged:true,fixtureSha256:createHash('sha256').update(before).digest('hex')});
}
console.log(JSON.stringify({kind:'deterministic-current-draft-context',budgetChars:24000,notMeasured:['total request token reduction','Qwen accuracy','Office COM performance','competitor runtime quality'],cases},null,2));
