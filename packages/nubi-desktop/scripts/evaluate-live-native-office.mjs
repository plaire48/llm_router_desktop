// The real Desktop Claude adapter + Pi + native approval path. Native Office is
// an explicitly labelled stateful DTO fixture; no Office/COM or save evidence.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {registerNativeOfficeConnection,nativeOfficeStatus} from '../runtime/native-office-host.mjs';
import {createNativeModelFixture} from '../../nubi-document-agent/eval/native-model-fixture.mjs';

installAgent(ProjectService);
const root=path.resolve(process.argv[2]),selected=process.env.NUBI_NATIVE_EVAL_APPS?.split(',')||['word','excel','powerpoint'],failure=process.env.NUBI_NATIVE_EVAL_FAILURE||null;
assert(selected.every(app=>['word','excel','powerpoint'].includes(app)));assert([null,'rejected','disconnect','calculation_pending'].includes(failure));
await mkdir(root,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceHashes={};
for(const file of ['runtime/agent.mjs','runtime/native-office-host.mjs','runtime/desktop-providers.mjs','runtime/claude-code.mjs','runtime/project-service.mjs','generated/document-agent-native.mjs','scripts/evaluate-live-native-office.mjs']){
 const bytes=await readFile(file);sourceHashes[file]=sha(bytes);const dest=path.join(root,'source',file);await mkdir(path.dirname(dest),{recursive:true});await copyFile(file,dest);
}
await writeFile(path.join(root,'contract.json'),JSON.stringify({kind:'real_desktop_claude_pi_native_approval',apps:selected,failure,sourceHashes,nativeBoundary:'stateful DTO fixture',actualOffice2016:false,comVerified:false,nascaVerified:false,savedToOffice:false,createdAt:new Date().toISOString()},null,2),{flag:'wx'});
const rows=[];
for(const app of selected){
 const directory=path.join(root,app);await mkdir(directory,{recursive:true});const temporary=await mkdtemp(path.join(tmpdir(),'nubi-live-native-')),projectRoot=path.join(temporary,'project');await mkdir(projectRoot);
 const service=new ProjectService({storageRoot:path.join(temporary,'state')}),native=createNativeModelFixture(app,2,{failure}),row={app,failure,status:'running',hostCalls:[],nativeBoundary:'fixture',startedAt:new Date().toISOString()};let task,timer;
 const persist=()=>writeFile(path.join(directory,'result.json'),JSON.stringify(row,null,2));await persist();
 try{
  await service.open(projectRoot,{initializeWiki:false,kind:'conversation'});
  const connected=await service.provider({action:'connect',input:{provider:'claude'}});assert.equal(connected.connected,true);assert.equal(connected.provider,'claude');row.model=connected.model;
  // No scripted planner/reviewer and no replacement model. Every model phase
  // goes through the exact production Desktop provider implementation.
  const complete=service.providers.complete.bind(service.providers);let turn=0;
  service.providers.complete=async(messages,tools,...rest)=>{const index=turn++,begin=Date.now();await writeFile(path.join(directory,'host-'+index+'-input.json'),JSON.stringify({messages,tools},null,2));const reply=await complete(messages,tools,...rest);await writeFile(path.join(directory,'host-'+index+'-output.json'),JSON.stringify(reply,null,2));row.hostCalls.push({index,elapsedMs:Date.now()-begin,tools:reply.calls?.map(c=>c.function.name)||[],planner:messages[0]?.content?.startsWith('Nubi Desktop work')||false,reviewer:messages[0]?.content?.startsWith('Nubi Desktop independent result review')||false});await persist();console.log(JSON.stringify({app,turn:index,tools:row.hostCalls.at(-1).tools}));return reply;};
  task=await service.createTask({request:native.request+'\n이번 업무는 연결된 문서에 대한 native Office 도구만 사용하세요. 실제 Office 대신 상태가 있는 DTO로 연결된 개발 검증이며 파일 도구나 터미널은 사용하지 않습니다. 문서 getter 안내: '+native.context.nativeMemberGuide});
  registerNativeOfficeConnection(service,{...native.connection,scope:{projectId:service.projectId,taskId:task.id},documentTitle:'개발 검증 '+app},{allowFixture:true});
  timer=setTimeout(()=>{row.timedOut=true;void service.stopAgent({taskId:task.id});},600000);
  await service.startAgent({taskId:task.id});await service.agentForTask(task.id).promise;
  const pending=service.task(task.id);row.beforeApproval={state:pending.state,question:pending.question,nativeStatus:nativeOfficeStatus(service,task.id)};
  assert.equal(native.calls.filter(c=>c.name==='execute_office_operations').length,0,'nothing writes before native approval');
  assert(pending.question?.nativeOfficeApproval,'real model must present a native approval');assert.equal(pending.state,'waiting_input');
  const approved=structuredClone(pending.nativeOffice.pending.args),option=pending.question.options.find(o=>o.label==='실행');assert(option);
  row.approvedHash=sha(JSON.stringify(approved));
  await service.answerAgent({taskId:task.id,choice:{questionId:pending.question.id,optionId:option.id}});await service.agentForTask(task.id).promise;
  const status=nativeOfficeStatus(service,task.id),current=service.task(task.id);row.afterApproval={taskState:current.state,nativeStatus:status,finalAnswer:current.messages.findLast(m=>m.role==='assistant')?.content};
  const issued=native.calls.filter(c=>c.name==='execute_office_operations');assert.equal(issued.length,1);assert.deepEqual(issued[0].input.steps,approved.steps);assert.deepEqual(issued[0].input.checks,approved.checks);row.exactApprovedBatch=true;
  if(failure){assert.equal(status.outcome?.finished,false);assert.equal(status.outcome?.status,{rejected:'rejected',disconnect:'uncertain',calculation_pending:'needs_review'}[failure]);assert.equal(status.writeLocked,true);row.noReplay=true;}
  else{row.oracle=native.verify();assert.equal(status.outcome?.finished,true);assert.equal(status.outcome?.receipt?.status,'verified_unsaved');assert.equal(status.outcome?.savedToOffice,false);assert.equal(current.state,'review');}
  row.status='passed';
 }catch(error){row.status='failed';row.error=error.code||error.message;row.stack=error.stack?.split('\n').slice(0,5);}
 finally{clearTimeout(timer);if(task)await writeFile(path.join(directory,'task.json'),JSON.stringify(service.task(task.id),null,2));await writeFile(path.join(directory,'native-calls.json'),JSON.stringify(native.calls,null,2));await writeFile(path.join(directory,'native-state.json'),JSON.stringify(native.state,null,2));service.dispose();service.store?.close();await rm(temporary,{recursive:true,force:true});row.finishedAt=new Date().toISOString();await persist();rows.push(row);console.log(JSON.stringify({app,status:row.status,error:row.error,calls:row.hostCalls.length}));}
}
await writeFile(path.join(root,'results.json'),JSON.stringify({rows,passed:rows.filter(r=>r.status==='passed').length,failed:rows.filter(r=>r.status!=='passed').length,actualOffice2016:false,comVerified:false,nascaVerified:false,savedToOffice:false},null,2));
if(rows.some(r=>r.status!=='passed'))process.exitCode=1;
