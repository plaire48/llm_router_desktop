import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
const setup=()=>{const metrics={};return{metrics,workspace:createSkillWorkspace({host:'excel',signal:new AbortController().signal,activity:createActivityLog(),metrics})};};
async function prepare(w){
  await w.execute('write',{path:'draft/input.json',content:'{"total":40}'});
  await w.execute('write',{path:'draft/a.js',content:'function transform(x){return {total:x.total+1}}'});
  await w.execute('write',{path:'draft/b.js',content:'function transform(x){return {total:x.total*2}}'});
  const first=await w.execute('run_script',{path:'draft/a.js',inputPath:'draft/input.json'});
  const second=await w.execute('run_script',{path:'draft/b.js',inputPath:first.resultPath});
  assert.equal(second.output.total,82);return{first,second};
}
test('chained result becomes stale when its original input changes',async()=>{
  const {workspace:w}=setup();await prepare(w);
  await w.execute('write',{path:'draft/input.json',content:'{"total":10}'});
  assert.equal(w.context().lastScript.current,false);
});
test('a stale upstream result cannot be consumed as fresh input or replace accepted outputs',async()=>{
  const {workspace:w,metrics}=setup(),{first}=await prepare(w);
  await w.execute('write',{path:'draft/a.js',content:'function transform(x){return {total:x.total+3}}'});
  const before=w.context().lastScript,calls=metrics.skillWorkspace.scriptRuns;
  const result=await w.execute('run_script',{path:'draft/b.js',inputPath:first.resultPath});
  assert.equal(result.error,'script_dependency_changed');assert.equal(metrics.skillWorkspace.scriptRuns,calls);
  assert.deepEqual(w.context().lastScript,before);
});
test('script result slots cannot silently overwrite unrelated user drafts',async()=>{
  const {workspace:w}=setup();
  await w.execute('write',{path:'draft/a.js',content:'function transform(){return 42}'});
  for(const path of ['draft/script-result.json','draft/script-result-next.json'])await w.execute('write',{path,content:'{"preserve":true}'});
  const result=await w.execute('run_script',{path:'draft/a.js',input:'null'});
  assert.equal(result.error,'script_result_conflict');
  for(const path of ['draft/script-result.json','draft/script-result-next.json'])assert.equal((await w.execute('read',{path})).content,'{"preserve":true}');
});

test('slot rotation keeps bounded upstream dependencies and supports rebuilding changed input',async()=>{
  const {workspace:w}=setup();await prepare(w);
  let result=w.context().lastScript;
  for(let i=0;i<8;i++){
    result=await w.execute('run_script',{path:'draft/b.js',inputPath:result.resultPath});
    assert.equal(result.error,undefined);assert.equal(w.context().lastScript.current,true);
    assert.equal(result.dependencies.length,3);
  }
  await w.execute('write',{path:'draft/input.json',content:'{"total":10}'});
  assert.equal(w.context().lastScript.current,false);
  const rebuilt=await w.execute('run_script',{path:'draft/a.js',inputPath:'draft/input.json'});
  const finished=await w.execute('run_script',{path:'draft/b.js',inputPath:rebuilt.resultPath});
  assert.equal(finished.output.total,22);assert.equal(w.context().lastScript.current,true);
});
test('upstream source change during execution rejects the result and keeps prior output',async()=>{
  const {workspace:w,metrics}=setup(),{first,second}=await prepare(w),runs=metrics.skillWorkspace.scriptRuns;
  const before=(await w.execute('read',{path:first.resultPath})).content;
  const pending=w.execute('run_script',{path:'draft/b.js',inputPath:second.resultPath});
  await w.execute('write',{path:'draft/input.json',content:'{"total":7}'});
  assert.equal((await pending).error,'script_dependency_changed');
  assert.equal((await w.execute('read',{path:first.resultPath})).content,before);assert.equal(metrics.skillWorkspace.scriptRuns,runs);
});
test('occupied or edited result slots are preserved and a free slot is used instead',async()=>{
  const {workspace:w}=setup();
  await w.execute('write',{path:'draft/a.js',content:'function transform(){return 42}'});
  await w.execute('write',{path:'draft/script-result.json',content:'{"preserve":true}'});
  const result=await w.execute('run_script',{path:'draft/a.js',input:'null'});
  assert.equal(result.resultPath,'draft/script-result-next.json');
  assert.equal((await w.execute('read',{path:'draft/script-result.json'})).content,'{"preserve":true}');
  await w.execute('write',{path:result.resultPath,content:'999'});
  assert.equal((await w.execute('read',{path:result.resultPath})).scriptProvenance.current,false);
  assert.equal((await w.execute('run_script',{path:'draft/a.js',inputPath:result.resultPath})).error,'script_dependency_changed');
  assert.equal((await w.execute('run_script',{path:'draft/a.js',input:'null'})).error,'script_result_conflict');
});
test('a user write racing with result publication wins without being overwritten',async()=>{
  const {workspace:w}=setup();
  await w.execute('write',{path:'draft/a.js',content:'function transform(){return 42}'});
  const pending=w.execute('run_script',{path:'draft/a.js',input:'null'});
  await w.execute('write',{path:'draft/script-result.json',content:'{"preserve":true}'});
  assert.equal((await pending).error,'script_result_conflict');
  assert.equal((await w.execute('read',{path:'draft/script-result.json'})).content,'{"preserve":true}');
  assert.equal(w.context().lastScript,null);
});
test('bound draft slots are never selected for script output',async()=>{
  const {workspace:w}=setup();let writes=0;
  for(const path of ['draft/script-result.json','draft/script-result-next.json'])w.bindDraft(path,{read:()=>undefined,write:()=>writes++});
  await w.execute('write',{path:'draft/a.js',content:'function transform(){return 42}'});
  assert.equal((await w.execute('run_script',{path:'draft/a.js',input:'null'})).error,'script_result_conflict');assert.equal(writes,0);
});
test('receipt and context consumers cannot mutate retained dependency proofs',async()=>{
  const {workspace:w}=setup(),{second}=await prepare(w);
  second.dependencies.length=0;w.context().lastScript.dependencies.length=0;
  const read=await w.execute('read',{path:second.resultPath});read.scriptProvenance.dependencies.length=0;
  await w.execute('write',{path:'draft/input.json',content:'{"total":0}'});
  assert.equal(w.context().lastScript.current,false);assert.equal(w.context().lastScript.dependencies.length,3);
  assert.equal((await w.execute('read',{path:second.resultPath,charOffset:0})).scriptProvenance.current,false);
});

test('unchanged stale-input errors use the existing three-failure supervisor without script replay',async()=>{
  const {createResilience}=await import('../worker/resilience.mjs');
  const {workspace:w,metrics}=setup(),{first}=await prepare(w);let pauses=0;
  await w.execute('write',{path:'draft/input.json',content:'{"total":0}'});
  const runs=metrics.skillWorkspace.scriptRuns,controller=new AbortController();
  const resilience=createResilience({signal:controller.signal,activity:createActivityLog(),metrics,getProgress:w.progress,wait:async()=>{},onStall:async()=>{pauses++;}});
  for(let i=0;i<3;i++){
    const result=await resilience.localTool('run_script',()=>w.execute('run_script',{path:'draft/b.js',inputPath:first.resultPath}));
    assert.equal(result.error,'script_dependency_changed');assert.equal(result.recoveryHandled,true);
  }
  assert.equal(pauses,1);assert.equal(metrics.skillWorkspace.scriptRuns,runs);
  assert.match(resilience.localFailure().instruction,/original input/);
});
