import test from 'node:test';
import assert from 'node:assert/strict';
import {delegateWikiQuestion} from '../openwiki-agent.js';

async function research({mode='focused',large=false}={}){
 const docs=['rule','exception','date'].map((id,i)=>({id,kind:'wiki',path:id+'.md',title:id,text:(i===0&&large?'x'.repeat(25000):id+' applies.'),version:'1'}));
 const assignments=new Map();
 const complete=async(messages,tools,scope)=>{
  const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const data=JSON.parse(messages.find(m=>m.role==='user').content);
  if(system.includes('Plan OpenWiki research'))return {content:JSON.stringify({mode,questions:['Apply the rule','Check the exception','Check the date']})};
  if(system.includes('Synthesize')){
   const rows=data.evidence||[];
   return {content:JSON.stringify({status:rows.length?'complete':'blocked',answer:'Combined result',findings:rows.slice(0,3).map(r=>({text:'Observed',citations:[r.id]})),uncertainties:[]})};
  }
  if(!data.assignment)throw Error('unexpected_repair');
  assignments.set(JSON.stringify(data.assignment),data.assignment);
  const reads=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).filter(r=>r.id);
  const id=data.assignment.documentIds.find(id=>!reads.some(r=>r.documentId===id));
  if(id)return {content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name:'read_wiki',arguments:JSON.stringify({documentId:id,start:data.assignment.range?.start||0,length:6000})}}]};
  return {content:JSON.stringify({status:'complete',answer:'Observed rule and exceptions',findings:reads.slice(0,3).map(r=>({text:'Observed',citations:[r.id]})),uncertainties:[]})};
 };
 const result=await delegateWikiQuestion({wiki:'external',question:'Determine eligibility using the rule, exception and date.'},{modelId:'fixture',signal:new AbortController().signal,execute:async()=>({wikiId:'external:test',sourceComplete:true,documents:docs}),complete});
 return {result,assignments:[...assignments.values()]};
}
test('small focused research combines dependent aspects without losing source citations',async()=>{
 const {result,assignments}=await research();
 assert.equal(assignments.length,1);assert.equal(result.coverage.tasks,1);assert.equal(result.status,'complete');
 assert.deepEqual(new Set(result.evidence.map(r=>r.documentId)),new Set(['rule','exception','date']));
 for(const text of ['Determine eligibility','Apply the rule','Check the exception','Check the date'])assert.ok(assignments[0].question.includes(text));
});
test('explicit comprehensive review retains independent full-range coverage',async()=>{
 const {result,assignments}=await research({mode:'comprehensive'});
 assert.equal(assignments.length,3);assert.equal(result.coverage.mode,'comprehensive');assert.equal(result.coverage.unreadRanges.length,0);
 assert.ok(assignments.every(a=>a.range&&a.documentIds.length===1));
});
test('large focused corpora retain the planned independent questions',async()=>{
 const {assignments}=await research({large:true});assert.equal(assignments.length,3);
 assert.deepEqual(assignments.map(a=>a.question),['Apply the rule','Check the exception','Check the date']);
});
