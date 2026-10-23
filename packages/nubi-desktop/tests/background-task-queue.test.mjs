import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackgroundTaskQueue,mailImportTask,wikiPreparationTask} from '../ui/background-task-queue.mjs';
import {adaptBackgroundModal} from '../scripts/background-modal-plugin.mjs';
import {readFile} from 'node:fs/promises';
test('a late progress event cannot revive a failed or completed operation',()=>{
 let now=100;const queue=createBackgroundTaskQueue({now:()=>now});const id=queue.begin({title:'저장',risk:'기존 자료 변경'});now=900;queue.update(id,{state:'failed'});queue.update(id,{state:'running',value:99});assert.equal(queue.get(id).state,'failed');assert.equal(queue.get(id).finishedAt,900);
});
test('queue dismissal never cancels active work; terminal history is bounded',async()=>{
 let cancelled=0;const queue=createBackgroundTaskQueue({historyLimit:2}),active=queue.begin({title:'실제 작업'},{cancel:()=>cancelled++});queue.dismiss(active);queue.clearFinished();assert(queue.get(active));assert.equal(cancelled,0);await queue.cancel(active);assert.equal(cancelled,1);
 let released=0;for(let i=0;i<4;i++){const id=queue.begin({title:'완료 기록'},{release:()=>released++});queue.update(id,{state:'completed'});}assert.equal(queue.getSnapshot().length,3);assert.equal(released,2);assert(queue.get(active));
});
test('unknown quantities remain unnumbered and input data never enters metadata',()=>{
 const queue=createBackgroundTaskQueue(),id=queue.begin({title:'처리',password:'sensitive',args:{token:'private'}});assert.equal(queue.get(id).value,null);assert.equal(queue.get(id).password,undefined);assert.equal(queue.get(id).args,undefined);
 queue.update(id,{value:70,max:53});assert.equal(queue.get(id).value,53);
});
test('host import and wiki terminal states stay distinct from success',()=>{
 const base={startedAt:'2026-10-23T00:00:00Z'};assert.equal(mailImportTask({...base,state:'completed',failures:[{}]}).state,'waiting');assert.equal(mailImportTask({...base,state:'interrupted'}).state,'interrupted');assert.equal(wikiPreparationTask({...base,state:'attention'}).state,'failed');assert.equal(wikiPreparationTask({...base,state:'partial'}).state,'waiting');
});
test('remaining time uses observed progress, persists while closed and resets between phases',()=>{
 let now=0;const queue=createBackgroundTaskQueue({now:()=>now}),id=queue.begin({title:'이동',phase:'copy',value:20,max:100});assert.equal(queue.estimate(id).state,'measuring');
 now=2000;queue.update(id,{value:40});assert.equal(queue.estimate(id).remainingMs,6000);
 now=4000;assert.equal(queue.estimate(id).remainingMs,12000,'stalled work must not count down to a false completion');
 queue.update(id,{state:'waiting'});now=100000;queue.update(id,{state:'running',value:50});assert.equal(queue.estimate(id).state,'measuring','resume excludes time spent waiting for user input');
 queue.update(id,{phase:'verify',value:60});assert.equal(queue.estimate(id).state,'measuring');
 queue.update(id,{value:null});assert.equal(queue.estimate(id).state,'unknown');queue.update(id,{state:'completed'});assert.equal(queue.estimate(id).state,'unknown');
});
test('the Desktop adapter keeps the original CX portal and guards upstream drift',async()=>{
 const source=await readFile(new URL('../node_modules/@e2e/cx-design-system/src/DetailPanel.jsx',import.meta.url),'utf8');const adapted=adaptBackgroundModal(source,'/fixture/background-modal.jsx');assert.match(adapted,/embedded\|\|background.hidden/);assert.match(adapted,/createPortal/);assert.match(adapted,/disabled=\{busy\}/);assert.throws(()=>adaptBackgroundModal(source.replace('[embedded]','[changed]'),'x'),/cx_background_modal_contract/);
});
