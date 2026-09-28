import test from 'node:test';
import assert from 'node:assert/strict';
import {searchContentPages,receiptSummary} from '../worker/content-context.mjs';
const page=(items,offset=0,total=items.length)=>({host:'word',scopeId:'s',documentId:'d',fingerprint:'f',created:false,offset,total,nextOffset:offset+items.length<total?offset+40:null,items});
const data=(n=25)=>new Map([[0,page(Array.from({length:n},(_,i)=>({id:'p-'+i,kind:'paragraph',text:'예산 계획 '+i,notes:'예산 근거 '+i,editable:false})))]]);
function collect(pages,query='예산',field='all'){
  const results=[];let result=searchContentPages(pages,{query,field});
  for(;;){results.push(result);if(result.nextCursor===null)break;result=searchContentPages(pages,{query,field,cursor:result.nextCursor,viewId:result.viewId});}
  return results;
}
test('all ranked item fields beyond the first eight are reachable exactly once',()=>{
  const pages=data(),before=structuredClone(pages),results=collect(pages);
  const matches=results.flatMap(r=>r.matches),ids=matches.map(m=>JSON.stringify([m.itemId,m.field]));
  assert.equal(matches.length,50);assert.equal(new Set(ids).size,50);
  assert.equal(results[0].totalMatches,50);assert.equal(results[0].matchUnit,'item_field');
  assert.equal(results[0].nextCursor,8);assert.equal(results.at(-1).nextCursor,null);
  for(const result of results){assert.ok(result.matches.length<=8);assert.ok(JSON.stringify(result).length<=12000);}
  assert.deepEqual(pages,before);
  for(const match of matches){const source=pages.get(0).items.find(i=>i.id===match.itemId)[match.field];assert.equal(match.excerpt,source.slice(match.textOffset,match.textOffset+240));}
});
test('field filters and receipt summaries preserve search continuation and exact excerpts',()=>{
  for(const field of ['text','notes']){
    const results=collect(data(),'예산',field);assert.equal(results[0].totalMatches,25);
    assert.ok(results.flatMap(r=>r.matches).every(m=>m.field===field));
    assert.deepEqual(receiptSummary(results[0]),results[0]);
  }
  assert.equal(searchContentPages(data(),{query:'예산',field:'title'}).totalMatches,0);
});
test('continuation rejects query, filter, source and captured-page drift',()=>{
  const pages=data(),result=searchContentPages(pages,{query:'예산'}),args={query:'예산',cursor:result.nextCursor,viewId:result.viewId};
  for(const changed of [{query:'계획'},{field:'notes'}])assert.throws(()=>searchContentPages(pages,{...args,...changed}),/source_changed/);
  for(const mutate of [p=>p.get(0).fingerprint='f2',p=>p.get(0).items[0].text='변경',p=>p.set(40,page([{id:'extra',text:'예산'}],40,80))]){
    const copy=structuredClone(pages);mutate(copy);assert.throws(()=>searchContentPages(copy,args),/source_changed|observation_invalid/);
  }
  assert.throws(()=>searchContentPages(pages,{query:'예산',cursor:8}),/document_schema_invalid/);
  assert.throws(()=>searchContentPages(pages,{...args,cursor:999}),/document_schema_invalid/);
});
test('unread pages and incomplete text remain unknown even when every search hit is retrieved',()=>{
  const p=page([{id:'p-1',text:'예산',truncated:true,textLength:8000}],40,80),pages=new Map([[40,p]]);
  const result=collect(pages)[0];assert.equal(result.nextCursor,null);assert.equal(result.allPagesRead,false);assert.equal(result.capturedTextComplete,false);assert.equal(result.partialItemCount,1);
  assert.equal(result.matches[0].sourceTruncated,true);assert.equal(result.matches[0].totalChars,8000);
  const none=searchContentPages(pages,{query:'없음'});assert.equal(none.totalMatches,0);assert.equal(none.allPagesRead,false);assert.equal(none.capturedTextComplete,false);
});
test('truncation metadata and escaping cannot create unbounded tool output',()=>{
  const pages=new Map();
  for(let offset=0;offset<2000;offset+=40)pages.set(offset,page(Array.from({length:40},(_,i)=>({id:'p-'+(offset+i),text:'예산 '+ '\\'.repeat(3997),truncated:true,textLength:9000})),offset,2000));
  const result=searchContentPages(pages,{query:'예산'});assert.equal(result.partialItemCount,2000);assert.equal(result.partialItemIds.length,40);assert.equal(result.partialItemIdsOmitted,1960);assert.ok(JSON.stringify(result).length<=12000);assert.equal(result.totalMatches,2000);
});
test('empty search, punctuation and invalid argument boundaries have explicit results',()=>{
  const empty=searchContentPages(new Map(),{query:'예산'});assert.equal(empty.totalMatches,0);assert.equal(empty.allPagesRead,false);assert.equal(empty.nextCursor,null);
  assert.equal(searchContentPages(data(),{query:'!!!'}).totalMatches,0);
  for(const args of [{query:''},{query:'x',cursor:-1},{query:'x',cursor:0.5},{query:'x',field:'bad'},{query:'x',cursor:10001},{query:'x',cursor:8,viewId:'bad'}])assert.throws(()=>searchContentPages(data(),args),/document_schema_invalid/);
});
