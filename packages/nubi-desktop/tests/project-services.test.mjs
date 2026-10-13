import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {ProjectService,resolveProjectFolder} from '../runtime/project-service.mjs';
import {ProjectServices} from '../runtime/project-services.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {desktopUsage} from '../runtime/usage.mjs';
import {fixturePlan,fixtureReview} from './fixtures.mjs';
installAgent(ProjectService);
const status=()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const gate=()=>{let release;return {promise:new Promise(r=>release=r),release:()=>release()};};
async function fixture(t){
 const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-projects-'))),a=path.join(temp,'a'),b=path.join(temp,'b'),storageRoot=path.join(temp,'state');
 await Promise.all([mkdir(a),mkdir(b)]);await Promise.all([writeFile(path.join(a,'app.txt'),'A ORIGINAL'),writeFile(path.join(b,'app.txt'),'B ORIGINAL')]);
 const service=new ProjectService({storageRoot}),pool=new ProjectServices({service,createService:()=>new ProjectService({storageRoot}),resolveRoot:resolveProjectFolder});
 t.after(async()=>{const services=[...pool.projects.values()];pool.dispose();await Promise.all(services.flatMap(s=>[...s.agentRuns?.values()||[]].map(run=>run.promise)));for(const s of services)s.store?.close();await rm(temp,{recursive:true,force:true});});
 const open=root=>pool.invoke('open',{root,initializeWiki:false});
 return {temp,a,b,service,pool,open};
}
test('a live agent keeps its project, store and answer while another folder runs a second agent',async t=>{
 const {a,b,service,pool,open}=await fixture(t),entered=gate(),release=gate();t.after(()=>release.release());let disposals=0;
 service.providers={status,dispose(){disposals++;},complete:async(messages,tools,signal)=>{
  const scripted=fixturePlan(messages)||fixtureReview(messages);if(scripted)return scripted;
  const first=messages.some(m=>m.role==='user'&&m.content==='ALPHA REQUEST');
  if(first){entered.release();await Promise.race([release.promise,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))]);}
  return {content:first?'ALPHA ANSWER':'BETA ANSWER',calls:[]};
 }};
 await open(a);const storeA=service.store,taskA=await pool.invoke('createTask',{request:'ALPHA REQUEST'});
 await pool.invoke('startAgent',{taskId:taskA.id});const runA=service.agentForTask(taskA.id);await entered.promise;
 const projectB=await open(b),serviceB=pool.current;
 await assert.rejects(pool.invoke('read',{path:'app.txt',full:true,_projectId:service.projectId}),/project_changed/);
 const currentSource=await pool.invoke('read',{path:'app.txt',full:true});await assert.rejects(pool.invoke('saveSource',{path:'app.txt',content:'WRONG PROJECT',expectedHash:currentSource.hash,_projectId:service.projectId}),/project_changed/);assert.notEqual(serviceB,service);assert.equal(service.root,a);assert.equal(service.store,storeA);assert.equal(runA.running,true);assert.equal(runA.controller.signal.aborted,false);
 assert.equal(projectB.backgroundActive,true);assert.equal(projectB.backgroundProjects[0].projectId,service.projectId);
 assert.equal((await service.read({path:'app.txt',full:true})).content,'A ORIGINAL');assert.equal((await pool.invoke('read',{path:'app.txt',full:true})).content,'B ORIGINAL');
 const taskB=await pool.invoke('createTask',{request:'BETA REQUEST'});await pool.invoke('startAgent',{taskId:taskB.id});await serviceB.agentForTask(taskB.id).promise;
 assert.equal(serviceB.task(taskB.id).state,'review',JSON.stringify(serviceB.task(taskB.id)));assert.equal(serviceB.task(taskB.id).messages.at(-1).content,'BETA ANSWER');assert.equal(serviceB.store.get('task:'+taskA.id),null);
 await assert.rejects(pool.invoke('provider',{action:'model',input:{model:'other'}}),/agent_busy/);await assert.rejects(pool.invoke('fabrix',{method:'CONNECT_FABRIX'}),/agent_busy/);await assert.rejects(pool.invoke('prepareAppUpdate'),/update_work_active/);
 release.release();await runA.promise;assert.equal(service.task(taskA.id).messages.at(-1).content,'ALPHA ANSWER');assert.equal(service.store.get('task:'+taskB.id),null);assert.equal(disposals,0);
 await open(a);assert.equal(pool.current,service);assert.equal(service.store,storeA);assert.equal(service.task(taskA.id).state,'review');
 assert.equal(await readFile(path.join(a,'app.txt'),'utf8'),'A ORIGINAL');assert.equal(await readFile(path.join(b,'app.txt'),'utf8'),'B ORIGINAL');
});
test('background questions remain identifiable; failed folder opening does not select a broken project',async t=>{
 const {a,b,service,pool,open}=await fixture(t);await open(a);const task=await service.createTask({request:'질문 보존'});service.store.set('task:'+task.id,{...task,state:'waiting_input',question:{id:'q',text:'어느 범위인가요?'}});
 await open(b);const state=await pool.invoke('state');assert.equal(state.backgroundDecisions.length,1);assert.equal(state.backgroundDecisions[0].projectId,service.projectId);assert.equal(state.backgroundDecisions[0].taskId,task.id);assert.equal(state.backgroundProjects[0].waitingInput,true);
 assert.equal((await pool.invoke('projectActivity',{projectId:service.projectId})).active,true);
 const selected=pool.current;await assert.rejects(open(path.join(b,'missing')),/project_path_missing/);assert.equal(pool.current,selected);
 await open(a);assert.equal(service.task(task.id).question.id,'q');
});
test('nested Git paths reuse the same project service and checkout',async t=>{
 const {a,pool,open}=await fixture(t);await promisify(execFile)('git',['init','-q',a]);await mkdir(path.join(a,'nested'));await open(a);const first=pool.current;
 await open(path.join(a,'nested'));assert.equal(pool.current,first);assert.equal(pool.projects.size,1);
 await assert.rejects(pool.invoke('open',{root:path.join(a,'nested'),initializeWiki:false,exactRoot:true}),/clone_root_mismatch/);assert.equal(pool.current,first);
});
test('account, mail, marketplace and usage ownership survive folder switches and dispose once',async t=>{
 const {a,b,service,pool,open}=await fixture(t);await open(a);let providers=0,mail=0;service.providers={status:()=>({connected:false}),dispose(){providers++;}};service.personalMail={dispose(){mail++;}};service.marketplaceToken='fixture-only';const ledger=desktopUsage(service);assert(ledger);
 await open(b);assert.equal(pool.current.providers,service.providers);assert.equal(pool.current.personalMail,service.personalMail);assert.equal(pool.current.marketplaceToken,'fixture-only');assert.equal(desktopUsage(pool.current),ledger);
 const call=ledger.start({provider:'aipro'});ledger.finish(call,{inputTokens:12,outputTokens:4});assert.deepEqual(desktopUsage(pool.current).summary(),ledger.summary());
 pool.dispose();assert.equal(providers,1);assert.equal(mail,1);assert.equal(ledger.closed,true);pool.dispose();assert.equal(providers,1);assert.equal(mail,1);
});

