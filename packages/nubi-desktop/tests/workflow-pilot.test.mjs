import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {createWorkflowRunner} from '../runtime/workflow-runner.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {fixturePlan,fixtureReview} from './fixtures.mjs';
installAgent(ProjectService);
async function pilot(t){const f=await fixture(t);await mkdir(path.join(f.root,'.nubi'),{recursive:true});await cp(new URL('./workflow-fixture-project/.nubi/workflows',import.meta.url),path.join(f.root,'.nubi/workflows'),{recursive:true});return f;}
test('the shipped synthetic pilot resolves prerequisites and requires independent file completion',async t=>{
 const {service}=await pilot(t),checked=await service.validateWorkflow({slug:'change-request-definition'});assert.equal(checked.workflow.permissions.externalWrite,'never');assert.deepEqual(checked.workflow.steps.map(s=>s.id),['read-ticket','draft','approve','verify','report']);const draft=checked.workflow.steps[1];for(const tool of ['inspect_path','record_change_plan','submit_step_output'])assert.ok(draft.resolvedTools.includes(tool));assert.equal(draft.done_when.kind,'all_of');assert.equal(checked.workflow.steps[4].done_when.kind,'output_schema');
});
test('the synthetic pilot dry-run completes allfive steps without writing or qualifying a run',async t=>{
 const f=await pilot(t),run=await createWorkflowRunner(f.service).start({slug:'change-request-definition',mode:'dry-run'});assert.equal(run.status,'complete',run.reason);assert.equal(Object.values(run.steps).filter(s=>s.status==='complete').length,5);assert.match(run.report,/합성 시험/);assert.equal(f.service.store.list('proposal:').length,0);assert.equal(f.service.store.list('workflow-qualified:').length,0);await assert.rejects(access(path.join(f.root,'out/change-request.md')));
});
test('an approved pilot file resumes its existing agent and reaches human review without repeating a write',async t=>{
 const f=await pilot(t);await cp(new URL('./workflow-fixture-project/fixtures',import.meta.url),path.join(f.root,'fixtures'),{recursive:true});await cp(new URL('./workflow-fixture-project/openwiki',import.meta.url),path.join(f.root,'openwiki'),{recursive:true});await mkdir(path.join(f.root,'out'));
 const content=await readFile(new URL('./workflow-pilot-expected.md',import.meta.url),'utf8'),calls=[];let draftTurns=0,reportTurns=0;
 const call=(name,args)=>{calls.push(name);return {content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]};};
 f.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),async complete(messages){
  const envelope=fixturePlan(messages)||fixtureReview(messages);if(envelope)return envelope;
  const results=messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(m.content);}catch{return {};}}),evidence=results.flatMap(r=>r.workflowEvidence||[]).map(r=>r.id);
  if(messages.some(m=>m.role==='user'&&String(m.content).includes('티켓 원문은'))){
   switch(draftTurns++){
    case 0:return call('wiki_query',{query:'합성 변경 절차'});
    case 1:return call('read_source',{path:'openwiki/pilot-change-policy.md'});
    case 2:return call('inspect_path',{path:'out/change-request.md'});
    case 3:return call('record_change_plan',{summary:'합성 정의서 작성',requirements:[{id:'R1',text:'합성 정의서 작성'}],targets:[{path:'out/change-request.md',action:'create',reason:'합성 요청',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'inspection',description:'원문과 파일 대조'}],assumptions:[]});
    case 4:return call('propose_new_file',{path:'out/change-request.md',content,reason:'합성 요청'});
    default:return call('submit_step_output',{output:{summary:'합성 정의서 작성',evidence}});
   }
  }
  if(reportTurns++===0)return call('read_source',{path:'out/change-request.md'});
  return call('submit_step_output',{output:{summary:'로컬 작성만 완료했습니다. 실제 JSM은 미검증입니다.',evidence}});
 },dispose(){}};
 const runner=createWorkflowRunner(f.service);let run=await runner.start({slug:'change-request-definition'});assert.equal(run.cursor,'read-ticket');run=await runner.resume(run.id,{answer:'approve'});assert.equal(run.cursor,'draft');run=await runner.resume(run.id,{answer:'approve'});
 const proposal=f.service.store.list('proposal:').find(p=>p.kind==='create');assert.ok(proposal,JSON.stringify({status:run.status,reason:run.reason,draftTurns,calls}));await assert.rejects(access(path.join(f.root,'out/change-request.md')));await f.service.applyNewFile({proposalId:proposal.id});run=await runner.notify(run.id);
 assert.equal(run.status,'waiting',JSON.stringify({status:run.status,reason:run.reason,calls}));assert.equal(run.cursor,'approve');assert.equal(calls.filter(c=>c==='propose_new_file').length,1);assert.equal(await readFile(path.join(f.root,'out/change-request.md'),'utf8'),content);
 run=await runner.resume(run.id,{answer:'approve'});assert.equal(run.cursor,'verify');run=await runner.resume(run.id,{answer:'approve'});assert.equal(run.cursor,'report');run=await runner.resume(run.id,{answer:'approve'});assert.equal(run.status,'complete',run.reason);assert.notEqual(run.steps.draft.taskId,run.steps.report.taskId);assert.equal(f.service.store.list('workflow-qualified:').length,1);
});
