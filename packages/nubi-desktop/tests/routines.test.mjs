import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextRun,dueRoutines,createRoutineScheduler,createRoutineManager} from '../runtime/routines.mjs';
import {fixture} from './fixtures.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {humanDecisions} from '../ui/human-decisions.mjs';
import {createRequire} from 'node:module';
const {decisionNoticeContent}=createRequire(import.meta.url)('../electron-app/decision-notices.cjs');
installAgent((await import('../runtime/project-service.mjs')).ProjectService);
// The routine engine stays and is tested with its switch on; the release keeps it off (tests at the end of this file).
const ENGINE={workflows:true};
const memory=()=>{const m=new Map();return {get:k=>m.get(k),set:(k,v)=>m.set(k,structuredClone(v)),delete:k=>m.delete(k),list:p=>[...m].filter(([k])=>k.startsWith(p)).map(([,v])=>structuredClone(v))};};
const date=(day,hour=10)=>new Date(2026,9,day,hour,0,0);
const routine={id:'a',name:'점검',projectId:'p',request:'점검 요청',enabled:true,schedule:{kind:'daily',time:'09:00'},createdAt:date(14).toISOString()};
test('daily and weekly dates are local; catch-up is once, never before creation or when disabled',()=>{
 assert.equal(new Date(nextRun(routine,date(16))).getDate(),17);assert.equal(new Date(nextRun(routine,date(16))).getHours(),9);
 assert.equal(new Date(nextRun({...routine,schedule:{kind:'weekly',time:'08:30',weekday:1}},date(16))).getDay(),1);
 const store=memory();store.set('routine:a',routine);assert.equal(dueRoutines(store,date(16)).length,1);
 store.set('routine:a',{...routine,lastRunAt:date(16).toISOString()});assert.equal(dueRoutines(store,date(16)).length,0);
 store.set('routine:a',{...routine,createdAt:date(16).toISOString()});assert.equal(dueRoutines(store,date(16)).length,0);
 store.set('routine:a',{...routine,enabled:false});assert.equal(dueRoutines(store,date(20)).length,0);
 for(const time of ['24:00','09:60','9:00'])assert.throws(()=>nextRun({...routine,schedule:{kind:'daily',time}},date(16)),/routine_invalid/);
});
test('concurrent startup ticks reserve once; pending work blocks later slots; failure is not replayed on restart',async()=>{
 const store=memory();store.set('routine:a',routine);let now=date(16),busy=false,calls=0;
 const run=async(r,{recordTask})=>{calls++;assert(store.get('routine:a').lastRunAt);recordTask('t');await Promise.resolve();return {taskId:'t'};};
 const s=createRoutineScheduler({store,run,now:()=>now,isBusy:()=>busy});await Promise.all([s.tick(),s.tick()]);assert.equal(calls,1);assert.equal(store.get('routine:a').lastTaskId,'t');
 now=date(17);busy=true;await s.tick();assert.equal(calls,1);busy=false;await s.tick();assert.equal(calls,2);
 now=date(18);const failure=createRoutineScheduler({store,run:async()=>{throw Error('private upstream text');},now:()=>now});await failure.tick();assert.equal(store.get('routine:a').lastError,'routine_failed');await createRoutineScheduler({store,run,now:()=>now}).tick();assert.equal(calls,2);
});
test('manual run and ticks share a queue; disabling during a run is preserved and missing readiness consumes no slot',async()=>{
 const store=memory();store.set('routine:a',routine);let ready=false,release;
 const scheduler=createRoutineScheduler({store,now:()=>date(16),canRun:()=>ready,run:()=>new Promise(resolve=>{release=resolve;})});
 await scheduler.tick();assert.equal(store.get('routine:a').lastRunAt,undefined);ready=true;
 const running=scheduler.runNow('a');while(!release)await new Promise(resolve=>setTimeout(resolve,0));
 store.set('routine:a',{...store.get('routine:a'),enabled:false,name:'새 이름'});release({taskId:'t'});await running;
 assert.equal(store.get('routine:a').enabled,false);assert.equal(store.get('routine:a').name,'새 이름');
 scheduler.stop();await scheduler.tick();assert.equal(store.get('routine:a').lastTaskId,'t');
});
test('manager validates project, creates a normal agent conversation, waits for questions, persists controls and keeps approvals',async t=>{
 const {service}=await fixture(t),store=memory();const projects=[{id:service.projectId,name:'프로젝트',root:service.root}];
 const manager=createRoutineManager({features:ENGINE,store,listProjects:async()=>projects,serviceFor:async()=>service,now:()=>date(16)});service.routines=manager;t.after(()=>manager.stop());
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>({content:'',calls:[{id:'q',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'어느 범위를 확인할까요?'})}}]})};
 await assert.rejects(service.invoke('saveRoutine',{name:'점검',projectId:'wrong',request:'요청',schedule:routine.schedule,enabled:true}),/project_missing/);
 const saved=await service.invoke('saveRoutine',{name:'매일 점검',projectId:service.projectId,request:'점검해 주세요',schedule:routine.schedule,enabled:true});
 const result=await service.invoke('runRoutineNow',{id:saved.id});await service.agent.promise;const task=service.task(result.taskId);assert.equal(task.routineId,saved.id);assert.equal(task.state,'waiting_input');
 const decisions=humanDecisions({...service.state(),projectId:service.projectId});assert.equal(decisions[0].routineName,'매일 점검');assert.match(decisionNoticeContent(decisions[0]).body,/루틴 '매일 점검'이 답을 기다려요/);
 await assert.rejects(service.invoke('runRoutineNow',{id:saved.id}),/routine_busy/);
 const updated=await service.invoke('saveRoutine',{...saved,enabled:false});assert.equal(updated.lastTaskId,result.taskId);assert.equal((await service.invoke('listRoutines')).items.length,1);
 await service.invoke('deleteRoutine',{id:saved.id,confirmed:true});assert.equal((await service.invoke('listRoutines')).items.length,0);assert.equal(service.task(result.taskId).state,'waiting_input');
});
test('restart blocks an unrecorded routine conversation and pending approval even after its target changes',async t=>{
 const {service}=await fixture(t),store=memory();const manager=createRoutineManager({features:ENGINE,store,listProjects:async()=>[{id:service.projectId}],serviceFor:async()=>service,now:()=>date(16)});t.after(()=>manager.stop());
 service.providers={status:()=>({connected:true}),dispose(){}};
 const saved=await manager.save({...routine,id:undefined,projectId:service.projectId});
 // A crash may happen between the project task write and recordTask in the routine store.
 const task=await service.createTask({request:'확인할 작업'},{id:saved.id,name:saved.name});
 service.store.set('task:'+task.id,{...task,state:'review'});service.store.set('setup-action:pending',{id:'pending',taskId:task.id,state:'proposed',title:'사용자 승인 필요',profile:'bash',script:'node example.js'});
 await assert.rejects(manager.runNow({id:saved.id}),/routine_busy/);
 assert.equal(service.store.get('setup-action:pending').state,'proposed');assert.equal(service.store.list('task:').length,1);
 store.set('routine:'+saved.id,{...store.get('routine:'+saved.id),lastTaskId:task.id,lastProjectId:service.projectId,projectId:'new-target'});
 await assert.rejects(manager.runNow({id:saved.id}),/routine_busy/);
});
test('deleting or editing a routine during readiness checks cancels the stale dispatch',async()=>{
 for(const change of ['delete','edit','disable']){
  const store=memory();store.set('routine:a',routine);let release,calls=0;
  const scheduler=createRoutineScheduler({store,now:()=>date(16),canRun:()=>new Promise(resolve=>{release=resolve;}),run:async()=>{calls++;return {taskId:'unexpected'};}});
  const tick=scheduler.tick();while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  if(change==='delete')store.delete('routine:a');else store.set('routine:a',{...routine,...(change==='disable'?{enabled:false}:{request:'바뀐 요청'})});
  release(true);await tick;assert.equal(calls,0,change);assert.equal(store.get('routine:a')?.lastRunAt,undefined,change);
 }
});

