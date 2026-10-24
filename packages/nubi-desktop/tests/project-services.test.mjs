import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {ProjectService,resolveProjectFolder} from '../runtime/project-service.mjs';
import {ProjectServices} from '../runtime/project-services.mjs';
import {stopProjectWork} from '../runtime/project-navigation.mjs';
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

test('a real server belongs to its original project across selection and re-entry',async t=>{
 const {a,b,service,pool,open}=await fixture(t);await open(a);
 await writeFile(path.join(a,'server.cjs'),"require('node:http').createServer((req,res)=>res.end('PROJECT_A_SERVER')).listen(0,'127.0.0.1',function(){console.log('PORT='+this.address().port)});");
 const task=await service.createTask({request:'계속 실행할 서버'}),record=await service.processes.start({cwd:a,taskId:task.id,script:'node server.cjs',idleCheck:false,autoDiagnose:false});
 try{
  for(const deadline=Date.now()+10000;!service.processes.poll(record.id).output.includes('PORT=')&&Date.now()<deadline;)await new Promise(resolve=>setTimeout(resolve,10));
  const port=/PORT=(\d+)/.exec(service.processes.poll(record.id).output)?.[1];assert(port);const address=`http://127.0.0.1:${port}`;
  assert.equal(await (await fetch(address)).text(),'PROJECT_A_SERVER');const store=service.store;
  const selected=await open(b);assert.equal(selected.backgroundProjects[0].processCount,1);assert.equal(service.store,store);assert.equal(service.processes.poll(record.id).state,'running');
  assert.equal(await (await fetch(address)).text(),'PROJECT_A_SERVER');await assert.rejects(pool.invoke('poll',{id:record.id,_projectId:service.projectId}),/project_changed/);
  await open(a);assert.equal(pool.current,service);assert.equal((await pool.invoke('poll',{id:record.id})).state,'running');assert.equal(await (await fetch(address)).text(),'PROJECT_A_SERVER');
  await pool.invoke('stop',{id:record.id});while(service.processes.active.size)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(service.processes.poll(record.id).state,'cancelled');
 }finally{service.processes.stop(record.id);while(service.processes.active.size)await new Promise(resolve=>setTimeout(resolve,10));}
});

test('explicit user navigation cancels every current conversation before selecting another project',async t=>{
 const {a,b,service,pool,open}=await fixture(t),entered=[];
 service.providers={status,dispose(){},complete:async(messages,tools,signal)=>{
  const scripted=fixturePlan(messages)||fixtureReview(messages);if(scripted)return scripted;
  entered.push(true);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
 }};
 await open(a);const originalStore=service.store;
 const first=await pool.invoke('createTask',{request:'처음 실행'}),second=await pool.invoke('createTask',{request:'동시에 실행'}),waiting=await pool.invoke('createTask',{request:'확인 대기'});
 service.store.set('task:'+waiting.id,{...waiting,state:'waiting_input',question:{id:'navigation-question',text:'선택해 주세요.'}});
 for(const task of [first,second])await pool.invoke('startAgent',{taskId:task.id});
 while(entered.length<2)await new Promise(resolve=>setTimeout(resolve,10));
 const selected=await pool.invoke('open',{root:b,initializeWiki:false,stopCurrent:true});
 assert.equal(selected.root,b);assert.equal(service.store,originalStore,'navigation keeps the source journal open');
 for(const task of [first,second,waiting])assert.equal(service.task(task.id).state,'cancelled');
 assert([...service.agentRuns.values()].every(run=>!run.running&&run.controller.signal.aborted));
 assert.equal(selected.backgroundDecisions.length,0,'cancelled questions do not remain actionable');
 assert.equal(await readFile(path.join(a,'app.txt'),'utf8'),'A ORIGINAL');
});

