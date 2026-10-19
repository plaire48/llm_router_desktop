import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProgressiveIndices,advanceProgressiveIndices} from '../ui/useProgressiveList.js';
test('visible and selected rows are immediately available without rendering the full page',()=>{
 const state=seedProgressiveIndices({start:0,end:100,firstStart:0,firstEnd:8,include:[80,80,-1,101]});
 assert.deepEqual([...state],[0,1,2,3,4,5,6,7,80]);
 let current=state;for(let i=0;i<30&&current.size<100;i++){
  const next=advanceProgressiveIndices(current,{start:0,end:100,batchSize:8,direction:'forward'});
  assert(next.size-current.size<=8);assert(next.has(80));current=next;
 }
 assert.deepEqual([...current].sort((a,b)=>a-b),Array.from({length:100},(_,i)=>i));
 assert.equal(advanceProgressiveIndices(current,{start:0,end:100,batchSize:8,direction:'forward'}),current);
});
test('conversation pages prepend in bounded chronological steps while retaining every earlier index',()=>{
 let current=seedProgressiveIndices({start:120,end:160,firstStart:156,firstEnd:160});
 assert.deepEqual([...current],[156,157,158,159]);
 for(let n=0;n<19;n++){
  const before=current;current=advanceProgressiveIndices(current,{start:n<9?120:80,end:160,batchSize:4,direction:'backward'});
  assert([...before].every(i=>current.has(i)));assert(current.size-before.size<=4);
 }
 assert.equal(current.size,80);assert.equal(Math.min(...current),80);
});
