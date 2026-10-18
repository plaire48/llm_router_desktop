import {test} from 'node:test';import assert from 'node:assert/strict';
import {proposeSideTask,transitionSideTask,mergeSideTasks,SIDE_TASK_LIMIT} from '../runtime/side-tasks.mjs';
import {fixture} from './fixtures.mjs';import {ProjectService} from '../runtime/project-service.mjs';import {installAgent} from '../runtime/agent.mjs';installAgent(ProjectService);
const prompt='src/mail.mjs 135행의 첨부 실패 목록에 mail_timeout이 빠져 있다. 목록에 넣고 tests/mail-attachments.test.mjs에 시간 초과 사례를 추가해 node --test로 확인한다. '.repeat(3);
const input={title:'첨부 실패 코드 보완',tldr:'첨부 읽기 실패 목록에 시간 초과가 빠져 있어요.',prompt,runId:'r'};
test('a side task requires bounded metadata and a standalone prompt with a file path',()=>{
 const task={id:'t'},chip=proposeSideTask(task,input);assert.equal(chip.state,'proposed');assert.equal(chip.prompt,prompt.trim());
 for(const patch of [{title:''},{title:'x'.repeat(61)},{tldr:''},{tldr:'x'.repeat(241)},{prompt:'short'},{prompt:'경로 없이 '.repeat(40)},{prompt:'src/a.mjs '+ 'x'.repeat(4000)},{runId:''}])assert.throws(()=>proposeSideTask(task,{...input,...patch}),/side_task_invalid/);
 assert.equal(task.sideTasks.length,1);
});
test('three chips per run, preserving other runs and one-way terminal states',()=>{
 const task={id:'t'};for(let i=0;i<SIDE_TASK_LIMIT;i++)proposeSideTask(task,input);
 assert.throws(()=>proposeSideTask(task,input),/side_task_limit/);const next=proposeSideTask(task,{...input,runId:'next'});assert.equal(task.sideTasks.length,4);
 transitionSideTask(task,next.id,'started');assert.throws(()=>transitionSideTask(task,next.id,'dismissed'),/side_task_state/);
 assert.throws(()=>transitionSideTask(task,'missing','dismissed'),/side_task_missing/);
});
test('persisting an older agent snapshot never revives a user-started or dismissed chip',()=>{
 const current=[{id:'a',state:'started',startedTaskId:'child'},{id:'b',state:'dismissed'}],incoming=[{id:'a',state:'proposed'},{id:'b',state:'proposed'},{id:'c',state:'proposed'}];
 assert.deepEqual(mergeSideTasks(current,incoming),[...current,incoming[2]]);assert.deepEqual(current,[{id:'a',state:'started',startedTaskId:'child'},{id:'b',state:'dismissed'}]);
});
async function seeded(t){const {service,root}=await fixture(t),task=await service.createTask({request:'원 요청'}),chip=proposeSideTask(task,input);service.store.set('task:'+task.id,task);return {service,root,task,chip,args:{projectId:service.projectId,taskId:task.id,sideTaskId:chip.id}};}
test('starting a chip makes exactly one same-project draft with the original prompt, even on duplicate calls',async t=>{
 const {service,task,chip,args}=await seeded(t);const [a,b]=await Promise.all([service.invoke('startSideTask',args),service.invoke('startSideTask',args)]);assert.equal(a.taskId,b.taskId);assert.notEqual(a.taskId,task.id);assert.equal(service.task(a.taskId).request,prompt.trim());assert.equal(service.task(a.taskId).state,'draft');assert.equal(service.store.taskSummaries().length,2);
 assert.equal((await service.invoke('startSideTask',args)).taskId,a.taskId);const saved=service.task(task.id).sideTasks[0];assert.equal(saved.state,'started');assert.equal(saved.startedTaskId,a.taskId);
 assert.throws(()=>service.dismissSideTask(args),/side_task_state/);await assert.rejects(service.startSideTask({...args,projectId:'other'}),/project_changed/);assert.equal(chip.state,'proposed');
});
test('dismissal preserves the chip record, blocks starting it and enforces the model run binding',async t=>{
 const {service,task,args}=await seeded(t);assert.throws(()=>service.dismissSideTask({...args,runId:'other'}),/side_task_state/);
 await service.invoke('dismissSideTask',args);assert.equal(service.task(task.id).sideTasks[0].state,'dismissed');await assert.rejects(service.startSideTask(args),/side_task_state/);assert.equal(service.store.taskSummaries().length,1);
});
test('failed creation leaves the chip proposed and allows retry; in-flight start cannot be dismissed or duplicated',async t=>{
 const {service,task,args}=await seeded(t),original=service.createTask.bind(service);let release;service.createTask=()=>new Promise((resolve,reject)=>{release=()=>reject(Error('fixture_failure'));});
 const pending=service.startSideTask(args);assert.throws(()=>service.dismissSideTask(args),/side_task_state/);release();await assert.rejects(pending,/fixture_failure/);assert.equal(service.task(task.id).sideTasks[0].state,'proposed');service.createTask=original;await service.startSideTask(args);assert.equal(service.store.taskSummaries().length,2);
});
test('agent spawn persists the host run; a user dismissal during the next model call survives the final answer',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'확인된 별도 작업을 제안해 주세요.'});let step=0,advertised;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},complete:async(messages,tools)=>{
  advertised??=tools.map(row=>row.function.name);if(step++===0)return {content:'',calls:[{id:'spawn',type:'function',function:{name:'spawn_task',arguments:JSON.stringify({title:input.title,tldr:input.tldr,prompt})}}]};
  const chip=service.task(task.id).sideTasks?.[0];assert(chip);service.dismissSideTask({projectId:service.projectId,taskId:task.id,sideTaskId:chip.id});return {content:'별도 작업을 정리했어요.',calls:[]};
 }};
 await service.startAgent({taskId:task.id});await service.agent.promise;const saved=service.task(task.id);assert(advertised.includes('spawn_task')&&advertised.includes('dismiss_task'));assert.equal(saved.sideTasks?.length,1,JSON.stringify(saved.trace));assert.equal(saved.sideTasks[0].state,'dismissed');assert.equal(saved.sideTasks[0].runId,saved.messages.findLast(m=>m.role==='assistant').runId);
});
test('a pending chip start blocks source deletion, service replacement and app update until it settles',async t=>{
 const {mkdir}=await import('node:fs/promises');const {service,root,task,args}=await seeded(t);const other=root+'-other';await mkdir(other);
 let release;service.createTask=()=>new Promise((resolve,reject)=>{release=()=>reject(Error('fixture_failure'));});const pending=service.startSideTask(args);
 await assert.rejects(service.deleteTask({taskId:task.id}),/project_busy/);await assert.rejects(service.open(other,{initializeWiki:false}),/project_busy/);assert.throws(()=>service.prepareAppUpdate(),/update_work_active/);
 release();await assert.rejects(pending,/fixture_failure/);assert.equal(service.root,root);assert.equal(service.sideTaskStarts.size,0);
});
test('the model can dismiss its own run chip and the transition is retained',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'제안한 별도 작업을 이번 실행에서 해결하면 거두어 주세요.'});let step=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},complete:async()=>{
  const name=step++===0?'spawn_task':step===2?'dismiss_task':null;if(!name)return {content:'제안을 정리했어요.',calls:[]};
  return {content:'',calls:[{id:'side-'+step,type:'function',function:{name,arguments:JSON.stringify(name==='spawn_task'?{title:input.title,tldr:input.tldr,prompt}:{id:service.task(task.id).sideTasks[0].id})}}]};
 }};
 await service.startAgent({taskId:task.id});await service.agent.promise;const saved=service.task(task.id);assert.equal(saved.sideTasks[0].state,'dismissed');assert(saved.trace.some(row=>row.tool==='dismiss_task'&&row.status==='done'));
});

