import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {fixture} from './fixtures.mjs';import {ProjectService} from '../runtime/project-service.mjs';import {installAgent} from '../runtime/agent.mjs';import {createWorkflowRunner} from '../runtime/workflow-runner.mjs';import {loadWorkflowPackage} from '../runtime/workflow-package.mjs';import {allowMcpTool,approvalPolicy} from '../runtime/approval-policy.mjs';
installAgent(ProjectService);
async function setup(t,{readOnly=false,externalWrite=true,never=false,fail=false,structured={saved:true},outputs,then=[]}={}){
 const f=await fixture(t),dir=path.join(f.root,'.nubi/workflows/mcp');await mkdir(dir,{recursive:true});const step={id:'apply',kind:'tool',adapter:'mcp.fixture.add_note',args:{text:'합성 메모'},externalWrite,verify:{kind:'output_matches',value:'saved'},...(outputs?{outputs:{schema:outputs}}:{})};await writeFile(path.join(dir,'workflow.yaml'),JSON.stringify({name:'합성 MCP 작업',version:1,permissions:{tools:[step.adapter],externalWrite:never?'never':'ask'},steps:[step,...then]}));
 const pkg=await loadWorkflowPackage(f.root,'mcp');f.service.store.set('workflow-qualified:mcp:'+pkg.definitionHash,{definitionHash:pkg.definitionHash,hash:pkg.hash});const observed=[];let revision=1;const registry={tool:name=>name==='mcp__fixture__add_note'?{serverId:'fixture',tool:{name:'add_note',inputSchema:{type:'object',title:'v'+revision},annotations:{readOnlyHint:readOnly}},readOnly}:null,fingerprint:(name,args)=>createHash('sha256').update(name+JSON.stringify(args)).digest('hex'),call:async(name,args)=>{observed.push({name,args});if(fail)throw Error('mcp_call_timeout');return {ok:true,text:'saved',structured};}};
 f.service.mcpRegistry=()=>registry;return {...f,dir,observed,registry,changeCatalog:()=>revision++,runner:createWorkflowRunner(f.service)};
}
async function answer(f,run,label){const task=f.service.task(run.taskId),option=task.question.options.find(o=>o.label===label);assert.ok(option,'expected approval option '+label);return f.service.answerAgent({taskId:task.id,choice:{questionId:task.question.id,optionId:option.id}});}
test('external MCP effect waits for exact consent and executes once without a model loop',async t=>{
 const f=await setup(t);let run=await f.runner.start({slug:'mcp'});assert.equal(run.status,'waiting');assert.equal(f.observed.length,0);const task=f.service.task(run.taskId);assert.equal(task.question.toolRequest.tool,'add_note');assert.match(task.question.toolRequest.arguments.text,/합성 메모/);assert.equal(task.question.options.some(o=>o.label==='항상 허용'),false);
 run=await answer(f,run,'실행');assert.equal(run.status,'complete');assert.equal(f.observed.length,1);assert.equal((await f.runner.resume(run.id)).status,'complete');assert.equal(f.observed.length,1);assert.equal(f.service.store.list('task:').length,1);assert.equal(f.service.agent?.running||false,false);assert.ok(f.service.task(run.taskId).questionHistory.some(q=>q.workflow?.runId===run.id&&q.answer.text==='실행'));
});
test('externalWrite cannot be bypassed by a saved tool allowance or readOnly hint',async t=>{
 const f=await setup(t,{readOnly:true});allowMcpTool(f.service.store,{serverId:'fixture',tool:'add_note'});const run=await f.runner.start({slug:'mcp'});assert.equal(run.status,'waiting');assert.equal(f.observed.length,0);assert.equal(f.service.task(run.taskId).question.options.some(o=>o.label==='항상 허용'),false);
});
test('readonly MCP tool runs in never mode but an undeclared write is refused at the host',async t=>{
 const read=await setup(t,{readOnly:true,externalWrite:false,never:true});assert.equal((await read.runner.start({slug:'mcp'})).status,'complete');assert.equal(read.observed.length,1);
 const write=await setup(t,{externalWrite:false,never:true});const stopped=await write.runner.start({slug:'mcp'});assert.equal(stopped.status,'partial');assert.equal(stopped.reason,'workflow_external_write_forbidden');assert.equal(write.observed.length,0);
});
test('cancel and changed MCP catalog cannot issue an old approved call',async t=>{
 const cancelled=await setup(t);let run=await cancelled.runner.start({slug:'mcp'});run=await answer(cancelled,run,'취소');assert.equal(run.status,'partial');assert.equal(cancelled.observed.length,0);
 const changed=await setup(t);run=await changed.runner.start({slug:'mcp'});changed.changeCatalog();run=await answer(changed,run,'실행');assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_mcp_changed');assert.equal(changed.observed.length,0);assert.equal(changed.service.task(run.taskId).mcpContinuation?.state==='approved',false);
});
test('a lost MCP write response remains unconfirmed across runner recreation and never replays',async t=>{
 const f=await setup(t,{fail:true});let run=await f.runner.start({slug:'mcp'});run=await answer(f,run,'실행');assert.equal(run.status,'waiting');assert.equal(run.steps.apply.status,'unconfirmed');assert.equal(f.observed.length,1);delete f.service.workflowRunner;run=await createWorkflowRunner(f.service).resume(run.id);assert.equal(run.status,'waiting');assert.equal(f.observed.length,1);
});

