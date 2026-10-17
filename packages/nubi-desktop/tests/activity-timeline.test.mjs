import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityTimeline,activityToolSummary} from '../ui/activity-timeline.mjs';
const tool=(id,status='done')=>({id,tool:'read_source',status,label:'소스 읽기'});
test('journal preserves chronology and isolates every unresolved operation',()=>{
 const trace=[tool('a'),tool('b'),{id:'note',tool:'progress_note',content:'확인한 결과'},tool('c','error'),tool('d','waiting'),tool('e'),{id:'plan',tool:'update_plan'},tool('f','running')];
 const copy=structuredClone(trace),blocks=activityTimeline(trace);
 assert.deepEqual(blocks.map(b=>[b.kind,b.id,b.steps?.map(s=>s.id)]),[['tools','a',['a','b']],['note','note',undefined],['tools','c',['c']],['tools','d',['d']],['tools','e',['e','f']]]);
 assert.equal(blocks[2].attention,true);assert.equal(blocks[3].attention,true);
 assert.deepEqual(trace,copy,'presentation does not rewrite evidence or success states');
 assert.equal(activityToolSummary(blocks[0].steps),'소스 읽기 2회');
 assert.equal(activityToolSummary(blocks[4].steps),'소스 읽기');
});
test('appending progress keeps previous group identities and never drops cancellations or deferrals',()=>{
 const trace=[tool('a'),tool('b','cancelled'),tool('c','deferred')];
 assert.deepEqual(activityTimeline(trace).map(b=>b.id),['a','b','c']);
 assert.deepEqual(activityTimeline([...trace,tool('d')]).slice(0,3),activityTimeline(trace));
 assert.equal(activityTimeline([]).length,0);
});
test('provider notes sit between operations without reordering receipts',()=>{
 const trace=[{...tool('a'),startedAt:'2026-10-16T01:00:00Z'},{...tool('b','error'),startedAt:'2026-10-16T01:00:02Z'}];
 const notes=[{id:'memo',at:'2026-10-16T01:00:01Z',content:'관찰한 내용'},{id:'legacy',content:'기존 기록'}];
 const original=structuredClone({trace,notes});
 assert.deepEqual(activityTimeline(trace,notes).map(block=>[block.kind,block.id]),[['tools','a'],['memo','memo'],['tools','b'],['memo','legacy']]);
 assert.deepEqual({trace,notes},original);
});