test('automatic tick publishes start and question settlement without a manual run or UI refresh',async t=>{
 const {service}=await fixture(t),store=memory(),events=[];
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>({content:'',calls:[{id:'q',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'자동 실행 질문'})}}]})};
 store.set('routine:a',{...routine,projectId:service.projectId});
 const manager=createRoutineManager({features:ENGINE,store,listProjects:async()=>[{id:service.projectId}],serviceFor:async()=>service,now:()=>date(16),onActivity:event=>events.push(event)});t.after(()=>manager.stop());
 await manager.tick();const id=store.get('routine:a').lastTaskId;assert(id);await service.agent.promise;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(events[0]?.phase,'started');assert.equal(events.at(-1)?.phase,'settled');assert(events.every(e=>e.taskId===id&&e.projectId===service.projectId));assert.equal(service.task(id).state,'waiting_input');assert.equal(humanDecisions({...service.state(),projectId:service.projectId})[0].taskId,id);
});
test('live wiki admission waits without consuming the daily slot and starts once after release',async t=>{
 const {service}=await fixture(t),store=memory();let starts=0;
 service.providers={status:()=>({connected:true}),dispose(){}};service.startAgent=async()=>{starts++;};
 service.wikiInitOwner=service.store;service.wikiInitController=new AbortController();service.store.set('wiki-init',{state:'running'});
 store.set('routine:a',{...routine,projectId:service.projectId});
 const manager=createRoutineManager({features:ENGINE,store,listProjects:async()=>[{id:service.projectId}],serviceFor:async()=>service,now:()=>date(16)});t.after(()=>manager.stop());
 await manager.tick();assert.equal(store.get('routine:a').lastRunAt,undefined);assert.equal(service.store.list('task:').length,0);
 service.wikiInitController.abort();await manager.tick();await manager.tick();assert.equal(starts,1);assert.equal(service.store.list('task:').length,1);
});
test('a settled previous project can be removed after retargeting; unresolved previous ownership stays blocked',async t=>{
 const first=await fixture(t),second=await fixture(t),store=memory();let projects=[{id:first.service.projectId},{id:second.service.projectId}];
 for(const {service} of [first,second]){service.providers={status:()=>({connected:true}),dispose(){}};service.startAgent=async({taskId})=>{service.store.set('task:'+taskId,{...service.task(taskId),state:'review'});service.agent={taskId,running:false,promise:Promise.resolve()};};}
 const manager=createRoutineManager({features:ENGINE,store,listProjects:async()=>projects,serviceFor:async p=>p.id===first.service.projectId?first.service:second.service,now:()=>date(16)});t.after(()=>manager.stop());
 const saved=await manager.save({...routine,id:undefined,projectId:first.service.projectId});const previous=await manager.runNow({id:saved.id});await new Promise(resolve=>setImmediate(resolve));
 await manager.save({...saved,projectId:second.service.projectId});projects=[{id:second.service.projectId}];
 const next=await manager.runNow({id:saved.id});assert.equal(next.projectId,second.service.projectId);assert.notEqual(next.taskId,previous.taskId);
 store.set('routine:uncertain',{...routine,id:'uncertain',projectId:second.service.projectId,lastProjectId:first.service.projectId,lastTaskId:'unknown'});
 await assert.rejects(manager.runNow({id:'uncertain'}),/routine_previous_project_missing/);
});

