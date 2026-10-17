import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
test('invalid cancellation input cannot leave a process reserved',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'Validate admission'});
 await assert.rejects(service.run({taskId:task.id,script:'printf invalid > must-not-run.txt',profile:'bash',signal:{}}),/command_invalid/);
 assert.equal(service.store.list('process:').length,0);assert.equal(service.processes.pending.size,0);
 await assert.rejects(access(path.join(root,'must-not-run.txt')));
});
async function repairFixture(t){
 const h=await fixture(t),task=await h.service.createTask({request:'Repair once'});
 const original=await h.service.run({taskId:task.id,script:'exit 1',profile:'bash',autoDiagnose:false});
 while(h.service.processes.active.size)await new Promise(resolve=>setTimeout(resolve,10));
 const repair=await h.service.proposeCommandRepair({taskId:task.id,processId:original.id,profile:'bash',script:'printf repaired > must-not-run.txt',reason:'Inspect before retry'});
 return {...h,task,repair};
}

test('a late repair approval cannot execute after the user stopped its task',async t=>{
 const {service,task,repair,root}=await repairFixture(t);
 await service.stopAgent({taskId:task.id});
 await assert.rejects(service.applyCommandRepair({id:repair.id}),/setup_cancelled/);
 assert.equal(service.store.list('process:').length,1);await assert.rejects(access(path.join(root,'must-not-run.txt')));
});

test('stop during repair workspace validation prevents dispatch and preserves the original receipt',async t=>{
 const {service,task,repair,root}=await repairFixture(t),entered=gate(),hold=gate(),target=service.target.bind(service);
 service.target=async id=>{entered.release();await hold.promise;return target(id);};
 const starting=service.applyCommandRepair({id:repair.id});const outcome=starting.then(value=>({value}),error=>({error}));
 await entered.promise;await service.stopAgent({taskId:task.id});hold.release();
 assert.equal((await outcome).error?.message,'setup_cancelled');
 assert.equal(service.store.list('process:').length,1);assert.equal(service.store.get('command-repair:'+repair.id).state,'attention');
 await assert.rejects(access(path.join(root,'must-not-run.txt')));
});

test('stop during shell preflight prevents a repaired command from spawning later',async t=>{
 const {service,task,repair,root}=await repairFixture(t),entered=gate(),hold=gate(),profiles=service.processes.profiles;
 service.processes.profiles=async()=>{entered.release();await hold.promise;return profiles();};
 const starting=service.applyCommandRepair({id:repair.id});const outcome=starting.then(value=>({value}),error=>({error}));
 await entered.promise;await service.stopAgent({taskId:task.id});hold.release();
 const result=await outcome;
 assert(!result.error,result.error?.stack);const receipt=service.processes.poll(result.value.resultProcessId);
 assert.equal(receipt.state,'cancelled');assert.equal(receipt.execution,'not_started');assert.equal(service.processes.active.size,0);
 await assert.rejects(access(path.join(root,'must-not-run.txt')));
});

test('stopping another conversation does not cancel an approved repair',async t=>{
 const {service,task,repair,root}=await repairFixture(t),other=await service.createTask({request:'Other conversation'}),entered=gate(),hold=gate(),profiles=service.processes.profiles;
 service.processes.profiles=async()=>{entered.release();await hold.promise;return profiles();};
 const starting=service.applyCommandRepair({id:repair.id});await entered.promise;
 await service.stopAgent({taskId:other.id});hold.release();const result=await starting;
 while(service.processes.active.size)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(service.processes.poll(result.resultProcessId).state,'completed');assert.equal(await readFile(path.join(root,'must-not-run.txt'),'utf8'),'repaired');
 assert.equal(service.repairStarts.size,0);
});

test('a pending repair protects its project and task until its admission settles',async t=>{
 const {service,task,repair,root,directory}=await repairFixture(t),entered=gate(),hold=gate(),target=service.target.bind(service),otherRoot=path.join(directory,'other');
 await mkdir(otherRoot);service.target=async id=>{entered.release();await hold.promise;return target(id);};
 const starting=service.applyCommandRepair({id:repair.id});const outcome=starting.then(value=>({value}),error=>({error}));
 await entered.promise;
 try{
  await assert.rejects(service.open(otherRoot),/project_busy/);
  await assert.rejects(service.createWorktree({taskId:task.id}),/project_busy/);
  await assert.rejects(service.deleteTask({taskId:task.id}),/agent_busy/);
  assert.throws(()=>service.prepareAppUpdate(),/update_work_active/);
  assert.equal(service.root,root);
 }finally{await service.stopAgent({taskId:task.id});hold.release();await outcome;}
 assert.equal(service.repairStarts.size,0);
});