test('user navigation waits for the original command exit receipt',async t=>{
 const {a,b,service,pool,open}=await fixture(t);await open(a);const task=await pool.invoke('createTask',{request:'실행 중인 명령'});
 const process=await service.processes.start({cwd:a,taskId:task.id,script:'node -e "setInterval(()=>{},1000)"',idleCheck:false,autoDiagnose:false});
 try{
  await pool.invoke('open',{root:b,initializeWiki:false,stopCurrent:true});
  assert.equal(service.processes.active.size,0);assert.equal(service.processes.pending.size,0);
  assert.equal(service.store.get('process:'+process.id).state,'cancelled');
 }finally{
  service.processes.stop(process.id);while(service.processes.active.size||service.processes.pending.size)await new Promise(resolve=>setTimeout(resolve,10));
 }
});

test('an invalid navigation target does not cancel the current task',async t=>{
 const {a,b,service,pool,open}=await fixture(t);await open(a);const task=await service.createTask({request:'대기 중인 요청'});
 service.store.set('task:'+task.id,{...task,state:'waiting_input',question:{id:'preserved-question',text:'범위를 선택해 주세요.'}});
 await assert.rejects(pool.invoke('open',{root:path.join(b,'missing'),initializeWiki:false,stopCurrent:true}),/project_path_missing/);
 assert.equal(pool.current,service);assert.equal(service.task(task.id).state,'waiting_input');
 await pool.invoke('open',{root:a,initializeWiki:false,stopCurrent:true});assert.equal(service.task(task.id).state,'waiting_input','same-project selection is a no-op');
});

test('a late source-validation response cannot start work after user navigation',async t=>{
 const {a,b,service,pool,open}=await fixture(t),entered=gate(),release=gate();t.after(()=>release.release());
 service.providers={status,dispose(){},complete:async()=>({content:'must not start',calls:[]})};
 service.mail=async()=>{entered.release();await release.promise;return {id:'source',sourceHash:'hash'};};
 await open(a);const task=await service.createTask({request:'메일 확인 대기'});
 const starting=pool.invoke('startAgent',{taskId:task.id,mailReferences:[{id:'source'}]});await entered.promise;
 await pool.invoke('open',{root:b,initializeWiki:false,stopCurrent:true});release.release();
 await assert.rejects(starting,/project_navigation_stopping/);assert.equal(service.agentForTask(task.id)?.running||false,false);
});

test('the host stop phase preserves project selection until terminal cleanup finishes',async t=>{
 const {a,service,pool,open}=await fixture(t);await open(a);const task=await service.createTask({request:'중지할 확인 질문'});
 service.store.set('task:'+task.id,{...task,state:'waiting_input',question:{id:'stop-phase',text:'선택 대기'}});
 await assert.rejects(pool.invoke('stopProjectWork',{projectId:'foreign'}),/project_changed/);
 const result=await pool.invoke('stopProjectWork',{projectId:service.projectId});
 assert.equal(result.projectId,service.projectId);assert.equal(pool.current,service);assert.equal(service.task(task.id).state,'cancelled');
});

test('navigation resolves the target before stopping the current project',async t=>{
 const {a,b,service,pool,open}=await fixture(t);await promisify(execFile)('git',['init','-q',a]);await mkdir(path.join(a,'nested'));await open(a);
 const task=await service.createTask({request:'대상을 고르는 동안 보존'});service.store.set('task:'+task.id,{...task,state:'waiting_input',question:{text:'대기'}});
 assert.equal((await pool.invoke('projectNavigationTarget',{root:path.join(a,'nested')})).root,a);
 assert.equal((await pool.invoke('projectNavigationTarget',{root:b})).root,b);
 await assert.rejects(pool.invoke('projectNavigationTarget',{root:path.join(b,'missing')}),/project_path_missing/);
 assert.equal(pool.current,service);assert.equal(service.task(task.id).state,'waiting_input');
});

