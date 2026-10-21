import test from 'node:test';
import assert from 'node:assert/strict';
import {CASES,gradeCase} from '../eval/document-forms/run.mjs';

// The forms baseline grader (plan Task G) judges by code only: values in their cells, words in their sections, the
// asked slot, preservation and opening.
test('the grader passes a correct copy and names each miss',()=>{
  const testCase=CASES.find(c=>c.id==='trip-missing');
  const items=[{id:'t1/r2/c2',kind:'cell',text:'광주 지사'},{id:'t1/r3/c2',kind:'cell',text:'2026. 11. 3. ~ 2026. 11. 4.'},{id:'p-14',kind:'paragraph',text:'1. 출장 목적'},{id:'p-15',kind:'paragraph',text:'지사 장비 교체'},{id:'p-16',kind:'paragraph',text:'2. 주요 일정'}];
  const good=gradeCase(testCase,{copyItems:items,written:{sameEntries:true,violations:[]},checks:{summary:'칸 4/4, 목차 2/2, 남은 안내 문구 0, 서식 유지, 근거 확인'},asked:['s4'],opened:true});
  assert.deepEqual([good.success,good.accuracy,good.asksOk,good.guidesLeft],[true,1,true,0]);
  const bad=gradeCase(testCase,{copyItems:items.map(item=>item.id==='t1/r3/c2'?{...item,text:'20XX. XX. XX.'}:item),written:{sameEntries:true,violations:['p-3']},checks:{summary:'칸 3/4, 목차 2/2, 남은 안내 문구 1, 서식 유지, 근거 확인'},asked:[],opened:true});
  assert.deepEqual([bad.success,bad.preserved,bad.asksOk,bad.guidesLeft,bad.cells.find(c=>!c.ok).target],[false,false,false,1,'t1/r3/c2']);
  assert.ok(CASES.length>=5&&CASES.every(c=>c.request&&c.expected));
});
