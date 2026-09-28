// Deterministic observation-payload comparison, not live LLM or Office quality.
import {createHash} from 'node:crypto';
import {inspectDocumentStructure} from '../worker/content-structure.mjs';
const cases=[];
for(const host of ['word','powerpoint'])for(const count of [40,80,200]){
  const items=Array.from({length:count},(_,i)=>host==='word'?{id:'p-'+i,kind:'paragraph',text:`항목 ${i}: `+'실제 관찰 본문 '.repeat(350),outlineLevel:i%10===0?1:10,editable:i%4===0,truncated:false}:{id:'s-1/h-'+i,kind:'shape',slideId:'s-1',name:'도형 '+i,text:`항목 ${i}: `+'실제 관찰 본문 '.repeat(350),editable:false,overflow:i%25===0});
  const pages=new Map();for(let offset=0;offset<count;offset+=40)pages.set(offset,{host,scopeId:'scope',documentId:'document',fingerprint:'fixture',created:false,total:count,offset,nextOffset:offset+40<count?offset+40:null,items:items.slice(offset,offset+40)});
  const results=[];let result=inspectDocumentStructure(pages,{filter:'all'});
  for(;;){results.push(result);if(result.nextCursor===null)break;result=inspectDocumentStructure(pages,{filter:'all',cursor:result.nextCursor,viewId:result.viewId});}
  const ids=results.flatMap(r=>r.items.map(i=>i.itemId));if(JSON.stringify(ids)!==JSON.stringify(items.map(i=>i.id)))throw new Error('benchmark_coverage_failed');
  const baselineChars=JSON.stringify([...pages.values()]).length,structureChars=JSON.stringify(results).length;
  const partial=new Map(pages);if(count>40)partial.delete(0);
  const partialResult=inspectDocumentStructure(partial,{filter:'all'});if(count>40&&partialResult.coverage.allItemsRead)throw new Error('benchmark_missing_page_failed');
  cases.push({host,nativeItems:count,baselineChars,structureChars,reductionPercent:Math.round((1-structureChars/baselineChars)*1000)/10,allAnchorsPreserved:true,missingPagesRemainUnknown:count>40,fixtureHash:createHash('sha256').update(JSON.stringify([...pages])).digest('hex')});
}
console.log(JSON.stringify({kind:'deterministic-source-observation-payload',baseline:'Raw captured native pages',candidate:'All entries from paginated structure map',purpose:'Locate structural anchors before deliberate full-content retrieval',notMeasured:['model accuracy','Qwen token counts','Office COM latency','NASCA','competitor runtime performance'],cases},null,2));
