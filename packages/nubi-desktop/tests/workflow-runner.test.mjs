import {featureTest} from './beta-feature.mjs';const test=featureTest('workflows');
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {createWorkflowRunner} from '../runtime/workflow-runner.mjs';
import {loadWorkflowPackage} from '../runtime/workflow-package.mjs';
import {workflowStepContext,submitStepOutput} from '../runtime/workflow-step.mjs';
installAgent(ProjectService);
const human={id:'ok',kind:'human',ask:'계속?',outputs:{decision:['approve','stop']}};
const agent=(id='write')=>({id,kind:'agent',goal:'메모를 작성한다',tools:['read_source','propose_new_file'],done_when:{kind:'file_exists',path:'out/memo.md'},outputs:{schema:{type:'object',required:['summary'],properties:{summary:{type:'string'}},additionalProperties:false}}});
export async function workflowFixture(t,steps,{permissions={tools:['documents','terminal'],externalWrite:'never'},fixtures}={}){
 const f=await fixture(t);await mkdir(path.join(f.root,'out'));const dir=path.join(f.root,'.nubi/workflows/sample');await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'workflow.yaml'),JSON.stringify({name:'시범',version:1,permissions,steps}));
 if(fixtures){await mkdir(path.join(dir,'fixtures'));for(const [name,value] of Object.entries(fixtures))await writeFile(path.join(dir,'fixtures',name),JSON.stringify(value));}
 const runner=createWorkflowRunner(f.service);return {...f,runner,dir};
}
async function qualified(f){const pkg=await loadWorkflowPackage(f.root,'sample');f.service.store.set('workflow-qualified:sample:'+pkg.definitionHash,{definitionHash:pkg.definitionHash,hash:pkg.hash});}
const call=(name,args)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
function provider(f,actor){f.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),complete:actor,dispose(){}};}

