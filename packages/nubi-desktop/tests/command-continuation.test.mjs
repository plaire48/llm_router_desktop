import test from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {skillCatalog} from '../runtime/agent-capabilities.mjs';
import assert from 'node:assert/strict';
import {continuationBinding,continueCommandPlan} from '../runtime/command-continuation.mjs';
import {fixture,fixturePlan,fixtureReview} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {hostShell} from '../runtime/processes.mjs';
import {readSource} from '../runtime/files.mjs';
installAgent(ProjectService);
const seed=()=>{
 const task={id:'t',request:'두 명령의 결과를 확인',criteria:[],messages:[],workPlan:{runId:'before',intent:{goal:'결과 확인',constraints:[],outcomes:['두 출력 확인'],workflowIds:[],skillPaths:[]},steps:[{text:'출력 확인',expected_outcome:'실제 값',status:'in_progress'}]}};
 const context={task,workspace:'/project',rules:'rules-hash',scope:null,skills:[]};
 const binding=continuationBinding(context);task.workPlan.commandContinuation={actionId:'a',binding};
 return {task,context,binding,runId:'after',capabilities:{workflows:[],skills:[]},action:{id:'a',taskId:'t',state:'started',resultProcessId:'p'},process:{id:'p',taskId:'t',setupActionId:'a',execution:'started',state:'completed',exitCode:0}};
};
test('only a matching successful command carries the provisional plan, without authority',()=>{
 const x=seed(),plan=continueCommandPlan(x);assert.equal(plan.runId,'after');assert.equal(plan.continuedFrom,'before');assert.equal(plan.commandContinuation,null);
 assert.equal(plan.steps[0].status,'in_progress');assert.equal(x.task.workPlan.runId,'before');
 for(const mutation of [x=>x.process.exitCode=1,x=>x.process.state='interrupted',x=>x.process.execution='unknown',x=>x.process.taskId='other',x=>x.action.resultProcessId='other',x=>x.action.state='proposed',x=>x.task.state='cancelled',x=>x.process.stopReason='cancelled',x=>x.action=null]){const y=seed();mutation(y);assert.equal(continueCommandPlan(y),null);}
});
test('new requirements, workspace, rules, scope, mail or skills require a fresh plan',()=>{
 for(const mutation of [x=>x.task.messages.push({role:'user',content:'다른 작업'}),x=>x.task.criteria.push('새 조건'),x=>x.task.questionHistory=[{answer:'새 결정'}],x=>x.workspace='/other',x=>x.rules='changed',x=>x.scope='mail',x=>x.task.mailReferences=[{id:'mail'}],x=>x.skills.push({path:'skill',hash:'new'})]){const y=seed();mutation(y.context);y.binding=continuationBinding(y.context);assert.equal(continueCommandPlan(y),null);}
});
test('unknown old capabilities and invalid plans cannot bypass planning',()=>{
 const x=seed();x.task.workPlan.intent.skillPaths=['missing'];assert.equal(continueCommandPlan(x),null);
 const y=seed();y.task.workPlan.steps=[];assert.equal(continueCommandPlan(y),null);
});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const wait=async fn=>{for(let i=0;i<700;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('continuation timeout');};
test('two approved commands pause without narration/review and continue one plan to a final review',async t=>{
 const {service}=await fixture(t,{scriptedPlanning:true,scriptedReview:true});let plans=0,reviews=0,actor=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
  const plan=fixturePlan(messages);if(plan){plans++;return plan;}
  const review=fixtureReview(messages);if(review){reviews++;return review;}
  actor++;
  const processes=service.store.list('process:'),actions=service.store.list('setup-action:');
  if(actions.some(a=>a.state==='proposed'))assert.fail('model called after approval became pending');
  if(processes.length<2)return call('propose_setup_action',{title:'출력 확인',kind:'inspect',profile:hostShell(),script:processes.length?'echo SECOND_RESULT':'echo FIRST_RESULT',reason:'두 출력 확인',effects:'표준 출력만',verification:'실제 출력 비교',references:[]});
  assert.match(JSON.stringify(messages),/FIRST_RESULT/);assert.match(JSON.stringify(messages),/SECOND_RESULT/);
  return {content:'두 출력은 FIRST_RESULT와 SECOND_RESULT입니다.',calls:[]};
 }};
 const task=await service.createTask({request:'두 명령의 출력을 순서대로 확인해 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(reviews,0);assert.equal(actor,1);assert.equal(service.task(task.id).messages.filter(m=>m.role==='assistant').length,0);
 for(let i=0;i<2;i++){
  const action=service.store.list('setup-action:').find(a=>a.state==='proposed');assert(action);
  await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  await wait(()=>!service.agent.running&&service.store.list('process:').length===i+1&&service.store.list('process:').every(p=>p.recoveryState==='review'));
 }
 assert.equal(plans,1);assert.equal(reviews,1);assert.equal(actor,3);
 assert.equal(service.task(task.id).state,'review');
 assert.equal(service.store.list('process:').length,2);
});

test('independent original mail reads share one model turn and keep distinct citations',async t=>{
 const {service}=await fixture(t);let actors=0;const ids=['a'.repeat(64),'b'.repeat(64)],read=[];
 service.mail=async args=>{read.push(args.id);return {id:args.id,sourceHash:'hash-'+args.id,mail:{subject:args.id===ids[0]?'기본':'추가',from:'sender@example.test',date:'2026-10-12',text:args.id===ids[0]?'담당자는 이하린':'문서는 운영매뉴얼',attachments:[]}};};
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
  if(++actors===1)return {content:'',calls:ids.flatMap(id=>call('read_personal_mail',{id}).calls)};
  assert.deepEqual(read,ids);const sources=messages.filter(m=>m.role==='tool').flatMap(m=>{try{return JSON.parse(m.content).citations||[];}catch{return [];}});
  assert.equal(sources.length,2);
  return {content:`담당자는 이하린이고 문서는 운영매뉴얼입니다. ${sources.map((s,i)=>`[${i+1}](${s.href})`).join(' ')}`,calls:[]};
 }};
 const task=await service.createTask({request:'/mail 담당자와 문서를 알려 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(actors,2);assert.equal(service.task(task.id).messages.at(-1).sourceReferences.length,2);
});

test('a successful command reuses verified skill instructions and preserves constraints without another skill call',async t=>{
 const {service,root}=await fixture(t),skillPath='.nubi/skill/keep-order/SKILL.md';
 await mkdir(path.join(root,'.nubi/skill/keep-order'),{recursive:true});await writeFile(path.join(root,skillPath),'---\nname: keep-order\ndescription: Keep order\n---\nKEEP_ORDER_GUIDANCE\n');
 const skill=(await skillCatalog(root)).skills[0];let actors=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
  actors++;
  if(actors===1)return call('use_skill',{path:skill.path,expectedHash:skill.hash});
  if(actors===2)return call('update_plan',{intent:{goal:'출력 확인',constraints:['개별 명령 승인'],outcomes:['출력 확인'],workflowIds:[],skillPaths:[skill.path]},steps:[{text:'출력 확인',expected_outcome:'실제 결과',status:'in_progress'}]});
  if(actors===3)return call('propose_setup_action',{title:'출력 확인',kind:'inspect',profile:hostShell(),script:'echo SKILL_RESULT',reason:'결과 확인',effects:'출력만',verification:'출력 확인',references:[]});
  const host=messages.findLast(m=>m.role==='user'&&m.content.startsWith('Current host receipts'));
  assert.match(host.content,/loadedSkillInstructions/);assert.match(host.content,/KEEP_ORDER_GUIDANCE/);assert.match(host.content,/개별 명령 승인/);
  return {content:'SKILL_RESULT를 확인했습니다.',calls:[]};
 }};
 const task=await service.createTask({request:'명령을 개별 승인하고 출력을 확인하세요.'});await service.startAgent({taskId:task.id});await service.agent.promise;
 const action=service.store.list('setup-action:')[0];await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
 await wait(()=>!service.agent.running&&service.store.list('process:').every(p=>p.recoveryState==='review'));
 assert.equal(actors,4);assert.equal(service.task(task.id).state,'review');
});

