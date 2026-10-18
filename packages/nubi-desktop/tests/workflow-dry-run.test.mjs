import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {createWorkflowRunner} from '../runtime/workflow-runner.mjs';
installAgent(ProjectService);
const workflow={name:'합성 변경 요청',version:1,inputs:{ticket:{type:'string',required:true}},permissions:{tools:['terminal','documents'],externalWrite:'never'},steps:[
 {id:'read',kind:'tool',adapter:'terminal.run',args:{profile:'bash',script:'echo fixture'},verify:{kind:'exit_code',value:0}},
 {id:'approve',kind:'human',ask:'{{ inputs.ticket }} 초안을 만들까요?',outputs:{decision:['approve','stop']}},
 {id:'draft',kind:'agent',goal:'{{ inputs.ticket }} 초안 작성',tools:['propose_new_file'],done_when:{kind:'file_exists',path:'out/memo.md'},outputs:{schema:{type:'object',required:['summary'],properties:{summary:{type:'string'}},additionalProperties:false}}}
]};
const basic={inputs:{ticket:'CR-12'},answers:{approve:'approve'},responses:{read:{ok:true,result:{exitCode:0,output:'합성 요청'},receipts:['process:synthetic']},draft:{ok:true,output:{summary:'합성 초안'},result:{exists:true},receipts:['fixture:draft']}}};
async function setup(t,data=basic){
 const f=await fixture(t),dir=path.join(f.root,'.nubi/workflows/sample');await mkdir(path.join(dir,'fixtures'),{recursive:true});
 await writeFile(path.join(dir,'workflow.yaml'),JSON.stringify(workflow));await writeFile(path.join(dir,'fixtures/basic.json'),JSON.stringify(data));
 return {...f,dir,runner:createWorkflowRunner(f.service)};
}
function noEffects(service){for(const key of ['setup-action:','proposal:','process:'])assert.equal(service.store.list(key).length,0,key);assert.equal(service.store.list('task:').filter(task=>task.origin?.kind==='workflow_step').length,0);}
test('dry-run uses fixture inputs, responses and human answers, with a stored synthetic report and no effects',async t=>{
 const f=await setup(t),before=await readFile(path.join(f.root,'app.txt'));let calls=0;
 f.service.startAgent=async()=>{calls++;throw Error('real_model_called');};f.service.playwrightRequest=async()=>{calls++;throw Error('real_browser_called');};
 const run=await f.runner.start({slug:'sample',mode:'dry-run'});
 assert.equal(run.status,'complete');assert.equal(run.mode,'dry-run');assert.equal(run.steps.approve.answer,'approve');assert.equal(run.steps.draft.output.summary,'합성 초안');
 assert.equal(calls,0);noEffects(f.service);await assert.rejects(access(path.join(f.root,'out/memo.md')));assert.deepEqual(await readFile(path.join(f.root,'app.txt')),before);
 assert.equal(typeof run.report,'string');assert.match(run.report,/합성 시험/);assert.equal(f.service.store.get('workflow-run:'+run.id).report,run.report);
 assert.ok(run.steps.read.receipts.every(id=>id.startsWith('fixture:')));
});
test('missing step response is partial with the exact step and no real fallback',async t=>{
 const data=structuredClone(basic);delete data.responses.draft;const f=await setup(t,data),run=await f.runner.start({slug:'sample',mode:'dry-run'});
 assert.equal(run.status,'partial');assert.equal(run.cursor,'draft');assert.equal(run.reason,'workflow_fixture_missing');assert.match(run.report,/未|미해결/);noEffects(f.service);
});
test('missing fixture file, unknown mode and path traversal fail before a run or task is created',async t=>{
 const f=await setup(t);
 for(const args of [{mode:'dry-run',fixture:'missing.json'},{mode:'dry-run',fixture:'../basic.json'},{mode:'invented'}])await assert.rejects(f.runner.start({slug:'sample',...args}),/workflow_fixture_missing|workflow_mode_invalid/);
 assert.equal(f.service.store.list('workflow-run:').length,0);assert.equal(f.service.store.list('task:').length,0);noEffects(f.service);
});
test('dry-run human stop is partial and does not consume a later response',async t=>{
 const data=structuredClone(basic);data.answers.approve='stop';const f=await setup(t,data),run=await f.runner.start({slug:'sample',mode:'dry-run'});
 assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_stopped');assert.equal(run.steps.approve.answer,'stop');assert.equal(run.steps.draft,undefined);noEffects(f.service);
});
test('missing human answers and invalid structured output are partial rather than inferred successes',async t=>{
 for(const invalid of ['answer','schema']){
  const data=structuredClone(basic);if(invalid==='answer')delete data.answers.approve;else data.responses.draft.output.summary=42;
  const f=await setup(t,data),run=await f.runner.start({slug:'sample',mode:'dry-run'});
  assert.equal(run.status,'partial');assert.equal(run.reason,invalid==='answer'?'workflow_fixture_missing':'workflow_output_schema');noEffects(f.service);
 }
});
test('synthetic completion still checks done_when instead of accepting fixture ok alone',async t=>{
 const data=structuredClone(basic);data.responses.draft.result.exists=false;const f=await setup(t,data),run=await f.runner.start({slug:'sample',mode:'dry-run'});
 assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_verify_failed');assert.equal(run.steps.draft.output,undefined);noEffects(f.service);
});
test('a successful dry-run cannot qualify or silently switch to actual execution',async t=>{
 const f=await setup(t),run=await f.runner.start({slug:'sample',mode:'dry-run'});
 assert.equal(f.service.store.get('workflow-qualified:sample:'+run.hash),null);
 const resumed=await f.runner.resume(run.id,{mode:'execute'});assert.equal(resumed.mode,'dry-run');assert.equal(resumed.status,'complete');noEffects(f.service);
 const actual=await f.runner.start({slug:'sample',inputs:{ticket:'CR-12'}});assert.equal(actual.supervised,true);assert.equal(actual.steps.read.phase,'supervision');noEffects(f.service);
});
test('new fixture packages get a new hash without rewriting historical results',async t=>{
 const f=await setup(t),run=await f.runner.start({slug:'sample',mode:'dry-run'});assert.equal(run.status,'complete');
 // Completed runs are immutable historical evidence; a new run gets the changed package hash.
 const data=structuredClone(basic);data.responses.draft.output.summary='새 합성 응답';await writeFile(path.join(f.dir,'fixtures/basic.json'),JSON.stringify(data));
 const next=await f.runner.start({slug:'sample',mode:'dry-run'});assert.notEqual(next.hash,run.hash);assert.equal(next.steps.draft.output.summary,'새 합성 응답');assert.equal(f.service.store.get('workflow-run:'+run.id).steps.draft.output.summary,'합성 초안');noEffects(f.service);
});
test('an interrupted synthetic step resumes after SQLite reopen without acquiring real authority',async t=>{
 const f=await setup(t),run=await f.runner.start({slug:'sample',mode:'dry-run'});
 const checkpoint={...run,status:'running',cursor:'read',steps:{read:{status:'running',inputHash:run.steps.read.inputHash,receipts:[]}}};delete checkpoint.finishedAt;f.service.store.set('workflow-run:'+run.id,checkpoint);
 f.service.dispose();f.service.store.close();const second=new ProjectService({storageRoot:path.join(f.directory,'state')});t.after(()=>{second.dispose();second.store.close();});await second.open(f.root);
 const resumed=await createWorkflowRunner(second).resume(run.id,{mode:'execute'});assert.equal(resumed.status,'complete');assert.equal(resumed.mode,'dry-run');noEffects(second);
});
test('actual supervision stop remains recorded in the report without starting any action',async t=>{
 const f=await setup(t);let run=await f.runner.start({slug:'sample',inputs:{ticket:'CR-12'}});run=await f.runner.resume(run.id,{answer:'stop'});
 assert.equal(run.steps.read.answer,'stop');assert.match(run.report,/stop/);assert.equal(run.status,'partial');noEffects(f.service);
});
test('agent conditions without a child-bound observation port are rejected before effects',async t=>{
 const f=await setup(t);const unsupported=structuredClone(workflow);unsupported.steps[2].done_when={kind:'text_present',value:'다른 탭의 문구'};
 await writeFile(path.join(f.dir,'workflow.yaml'),JSON.stringify(unsupported));
 await assert.rejects(f.runner.start({slug:'sample',mode:'dry-run'}),/workflow_verify_unsupported/);
 assert.equal(f.service.store.list('workflow-run:').length,0);noEffects(f.service);
});