test('first actual execution confirms every non-human step and qualification is hash bound',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'},verify:{kind:'truthy'}},human]);
 let run=await f.runner.start({slug:'sample'});assert.equal(run.status,'waiting');assert.equal(run.steps.read.phase,'supervision');assert.equal(f.service.store.list('workflow-receipt:').length,0);
 run=await f.runner.resume(run.id,{answer:'approve'});assert.equal(run.cursor,'ok');assert.ok(f.service.task(run.taskId).question);
 run=await f.runner.resume(run.id,{answer:'approve'});assert.equal(run.status,'complete');
 const second=await f.runner.start({slug:'sample'});assert.equal(second.cursor,'ok');assert.equal(second.supervised,false);
 await writeFile(path.join(f.dir,'README.md'),'changed');const changed=await f.runner.start({slug:'sample'});assert.equal(changed.supervised,true);
});
test('human stop is partial and creates no later child task or effects',async t=>{
 const f=await workflowFixture(t,[human,agent()]);let run=await f.runner.start({slug:'sample'});run=await f.runner.resume(run.id,{answer:'stop'});
 assert.equal(run.status,'partial');assert.equal(run.steps.write,undefined);assert.equal(f.service.store.list('task:').filter(task=>task.origin?.kind==='workflow_step').length,0);
 assert.equal((await f.runner.resume(run.id,{})).status,'partial');
});
test('completed prefix is not replayed and changed packages cannot resume',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'}},human]);await qualified(f);
 let run=await f.runner.start({slug:'sample'});const count=f.service.store.list('workflow-receipt:').length;
 await writeFile(path.join(f.dir,'README.md'),'changed');await assert.rejects(f.runner.resume(run.id,{answer:'approve'}),/workflow_package_changed/);
 assert.equal(f.service.store.list('workflow-receipt:').length,count);assert.equal(f.service.store.get('workflow-run:'+run.id).steps.read.status,'complete');
});
test('branch skips the unused path and finishes using explicit next links',async t=>{
 const f=await workflowFixture(t,[{id:'pick',kind:'branch',when:'true',then:'end',else:'skip'}, {id:'skip',kind:'tool',adapter:'documents.read',args:{path:'missing'}},{id:'end',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'}}]);await qualified(f);
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');assert.equal(run.steps.skip,undefined);
});
test('unsupported future node kinds are rejected before any step executes',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'}},{id:'future',kind:'subflow',workflow:'other'}]);
 await assert.rejects(f.runner.start({slug:'sample'}),/workflow_step_unsupported/);assert.equal(f.service.store.list('workflow-receipt:').length,0);
});
test('unconfirmed tool receipts remain waiting across runner recreation without another command',async t=>{
 const f=await workflowFixture(t,[{id:'run',kind:'tool',adapter:'terminal.run',args:{script:'echo hi',profile:'bash'},idempotency:'one'}]);await qualified(f);
 let run=await f.runner.start({slug:'sample'});assert.equal(f.service.store.list('setup-action:').length,1);
 f.service.store.set('workflow-run:'+run.id,{...run,steps:{run:{...run.steps.run,status:'unconfirmed'}}});
 run=await createWorkflowRunner(f.service).resume(run.id,{});assert.equal(run.status,'waiting');assert.equal(f.service.store.list('setup-action:').length,1);
});
test('agent offered tools equal resolved tools and forged unadvertised calls never execute',async t=>{
 const f=await workflowFixture(t,[agent()]);await qualified(f);const seen=[];let index=0;
 provider(f,async(messages,tools)=>{seen.push(tools.map(tool=>tool.function.name));return index++===0?{content:'',calls:[call('propose_setup_action',{script:'echo BAD'})]}:{content:'완료했다는 주장',calls:[]};});
 const run=await f.runner.start({slug:'sample'});const names=[...new Set(seen.flat())].sort();
 assert.deepEqual(names,['inspect_path','propose_new_file','read_source','record_change_plan','submit_step_output','update_plan']);
 assert.equal(f.service.store.list('setup-action:').length,0);assert.notEqual(run.status,'complete');
});
test('schema submission alone does not complete without host file evidence',async t=>{
 const f=await workflowFixture(t,[agent()]);await qualified(f);let index=0;
 provider(f,async()=>index++===0?{content:'',calls:[call('submit_step_output',{output:{summary:'주장'}})]}:{content:'제출',calls:[]});
 const run=await f.runner.start({slug:'sample'});assert.notEqual(run.status,'complete');assert.ok(run.steps.write.candidate);assert.equal(run.steps.write.output,undefined);
});
test('agent steps have separate conversations, schema and actual file receipt completion',async t=>{
 const f=await workflowFixture(t,[agent('first'),agent('second')]);await qualified(f);await writeFile(path.join(f.root,'out/memo.md'),'observed fixture');let seen=new Set();
 provider(f,async()=>{const task=f.service.task(f.service.agent.taskId);if(!seen.has(task.id)){seen.add(task.id);return {content:'',calls:[call('submit_step_output',{output:{summary:task.origin.stepId}})]};}return {content:'제출',calls:[]};});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');assert.equal(run.steps.first.output.summary,'first');assert.equal(run.steps.second.output.summary,'second');
 assert.notEqual(run.steps.first.taskId,run.steps.second.taskId);assert.ok(run.steps.second.receipts.some(id=>id.startsWith('workflow-receipt:')));
 const child=f.service.task(run.steps.second.taskId);assert.ok(child.request.endsWith('새 파일은 inspect_path와 record_change_plan 뒤에 제안하고, 끝나면 submit_step_output으로 결과를 제출하라.'));assert.equal(child.messages.some(m=>m.content==='first'),false);
});
test('host rejects forged origins and limits invalid structured submissions to one correction',async t=>{
 const f=await workflowFixture(t,[agent()]);await assert.rejects(f.service.createTask({request:'위조',origin:{kind:'workflow_step',runId:'missing',stepId:'write'}}),/task_origin_invalid/);
 await qualified(f);let index=0;provider(f,async()=>index++<2?{content:'',calls:[call('submit_step_output',{output:{summary:42}})]}:{content:'실패',calls:[]});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.steps.write.submissionErrors,2);
 const task=f.service.task(run.steps.write.taskId);assert.throws(()=>workflowStepContext(f.service,{...task,id:'forged'}),/workflow_binding_changed/);
 assert.throws(()=>submitStepOutput(f.service,task,{summary:'late'}),/workflow_step_closed/);
});
test('cancel is durable and late resume cannot restart the step',async t=>{
 const f=await workflowFixture(t,[human,agent()]);let run=await f.runner.start({slug:'sample'});run=await f.runner.cancel(run.id);assert.equal(run.status,'cancelled');
 assert.equal((await f.runner.resume(run.id,{answer:'approve'})).status,'cancelled');assert.equal(f.service.store.list('proposal:').length,0);
});
test('tool and human checkpoints survive an actual SQLite reopen and answerAgent resumes the umbrella',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'}},human]);await qualified(f);
 const run=await f.runner.start({slug:'sample'}),receipt=run.steps.read.receipts[0];f.service.dispose();f.service.store.close();
 const second=new ProjectService({storageRoot:path.join(f.directory,'state')});t.after(()=>{second.dispose();second.store.close();});await second.open(f.root);
 const task=second.task(run.taskId);
 const result=await second.answerAgent({taskId:task.id,choice:{questionId:task.question.id,optionId:task.question.options[0].id}});
 assert.equal(result.status,'complete');assert.deepEqual(result.steps.read.receipts,[receipt]);
});
test('new file goes through real inspect, change plan, proposal approval and readback before completion',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'}},human,agent()]);await qualified(f);let index=0;
 provider(f,async()=>({content:'',calls:[[
  call('inspect_path',{path:'out/memo.md'}),
  call('record_change_plan',{summary:'합성 메모 작성',requirements:[{id:'R1',text:'합성 메모를 작성한다'}],targets:[{path:'out/memo.md',action:'create',reason:'새 메모',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'inspection',description:'파일 본문을 확인한다'}],assumptions:[]}),
  call('propose_new_file',{path:'out/memo.md',content:'# 합성 메모\n',reason:'요청한 초안'}),
  call('submit_step_output',{output:{summary:'메모 초안'}})
 ][index++]].filter(Boolean)}));
 let run=await f.runner.start({slug:'sample'});run=await f.runner.resume(run.id,{answer:'approve'});assert.equal(run.status,'waiting');
 const proposal=f.service.store.list('proposal:')[0];assert.ok(proposal);assert.equal(proposal.state,'proposed');assert.equal(run.steps.write.output,undefined);
 const ready=await f.service.prepareProposal({proposalId:proposal.id});let appliedWake=false;const notify=f.runner.notify;f.runner.notify=async id=>{appliedWake=true;return notify(id);};await f.service.applyNewFile({proposalId:proposal.id,token:ready.token});await new Promise(resolve=>setImmediate(resolve));assert.equal(appliedWake,true,'new-file confirmation wakes the workflow');
 run=await f.runner.resume(run.id,{});assert.equal(run.status,'complete');assert.equal(await readFile(path.join(f.root,'out/memo.md'),'utf8'),'# 합성 메모\n');
});
for(const inspect of [false,true])test(`expanded tools still require actual ${inspect?'change plan':'source inspection'}`,async t=>{
 const f=await workflowFixture(t,[agent()]);await qualified(f);let index=0;const errors=[];
 provider(f,async messages=>{for(const m of messages.filter(m=>m.role==='tool'))try{const row=JSON.parse(m.content);if(row.error)errors.push(row.error);}catch{}
  index++;if(inspect&&index===1)return {content:'',calls:[call('inspect_path',{path:'out/memo.md'})]};
  if(index===(inspect?2:1))return {content:'',calls:[call('propose_new_file',{path:'out/memo.md',content:'합성',reason:'시험'})]};return {content:'선행 작업 필요',calls:[]};});
 await f.runner.start({slug:'sample'});assert.ok(errors.includes(inspect?'change_plan_required':'source_read_required'),JSON.stringify(errors));assert.equal(f.service.store.list('proposal:').length,0);
});
test('step actor call budget is honored without raising default budgets',async t=>{
 const f=await workflowFixture(t,[{...agent(),tools:['read_source'],budget:{calls:1,minutes:1}}]);await qualified(f);let calls=0,withTools=0;
 provider(f,async(messages,tools)=>{calls++;if(tools.length){withTools++;return {content:'',calls:[call('read_source',{path:'app.txt'})]};}return {content:'예산 종료',calls:[]};});
 const run=await f.runner.start({slug:'sample'});assert.notEqual(run.status,'complete');assert.equal(withTools,1);assert.ok(calls<=2);assert.equal(f.service.task(run.steps.write.taskId).runBudget.reached,true);
});
test('same run idempotency keys reuse confirmed output and reject changed arguments',async t=>{
 const steps=[{id:'one',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'},idempotency:'same'},{id:'two',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'},idempotency:'same'}];
 const f=await workflowFixture(t,steps);await qualified(f);const run=await f.runner.start({slug:'sample'});
 assert.equal(run.status,'complete');assert.equal(f.service.store.list('workflow-receipt:').length,1);assert.equal(run.steps.two.cachedFrom,'one');
 await writeFile(path.join(f.dir,'workflow.yaml'),JSON.stringify({...run.workflow,steps:[steps[0],{...steps[1],args:{path:'other.txt'}}]}));await qualified(f);
 const changed=await f.runner.start({slug:'sample'});assert.equal(changed.status,'partial');assert.equal(changed.reason,'workflow_idempotency_changed');
});
test('package README is lower-priority stage guidance and does not enter another conversation',async t=>{
 const f=await workflowFixture(t,[agent()]);await writeFile(path.join(f.dir,'README.md'),'합성 워크플로우 지침 ABC');await qualified(f);const requests=[];
 provider(f,async messages=>{requests.push(messages);return {content:'지침 확인',calls:[]};});await f.runner.start({slug:'sample'});
 assert.ok(requests.flat().some(m=>m.role==='system'&&m.content.includes('합성 워크플로우 지침 ABC')));
});
test('stopping the umbrella cancels its run and child approval authority',async t=>{
 const f=await workflowFixture(t,[{...agent(),tools:['ask_user']}]);await qualified(f);provider(f,async()=>({content:'',calls:[call('ask_user',{question:'확인할 내용?'})]}));
 const run=await f.runner.start({slug:'sample'});await f.service.stopAgent({taskId:run.taskId});
 assert.equal(f.service.store.get('workflow-run:'+run.id).status,'cancelled');assert.equal(f.service.task(run.steps.write.taskId).state,'cancelled');
});
test('a confirmed terminal receipt can resolve an earlier unconfirmed hold without redispatch',async t=>{
 const f=await workflowFixture(t,[{id:'run',kind:'tool',adapter:'terminal.run',args:{script:'echo workflow',profile:'bash'},verify:{kind:'exit_code',value:0}}]);await qualified(f);
 let run=await f.runner.start({slug:'sample'});const action=f.service.store.list('setup-action:')[0];
 f.service.store.set('setup-action:'+action.id,{...action,state:'attention'});run=await f.runner.resume(run.id,{});assert.equal(run.steps.run.status,'unconfirmed');assert.ok(f.service.task(run.taskId).question);
 f.service.store.set('setup-action:'+action.id,{...action,state:'started',resultProcessId:'confirmed'});f.service.store.set('process:confirmed',{id:'confirmed',taskId:run.taskId,state:'completed',exitCode:0,output:'workflow'});
 run=await f.runner.resume(run.id,{});assert.equal(run.status,'complete');assert.equal(f.service.store.list('setup-action:').length,1);assert.equal(f.service.store.list('process:').length,1);
});
test('a rejected child write cannot be reported complete from an existing file',async t=>{
 const f=await workflowFixture(t,[agent()]);await qualified(f);await writeFile(path.join(f.root,'out/memo.md'),'원본');
 provider(f,async()=>{const taskId=f.service.agent.taskId;f.service.store.set('proposal:rejected',{id:'rejected',taskId,path:'out/memo.md',state:'rejected'});return {content:'',calls:[call('submit_step_output',{output:{summary:'반영했다고 주장'}})]};});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_action_rejected');assert.equal(run.steps.write.output,undefined);
});
test('unconfirmed MCP evidence blocks completion despite a satisfied file condition',async t=>{
 const f=await workflowFixture(t,[agent()]);await qualified(f);await writeFile(path.join(f.root,'out/memo.md'),'원본');
 provider(f,async()=>{const task=f.service.task(f.service.agent.taskId);task.mcpContinuation={state:'executing',name:'fixture',fingerprint:'bound'};f.service.store.set('task:'+task.id,task);return {content:'',calls:[call('submit_step_output',{output:{summary:'주장'}})]};});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'waiting');assert.equal(run.steps.write.output,undefined);assert.equal(run.steps.write.reason,'workflow_action_pending');
});
test('large unreferenced previous outputs do not enter or block the next stage conversation',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.read',args:{path:'large.txt'}},agent()]);await qualified(f);
 await writeFile(path.join(f.root,'large.txt'),'UNRELATED_PRIVATE_BODY'.repeat(2000));await writeFile(path.join(f.root,'out/memo.md'),'관찰');const requests=[];
 provider(f,async messages=>{requests.push(messages);return {content:'',calls:[call('submit_step_output',{output:{summary:'검증'}})]};});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');assert.ok(requests.length);assert.equal(JSON.stringify(requests).includes('UNRELATED_PRIVATE_BODY'),false);
});

