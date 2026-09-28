import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {contentWindow,contentEvidence,receiptSummary,CONTENT_WINDOW_CHARS,CONTENT_REVIEW_CHARS} from '../worker/content-context.mjs';
import {contentStepReview,contentReview,contentOperation,contentObservation} from '../worker/content-schema.mjs';

const page=(offset=0,total=40)=>({host:'word',scopeId:'s',documentId:'d',fingerprint:'f',created:false,offset,total,nextOffset:offset+40<total?offset+40:null,items:Array.from({length:Math.min(40,total-offset)},(_,i)=>({id:'p-'+(offset+i),kind:'paragraph',text:'본문 '+(offset+i),editable:false}))});
const encoded=value=>({content:JSON.stringify(value)});
test('context window retrieves omitted exact text without mutating evidence or importing other page bodies',()=>{
  const current=page(0,80),other=page(40,80);current.items.forEach(i=>i.text='본문'.repeat(1800));other.items[0].text='PRIVATE_OTHER_PAGE';
  const pages=new Map([[0,current],[40,other]]),before=structuredClone(current),view=contentWindow(pages,current);
  assert.ok(view.currentDocument.omittedItemIds.length);assert.ok(JSON.stringify(view).length<CONTENT_WINDOW_CHARS+3000);
  assert.equal(JSON.stringify(view).includes('PRIVATE_OTHER_PAGE'),false);
  const id=view.currentDocument.omittedItemIds.at(-1),focused=contentWindow(pages,current,[id]);
  assert.equal(focused.currentDocument.items[0].id,id);assert.equal(focused.currentDocument.items[0].text,current.items.find(i=>i.id===id).text);
  assert.deepEqual(current,before);assert.deepEqual(view.documentIndex.map(i=>i.offset),[0,40]);
});
test('fast-check: visibility and omissions partition every exact native item',()=>{
  fc.assert(fc.property(fc.array(fc.string({minLength:0,maxLength:4000}),{minLength:1,maxLength:40}),fc.integer({min:200,max:5000}),(texts,budget)=>{
    const current=page(0,texts.length);current.items=texts.map((text,i)=>({id:'p-'+i,text,editable:i%2===0}));
    const original=structuredClone(current),view=contentWindow(new Map([[0,current]]),current,[],budget).currentDocument;
    assert.deepEqual([...view.items.map(i=>i.id),...view.omittedItemIds].sort(),current.items.map(i=>i.id).sort());
    for(const item of view.items)assert.deepEqual(item,current.items.find(i=>i.id===item.id));
    assert.deepEqual(current,original);
  }),{seed:231016,numRuns:100});
});
test('full review rejects missing, duplicate, stale and oversized evidence instead of silently summarizing it',()=>{
  const a=page(0,80),b=page(40,80),pages=new Map([[0,a],[40,b]]);
  assert.equal(contentEvidence(pages,true).length,2);
  assert.throws(()=>contentEvidence(new Map([[40,b]]),true),/observation_invalid/);
  assert.throws(()=>contentEvidence(new Map([[0,a],[40,{...b,fingerprint:'changed'}]]),true),/observation_invalid/);
  assert.throws(()=>contentEvidence(new Map([[0,a],[40,{...b,items:[a.items[0],...b.items.slice(1)]}]]),true),/observation_invalid/);
  a.items[0].text='x'.repeat(CONTENT_REVIEW_CHARS);assert.throws(()=>contentEvidence(pages,true),/evidence_limit/);
});
test('inspection completion is a step verdict and cannot count as a final requirement verdict',()=>{
  const step={status:'complete',checks:[{criterion:'원본과 대상 확인',status:'met',evidence:[1]}],feedback:''},evidence=[{id:1}];
  assert.equal(contentStepReview(encoded(step),evidence).scope,'step');
  assert.throws(()=>contentReview(encoded(step),{requirements:['보고서 전체 작성']},evidence,null),/goal_review_failed/);
  assert.throws(()=>contentStepReview(encoded({...step,checks:[{...step.checks[0],evidence:[999]}]}),evidence),/goal_review_failed/);
});
test('Word field filling requires a confirmed safe native field and cannot use the paragraph bypass',()=>{
  const field={id:'cc-42',kind:'field',controlType:1,editable:true,mapped:false,locked:false,temporary:false,nested:false},op={type:'fill_field',targetId:'cc-42',text:'사업부 A'};
  assert.deepEqual(contentOperation('word',op,{items:[field]}),op);
  for(const key of ['mapped','locked','temporary','nested'])assert.throws(()=>contentOperation('word',op,{items:[{...field,[key]:true}]}),/unsupported_target/);
  assert.throws(()=>contentOperation('word',{...op,type:'replace_text'},{items:[field]}),/unsupported_target/);
  assert.throws(()=>contentOperation('powerpoint',op,{items:[field]}),/unsupported_operation/);
  assert.throws(()=>contentOperation('word',op,{items:[{...field,editable:false}]}),/unsupported_target/);
});
test('invalid pagination cannot claim full coverage or repeat an empty page forever',()=>{
  for(const value of [{...page(),items:[],nextOffset:0},{...page(),items:[page().items[0]],nextOffset:null},{...page(),items:[page().items[0],...page().items.slice(0,39)]}])assert.throws(()=>contentObservation(value,'word','s','d'),/observation_invalid/);
});
test('receipts carry navigation and verification instead of duplicating the raw document body',()=>{
  const snapshot=page(),summary=receiptSummary({verified:true,snapshot,targetId:'p-0'});
  assert.equal(summary.verified,true);assert.equal(summary.snapshot.offset,0);assert.equal(summary.snapshot.items,undefined);
  assert.equal(receiptSummary(snapshot).items,undefined);assert.deepEqual(receiptSummary(snapshot).itemIds,snapshot.items.map(i=>i.id));
});

test('partial Word text cannot become complete-document evidence',()=>{
  const current=page(0,1);current.items[0]={...current.items[0],text:'앞부분',truncated:true,textLength:5000};
  const pages=new Map([[0,current]]);
  assert.equal(contentEvidence(pages,false).length,1);
  assert.throws(()=>contentEvidence(pages,true),/evidence_incomplete/);
});

test('legacy boundary fields remain unknown while explicit complete text remains usable',()=>{
  const current=page(0,1),value='가'.repeat(4000);
  current.items=[{id:'cc-1',kind:'field',text:value,editable:false}];
  const pages=new Map([[0,current]]);
  assert.throws(()=>contentEvidence(pages,true),/evidence_incomplete/);
  current.items[0].truncated=false;current.items[0].textLength=4000;
  assert.equal(contentEvidence(pages,true).length,1);
  current.items[0].text='가'.repeat(3999);delete current.items[0].textLength;delete current.items[0].truncated;
  assert.equal(contentEvidence(pages,true).length,1);
});
test('native text completeness metadata rejects inconsistent lengths and flags',()=>{
  for(const metadata of [{truncated:'false'},{textLength:-1},{textLength:2},{textLength:NaN},{textLength:3.5},{truncated:false,textLength:10},{truncated:true,textLength:3}]){
    const current=page(0,1);current.items=[{id:'p-1',text:'abc',...metadata}];
    assert.throws(()=>contentObservation(current,'word','s','d'),/observation_invalid/);
  }
  for(const metadata of [{},{truncated:false,textLength:3},{truncated:true,textLength:10},{textLength:10}]){
    const current=page(0,1);current.items=[{id:'p-1',text:'abc',...metadata}];assert.equal(contentObservation(current,'word','s','d'),current);
  }
});