test('an unconfirmed process stop retains its admission guard and discards a late model answer',async t=>{
 const {a,service,open}=await fixture(t),entered=gate(),release=gate();t.after(()=>release.release());
 service.providers={status,dispose(){},complete:async(messages)=>{
  const scripted=fixturePlan(messages)||fixtureReview(messages);if(scripted)return scripted;
  entered.release();await release.promise;return {content:'LATE ANSWER MUST NOT APPEAR',calls:[]};
 }};
 await open(a);const task=await service.createTask({request:'종료 확인 대기'}),next=await service.createTask({request:'새 작업 차단'});
 await service.startAgent({taskId:task.id});await entered.promise;
 const process=await service.processes.start({cwd:a,taskId:task.id,script:'node -e "setInterval(()=>{},1000)"',idleCheck:false,autoDiagnose:false}),stop=service.processes.stop.bind(service.processes);
 service.processes.stop=id=>service.processes.poll(id); // Native stop requested without an exit receipt.
 try{
  await assert.rejects(stopProjectWork(service,{timeoutMs:10}),/project_navigation_stop_pending/);
  assert.equal(service.navigationStopping,true);assert.equal(service.agentForTask(task.id).controller.signal.aborted,true);
  await assert.rejects(service.startAgent({taskId:next.id}),/project_navigation_stopping/);
  await assert.rejects(service.processes.start({cwd:a,script:'node --version',taskId:next.id}),/project_navigation_stopping/);
 }finally{service.processes.stop=stop;stop(process.id);release.release();await service.navigationStop;}
 assert.equal(service.navigationStopping,false);assert.equal(service.task(task.id).state,'cancelled');
 assert(!service.task(task.id).messages.some(message=>message.role==='assistant'&&message.content.includes('LATE ANSWER')));
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

test('saved answers notify from foreground and background services without replaying history',async t=>{
 const {a,b,service,pool,open}=await fixture(t),notices=[];
 service.notifyAnswer=notice=>{
  const owner=[...pool.projects.values()].find(item=>item.projectId===notice.projectId);
  assert.equal(owner.store.get('task:'+notice.taskId).messages.at(-1).runId,notice.runId,'notification follows saved answer');
  notices.push(notice);
 };
 service.providers={status,dispose(){},complete:async messages=>fixturePlan(messages)||fixtureReview(messages)||{content:'Saved answer',calls:[]}};
 await open(a);const first=await pool.invoke('createTask',{request:'FIRST'});
 await open(b);const second=await pool.invoke('createTask',{request:'SECOND'});
 await service.startAgent({taskId:first.id});await service.agentForTask(first.id).promise;
 await pool.invoke('startAgent',{taskId:second.id});await pool.current.agentForTask(second.id).promise;
 assert.equal(notices.length,2);assert.deepEqual(new Set(notices.map(n=>n.taskId)),new Set([first.id,second.id]));
 assert.equal(notices[0].projectId,service.projectId);assert.equal(notices[1].projectId,pool.current.projectId);
 await pool.invoke('state');await open(a);await pool.invoke('overview');assert.equal(notices.length,2);
});

test('switching projects clears foreground conversation even if the previous renderer cleanup arrives late',async t=>{
 const {a,b,service,pool,open}=await fixture(t);await open(a);const task=await service.createTask({request:'Viewed answer'});
 await pool.invoke('markTaskRead',{projectId:service.projectId,taskId:task.id});assert.equal(service.viewingTaskId,task.id);
 await open(b);assert.equal(service.viewingTaskId,null);
 await assert.rejects(pool.invoke('markTaskRead',{projectId:service.projectId,taskId:null}),/project_changed/);
 assert.equal(pool.current.viewingTaskId,null);
});

test('routine target reopens a saved project without selecting it and rejects a changed root identity',async t=>{
 const {a,b,pool,open}=await fixture(t);const first=await open(a),owner=pool.current;const {hash}=await import('../runtime/files.mjs');
 const target=await pool.service({id:hash(b).slice(7,31),root:b});assert.equal(pool.current,owner);assert.equal(pool.current.projectId,first.projectId);assert.equal(target.root,b);assert.equal(await pool.service({id:target.projectId,root:b}),target);
 await assert.rejects(pool.service({id:'wrong',root:b}),/project_changed/);assert.equal(pool.current,owner);
});
