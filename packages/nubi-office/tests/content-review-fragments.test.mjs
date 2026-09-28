import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {contentReviewBatches} from '../worker/content-context.mjs';
import {contentPartitionFindings,partitionedContentReview} from '../worker/content-review.mjs';
const digest=text=>createHash('sha256').update(text).digest('hex');
const response=value=>({content:JSON.stringify(value),calls:[]});
const source=(item,host='word')=>new Map([[0,{host,scopeId:'s',documentId:'d',fingerprint:'version-1',offset:0,total:1,nextOffset:null,created:false,items:[item]}]]);
const all=batches=>batches.flatMap(batch=>batch.items.flatMap(entry=>entry.value.items));
function report(batch){
  const item=batch.items.flatMap(entry=>entry.value.items).find(item=>typeof item.text==='string'||typeof item.notes==='string');
  return{checks:[{requirement:0,status:item?'support':'irrelevant',finding:item?'원문 근거를 확인했습니다.':'',sources:item?[{itemId:item.id,field:typeof item.text==='string'?'text':'notes',quote:(item.text??item.notes).slice(0,80)}]:[]}]};
}
test('hydrated long Word text partitions into immutable bounded exact fragments with original provenance',()=>{
  const text='도입부 '.repeat(2500)+'끝부분 근거 '+'상세 내용 '.repeat(7500),item={id:'p-1',kind:'paragraph',text,textLength:text.length,textHash:digest(text),truncated:false,style:'본문',editable:false};
  const pages=source(item),before=structuredClone(pages),batches=contentReviewBatches(pages,true),items=all(batches),fragments=items.filter(i=>i.kind==='text_fragment');
  assert.ok(batches.length>1);assert.ok(fragments.length>6);assert.deepEqual(pages,before);assert.equal(items[0].id,'p-1');assert.equal(items[0].text,undefined);assert.deepEqual(items[0].fragmentedFields,[{field:'text',length:text.length,fullHash:digest(text)}]);
  assert.equal(new Set(items.map(i=>i.id)).size,items.length);assert.equal(fragments.map(i=>i.text).join(''),text);
  let end=0;for(const fragment of fragments){assert.equal(fragment.start,end);assert.equal(fragment.end,fragment.start+fragment.text.length);assert.equal(fragment.sourceLength,text.length);assert.equal(fragment.fullHash,digest(text));assert.equal(fragment.sourceItemId,item.id);assert.equal(fragment.sourceField,'text');assert.equal(fragment.editable,false);assert.ok(fragment.text.length<=8000);end=fragment.end;}
  assert.equal(end,text.length);assert.ok(batches.every(b=>JSON.stringify(b.items).length<=48000));
  fragments[0].text='changed';assert.equal(pages.get(0).items[0].text,text);
});
test('PowerPoint notes retain their exact field and offset citations beyond the preview',()=>{
  const notes='기초 '.repeat(5000)+'발표자 결정 근거 '+'참고 '.repeat(12000),pages=source({id:'s-1',kind:'slide',notes,notesLength:notes.length,notesHash:digest(notes),notesTruncated:false,name:'중간 보고',editable:false},'powerpoint');
  const batches=contentReviewBatches(pages,true),entry=batches.flatMap(b=>b.items).find(e=>e.value.items[0].kind==='text_fragment'&&e.value.items[0].notes.includes('발표자 결정 근거')),fragment=entry.value.items[0],batch=batches.find(b=>b.items.includes(entry));
  const parsed=contentPartitionFindings(response({checks:[{requirement:0,status:'support',finding:'노트의 근거',sources:[{itemId:fragment.id,field:'notes',quote:'발표자 결정 근거'}]}]}),batch,['노트 확인']).checks[0].sources[0];
  assert.equal(parsed.itemId,'s-1');assert.equal(parsed.fragmentId,fragment.id);assert.equal(parsed.field,'notes');assert.equal(parsed.offset,notes.indexOf('발표자 결정 근거'));assert.equal(parsed.end,parsed.offset+'발표자 결정 근거'.length);assert.equal(parsed.fullHash,digest(notes));assert.equal(parsed.fingerprint,'version-1');
});
test('review fragments preserve Unicode, escaped JSON and UTF-16 offsets under a small serialized budget',()=>{
  const text=('가"\\\n😀끝').repeat(1400),pages=source({id:'p-1',kind:'paragraph',text,truncated:false,textLength:text.length});
  const batches=contentReviewBatches(pages,true,2048),fragments=all(batches).filter(i=>i.kind==='text_fragment');
  assert.equal(fragments.map(i=>i.text).join(''),text);assert.ok(batches.every(b=>JSON.stringify(b.items).length<=2048));for(const i of fragments)assert.equal(text.slice(i.start,i.end),i.text);
});
test('incomplete, mismatched hash and oversized non-text metadata cannot be hidden by fragmenting',()=>{
  const text='내용'.repeat(30000);
  for(const override of [{truncated:true,textLength:text.length+1},{textHash:'a'.repeat(64)},{oversized:'x'.repeat(48000)}]){
    const pages=source({id:'p-1',kind:'paragraph',text,truncated:false,textLength:text.length,...override});assert.throws(()=>contentReviewBatches(pages,true),/evidence_incomplete|observation_invalid|evidence_limit/);
  }
  assert.throws(()=>contentReviewBatches(source({id:'p-1',kind:'paragraph',text:'x'.repeat(200000)}),true,1024),/evidence_limit/);
});
test('invented quotes, wrong fragment fields and damaged fragment offsets fail provenance checks',()=>{
  const pages=source({id:'p-1',kind:'paragraph',text:'원문 '.repeat(20000)}),batches=contentReviewBatches(pages,true),batch=batches[0],original=all([batch]).find(i=>i.kind==='text_fragment');
  for(const defect of ['quote','field','offset']){
    const copy=structuredClone(batch),fragment=all([copy]).find(i=>i.id===original.id),ref={itemId:fragment.id,field:'text',quote:fragment.text.slice(0,50)};
    if(defect==='quote')ref.quote='없는 근거';if(defect==='field')ref.field='notes';if(defect==='offset')fragment.end++;
    assert.throws(()=>contentPartitionFindings(response({checks:[{requirement:0,status:'support',finding:'근거',sources:[ref]}]}),copy,['요건']),/goal_review_failed/);
  }
});
test('partition review reports native item count separately from fragment count and retains canonical quotes',async()=>{
  const pages=source({id:'p-1',kind:'paragraph',text:'고유 근거 '.repeat(10000)}),batches=contentReviewBatches(pages,true);let reduction;
  const verdict=await partitionedContentReview({host:'word',batches,task:{requirements:['문서 내용 확인']},whole:true,context:{},metrics:{},activity:{start:()=>({}),end:()=>{}},checkSource:async()=>{},structured:async(make,parse)=>{
    const packet=JSON.parse(make('')[1].content);if(packet.batch)return parse(response(report(packet.batch)));
    reduction=packet;return parse(response({status:'complete',checks:[{requirement:0,status:'met',evidence:packet.evidence.map(e=>e.id)}],feedback:''}));
  }});
  assert.equal(verdict.status,'complete');assert.equal(verdict.coverage.items,1);assert.equal(verdict.coverage.fragments,all(batches).filter(i=>i.kind==='text_fragment').length);assert.equal(verdict.coverage.fingerprint,'version-1');assert.ok(reduction.evidence.flatMap(e=>e.value.sources).every(c=>c.itemId==='p-1'&&c.fullHash));
});
test('a hydrated field over 8K uses small fragments even below the overall partition budget',()=>{
  const text='내용 '.repeat(4000),batches=contentReviewBatches(source({id:'p-1',kind:'paragraph',text}),true),fragments=all(batches).filter(item=>item.kind==='text_fragment');
  assert.equal(fragments.length,2);assert.ok(fragments.every(item=>item.text.length<=8000));assert.equal(fragments.map(item=>item.text).join(''),text);
});
