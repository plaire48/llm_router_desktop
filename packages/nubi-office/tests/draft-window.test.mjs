import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {draftWindow,readDraft,DRAFT_WINDOW_CHARS} from '../worker/document-context.mjs';
const draft=()=>({name:'보고',address:'A1:A20',cells:Array.from({length:20},(_,i)=>({address:'A'+(i+1),value:('본문 '+i+' ').repeat(400)})),formats:Array.from({length:40},(_,i)=>({address:'A1:A20',style:{fontName:'Noto Sans KR',numberFormat:'0.'+'0'.repeat(80),fontSize:10+i}})),merges:[],columnWidths:[{index:1,size:40}],rowHeights:[],borders:[],page:{orientation:'portrait'}});
test('large draft window stays bounded, preserves exact focus and exposes every omitted cell',()=>{
  const source=draft(),before=structuredClone(source),view=draftWindow(source,['A20']);
  assert.ok(JSON.stringify(view).length<=DRAFT_WINDOW_CHARS);assert.ok(view.draftView.omittedCellAddresses.length);assert.equal(view.draftView.complete,false);
  assert.equal(view.cells[0].address,'A20');assert.deepEqual([...view.cells.map(c=>c.address),...view.draftView.omittedCellAddresses].sort(),source.cells.map(c=>c.address).sort());
  for(const cell of view.cells)assert.deepEqual(cell,source.cells.find(c=>c.address===cell.address));
  for(const address of view.draftView.omittedCellAddresses)assert.deepEqual(readDraft({sheet:'보고',address,viewId:view.draftView.viewId},[],source).cells,[source.cells.find(c=>c.address===address)]);
  assert.deepEqual(source,before);
});
test('layout pages reconstruct original entries with source-bound continuation',()=>{
  const source=draft();let result=readDraft({sheet:'보고',part:'formats'},[],source),all=[];
  for(;;){all.push(...result.items);assert.ok(JSON.stringify(result).length<=16000);if(result.nextCursor===null)break;result=readDraft({sheet:'보고',part:'formats',cursor:result.nextCursor,viewId:result.viewId},[],source);}
  assert.deepEqual(all,source.formats);assert.deepEqual(readDraft({sheet:'보고',part:'page'},[],source).items,[source.page]);
  const initial=readDraft({sheet:'보고',part:'formats'},[],source);source.cells[0].value='변경';
  assert.throws(()=>readDraft({sheet:'보고',part:'formats',cursor:8,viewId:initial.viewId},[],source),/document_reference_invalid/);
  assert.throws(()=>readDraft({sheet:'보고',part:'formats',cursor:8},[],source),/document_reference_invalid/);
});
test('layout absence and invalid reads are not inferred defaults or full-sheet evidence',()=>{
  const source={name:'보고',address:'A1',cells:[{address:'A1',value:0}]};
  const result=readDraft({sheet:'보고',part:'page'},[],source);assert.equal(result.present,false);assert.deepEqual(result.items,[]);
  for(const args of [{part:'unknown'},{part:'formats',address:'A1'},{part:'formats',cursor:-1},{part:'cells',cursor:1,address:'A1'},{}])assert.throws(()=>readDraft({sheet:'보고',...args},[],source),/document_reference_invalid/);
  const view=draftWindow(source);view.cells[0].value=99;assert.equal(source.cells[0].value,0);assert.equal(view.draftView,undefined);
});
test('generated Unicode/escaping windows partition exact cells without mutating drafts',()=>{
  fc.assert(fc.property(fc.array(fc.string({minLength:100,maxLength:500}),{minLength:20,maxLength:40}),texts=>{
    const source={name:'보고',address:'A1:A40',cells:texts.map((value,i)=>({address:'A'+(i+1),value}))},before=structuredClone(source),view=draftWindow(source,[],4000);
    assert.ok(JSON.stringify(view).length<=4000);assert.deepEqual([...view.cells.map(c=>c.address),...(view.draftView?.omittedCellAddresses??[])].sort(),source.cells.map(c=>c.address).sort());assert.deepEqual(source,before);
    for(const cell of view.cells)assert.deepEqual(cell,source.cells.find(c=>c.address===cell.address));
  }),{seed:250925,numRuns:50});
});
