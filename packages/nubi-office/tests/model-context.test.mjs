import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeGrid,decodeGrid,compactObservation,compactMessages,GRID_GUIDANCE} from '../worker/model-context.mjs';
import {draftIndex,readDraft} from '../worker/document-context.mjs';
import {contextFixture,contextMeasurement} from './quality-fixtures.mjs';

test('grid encoding round trips sparse and uniform data including meaningful null, zero, false and objects',()=>{
 for(const value of [null,0,false,'',true,'General',{type:'list',formula1:'a,b'}]){
  const grid=Array.from({length:20},()=>Array.from({length:10},()=>structuredClone(value)));
  const encoded=encodeGrid(grid);assert.equal(encoded.$grid,'uniform');assert.deepEqual(decodeGrid(encoded),grid);
  grid[3][7]=value==='General'?null:'DIFFERENT';assert.deepEqual(decodeGrid(encodeGrid(grid)),grid);
 }
 for(const grid of [[],[[]],[[1],[1,2]],[[undefined]],[[false]],[[1,2],[3,4]]])assert.equal(encodeGrid(grid),grid);
});

test('wire compaction retains original values/formulas/evidence and unknown properties',()=>{
 const original=contextFixture(),copy=structuredClone(original);original.values[0][0]='private input';original.formulas[1][0]='=SUM(A1:A3)';copy.values[0][0]='private input';copy.formulas[1][0]='=SUM(A1:A3)';
 const encoded=compactObservation({snapshot:original}).snapshot;
 assert.deepEqual(encoded.values,original.values);assert.deepEqual(encoded.formulas,original.formulas);assert.equal(encoded.fingerprint,original.fingerprint);
 for(const [key,grid] of Object.entries(original.formats))assert.deepEqual(decodeGrid(encoded.formats[key]),grid);
 assert.deepEqual(decodeGrid(encoded.errors),original.errors);assert.deepEqual(original,copy);
 delete original.properties;assert.equal(compactObservation(original).properties,undefined);
 const metrics={},messages=[{role:'system',content:'Read actual observations.'},{role:'user',content:JSON.stringify({snapshot:original})}];
 const output=compactMessages(messages,metrics);assert.ok(output[0].content.includes(GRID_GUIDANCE));assert.equal(messages[0].content,'Read actual observations.');assert.ok(metrics.modelContext.sentChars<metrics.modelContext.originalChars);
});

test('tiny payloads do not grow and fixture reduction measures characters, not model quality',()=>{
 const messages=[{role:'system',content:'s'},{role:'user',content:'{"values":[[1]]}'}];assert.equal(compactMessages(messages),messages);
 const m=contextMeasurement();assert.ok(m.savedPercent>50);assert.ok(m.originalChars<90000);assert.equal(m.cells,600);assert.equal(m.unit,'JSON characters');
});

test('draft index defers exact data to bounded reads without granting any write access',()=>{
 const specs=[{name:'입력',address:'A1:B60',cells:[{address:'A1',value:'x'.repeat(200)},{address:'A2',value:0},{address:'B2',value:false},{address:'A3',value:null},{address:'B3',formula:'=A2*2'}]}];
 const index=draftIndex(specs,'결과');assert.equal(index[0].preview[0].value.length,120);assert.equal(index[0].cellCount,5);assert.equal(index[0].cells,undefined);
 const actual=readDraft({sheet:'입력',address:'A1:B3'},specs);assert.deepEqual(actual.cells,specs[0].cells);assert.equal(actual.complete,true);actual.cells[0].value='changed';assert.equal(specs[0].cells[0].value.length,200);
 for(const args of [{sheet:'Missing',address:'A1'},{sheet:'입력',address:'A1:B60'},{sheet:'입력',address:'C1'},{sheet:'입력',address:'A60:A59'}])assert.throws(()=>readDraft(args,specs));
 const current={...specs[0],cells:[{address:'A1',value:'updated'}]};assert.equal(readDraft({sheet:'입력',address:'A1'},specs,current).cells[0].value,'updated');
 assert.throws(()=>readDraft({sheet:'입력',address:'A1:B3'},[{...specs[0],cells:Array.from({length:6},(_,i)=>({address:'A'+(i+1),value:'x'.repeat(8000)}))}]),/document_reference_invalid/);
});
