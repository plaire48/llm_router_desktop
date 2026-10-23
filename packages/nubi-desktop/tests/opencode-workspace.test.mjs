import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {hash} from '../runtime/files.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {preferOpenCodeCoding} from '../runtime/coding-engine-routing.mjs';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('the product coding path uses original OpenCode and preserves observed edits, diagnostics and approval',async t=>{
 const {service,root}=await fixture(t);delete service.codingRunner;
 const original='export function value() {\r\n    return 1;\r\n}\r\n';await writeFile(path.join(root,'app.ts'),original);let observed,planned=false,rejected=false,proposed=false,rounds=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:64000}]}),dispose(){},async complete(messages){
  rounds++;const last=messages.findLast(m=>m.role==='tool'),result=last?JSON.parse(last.content):null;
  if(!observed){if(result?.path==='app.ts'&&result.hash)observed=result.hash;else return call('read_source',{path:'app.ts'});}
  if(!planned){if(result?.id&&result.targets)planned=true;else return call('record_change_plan',{summary:'Return two',requirements:[{id:'R1',text:'Return two',criterionId:'AC-1'}],targets:[{path:'app.ts',reason:'Change the observed return value',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'The returned value is two'}],assumptions:[]});}
  if(!rejected){if(result?.error==='proposal_invalid_syntax'){assert(result.quality.diagnostics.some(d=>d.origin==='introduced'));rejected=true;}else return call('propose_patch',{path:'app.ts',expectedHash:observed,matching:'opencode',edits:[{oldText:'export function value() {\n  return 1;\n}',newText:'export function value() {\n    return (;\n}'}],reason:'Deliberate syntax regression'});}
  if(!proposed){if(result?.id&&result.quality?.state==='passed')proposed=true;else return call('propose_patch',{path:'app.ts',expectedHash:observed,matching:'opencode',edits:[{oldText:'export function value() {\n  return 1;\n}',newText:'export function value() {\n    return 2;\n}'}],reason:'Repair the draft and return two'});}
  return {content:'문법 오류를 고친 변경안을 준비했습니다. 반영과 실행 검사는 아직 하지 않았습니다.',calls:[]};
 }};
 const task=await service.createTask({request:'버그를 수정해서 value 함수가 2를 반환하게 해 주세요.',criteria:['Return two']});await service.startAgent({taskId:task.id});await service.agent.promise;
 const completed=service.task(task.id);assert.equal(completed.state,'review',completed.error);assert.equal(completed.executionEngine.id,'opencode');assert.equal(completed.executionEngine.version,'1.19.4');assert(completed.executionEngine.sessionId);assert.equal(completed.executionEngine.state,'completed');assert(rounds>=5&&rounds<=10);
 const proposals=service.state().proposals.filter(p=>p.taskId===task.id);assert.equal(proposals.length,1);assert.equal(proposals[0].quality.state,'passed');assert.equal(await readFile(path.join(root,'app.ts'),'utf8'),original,'native execution does not bypass host application approval');assert.equal(proposals[0].content,'export function value() {\r\n    return 2;\r\n}\r\n');assert.equal(proposals[0].expectedHash,hash(original));
 assert(completed.trace.some(entry=>entry.tool==='propose_patch'&&entry.status==='error'));assert(completed.trace.some(entry=>entry.tool==='propose_patch'&&entry.status==='done'));assert(completed.resultReview,'independent host review still runs');
});

test('coding routing chooses the native engine without requiring a magic coding keyword',()=>{
 assert(preferOpenCodeCoding({request:'이 화면의 버튼을 파랗게 바꿔 주세요.'}));
 assert(preferOpenCodeCoding({request:'함수를 정리해 주세요.'},{workspaceKind:'conversation'}));
 assert(!preferOpenCodeCoding({request:'메일 일정을 찾아 주세요.'},{scope:'mail'}));
 assert(!preferOpenCodeCoding({request:'문서 요약',workPlan:{intent:{workflowIds:['document']}}}));
 assert(!preferOpenCodeCoding({request:'안녕하세요.'},{workspaceKind:'conversation'}));
 assert(preferOpenCodeCoding({request:'기존 코딩 대화',changePlan:{}},{workspaceKind:'conversation'}));
});

test('native compaction invalidates discarded source observations in the product host',async t=>{
 const {service}=await fixture(t);let inspected=false,runnerFailure;
 const probe=async options=>{
  await options.prepareContext(options.messages,options.tools);
  await options.execute('update_plan',{intent:{goal:'Change the first line',constraints:[],outcomes:['The first line changes'],workflowIds:['source-change'],skillPaths:[]},steps:[{text:'Inspect and change the first line',expected_outcome:'The requested line changes',status:'in_progress'}]});
  const read=await options.execute('read_source',{path:'app.txt'});assert(read.hash,JSON.stringify(read));
  assert.equal(typeof options.onContextCompacted,'function');await options.onContextCompacted();
  const rejected=await options.execute('record_change_plan',{summary:'Change the first line',requirements:[{id:'R1',text:'Change the first line'}],targets:[{path:'app.txt',reason:'User request',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'inspection',description:'Inspect the first line'}],assumptions:[]});
  assert.equal(rejected.error,'source_read_required',JSON.stringify(rejected));inspected=true;
  return {content:'소스를 다시 읽기 전에는 변경 계획을 기록하지 않았습니다.',calls:[]};
 };
 service.codingRunner=async options=>{try{return await probe(options);}catch(error){runnerFailure=error;throw error;}};
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},complete:async()=>({content:'Unused actor fixture.',calls:[]})};
 const task=await service.createTask({request:'app.txt 첫 줄 코드를 수정해 주세요.'});await service.startAgent({taskId:task.id});await service.agent.promise;
 if(runnerFailure)throw runnerFailure;
 assert(inspected,service.task(task.id).error);assert.equal(service.task(task.id).changePlan,undefined);
});
