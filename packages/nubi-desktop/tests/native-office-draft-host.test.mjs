import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';import {ProjectService} from '../runtime/project-service.mjs';import {installAgent} from '../runtime/agent.mjs';import {executeNativeOffice,reviseNativeOfficeDraft,decideNativeOffice,continueNativeOffice} from '../runtime/native-office-host.mjs';
installAgent(ProjectService);
test('human revision supersedes the approved fingerprint without native writes, then applies the exact revised text once',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'Word 초안 검토'});let value='원본\r',writes=0;
 service.registerNativeOfficeConnection({environment:'fixture',app:'word',scope:{projectId:service.projectId,taskId:task.id},documentId:'doc',officeSessionId:'office',async call(name,input){if(name==='inspect_office')return {snapshotId:'snapshot',results:input.steps.map(s=>s.id?{reference:s.id}:value)};writes++;value=input.steps[0].value;return {status:'verified',mutated:true,completedWrites:1,writeResultUncertain:false,saved:false,checks:input.checks.map(c=>({passed:c.equals===value}))};}},{allowFixture:true});
 const observed=await executeNativeOffice(service,task,'inspect_native_office',{steps:[{action:'get',member:'Content',id:'body'},{target:'body',action:'get',member:'Text'}]},new AbortController().signal);
 const p=await executeNativeOffice(service,task,'write_native_office',{observationId:observed.observationId,summary:'본문 수정',steps:[{target:'body',action:'set',member:'Text',value:'AI 초안\r'}],checks:[{read:{target:'body',action:'get',member:'Text'},equals:'AI 초안\r'}]},new AbortController().signal);
 task.question=p.question;task.state='waiting_input';service.store.set('task:'+task.id,task);const original=task.question.nativeOfficeApproval;
 const result=reviseNativeOfficeDraft(service,{taskId:task.id,questionId:task.question.id,approvalId:original,edits:[{id:task.question.documentPreview.editTargets[0].id,value:'사람이 고친 문구'}]});assert.equal(writes,0);assert.equal(value,'원본\r');assert.notEqual(result.question.nativeOfficeApproval,original);
 assert.throws(()=>decideNativeOffice(service,service.task(task.id),'실행',original),/draft_changed/);assert.throws(()=>reviseNativeOfficeDraft(service,{taskId:task.id,questionId:task.question.id,approvalId:original,edits:[]}),/draft_changed/);
 const current=service.task(task.id);decideNativeOffice(service,current,'실행',current.question.nativeOfficeApproval);await continueNativeOffice(service,current,new AbortController().signal);assert.equal(writes,1);assert.equal(value,'사람이 고친 문구\r');assert.equal(service.task(task.id).nativeOffice.outcome.receipt.status,'verified_unsaved');
});
for(const reason of ['stop','disconnect'])test(`human draft cannot be revised or approved after ${reason}`,async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'Word 초안 수정'});let writes=0;
 service.registerNativeOfficeConnection({environment:'fixture',app:'word',scope:{projectId:service.projectId,taskId:task.id},documentId:'doc',officeSessionId:'office',async call(name,input){if(name==='inspect_office')return {snapshotId:'snapshot',results:input.steps.map(s=>s.id?{reference:s.id}:'원본\r')};writes++;throw Error('unexpected write');}},{allowFixture:true});
 const observed=await executeNativeOffice(service,task,'inspect_native_office',{steps:[{action:'get',member:'Content',id:'body'},{target:'body',action:'get',member:'Text'}]},new AbortController().signal);
 const p=await executeNativeOffice(service,task,'write_native_office',{observationId:observed.observationId,summary:'본문 수정',steps:[{target:'body',action:'set',member:'Text',value:'초안\r'}],checks:[{read:{target:'body',action:'get',member:'Text'},equals:'초안\r'}]},new AbortController().signal);
 task.question=p.question;task.state='waiting_input';service.store.set('task:'+task.id,task);
 const input={taskId:task.id,questionId:task.question.id,approvalId:task.question.nativeOfficeApproval,edits:[{id:task.question.documentPreview.editTargets[0].id,value:'사람 수정'}]};
 assert.throws(()=>reviseNativeOfficeDraft(service,{...input,edits:[{id:'unknown',value:'x'}]}),/target_changed/);assert.equal(service.task(task.id).nativeOffice.pending.id,input.approvalId);
 const revised=reviseNativeOfficeDraft(service,input);if(reason==='stop')await service.stopAgent({taskId:task.id});else service.dispose();
 assert.throws(()=>reviseNativeOfficeDraft(service,{...input,approvalId:revised.question.nativeOfficeApproval}),/draft_changed/);
 assert.throws(()=>decideNativeOffice(service,service.task(task.id),'실행',revised.question.nativeOfficeApproval),/draft_changed|approval_changed/);assert.equal(writes,0);
});
