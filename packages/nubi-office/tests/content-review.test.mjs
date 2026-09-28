import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {contentEvidence,contentReviewBatches} from '../worker/content-context.mjs';
import {contentPartitionFindings,partitionedContentReview} from '../worker/content-review.mjs';

const response=value=>({content:JSON.stringify(value),calls:[]});
function pages(count=200){
  const items=Array.from({length:count},(_,i)=>({id:`p${i}`,kind:'paragraph',text:`항목 ${i}: `+'보고 내용 '.repeat(180),editable:false}));
  return new Map(Array.from({length:Math.ceil(count/40)},(_,i)=>{const offset=i*40;return[offset,{host:'word',scopeId:'s',documentId:'d',fingerprint:'f',total:count,offset,nextOffset:offset+40<count?offset+40:null,items:items.slice(offset,offset+40)}];}));
}
function findings(batch,status='support',requirements=['본문 확인']){
  const item=batch.items[0].value.items[0];
  return {checks:requirements.map((_,requirement)=>({requirement,status,finding:status==='irrelevant'?'':'검토한 내용',sources:['support','conflict'].includes(status)?[{itemId:item.id,field:'text',quote:item.text.slice(0,100)}]:[]}))};
}
test('large review partitions preserve every native item exactly and stay within the serialized budget',()=>{
  const source=pages();assert.throws(()=>contentEvidence(source,true),/evidence_limit/);
  const batches=contentReviewBatches(source,true),original=[...source.values()].flatMap(p=>p.items);
  assert.ok(batches.length>1);
  assert.deepEqual(batches.flatMap(b=>b.items.flatMap(e=>e.value.items)),original);
  for(const batch of batches){assert.ok(JSON.stringify(batch.items).length<=48000);assert.ok(batch.items.every(e=>e.partialPage));}
  batches[0].items[0].value.items[0].text='mutated';assert.notEqual(original[0].text,'mutated');
});
test('partitioning rejects incomplete, duplicated, changed and oversized evidence before model dispatch',()=>{
  for(const defect of ['missing','duplicate','changed','truncated','large']){
    const source=pages();
    if(defect==='missing')source.delete(40);
    if(defect==='duplicate')source.get(40).items[0].id='p0';
    if(defect==='changed')source.get(40).fingerprint='different';
    if(defect==='truncated')source.get(40).items[0].truncated=true;
    if(defect==='large')source.get(40).items[0].unsupportedMetadata='x'.repeat(48000);
    assert.throws(()=>contentReviewBatches(source,true),/observation_invalid|evidence_incomplete|evidence_limit/);
  }
});
test('partition findings require every requirement once and exact quotes from assigned fields',()=>{
  const batch=contentReviewBatches(pages(40),true)[0],requirements=['본문','양식'];
  for(const defect of ['missing','duplicate','foreign','quote','field','empty','null']){
    const value=findings(batch,'support',requirements);
    if(defect==='missing')value.checks.pop();
    if(defect==='duplicate')value.checks[1].requirement=0;
    if(defect==='foreign')value.checks[0].sources[0].itemId='foreign';
    if(defect==='quote')value.checks[0].sources[0].quote='invented evidence';
    if(defect==='field')value.checks[0].sources[0].field='__proto__';
    if(defect==='empty')value.checks[0].sources=[];
    if(defect==='null')value.checks[0]=null;
    assert.throws(()=>contentPartitionFindings(response(value),batch,requirements),/goal_review_failed/);
  }
});
for(const status of ['support','conflict','unknown','irrelevant','reducer_revision'])test(`partition reduction cannot erase ${status} evidence`,async()=>{
  const batches=contentReviewBatches(pages(80),true),metrics={},calls=[],progress=[];
  const result=await partitionedContentReview({host:'word',batches,task:{requirements:['본문 확인']},whole:true,context:{request:'원래 요청'},metrics,
    activity:{start:()=>({}),end:()=>{}},checkSource:async()=>{calls.push('source');},onProgress:key=>progress.push(key),
    structured:async(make,parse)=>{
      const messages=make(''),payload=JSON.parse(messages[1].content);assert.equal(payload.context.request,'원래 요청');
      if(payload.batch)return parse(response(findings(payload.batch,status==='reducer_revision'?'support':status)));
      assert.equal(payload.evidence.length,batches.length);
      return parse(response({status:status==='reducer_revision'?'revise':'complete',checks:[{requirement:0,status:'met',evidence:[1]}],feedback:status==='reducer_revision'?'표 합계의 근거를 추가로 확인해야 합니다.':''}));
    }});
  assert.equal(result.status,status==='support'?'complete':'revise');
  assert.equal(calls.length,batches.length+1);assert.equal(new Set(progress).size,progress.length);
  assert.equal(result.coverage.items,80);assert.equal(result.coverage.fingerprint,'f');
});
test('a source change aborts partition review without reducing or marking the document complete',async()=>{
  let calls=0;
  await assert.rejects(partitionedContentReview({host:'word',batches:contentReviewBatches(pages(),true),task:{requirements:['본문 확인']},whole:true,context:{},metrics:{},
    activity:{start:()=>({}),end:()=>{}},checkSource:async()=>{throw new Error('source_changed');},
    structured:async(make,parse)=>{calls++;return parse(response(findings(JSON.parse(make('')[1].content).batch)));}}),/source_changed/);
  assert.equal(calls,1);
});
test('Unicode and escaping survive native-item partition boundaries without omissions',()=>{
  fc.assert(fc.property(fc.array(fc.string({minLength:1,maxLength:800}),{minLength:1,maxLength:40}),texts=>{
    const source=pages(texts.length);source.get(0).items.forEach((item,i)=>{item.text=texts[i];});
    const batches=contentReviewBatches(source,true,8192);
    assert.deepEqual(batches.flatMap(b=>b.items.flatMap(e=>e.value.items.map(item=>item.text))),texts);
    assert.ok(batches.every(b=>JSON.stringify(b.items).length<=8192));
  }),{seed:9252026,numRuns:100});
});
