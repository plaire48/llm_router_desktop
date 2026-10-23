import test from 'node:test';
import assert from 'node:assert/strict';
import {wikiProgress,wikiUpdateProgress} from '../ui/wiki-progress.mjs';
import {createBackgroundTaskQueue,wikiPreparationTask} from '../ui/background-task-queue.mjs';
const job={id:'wiki-1',startedAt:'2026-10-24T00:00:00Z',state:'running',stage:'generating',completed:3,total:8};
test('Wiki writing reports observed pages and remaining amount, ignoring a stale percent',()=>{
 const view=wikiProgress({...job,percent:99});assert.equal(view.percent,37);assert.equal(view.quantity,'3/8개 문서');assert.equal(view.remainingLabel,'5개 문서 남음 (63%)');assert.equal(view.step,2);assert.equal(view.saved,false);
});
test('planning, unknown totals and current page indices never invent completion',()=>{
 for(const input of [{stage:'planning',completed:8,total:8,percent:100},{stage:'generating',index:8,total:8},{stage:'generating',completed:-1,total:8},{stage:'generating',completed:3,total:0}])assert.equal(wikiProgress(input).percent,null);
 assert.equal(wikiProgress({stage:'scanning',completed:230}).quantity,'파일 230개 확인');
});
test('a full writing or publishing counter is still running until the host confirms saved work',()=>{
 for(const stage of ['generating','publishing']){const view=wikiProgress({...job,stage,completed:8});assert.equal(view.percent,100);assert.equal(view.saved,false);assert.match(view.nextLabel,/저장/);}
 assert.equal(wikiProgress({...job,state:'completed',pages:8}).step,4);
 assert.equal(wikiProgress({...job,state:'partial',pages:3}).saved,false);
});
test('file and document units stay distinct across preparation, review and publication',()=>{
 for(const stage of ['reading','snapshot','snapshot_git','publishing'])assert.match(wikiProgress({...job,stage}).quantity,/개 파일$/);
 assert.match(wikiProgress({...job,stage:'reviewing'}).quantity,/개 문서$/);
 assert.match(wikiProgress({...job,stage:'snapshot_git',gitStep:'history'}).summary,/분석 이력 복사/);
});
test('the compact Wiki queue resets its ETA at review and scope boundaries',()=>{
 let now=0;const queue=createBackgroundTaskQueue({now:()=>now});const update=value=>{const task=wikiPreparationTask(value);queue.update(task.id,task);return task.id;};
 const id=update(job);now=2000;update({...job,completed:4});assert.equal(queue.estimate(id).remainingMs,8000);
 update({...job,stage:'reviewing',completed:4});assert.equal(queue.estimate(id).state,'measuring');
 now=4000;update({...job,stage:'reviewing',completed:5});assert.equal(queue.estimate(id).state,'estimated');
 update({...job,stage:'reviewing',completed:5,scope:{rounds:{done:1}}});assert.equal(queue.estimate(id).state,'measuring');
 update({...job,state:'partial',pages:3});assert.equal(queue.estimate(id).state,'unknown');assert.equal(queue.get(id).state,'waiting');
});
test('updates use completed counts for both generation and review, and reset on stage re-entry',()=>{
 const progress=(stage,completed,at)=>({type:'progress',stage,completed,total:8,at});
 const events=[progress('generating',3,'a'),progress('generating',4,'b')];
 assert.equal(wikiUpdateProgress({...job,events}).percent,50);
 assert.equal(wikiUpdateProgress({...job,events}).phase,wikiUpdateProgress({...job,events:[...events,progress('generating',5,'c')]}).phase);
 const reviewed=wikiUpdateProgress({...job,events:[...events,progress('reviewing',2,'d')]});assert.equal(reviewed.percent,25);
 const reentered=wikiUpdateProgress({...job,events:[...events,progress('reviewing',2,'d'),progress('generating',4,'e')]});assert.notEqual(reentered.phase,wikiUpdateProgress({...job,events}).phase);
});
