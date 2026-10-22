import {featureTest} from './beta-feature.mjs';const test=featureTest('workflows');
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {createRoutineManager} from '../runtime/routines.mjs';
import {definitionHash,parseWorkflowSchedule,formatWorkflowSchedule,loadWorkflowPackage} from '../runtime/workflow-package.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent((await import('../runtime/project-service.mjs')).ProjectService);

const memory=()=>{const m=new Map();return {get:k=>m.get(k),set:(k,v)=>m.set(k,structuredClone(v)),delete:k=>m.delete(k),list:p=>[...m].filter(([k])=>k.startsWith(p)).map(([,v])=>structuredClone(v))};};
const date=(day,hour=10)=>new Date(2026,9,day,hour,0,0);
const definition=(extra={})=>({name:'합성 루틴 절차',version:1,trigger:{kind:'routine',schedule:'daily 09:00'},inputs:{ticket:{type:'string',required:true,default:'DEMO-101'}},permissions:{tools:['documents'],externalWrite:'never'},steps:[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'app.txt'}}],...extra});
async function setup(t,extra){
 const f=await fixture(t);const dir=path.join(f.root,'.nubi/workflows/routine-flow');await mkdir(path.join(dir,'fixtures'),{recursive:true});
 await writeFile(path.join(dir,'workflow.yaml'),JSON.stringify(definition(extra)));await writeFile(path.join(dir,'fixtures/basic.json'),JSON.stringify({responses:{read:{ok:true,result:{exists:true}}}}));
 f.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>({content:'완료',calls:[]})};
 const store=memory(),events=[],clock={value:date(15)};const manager=createRoutineManager({store,listProjects:async()=>[{id:f.service.projectId,name:'프로젝트',root:f.root}],serviceFor:async()=>f.service,now:()=>clock.value,onActivity:event=>events.push(event)});
 f.service.routines=manager;t.after(()=>manager.stop());return {...f,store,manager,events,clock};
}
const settle=async service=>{for(let n=0;n<200&&(service.workflowActive||service.agent?.running);n++)await new Promise(r=>setTimeout(r,10));};
const qualify=async(service,root)=>{const pkg=await loadWorkflowPackage(root,'routine-flow');service.store.set(`workflow-qualified:routine-flow:${pkg.definitionHash}`,{definitionHash:pkg.definitionHash,runId:'supervised'});return pkg;};

test('definitionHash ignores trigger.schedule and key order but follows the steps; schedule text round-trips',()=>{
 const a=definition(),b={...definition({trigger:{kind:'routine',schedule:'weekly mon 08:30'}})};
 assert.equal(definitionHash(a),definitionHash(b));
 assert.equal(definitionHash(a),definitionHash({...a,steps:[{...a.steps[0]}],name:a.name}));
 assert.notEqual(definitionHash(a),definitionHash(definition({steps:[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'other.txt'}}]})));
 assert.deepEqual(parseWorkflowSchedule('daily 09:00'),{kind:'daily',time:'09:00'});
 assert.deepEqual(parseWorkflowSchedule('weekly mon 08:30'),{kind:'weekly',time:'08:30',weekday:1});
 assert.deepEqual(parseWorkflowSchedule('weekly 0 23:59'),{kind:'weekly',time:'23:59',weekday:0});
 for(const text of ['hourly 09:00','daily 24:00','weekly 09:00','',null])assert.throws(()=>parseWorkflowSchedule(text),/workflow_schedule_invalid/);
 assert.equal(formatWorkflowSchedule({kind:'weekly',time:'08:30',weekday:1}),'weekly mon 08:30');
 assert.equal(formatWorkflowSchedule({kind:'daily',time:'09:00'}),'daily 09:00');
});

test('(a) a workflow routine starts the workflow at its slot with the routine trigger and records the umbrella task',async t=>{
 const {service,root,store,manager,clock}=await setup(t);await qualify(service,root);
 const saved=await manager.save({name:'아침 절차',projectId:service.projectId,kind:'workflow',slug:'routine-flow',inputs:{ticket:'DEMO-7'},schedule:{kind:'daily',time:'09:00'},enabled:true});
 assert.equal(saved.kind,'workflow');assert.equal(saved.slug,'routine-flow');assert.equal(saved.request,undefined);
 clock.value=date(16);await manager.tick();await settle(service);
 const runs=service.store.list('workflow-run:');assert.equal(runs.length,1);
 assert.equal(runs[0].trigger.kind,'routine');assert.equal(runs[0].trigger.routineId,saved.id);assert.equal(runs[0].inputs.ticket,'DEMO-7');
 assert.equal(store.get('routine:'+saved.id).lastTaskId,runs[0].taskId);assert.equal(service.task(runs[0].taskId).routineId,saved.id);
 assert.equal(runs[0].supervised,false,'a qualified definition runs unattended');
});