test('catalog drift cannot grant a permanent tool allowance before refusing the call',async t=>{const f=await setup(t,{externalWrite:false});let run=await f.runner.start({slug:'mcp'});f.changeCatalog();run=await answer(f,run,'항상 허용');assert.equal(run.status,'partial');assert.equal(f.observed.length,0);assert.equal(approvalPolicy(f.service.store).allowedMcpTools.length,0);});

test('MCP declared fields feed the next step from the actual structured response',async t=>{const f=await setup(t,{structured:{noteId:'SYNTHETIC-NOTE'},outputs:{type:'object',required:['noteId'],properties:{noteId:{type:'string'}}},then:[{id:'inspect',kind:'human',ask:'확인: {{ steps.apply.output.noteId }}'}]});let run=await f.runner.start({slug:'mcp'});run=await answer(f,run,'실행');assert.equal(run.cursor,'inspect');assert.match(f.service.task(run.taskId).question.text,/SYNTHETIC-NOTE/);assert.equal(run.steps.apply.output.noteId,'SYNTHETIC-NOTE');assert.equal(f.observed.length,1);});

test('a mismatched MCP response stops after the issued effect without retrying it',async t=>{const f=await setup(t,{structured:{wrong:42},outputs:{type:'object',required:['noteId'],properties:{noteId:{type:'string'}}}});let run=await f.runner.start({slug:'mcp'});run=await answer(f,run,'실행');assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_output_schema');assert.equal(f.observed.length,1);await f.runner.resume(run.id);assert.equal(f.observed.length,1);});
for(const lost of [false,true])test(`MCP ${lost?'unconfirmed effect':'pending consent'} survives SQLite reopening without duplicate issuance`,async t=>{
 const f=await setup(t,{fail:lost});let run=await f.runner.start({slug:'mcp'});if(lost)run=await answer(f,run,'실행');f.service.dispose();f.service.store.close();
 const second=new ProjectService({storageRoot:path.join(f.directory,'state')});t.after(()=>{second.dispose();second.store.close();});await second.open(f.root);second.mcpRegistry=()=>f.registry;
 run=lost?await createWorkflowRunner(second).resume(run.id):await answer({service:second},run,'실행');assert.equal(run.status,lost?'waiting':'complete');assert.equal(f.observed.length,1);await createWorkflowRunner(second).resume(run.id);assert.equal(f.observed.length,1);
});
