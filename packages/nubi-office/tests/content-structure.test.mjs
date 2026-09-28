import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDocumentStructure} from '../worker/content-structure.mjs';
const item=(i)=>({id:'p-'+i,kind:'paragraph',text:'제목 '+i+' '+('본문 '.repeat(500)),outlineLevel:i%10===0?1:10,editable:i%3===0,inTable:i%5===0,truncated:false});
function fixture(count=80,host='word'){
  const items=Array.from({length:count},(_,i)=>item(i)),pages=new Map();
  for(let offset=0;offset<count||offset===0;offset+=40)pages.set(offset,{host,scopeId:'s',documentId:'d',fingerprint:'f',created:false,total:count,offset,nextOffset:offset+40<count?offset+40:null,items:items.slice(offset,offset+40)});
  return{pages,items};
}
test('structure map preserves original anchors and distinguishes table paragraphs from actual tables',()=>{
  const {pages,items}=fixture(),r=inspectDocumentStructure(pages);
  assert.equal(r.items.length,8);assert.deepEqual(r.items.map(i=>i.itemId),items.filter(i=>i.outlineLevel===1).map(i=>i.id));assert.equal(r.coverage.allItemsRead,true);assert.equal(r.counts.tableParagraphs,16);assert.equal(r.counts.paragraphs,80);assert.equal(r.counts.tables,undefined);
  assert.equal(r.items[4].pageOffset,40);assert.equal(r.items[0].label.length,120);assert.equal(r.items[0].labelTruncated,true);assert.equal(r.items[0].text,undefined);assert.ok(JSON.stringify(r).length<14000);assert.equal(items[0].text.length>120,true);
});
test('all-entry cursor pages retain every item exactly once and bind the observed index',()=>{
  const {pages,items}=fixture(105),seen=[];let r=inspectDocumentStructure(pages,{filter:'all'});
  for(;;){seen.push(...r.items.map(i=>i.itemId));if(r.nextCursor===null)break;r=inspectDocumentStructure(pages,{filter:'all',cursor:r.nextCursor,viewId:r.viewId});}
  assert.deepEqual(seen,items.map(i=>i.id));assert.throws(()=>inspectDocumentStructure(pages,{filter:'all',cursor:40}),/tool_arguments_invalid/);
  assert.throws(()=>inspectDocumentStructure(pages,{filter:'landmarks',viewId:r.viewId}),/source_changed/);
});
test('missing pages and truncated notes cannot be represented as complete document knowledge',()=>{
  const {pages}=fixture();pages.delete(0);let r=inspectDocumentStructure(pages);assert.deepEqual(r.coverage.missingPageOffsets,[0]);assert.equal(r.coverage.allItemsRead,false);assert.equal(r.coverage.observedItems,40);
  const ppt=fixture(1,'powerpoint');ppt.pages.get(0).items=[{id:'s-1',kind:'slide',index:1,layout:'제목',notes:'앞',truncated:true,notesTruncated:true,notesLength:10000,editable:false}];
  r=inspectDocumentStructure(ppt.pages,{filter:'issues'});assert.equal(r.coverage.allItemsRead,true);assert.equal(r.coverage.capturedTextComplete,false);assert.deepEqual(r.items[0].issues,['text_incomplete']);assert.equal(r.items[0].textFields.notes.totalChars,10000);
});
test('inputs, read-only shapes and measured overflow keep their native status',()=>{
  const {pages}=fixture(3,'powerpoint');pages.get(0).items=[{id:'field',kind:'field',title:'대상 분기',tag:'quarter',editable:true,text:''},{id:'s-1',kind:'slide',index:1,layout:'Custom',editable:false},{id:'s-1/h-2',kind:'shape',slideId:'s-1',name:'차트',editable:false,overflow:true}];
  assert.deepEqual(inspectDocumentStructure(pages).items.map(i=>i.itemId),['field','s-1']);assert.deepEqual(inspectDocumentStructure(pages,{filter:'editable'}).items.map(i=>i.itemId),['field']);assert.deepEqual(inspectDocumentStructure(pages,{filter:'issues'}).items[0].issues,['text_overflow']);
});
test('source drift, duplicate items and changed captured pages reject old cursors',()=>{
  const {pages}=fixture(),r=inspectDocumentStructure(pages,{filter:'all'});pages.get(40).fingerprint='other';assert.throws(()=>inspectDocumentStructure(pages),/observation_invalid/);
  pages.get(40).fingerprint='f';pages.get(40).items[0].id='p-0';assert.throws(()=>inspectDocumentStructure(pages),/observation_invalid/);
  pages.get(40).items[0].id='p-40';pages.delete(0);assert.throws(()=>inspectDocumentStructure(pages,{filter:'all',cursor:40,viewId:r.viewId}),/source_changed/);
});
test('metadata budgets count escaped labels, and invalid arguments do not read or guess',()=>{
  const {pages}=fixture(40);for(const i of pages.get(0).items){i.outlineLevel=1;i.text='"\\\n'.repeat(1000);}
  const r=inspectDocumentStructure(pages,{filter:'all'});assert.ok(JSON.stringify(r).length<=14000);assert.ok(r.items.length>0);assert.equal(r.nextCursor,r.items.length);
  for(const arg of [{filter:'secret'},{cursor:-1},{cursor:0.5},{cursor:999}])assert.throws(()=>inspectDocumentStructure(pages,arg),/tool_arguments_invalid/);
  assert.throws(()=>inspectDocumentStructure(new Map()),/source_not_read/);
});
test('empty native document is an empty structure, not a fabricated heading',()=>{
  const r=inspectDocumentStructure(fixture(0).pages);assert.equal(r.items.length,0);assert.equal(r.nextCursor,null);assert.equal(r.coverage.allItemsRead,true);
});