test('separate approvals reuse freshly verified setup prerequisites without stale-read repair turns',async t=>{
 const {service,root}=await fixture(t),file=await readSource(root,'app.txt');let actors=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
  actors++;
  if(actors===1)return call('read_source',{path:'app.txt'});
  const processes=service.store.list('process:');
  if(processes.length){
   const host=messages.findLast(m=>m.role==='user'&&m.content.startsWith('Current host receipts'));
   assert.match(host.content,/setupPrerequisites/);assert.match(host.content,/setup_reference_only/);
   assert.match(host.content,/first/);
  }
  if(processes.length<2)return call('propose_setup_action',{title:'결과 확인',kind:'inspect',profile:hostShell(),script:processes.length?'echo SECOND':'echo FIRST',reason:'두 결과 확인',effects:'출력만',verification:'실제 출력',references:[{path:file.path,hash:file.hash}]});
  return {content:'FIRST와 SECOND를 확인했습니다.',calls:[]};
 }};
 const task=await service.createTask({request:'app.txt를 참고하고 두 명령을 개별 승인해 결과를 확인하세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 for(let i=0;i<2;i++){
  const action=service.store.list('setup-action:').find(a=>a.state==='proposed');assert(action);
  await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  await wait(()=>!service.agent.running&&service.store.list('process:').length===i+1&&service.store.list('process:').every(p=>p.recoveryState==='review'));
 }
 assert.equal(actors,4);assert.equal(service.task(task.id).state,'review');
 assert.equal(service.store.list('operation:').filter(o=>o.receipt?.error==='source_read_required').length,0);
});