test('F4 dismissal denial remains typed in the model result and trace',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'다음 작업 제안 정리'});let n=0;const returned=[];
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{for(const m of messages.filter(m=>m.role==='tool')){try{returned.push(JSON.parse(m.content));}catch{}}return n++===0?{content:'',calls:[{id:'bad-dismiss',type:'function',function:{name:'dismiss_task',arguments:JSON.stringify({id:'missing'})}}]}:{content:'제안을 찾지 못했습니다.',calls:[]};}};
 await service.startAgent({taskId:task.id});await service.agent.promise;assert(returned.some(r=>r.error==='side_task_missing'&&r.actionIssued===false));assert(service.task(task.id).trace.some(r=>r.tool==='dismiss_task'&&r.reason==='side_task_missing'));
});
test('F4 spawn validation failure reaches the model and trace',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'후속 작업 제안'});let n=0;const returned=[];
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{returned.push(...messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)));return n++===0?{content:'',calls:[{id:'bad-spawn',type:'function',function:{name:'spawn_task',arguments:JSON.stringify({title:'확인',tldr:'추가 확인',prompt:'구체적인 파일 경로가 없는 작업 설명입니다. '.repeat(12)})}}]}:{content:'제안 내용을 보완해야 합니다.',calls:[]};}};
 await service.startAgent({taskId:task.id});await service.agent.promise;assert(returned.some(r=>r.error==='side_task_invalid'&&r.actionIssued===false&&r.instruction));assert(service.task(task.id).trace.some(r=>r.tool==='spawn_task'&&r.reason==='side_task_invalid'));
});