test('background Wiki status identifies its owning project and clears after completion or abort',async t=>{
 const {a,b,service,pool,open}=await fixture(t);await open(a);
 const owner=service.projectId;service.wikiInitController=new AbortController();service.wikiInitOwner=service.store;
 service.store.set('wiki-init',{id:'wiki-a',projectId:owner,state:'running',stage:'reading',completed:2,total:10,percent:20});
 await open(b);let state=await pool.invoke('state');
 assert.equal(state.backgroundProjects[0].projectId,owner);assert.equal(state.backgroundProjects[0].root,a);
 assert.equal(state.backgroundProjects[0].running,false,'Wiki work is distinct from an agent turn');
 assert.equal(state.backgroundProjects[0].wikiChatJob.id,'wiki-a');assert.equal(state.backgroundProjects[0].wikiChatJob.percent,20);
 service.wikiInitController.abort();assert.equal((await pool.invoke('state')).backgroundProjects[0].wikiChatJob,null);
 service.wikiInitController=null;service.wikiUpdateRun={id:'update-a',controller:new AbortController(),owner:service.store};
 service.store.set('wiki-update:update-a',{id:'update-a',state:'running',events:[{type:'progress',stage:'generating',index:3,total:4}]});
 state=await pool.invoke('state');assert.equal(state.backgroundProjects[0].wikiChatJob.kind,'update');assert.equal(state.backgroundProjects[0].wikiChatJob.projectId,owner);
 service.store.set('wiki-update:update-a',{id:'update-a',state:'completed'});assert.equal((await pool.invoke('state')).backgroundProjects[0].wikiChatJob,null);
});