test('resuming a previously settled routine clears removal proof before an uncertain stop',async t=>{
 const {service}=await fixture(t),store=memory();let listed=true;
 service.providers={status:()=>({connected:true}),dispose(){}};
 const task=await service.createTask({request:'이전 요청'},{id:'a',name:'점검'});
 service.store.set('task:'+task.id,{...task,state:'review'});
 store.set('routine:a',{...routine,projectId:service.projectId,lastProjectId:service.projectId,lastTaskId:task.id});
 const manager=createRoutineManager({features:ENGINE,store,listProjects:async()=>listed?[{id:service.projectId}]:[],serviceFor:async()=>service});t.after(()=>manager.stop());
 manager.observe(service);assert.equal(store.get('routine:a').lastSettledTaskId,task.id);
 service.store.set('task:'+task.id,{...task,state:'running'});manager.observe(service);assert.equal(store.get('routine:a').lastSettledTaskId,null);
 service.store.set('task:'+task.id,{...task,state:'paused',error:'tool_unsettled'});manager.observe(service);listed=false;
 await assert.rejects(manager.runNow({id:'a'}),/routine_previous_project_missing/);
});

// Workflows and routines are off in this release (design light-flow §5.1): nothing starts, stored routines stay as they
// were, and the person is told once.
test('routines never start while workflows are off and stored routines stay untouched',async()=>{
 const store=memory();store.set('routine:a',routine);const before=JSON.stringify(store.get('routine:a'));
 const manager=createRoutineManager({store,listProjects:async()=>[{id:'p'}],serviceFor:()=>assert.fail('a routine must not reach its project'),now:()=>date(16).getTime()});
 await manager.tick();
 assert.equal(JSON.stringify(store.get('routine:a')),before);
 await assert.rejects(()=>manager.runNow({id:'a'}),/workflow_feature_off/);
 await assert.rejects(async()=>manager.save({...routine,id:undefined}),/workflow_feature_off/);
 assert.throws(()=>manager.delete({id:'a',confirmed:true}),/workflow_feature_off/);
 assert.equal(JSON.stringify(store.get('routine:a')),before);
});
test('the paused-routines notice shows once, and only to someone who saved a routine',()=>{
 const empty=createRoutineManager({store:memory(),listProjects:async()=>[],serviceFor:()=>null});
 assert.equal(empty.notice().show,false);
 const store=memory();store.set('routine:a',routine);
 const manager=createRoutineManager({store,listProjects:async()=>[],serviceFor:()=>null,now:()=>date(16).getTime()});
 assert.deepEqual(manager.notice(),{show:true,text:'루틴은 다음 판에서 다시 켜집니다. 저장한 루틴은 그대로 있어요.'});
 manager.acknowledgeNotice();
 assert.equal(manager.notice().show,false);
 assert.equal(store.get('notice:routines-paused-1.3.1').at,date(16).toISOString());
});
test('the UI reads and acknowledges the routine notice through the host allowlist',async t=>{
 const {service}=await fixture(t);
 assert.deepEqual(await service.invoke('routineNotice',{}),{show:false});
 const store=memory();store.set('routine:a',routine);
 service.routines=createRoutineManager({store,listProjects:async()=>[],serviceFor:()=>null});
 assert.equal((await service.invoke('routineNotice',{})).show,true);
 assert.equal((await service.invoke('acknowledgeRoutineNotice',{})).show,false);
});
