import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {registerNativeOfficeConnection,nativeOfficeStatus,executeNativeOffice,decideNativeOffice,continueNativeOffice,cancelNativeOffice,disposeNativeOffice} from '../runtime/native-office-host.mjs';
installAgent(ProjectService);
const read={action:'get',member:'Text'},edit={summary:'본문 수정',steps:[{action:'set',member:'Text',value:'After'}],checks:[{read,equals:'After'}]};
const signal=()=>new AbortController().signal;
async function setup(t,app='word',options={}){
 const f=await fixture(t),task=await f.service.createTask({request:'열린 문서 수정'});let value='Before',writes=0,reads=0;
 const connection={environment:'fixture',app,scope:{projectId:f.service.projectId,taskId:task.id},documentId:'doc',officeSessionId:'session',async call(name,args){
  if(name==='inspect_office'){if(options.changed&&++reads===2)value='Human edit';return {snapshotId:'snapshot-'+reads,results:args.steps.map(s=>s.member==='Value2'?3:value)};}
  if(name==='calculate_office')return {status:'calculated',calculationDone:true};
  writes++;value='After';if(options.drop)throw Error('disconnected');if(options.hang)await new Promise(r=>options.release=r);
  return {status:'verified',mutated:true,completedWrites:1,writeResultUncertain:false,saved:false,checks:args.checks.map(()=>({passed:true}))};
 }};
 registerNativeOfficeConnection(f.service,connection,{allowFixture:true});
 return {...f,task,connection,get writes(){return writes;},get value(){return value;}};
}
async function propose(h){const o=await executeNativeOffice(h.service,h.task,'inspect_native_office',{steps:[read]},signal());return executeNativeOffice(h.service,h.task,'write_native_office',{...edit,observationId:o.observationId,...(h.connection.app==='excel'?{calculateTarget:'document',afterChecks:[{read:{action:'get',member:'Value2'},equals:3}]}:{})},signal());}
for(const app of ['word','excel','powerpoint'])test(`${app}: exact one-time approval, readback and receipt finish`,async t=>{
 const h=await setup(t,app),p=await propose(h);assert.equal(p.requiresUserInput,true);assert.equal(h.writes,0);assert.equal(JSON.parse(p.question.toolRequest.arguments.text).documentId,'doc');
 decideNativeOffice(h.service,h.task,'실행');await continueNativeOffice(h.service,h.task,signal());assert.equal(h.writes,1);
 const status=nativeOfficeStatus(h.service,h.task.id);assert.equal(status.outcome.receipt.status,'verified_unsaved');
 const r=await executeNativeOffice(h.service,h.task,'finish_native_office',{receiptId:status.outcome.receiptId},signal());assert.equal(r.status,'verified_unsaved');assert.equal(h.task.nativeOffice.outcome.finished,true);assert.equal(h.task.nativeOffice.outcome.savedToOffice,false);
 await continueNativeOffice(h.service,h.task,signal());assert.equal(h.writes,1);
});
for(const reason of ['reject','stop','reconnect','dispose','restart','source-change'])test(`${reason}: pending approval cannot write`,async t=>{
 const h=await setup(t,'word',{changed:reason==='source-change'});await propose(h);
 if(reason==='reject')decideNativeOffice(h.service,h.task,'취소');
 else if(reason==='stop')cancelNativeOffice(h.service,h.task.id);
 else if(reason==='reconnect')registerNativeOfficeConnection(h.service,h.connection,{allowFixture:true});
 else if(reason==='dispose')disposeNativeOffice(h.service);
 else if(reason==='restart'){disposeNativeOffice(h.service);h.task.nativeOffice.state='approved';}
 if(reason==='source-change')decideNativeOffice(h.service,h.task,'실행');
 await continueNativeOffice(h.service,h.task,signal());assert.equal(h.writes,0);assert.notEqual(h.task.nativeOffice.state,'verified_unsaved');
});
test('lost native reply survives resume and rebind without replay, while recovery getters work',async t=>{
 const h=await setup(t,'word',{drop:true});await propose(h);decideNativeOffice(h.service,h.task,'실행');await continueNativeOffice(h.service,h.task,signal());
 assert.equal(h.task.nativeOffice.outcome.writeResultUncertain,true);assert.equal(h.writes,1);
 registerNativeOfficeConnection(h.service,h.connection,{allowFixture:true});const o=await executeNativeOffice(h.service,h.task,'inspect_native_office',{steps:[read]},signal());assert.deepEqual(o.results,['After']);
 const r=await executeNativeOffice(h.service,h.task,'write_native_office',{...edit,observationId:o.observationId},signal());assert.equal(r.ok,false);assert.equal(h.writes,1);assert.equal(h.task.nativeOffice.outcome.writeResultUncertain,true);
});
test('unbound host is honest and fixture registration needs explicit test-only injection',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'문서'});assert.equal(nativeOfficeStatus(service,task.id).connected,false);
 assert.throws(()=>registerNativeOfficeConnection(service,{environment:'fixture',scope:{projectId:service.projectId,taskId:task.id}}),/fixture/);
});
test('explicit next-edit selection starts a fresh epoch only after verified finish, preserving the earlier receipt',async t=>{
 const h=await setup(t),p=await propose(h);decideNativeOffice(h.service,h.task,'실행');await continueNativeOffice(h.service,h.task,signal());
 const first=nativeOfficeStatus(h.service,h.task.id);await executeNativeOffice(h.service,h.task,'finish_native_office',{receiptId:first.outcome.receiptId},signal());
 registerNativeOfficeConnection(h.service,{...h.connection,officeSessionId:'second'},{allowFixture:true,newEpoch:true});
 const next=nativeOfficeStatus(h.service,h.task.id);assert.equal(next.state,'connected');assert.equal(next.writeLocked,false);assert.equal(next.outcome,undefined);assert.equal(next.history[0].outcome.receiptId,first.outcome.receiptId);assert.equal(next.history[0].outcome.finished,true);
 const proposal=await propose(h);assert.equal(proposal.requiresUserInput,true);assert.equal(h.writes,1);
});
test('explicit next-edit selection cannot clear an uncertain native write',async t=>{
 const h=await setup(t,'word',{drop:true});await propose(h);decideNativeOffice(h.service,h.task,'실행');await continueNativeOffice(h.service,h.task,signal());
 registerNativeOfficeConnection(h.service,{...h.connection,officeSessionId:'second'},{allowFixture:true,newEpoch:true});assert.equal(nativeOfficeStatus(h.service,h.task.id).outcome.writeResultUncertain,true);
 assert.equal((await propose(h)).error,'native_office_reconciliation_required');assert.equal(h.writes,1);
});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
for(const app of ['word','excel','powerpoint'])test(`${app}: Workspace Pi registers phase tools and exact approval resumes before inference`,async t=>{
 const h=await setup(t,app);let turn=0;
 h.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages,tools){
  const names=tools.map(t=>t.function.name);
  if(turn++===0){assert(names.includes('inspect_native_office'));assert(!names.includes('write_native_office'));assert(!names.includes('delegate_to_office'));return call('inspect_native_office',{steps:[read]});}
  if(turn===2){assert(names.includes('write_native_office'));const output=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('write_native_office',{...edit,observationId:output.observationId,...(app==='excel'?{calculateTarget:'document',afterChecks:[{read:{action:'get',member:'Value2'},equals:3}]}:{})});}
  if(turn===3){assert.equal(h.writes,1,'frozen approved call must precede inference');assert(names.includes('finish_native_office'));assert(!names.includes('write_native_office'));return call('finish_native_office',{receiptId:nativeOfficeStatus(h.service,h.task.id).outcome.receiptId});}
  return {content:'문서의 변경과 재확인을 마쳤습니다. 아직 저장하지 않았습니다.',calls:[]};
 }};
 await h.service.startAgent({taskId:h.task.id});await h.service.agent.promise;
 const pending=h.service.task(h.task.id);assert(pending.question.nativeOfficeApproval);assert.equal(pending.state,'waiting_input');assert.equal(h.writes,0);
 await h.service.answerAgent({taskId:h.task.id,choice:{questionId:pending.question.id,optionId:pending.question.options[0].id}});await h.service.agent.promise;
 const answered=h.service.task(h.task.id).questionHistory.at(-1);assert.equal(answered.documentPreview,undefined);assert.equal(answered.excelPreview,undefined);assert.deepEqual(JSON.parse(answered.toolRequest.arguments.text).steps,edit.steps);
 assert.equal(h.service.task(h.task.id).state,'review',h.service.task(h.task.id).error);assert.equal(nativeOfficeStatus(h.service,h.task.id).outcome.finished,true);assert.equal(h.writes,1);assert.equal(turn,4);
});
test('Workspace stop invalidates the approval form and a late answer cannot dispatch',async t=>{
 const h=await setup(t);let turn=0;
 h.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){if(turn++===0)return call('inspect_native_office',{steps:[read]});const o=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('write_native_office',{...edit,observationId:o.observationId});}};
 await h.service.startAgent({taskId:h.task.id});await h.service.agent.promise;const q=h.service.task(h.task.id).question;
 await h.service.stopAgent({taskId:h.task.id});assert.equal(h.service.task(h.task.id).question,null);
 await assert.rejects(h.service.answerAgent({taskId:h.task.id,choice:{questionId:q.id,optionId:q.options[0].id}}),/question_changed/);assert.equal(h.writes,0);
});
test('stop during a dispatched native write preserves uncertainty and the host lock until the real call settles',async t=>{
 const options={hang:true},h=await setup(t,'word',options);await propose(h);decideNativeOffice(h.service,h.task,'실행');
 const controller=new AbortController(),pending=continueNativeOffice(h.service,h.task,controller.signal);
 for(let i=0;i<50&&!options.release;i++)await new Promise(r=>setTimeout(r,5));assert.equal(h.writes,1);
 cancelNativeOffice(h.service,h.task.id);controller.abort();await pending;
 assert.equal(nativeOfficeStatus(h.service,h.task.id).outcome.writeResultUncertain,true);assert.equal(h.service.unsettledOperations.size,1);
 options.release();await new Promise(r=>setTimeout(r,5));assert.equal(h.service.unsettledOperations.size,0);
 assert.equal(nativeOfficeStatus(h.service,h.task.id).outcome.writeResultUncertain,true);assert.equal(h.writes,1);
});
test('uncertain native writes can be inspected on the same binding, but not written again',async t=>{
 const h=await setup(t,'excel',{drop:true});await propose(h);decideNativeOffice(h.service,h.task,'실행');await continueNativeOffice(h.service,h.task,signal());
 const observed=await executeNativeOffice(h.service,h.task,'inspect_native_office',{steps:[read]},signal());assert.deepEqual(observed.results,['After']);assert.equal(h.writes,1);
 const snapshot=await h.service.recoverySnapshot({taskId:h.task.id});assert.equal(snapshot.nativeOffice.outcome.writeResultUncertain,true);
});
test('interrupted executing record is reconciliation evidence after host restart, never replay authority',async t=>{
 const h=await setup(t);await propose(h);decideNativeOffice(h.service,h.task,'실행');h.task.nativeOffice.state='executing';h.service.store.set('task:'+h.task.id,h.task);
 await continueNativeOffice(h.service,h.task,signal());assert.equal(h.task.nativeOffice.outcome.writeResultUncertain,true);assert.equal(h.writes,0);
});
test('invalid and truncated approval plans are rejected before any approval form or native mutation',async t=>{
 const h=await setup(t),o=await executeNativeOffice(h.service,h.task,'inspect_native_office',{steps:[read]},signal());
 const bad=await executeNativeOffice(h.service,h.task,'write_native_office',{...edit,observationId:o.observationId,checks:[{read,equals:'Before'}]},signal());assert.equal(bad.ok,false);assert.equal(h.service.task(h.task.id).nativeOffice.pending,null);
 const text='A'.repeat(39000),big=await executeNativeOffice(h.service,h.task,'write_native_office',{...edit,observationId:o.observationId,steps:[{action:'set',member:'Text',value:text}],checks:[{read,equals:text}]},signal());assert.equal(big.ok,false);assert.equal(h.service.task(h.task.id).nativeOffice.pending,null);assert.equal(h.writes,0);
});
test('native connection cannot be injected through renderer invoke or another task scope',async t=>{
 const h=await setup(t);await assert.rejects(h.service.invoke('registerNativeOfficeConnection',h.connection),/method/);
 const other=await h.service.createTask({request:'다른 문서'});const output=await executeNativeOffice(h.service,other,'inspect_native_office',{steps:[read]},signal());assert.equal(output.error,'native_office_disconnected');
 assert.throws(()=>registerNativeOfficeConnection(h.service,{...h.connection,scope:{projectId:'different',taskId:h.task.id}},{allowFixture:true}),/scope/);
});
test('Workspace cannot deliver a false completion when native finish is missing',async t=>{
 const h=await setup(t);let turn=0;
 h.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
 if(turn++===0)return call('inspect_native_office',{steps:[read]});if(turn===2)return call('write_native_office',{...edit,observationId:JSON.parse(messages.findLast(m=>m.role==='tool').content).observationId});return {content:'완료했고 저장도 했습니다.',calls:[]};}};
 await h.service.startAgent({taskId:h.task.id});await h.service.agent.promise;let task=h.service.task(h.task.id);
 await h.service.answerAgent({taskId:h.task.id,choice:{questionId:task.question.id,optionId:task.question.options[0].id}});await h.service.agent.promise;task=h.service.task(h.task.id);
 assert.equal(task.state,'paused');assert.equal(task.nativeOffice.error,'native_office_finish_required');assert(!task.messages.at(-1).content.includes('저장도 했습니다'));assert.equal(h.writes,1);
});
test('native source drift is returned to the same Workspace model for fresh observation without a native write',async t=>{
 const h=await setup(t,'word',{changed:true});let turn=0;
 h.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages,tools){
 if(turn++===0)return call('inspect_native_office',{steps:[read]});if(turn===2)return call('write_native_office',{...edit,observationId:JSON.parse(messages.findLast(m=>m.role==='tool').content).observationId});
 assert.match(JSON.stringify(messages),/native_write_source_changed/);assert(tools.some(t=>t.function.name==='inspect_native_office'));return {content:'사람이 변경한 본문을 보존했습니다. 새 관찰이 필요합니다.',calls:[]};}};
 await h.service.startAgent({taskId:h.task.id});await h.service.agent.promise;const task=h.service.task(h.task.id);
 await h.service.answerAgent({taskId:h.task.id,choice:{questionId:task.question.id,optionId:task.question.options[0].id}});await h.service.agent.promise;assert.equal(h.writes,0);assert.equal(h.value,'Human edit');assert.equal(turn,3);
});
