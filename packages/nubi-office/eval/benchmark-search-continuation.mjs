// Deterministic retrieval coverage, not model accuracy or competitor performance.
import {createHash} from 'node:crypto';
import {searchContentPages} from '../worker/content-context.mjs';
const cases=[];
for(const host of ['word','powerpoint'])for(const count of [25,80,200]){
  const items=Array.from({length:count},(_,i)=>({id:`item-${i}`,kind:host==='word'?'paragraph':'shape',text:`예산 계획 ${i}`,notes:`예산 근거 ${i}`,editable:false}));
  const pages=new Map();for(let offset=0;offset<count;offset+=40)pages.set(offset,{host,scopeId:'s',documentId:'d',fingerprint:'fixture',created:false,total:count,offset,nextOffset:offset+40<count?offset+40:null,items:items.slice(offset,offset+40)});
  let result=searchContentPages(pages,{query:'예산'});const hits=[],responses=[];
  for(;;){responses.push(result);hits.push(...result.matches);if(result.nextCursor===null)break;result=searchContentPages(pages,{query:'예산',cursor:result.nextCursor,viewId:result.viewId});}
  const keys=hits.map(h=>JSON.stringify([h.itemId,h.field]));const expected=items.flatMap(i=>['text','notes'].map(f=>JSON.stringify([i.id,f])));
  if(keys.length!==expected.length||JSON.stringify([...new Set(keys)].sort())!==JSON.stringify(expected.sort()))throw new Error('retrieval_coverage_failed');
  for(const h of hits){const raw=items.find(i=>i.id===h.itemId)[h.field];if(h.excerpt!==raw.slice(h.textOffset,h.textOffset+240))throw new Error('excerpt_mismatch');}
  cases.push({host,items:count,matchingFields:expected.length,legacyTopEightPolicyReachable:Math.min(8,expected.length),paginatedReachable:keys.length,duplicateMatches:keys.length-new Set(keys).size,pages:responses.length,maxResponseChars:Math.max(...responses.map(r=>JSON.stringify(r).length)),allExcerptsExact:true,fixtureSha256:createHash('sha256').update(JSON.stringify([...pages])).digest('hex')});
}
console.log(JSON.stringify({kind:'deterministic-search-retrieval-coverage',baseline:'Previous source policy: first 8 item-field matches with no continuation',candidate:'MiniSearch ranked results with source-bound continuation',notMeasured:['real model accuracy','Office 2016 performance','competitor runtime quality','all phrase occurrences'],cases},null,2));