test('F14 started suggestions preserve provenance in saved tasks and navigation',async t=>{
 const {service,task,chip,args}=await seeded(t),child=await service.startSideTask(args);
 const origin={kind:'side_task',taskId:task.id,sideTaskId:chip.id,runId:chip.runId};
 assert.deepEqual(service.task(child.taskId).origin,origin);
 assert.deepEqual(service.store.taskSummaries().find(row=>row.id===child.taskId).origin,origin);
});
test('F14 a suggestion is not a personal memory; an actual follow-up still can be',async t=>{
 const {memoryStores,listMemories,closeUserMemoryStore}=await import('../runtime/memory.mjs');
 const {service,args}=await seeded(t);t.after(()=>closeUserMemoryStore(service.storageRoot));
 const child=await service.startSideTask(args),people=[];service.memoryExtraction=true;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},complete:async messages=>{
  if(messages[0]?.content.startsWith('You maintain a short memory')){
   people.push(JSON.parse(messages[1].content).person);
   return {content:JSON.stringify({add:[{text:'답변은 짧은 표로 정리하는 것을 선호한다',scope:'user'}],update:[],delete:[]}),calls:[]};
  }
  return {content:'요청을 확인했어요.',calls:[]};
 }};
 await service.startAgent({taskId:child.taskId});await service.agent.promise;
 assert.equal(people.length,0);assert.equal(listMemories(memoryStores(service)).length,0);
 await service.startAgent({taskId:child.taskId,answer:'앞으로 답변은 짧은 표로 정리해 주세요.'});await service.agent.promise;
 for(let i=0;i<100&&!listMemories(memoryStores(service)).length;i++)await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(people,['앞으로 답변은 짧은 표로 정리해 주세요.']);
 assert.equal(listMemories(memoryStores(service))[0]?.scope,'user');
});
test('F14 suggestion labels cannot conceal text with bidirectional controls',()=>{
 const chip=proposeSideTask({}, {...input,title:'\u202e첨부\u2066 확인\u2069',tldr:'\u202a요약\u202c',prompt:'\u202e'+prompt});
 assert.equal(chip.title,'첨부 확인');assert.equal(chip.tldr,'요약');assert.equal(chip.prompt,prompt.trim());
});

test('F12 suggestion inputs reject invisible labels and slash commands after normalization',()=>{
 for(const patch of [{title:'\u200b'},{tldr:'\u0007\u200b'},{prompt:'\u200b /wiki_update '+prompt},{prompt:'\u001b/wiki_update '+prompt}])assert.throws(()=>proposeSideTask({}, {...input,...patch}),/side_task_invalid/);
 const chip=proposeSideTask({}, {...input,title:'작업 \u200b  정리',prompt:'\u0007'+prompt+'\u009f'});
 assert.equal(chip.title,'작업 정리');assert.equal(chip.prompt,prompt.trim());
});