test('(b) a pending umbrella task blocks the next slot without a second start',async t=>{
 const {service,root,store,manager,clock}=await setup(t);await qualify(service,root);
 const saved=await manager.save({name:'아침 절차',projectId:service.projectId,kind:'workflow',slug:'routine-flow',inputs:{},schedule:{kind:'daily',time:'09:00'},enabled:true});
 clock.value=date(16);await manager.tick();await settle(service);const first=service.store.list('workflow-run:')[0];
 service.store.set('task:'+first.taskId,{...service.task(first.taskId),state:'waiting_input'});
 clock.value=date(17);await manager.tick();await settle(service);
 assert.equal(service.store.list('workflow-run:').length,1);
});

test('(c) without supervision the routine does not start and leaves exactly one supervision notice',async t=>{
 const {service,root,store,manager,events,clock}=await setup(t);
 const saved=await manager.save({name:'아침 절차',projectId:service.projectId,kind:'workflow',slug:'routine-flow',inputs:{},schedule:{kind:'daily',time:'09:00'},enabled:true});
 clock.value=date(16);await manager.tick();await settle(service);await manager.tick();await settle(service);
 assert.equal(service.store.list('workflow-run:').length,0);
 assert.equal(store.get('routine:'+saved.id).lastError,'workflow_supervision_required');
 assert.deepEqual(events.filter(e=>e.phase==='supervision_required').map(e=>e.slug),['routine-flow']);
 await assert.rejects(manager.runNow({id:saved.id}),/workflow_supervision_required/);
 assert.equal(service.store.list('workflow-run:').length,0);
});

test('(d) a routine trigger in YAML only proposes registration; the person enables it',async t=>{
 const {service,store}=await setup(t);
 const rows=await service.invoke('listWorkflows',{});const row=rows.find(r=>r.slug==='routine-flow');
 assert.equal(row.trigger.kind,'routine');assert.equal(row.routine,null);assert.equal(row.proposal?.state,'proposed');
 assert.equal(service.store.list('routine-proposal:').length,1);assert.equal(store.list('routine:').length,0);
 await service.invoke('listWorkflows',{});assert.equal(service.store.list('routine-proposal:').length,1);
 const registered=await service.invoke('registerWorkflowRoutine',{slug:'routine-flow',enabled:true});
 assert.equal(registered.kind,'workflow');assert.deepEqual(registered.schedule,{kind:'daily',time:'09:00'});assert.equal(registered.projectId,service.projectId);
 assert.equal(service.store.get('routine-proposal:routine-flow').state,'accepted');
 const after=(await service.invoke('listWorkflows',{})).find(r=>r.slug==='routine-flow');
 assert.equal(after.routine.id,registered.id);assert.ok(after.routine.nextRunAt);assert.equal(after.proposal,null);
 await assert.rejects(service.invoke('registerWorkflowRoutine',{slug:'routine-flow',enabled:true}),/routine_exists/);
});

test('(e) changing the schedule rewrites trigger.schedule and keeps definitionHash and supervision',async t=>{
 const {service,root,store,manager}=await setup(t);const pkg=await qualify(service,root);
 const registered=await service.invoke('registerWorkflowRoutine',{slug:'routine-flow',enabled:true});
 const changed=await manager.save({...registered,schedule:{kind:'weekly',time:'07:15',weekday:3}});
 assert.deepEqual(changed.schedule,{kind:'weekly',time:'07:15',weekday:3});
 const yaml=await readFile(path.join(root,'.nubi/workflows/routine-flow/workflow.yaml'),'utf8');assert.match(yaml,/weekly wed 07:15/);
 const reloaded=await loadWorkflowPackage(root,'routine-flow');
 assert.equal(reloaded.definitionHash,pkg.definitionHash);assert.notEqual(reloaded.hash,pkg.hash);
 assert.ok(service.store.get(`workflow-qualified:routine-flow:${reloaded.definitionHash}`));
 const row=(await service.invoke('listWorkflows',{})).find(r=>r.slug==='routine-flow');assert.equal(row.qualified,true);
 assert.equal(store.get('routine:'+registered.id).schedule.weekday,3);
});

test('(f) a prompt routine proposes promotion once after three successful runs',async t=>{
 const {service,store,manager}=await setup(t);
 const saved=await manager.save({name:'점검',projectId:service.projectId,request:'점검해 주세요',schedule:{kind:'daily',time:'09:00'},enabled:true});
 for(let day=16;day<=19;day++){
  store.set('routine:'+saved.id,{...store.get('routine:'+saved.id),lastRunAt:date(day-1).toISOString()});
  const result=await manager.runNow({id:saved.id});await service.agent?.promise;
  service.store.set('task:'+result.taskId,{...service.task(result.taskId),state:'completed'});manager.observe(service);
  assert.equal(service.store.list('workflow-promotion:').length,day>=18?1:0,'day '+day);
 }
 const proposal=service.store.list('workflow-promotion:')[0];assert.equal(proposal.routineId,saved.id);assert.equal(proposal.request,'점검해 주세요');
});