// Independent review W1-W9: reproduce each defect before changing the runner.
test('W1 ordinary next links skip the other branch for tool human and agent',async t=>{
 for(const kind of ['tool','human','agent']){
  const a=kind==='tool'?{id:'a',kind,adapter:'documents.exists',args:{path:'app.txt'}}:kind==='human'?{id:'a',kind,ask:'진행?',outputs:{decision:['approve']}}:agent('a');
  const f=await workflowFixture(t,[{id:'pick',kind:'branch',when:'true',then:'a',else:'b'},{...a,next:'end'},{id:'b',kind:'tool',adapter:'documents.read',args:{path:'missing'}},{id:'end',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'}}]);await qualified(f);
  await writeFile(path.join(f.root,'out/memo.md'),'fixture');let sent=false;provider(f,async()=>!sent?(sent=true,{content:'',calls:[call('submit_step_output',{output:{summary:'fixture'}})]}):{content:'끝',calls:[]});
  let run=await f.runner.start({slug:'sample'});if(kind==='human')run=await f.runner.resume(run.id,{answer:'approve'});
  assert.equal(run.status,'complete',kind);assert.equal(run.steps.b,undefined,kind);
 }
});
test('W2 missing conditions fail closed before tool agent or human dispatch',async t=>{
 for(const when of ['steps.missing.output.ok','!steps.missing.output.ok',"steps.missing.output.ok != 'approve'"]){
  const f=await workflowFixture(t,[{id:'tool',kind:'tool',adapter:'documents.read',args:{path:'missing'},when},{...agent(),when},{id:'person',kind:'human',ask:'실행되면 안됨',when}]);
  const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');for(const s of Object.values(run.steps))assert.equal(s.status,'skipped');assert.equal(f.service.store.list('workflow-receipt:').length,0);
 }
});
test('W3 pre-dispatch start rejection can resume after provider connection',async t=>{
 const f=await workflowFixture(t,[agent()]);await qualified(f);await writeFile(path.join(f.root,'out/memo.md'),'fixture');const original=f.service.startAgent;let starts=0;
 f.service.startAgent=async function(args){if(!starts++)throw Error('provider_missing');return original.call(this,args);};
 let sent=false;provider(f,async()=>!sent?(sent=true,{content:'',calls:[call('submit_step_output',{output:{summary:'connected'}})]}):{content:'끝',calls:[]});
 let run=await f.runner.start({slug:'sample'});assert.equal(run.status,'waiting');run=await f.runner.resume(run.id);assert.equal(run.status,'complete');assert.equal(starts,2);
});
test('W4 prose completion without a submission closes partial',async t=>{
 const f=await workflowFixture(t,[agent()]);await qualified(f);provider(f,async()=>({content:'완료했다고 말하지만 제출하지 않음',calls:[]}));
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_output_missing');
});
test('W4 confirmed child proposals notify the owning runner',async t=>{
 const f=await workflowFixture(t,[agent()]);const task=await f.service.createTask({request:'fixture'});task.origin={kind:'workflow_step',runId:'owner',stepId:'write'};f.service.store.set('task:'+task.id,task);
 const source=await f.service.read({path:'app.txt'});const proposal=await f.service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:'confirmed\n',reason:'fixture'});
 await writeFile(path.join(f.root,'app.txt'),'confirmed\n');let notified;f.service.workflowRunner={notify:async id=>{notified=id;},dispose(){}};
 await f.service.confirmProposal({proposalId:proposal.id});await new Promise(resolve=>setImmediate(resolve));assert.equal(notified,'owner');
});
test('W5 template errors in arguments and human questions close partial with a diagnostic',async t=>{
 for(const step of [{id:'bad',kind:'tool',adapter:'documents.exists',args:{path:'{{ inputs.ticket | jsmUrl }}'}},{id:'bad',kind:'human',ask:'{{ inputs.ticket | jsmUrl }}'}]){
  const f=await workflowFixture(t,[step]);await qualified(f);const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.reason,'template_invalid');
 }
});
test('W5 missing template data in cache arguments cannot leave a running zombie',async t=>{
 const f=await workflowFixture(t,[{id:'bad',kind:'tool',adapter:'documents.exists',args:{path:'{{ inputs.missing }}'}}]);await qualified(f);const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_data_invalid');
});
test('W6 forged analysis coordinator calls cannot create a hidden worker',async t=>{
 const f=await workflowFixture(t,[{...agent(),tools:['read_source']}]);await qualified(f);let index=0;const errors=[];
 provider(f,async(messages,tools)=>{for(const row of messages.filter(m=>m.role==='tool')){try{errors.push(JSON.parse(row.content).error);}catch{}}return index++===0?{content:'',calls:[call('delegate_analysis',{goal:'read everything',task:'hidden',sources:['app.txt']})]}:{content:'끝',calls:[]};});
 await f.runner.start({slug:'sample'});assert.ok(errors.includes('tool_unavailable'),JSON.stringify(errors));assert.equal(f.service.store.list('analysis:').length,0);
});
test('W7 human decision schema rejects strings empty arrays and non-string choices',async()=>{
 const {validateWorkflow}=await import('../runtime/workflow-schema.mjs');for(const decision of ['approve|revise',[],['approve',4],['']])assert.equal(validateWorkflow({name:'fixture',version:1,permissions:{tools:[]},steps:[{id:'ok',kind:'human',ask:'?',outputs:{decision}}]}).ok,false,JSON.stringify(decision));
});
test('W8 permissions reject ungranted agent tools including expanded prerequisites',async()=>{
 const {validateWorkflow}=await import('../runtime/workflow-schema.mjs');for(const tools of [[],['read_source'],['propose_new_file']]){
  const result=validateWorkflow({name:'fixture',version:1,permissions:{tools,externalWrite:'never'},steps:[agent()]});assert.equal(result.ok,false);assert.equal(result.errors[0].code,'workflow_permission_widened');
 }
});
test('W8 externalWrite never rejects irreversible commands before an approval exists',async t=>{
 const f=await workflowFixture(t,[{id:'bad',kind:'tool',adapter:'terminal.run',args:{script:'git push --force',profile:'bash'}}]);await qualified(f);const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_external_write_forbidden');assert.equal(f.service.store.list('setup-action:').length,0);
});
test('W8 actual agent invocation enforces external write policy before approval',async t=>{
 const f=await workflowFixture(t,[{...agent(),tools:['propose_setup_action']}]);await qualified(f);let i=0;const errors=[];
 provider(f,async messages=>{for(const row of messages.filter(m=>m.role==='tool'))try{errors.push(JSON.parse(row.content).error);}catch{}return i++===0?{content:'',calls:[call('propose_setup_action',{script:'git push --force',title:'bad',kind:'configure',reason:'fixture',effects:'force push',verification:'exit code',references:[]})]}:{content:'끝',calls:[]};});
 await f.runner.start({slug:'sample'});assert.ok(errors.includes('workflow_external_write_forbidden'));assert.equal(f.service.store.list('setup-action:').length,0);
});
test('W8 step timeout aborts a slow operation and rejects late receipts',async t=>{
 const f=await workflowFixture(t,[{id:'slow',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'},timeout:0.01}]);await qualified(f);const target=f.service.target.bind(f.service);f.service.target=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,60));return target(...args);};
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_step_timeout');await new Promise(resolve=>setTimeout(resolve,80));assert.equal(f.service.store.list('workflow-receipt:').length,0);
});
test('W8 run deadline survives waits and restarts with a two hour cap',async t=>{
 const f=await workflowFixture(t,[human]);let run=await f.runner.start({slug:'sample'});run.createdAt=new Date(Date.now()-7200001).toISOString();f.service.store.set('workflow-run:'+run.id,run);
 run=await f.runner.resume(run.id,{answer:'approve'});assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_run_timeout');
});
test('W8 on_failure retries a read then asks a human after the retry is exhausted',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.read',args:{path:'missing'},on_failure:{retry:1,then:'human'}}]);await qualified(f);
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'waiting');assert.equal(run.steps.read.attempts,2);assert.equal(run.steps.read.phase,'failure');assert.ok(f.service.task(run.taskId).question);
});
test('W8 changed wiki hashes are warnings in the execution report',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'},wiki:[{page:'app.txt',hash:'sha256:old'}]}]);await qualified(f);const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');assert.match(run.report,/workflow_wiki_changed/);
});
test('W9 umbrella creation failure closes its orphan record',async t=>{
 const f=await workflowFixture(t,[human]);f.service.createTask=async()=>{throw Error('task_creation_failed');};await assert.rejects(f.runner.start({slug:'sample'}),/task_creation_failed/);const rows=f.service.store.list('workflow-run:');assert.equal(rows.length,1);assert.equal(rows[0].status,'failed');
});
test('W9 free text stop is content rather than implicit cancellation',async t=>{
 const f=await workflowFixture(t,[{id:'text',kind:'human',ask:'문구?'}]);let run=await f.runner.start({slug:'sample'});run=await f.runner.resume(run.id,{answer:'stop'});assert.equal(run.status,'complete');assert.equal(run.steps.text.output.decision,'stop');
});
test('W9 explicit idempotency keys skip a confirmed effect from an earlier run',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'},idempotency:'ticket:publish'}]);await qualified(f);const first=await f.runner.start({slug:'sample'}),count=f.service.store.list('workflow-receipt:').length;const second=await f.runner.start({slug:'sample'});
 assert.equal(second.status,'complete');assert.equal(second.steps.read.status,'skipped');assert.equal(second.steps.read.reason,'workflow_idempotency_reused');assert.equal(second.steps.read.cachedRunId,first.id);assert.equal(f.service.store.list('workflow-receipt:').length,count);
});
test('W5 an unreadable referenced output closes partial rather than rejecting resume',async t=>{
 const f=await workflowFixture(t,[{id:'first',kind:'human',ask:'입력?'},{id:'second',kind:'tool',adapter:'documents.exists',args:{path:'{{ steps.first.output.path }}'}}]);let run=await f.runner.start({slug:'sample'});const reference={key:'missing-output-ref',hash:'sha256:absent',bytes:10};run.steps.first.outputRef=reference;run.steps.first.status='complete';run.cursor='second';run.status='running';f.service.store.set('workflow-run:'+run.id,run);
 run=await f.runner.resume(run.id);assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_output_missing');
});
test('W8 policy applies inherited exact grants and external MCP classification while send_file remains local',async()=>{
 const {assertWorkflowCall}=await import('../runtime/workflow-policy.mjs');const workflow={permissions:{tools:['documents','mcp__server__send','artifacts'],externalWrite:'never'}};const step={kind:'agent',resolvedTools:['read_source','update_plan','submit_step_output']};
 assert.throws(()=>assertWorkflowCall(workflow,step,'mcp__server__send',{}, {serverId:'server',tool:{name:'send',annotations:{openWorldHint:true}}}),/workflow_external_write_forbidden/);
 assert.doesNotThrow(()=>assertWorkflowCall(workflow,step,'send_file'));assert.doesNotThrow(()=>assertWorkflowCall(workflow,step,'submit_step_output'));
 assert.throws(()=>assertWorkflowCall(workflow,{...step,permissions:{tools:[]}},'read_source'),/workflow_permission_widened/);
});
test('W8 a successful retry has two attempts and does not repeat its completed prefix',async t=>{
 const f=await workflowFixture(t,[{id:'first',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'}},{id:'retry',kind:'tool',adapter:'documents.read',args:{path:'app.txt'},on_failure:{retry:1,then:'human'}}]);await qualified(f);const original=f.service.target.bind(f.service);let calls=0;f.service.target=async(...args)=>{if(++calls===2)throw Error('source_unavailable');return original(...args);};
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');assert.equal(run.steps.first.attempts,1);assert.equal(run.steps.retry.attempts,2);
});
test('W9 an earlier unconfirmed idempotency key cannot be replayed in a new run',async t=>{
 const f=await workflowFixture(t,[{id:'run',kind:'tool',adapter:'terminal.run',args:{script:'echo fixture',profile:'bash'},idempotency:'one-ticket'}]);await qualified(f);const first=await f.runner.start({slug:'sample'});assert.equal(first.status,'waiting');const second=await f.runner.start({slug:'sample'});assert.equal(second.steps.run.status,'unconfirmed');assert.equal(f.service.store.list('setup-action:').length,1);
});
test('W8 a broken template cannot consume retries in an endless loop',async t=>{
 const f=await workflowFixture(t,[{id:'bad',kind:'tool',adapter:'documents.exists',args:{path:'{{ inputs.ticket | invalid }}'},on_failure:{retry:1,then:'human'}}]);await qualified(f);const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.reason,'template_invalid');
});
test('W8 missing wiki material is reported as a warning rather than silently omitted',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'},wiki:[{page:'missing.md',hash:'sha256:old'}]}]);await qualified(f);const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');assert.match(run.report,/workflow_wiki_unavailable/);
});
test('W9 an unchanged idempotent effect is not resent after package documentation changes',async t=>{
 const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'},idempotency:'one-ticket'}]);await qualified(f);const first=await f.runner.start({slug:'sample'});await writeFile(path.join(f.dir,'README.md'),'new guidance');await qualified(f);const second=await f.runner.start({slug:'sample'});assert.notEqual(first.hash,second.hash);assert.equal(second.steps.read.status,'skipped');
});
test('W8 adapter calls enforce narrowed permissions independently of dispatch',async t=>{
 const {createAdapters}=await import('../runtime/workflow-adapters.mjs');const f=await workflowFixture(t,[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'}}]);const run=await f.runner.start({slug:'sample'});run.workflow.steps[0].permissions={tools:[]};f.service.store.set('workflow-run:'+run.id,run);const adapters=createAdapters(f.service,{taskId:run.taskId,runId:run.id});
 await assert.rejects(adapters.documents.exists({path:'app.txt'},{stepId:'read'}),/workflow_permission_widened/);assert.equal(f.service.store.list('workflow-receipt:').length,0);
});
test('W8 expiry while waiting revokes the existing command approval',async t=>{
 const f=await workflowFixture(t,[{id:'run',kind:'tool',adapter:'terminal.run',args:{script:'echo fixture',profile:'bash'},timeout:60}]);await qualified(f);let run=await f.runner.start({slug:'sample'});assert.equal(run.status,'waiting');const action=f.service.store.list('setup-action:')[0];assert.equal(action.state,'proposed');run.steps.run.startedAt=new Date(Date.now()-61000).toISOString();f.service.store.set('workflow-run:'+run.id,run);
 run=await f.runner.resume(run.id);assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_step_timeout');assert.equal(f.service.store.get('setup-action:'+action.id).state,'rejected');
});
