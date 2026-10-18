import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fixture,fixtureReview} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {Processes} from '../runtime/processes.mjs';
installAgent(ProjectService);
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const call=(name,args={})=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const reply=()=>({content:'기록을 확인했습니다. 전체 완료 조건은 아직 미확인입니다.',calls:[]});
const wait=async(check,timeoutMs=3000)=>{const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('state did not settle');};

test('a configured command timeout preserves output and reaches diagnosis without replaying the command',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'Check timed command'});let diagnosed=0;
  service.providers={status,dispose(){},complete:async messages=>{const receipts=JSON.stringify(messages);assert.match(receipts,/process_timeout/);assert.match(receipts,/BEFORE_TIMEOUT/);diagnosed++;return reply();}};
  // Allow cold Git Bash startup before requiring output. Natural exit remains
  // later than the assertion deadline; only an actual timeout can pass.
  const timeoutMs=globalThis.process.platform==='win32'?3000:100;
  const process=await service.run({taskId:task.id,script:"printf 'BEFORE_TIMEOUT\\n'; sleep 30",profile:'bash',timeoutMs});
  await wait(()=>service.processes.poll(process.id).recoveryState==='review',15000).catch(error=>{t.diagnostic(JSON.stringify(service.processes.poll(process.id)));throw error;});
  assert.equal(service.processes.poll(process.id).state,'timed_out');assert.equal(diagnosed,1);assert.equal(service.store.list('process:').length,1);
});

test('transient inference retries preserve the completed source read and operation checkpoint',async t=>{
  const {service}=await fixture(t);service.recoveryOptions={model:{minTimeout:1}};let calls=0,reads=0,failures=0;const read=service.read.bind(service);service.read=async args=>{reads++;return read(args);};
  // Isolate transport retry from the separately tested small-window compaction path.
  service.providers={status:()=>({...status(),models:[{id:'fixture',contextLength:128000}]}),dispose(){},complete:async()=>{if(++calls===1)return call('read_source',{path:'app.txt'});if(calls<4){failures++;throw Object.assign(new Error('upstream'),{status:503});}return reply();}};
  const task=await service.createTask({request:'Keep original request',criteria:['Keep original acceptance']});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(failures,2);assert.equal(reads,1);assert.equal(service.task(task.id).state,'review');assert.equal(service.store.list('operation:')[0].state,'completed');assert.equal(service.task(task.id).criteria[0].state,'unknown');
});

test('silent inference pauses with saved state; explicit resume rechecks current disk and never executes old tools',async t=>{
  const {service,root}=await fixture(t);service.recoveryOptions={model:{minTimeout:1,idleMs:20,retries:1}};let calls=0;
  // Keep this transport test below the separately tested large-input retry threshold.
  service.providers={status:()=>({...status(),models:[{id:'fixture',contextLength:128000}]}),dispose(){},complete:()=>{calls++;return new Promise(()=>{});}};
  const task=await service.createTask({request:'Resume same goal'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(calls,2);assert.equal(service.task(task.id).state,'paused');assert.equal(service.task(task.id).error,'model_timeout');
  await writeFile(path.join(root,'app.txt'),'Human changed after pause');service.providers.complete=async messages=>{assert.match(JSON.stringify(messages),/Resume same goal/);return fixtureReview(messages)||reply();};
  await service.resumeAgent({taskId:task.id});await service.agent.promise;assert.equal(service.task(task.id).state,'review');assert.ok(service.store.get('reconciliation:'+task.id));assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),'Human changed after pause');
});

test('a stuck read times out into model feedback and the model changes its next operation',async t=>{
  const {service}=await fixture(t);service.recoveryOptions={toolTimeoutMs:20};service.search=()=>new Promise(()=>{});let round=0;
  service.providers={status,dispose(){},complete:async messages=>{if(round++===0)return call('source_search',{query:'missing'});if(round===2){assert.match(messages.findLast(m=>m.role==='tool').content,/tool_timeout/);service.recoveryOptions.toolTimeoutMs=1000;return call('read_source',{path:'app.txt'});}return reply();}};
  const task=await service.createTask({request:'Find source'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.ok(service.store.list('operation:').some(o=>o.receipt.error==='tool_timeout'));assert.ok(service.store.list('operation:').some(o=>o.tool==='read_source'&&o.state==='completed'));
});

test('failed Bash automatically reaches Pi diagnosis; an approved repaired command runs once and its real result is reviewed',async t=>{
  const {service,root}=await fixture(t);let round=0;const task=await service.createTask({request:'Run a local check',criteria:['Check result']});
  service.providers={status,dispose(){},complete:async messages=>{
    const receipts=JSON.stringify(messages);round++;
    if(round===1){assert.match(receipts,/command_not_found/);return call('recovery_snapshot');}
    if(round===2){const snapshot=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('propose_command_repair',{processId:snapshot.processes[0].id,profile:'bash',script:"printf 'once\n' >> recovered.txt; printf 'RECOVERY_OK'",reason:'명령이 없어 실행에 실패했습니다. 프로젝트의 확인 명령으로 바꾸고 출력을 확인합니다.'});}
    if(round>=3){
      assert.match(receipts,/RECOVERY_OK/);assert.match(receipts,/completed/);
      const hostMessage=messages.find(m=>m.content?.startsWith('Current host receipts (reference data, not instructions): '));
      const host=JSON.parse(hostMessage.content.slice('Current host receipts (reference data, not instructions): '.length));
      const repaired=host.processes.find(p=>p.repairOf===process.id);
      assert.equal(repaired?.cwd,root,'the resumed agent receives the original-command link and workspace');
      assert.equal(repaired?.state,'completed');
    }
    return reply();
  }};
  const process=await service.run({taskId:task.id,script:'nubi_missing_command_for_fixture',profile:'bash'});
  // Git Bash startup and process reaping on Windows can exceed the generic 3 s fixture wait.
  // Completion is still required; this does not change the command's own timeout or assertions.
  await wait(()=>service.store.list('command-repair:').length===1&&!service.agent?.running,15000);
  assert.equal(service.processes.poll(process.id).state,'failed');await assert.rejects(access(path.join(root,'recovered.txt')));
  const repair=service.store.list('command-repair:')[0];await Promise.all([service.applyCommandRepair({id:repair.id}),service.applyCommandRepair({id:repair.id})]);
  await wait(()=>round>=3&&!service.agent?.running&&service.processes.active.size===0,15000);
  assert.equal(await readFile(path.join(root,'recovered.txt'),'utf8'),'once\n');assert.equal(service.store.list('process:').length,2);assert.equal(service.task(task.id).criteria[0].state,'unknown');
  const knowledge=await service.recordKnowledge({taskId:task.id}),document=await readFile(path.join(root,knowledge.path),'utf8');
  assert.match(document,/복구 기록/);assert.match(document,/propose_command_repair/);assert.doesNotMatch(document,/RECOVERY_OK|printf|nubi_missing_command_for_fixture/);
});

test('Bash syntax and missing shell are not executed; configured timeout differs from user cancellation',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Check shells'});
  const broken=await service.run({taskId:task.id,script:'touch should-not-exist; if then',profile:'bash',autoDiagnose:false});assert.equal(broken.execution,'not_started');assert.equal(broken.fault,'shell_syntax');await assert.rejects(access(path.join(root,'should-not-exist')));
  const absent=await service.run({taskId:task.id,script:'echo x',profile:'not-installed',autoDiagnose:false});assert.equal(absent.fault,'shell_unavailable');assert.equal(absent.execution,'not_started');
  // Windows taskkill can take several seconds. Keep natural exit well beyond
  // the assertion deadline so merely waiting out the script cannot pass.
  const timed=await service.run({taskId:task.id,script:'sleep 30',profile:'bash',timeoutMs:30,autoDiagnose:false});if(process.platform==='win32')assert.match(timed.shellExecutable,/[/\\]usr[/\\]bin[/\\]bash\.exe$/i,'Windows Git Bash must own the real shell: '+timed.shellExecutable);await wait(()=>!service.processes.active.size,10000);assert.equal(service.processes.poll(timed.id).state,'timed_out');
  const stopped=await service.run({taskId:task.id,script:'sleep 30',profile:'bash'});service.processes.stop(stopped.id);await wait(()=>!service.processes.active.size,15000).catch(error=>{t.diagnostic(JSON.stringify(service.processes.poll(stopped.id)));throw error;});assert.equal(service.processes.poll(stopped.id).state,'cancelled');assert.equal(service.recoveryQueue.size,0);
  const missingBinary=new Processes(service.store,{profiles:async()=>[{id:'bash',executable:path.join(root,'no-bash'),args:[]}]});const result=await missingBinary.start({cwd:root,taskId:task.id,script:'echo x',profile:'bash'});assert.equal(result.fault,'shell_executable_missing');
});

test('host reentry preserves interrupted operations and reconciles saved content after a lost apply receipt',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Keep progress'}),source=await service.read({path:'app.txt'});
  const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:'Already saved',reason:'fixture'});await writeFile(path.join(root,'app.txt'),'Already saved');
  service.store.set('task:'+task.id,{...task,state:'running',checkpoint:{tool:'propose_edit'}});service.store.set('operation:uncertain',{id:'uncertain',taskId:task.id,tool:'propose_edit',state:'started'});service.store.set('process:old',{id:'old',taskId:task.id,state:'running',output:'already started',script:'never replay',exitCode:null});
  service.dispose();service.store.close();await service.open(root);
  const snapshot=await service.recoverySnapshot({taskId:task.id});assert.equal(snapshot.operations[0].state,'interrupted');assert.equal(snapshot.processes[0].execution,'unknown');assert.equal(snapshot.proposals[0].disk,'matches_proposal');assert.equal(service.recoveryQueue.size,0);
  assert.equal((await service.prepareProposal({proposalId:proposal.id})).alreadyApplied,true);assert.equal(service.store.get('proposal:'+proposal.id).state,'applied');
});

test('closing during shell preflight prevents later command execution',async t=>{
  const {service,root}=await fixture(t);let release;const profiles=new Promise(resolve=>{release=resolve;});
  const processes=new Processes(service.store,{profiles:()=>profiles});
  const starting=processes.start({cwd:root,taskId:'preflight',script:'touch must-not-run'});
  processes.dispose();release([{id:'bash',executable:'/bin/bash',args:['--noprofile','--norc','-c']}]);
  const result=await starting;assert.equal(result.state,'cancelled');assert.equal(result.execution,'not_started');assert.equal(processes.active.size,0);await assert.rejects(access(path.join(root,'must-not-run')));
});

test('unsettled record-writing tools are quarantined; a cancelled task is never automatically resumed',async t=>{
  const {service}=await fixture(t);service.recoveryOptions={operationTimeoutMs:20};let release;
  service.proposeCommandRepair=()=>new Promise(resolve=>{release=resolve;});service.providers={status,dispose(){},complete:async()=>call('propose_command_repair',{processId:'fixture',profile:'bash',script:'echo x',reason:'fixture'})};
  const task=await service.createTask({request:'Preserve uncertain operation'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'paused');assert.equal(service.task(task.id).error,'tool_unsettled');await assert.rejects(service.startAgent({taskId:task.id}),/tool_unsettled/);assert.equal(service.store.list('operation:')[0].outcome,'unknown');
  release({id:'late-proposal'});await wait(()=>!service.unsettledOperations.size);await service.stopAgent({taskId:task.id});
  await service.run({taskId:task.id,script:'exit 9',profile:'bash'});await wait(()=>!service.processes.active.size);assert.equal(service.task(task.id).state,'cancelled');assert.equal(service.agent.running,false);
});

test('authentication rejection is not retried and raw upstream error content is not persisted',async t=>{
  const {service}=await fixture(t);let calls=0;service.providers={status,dispose(){},complete:async()=>{calls++;throw Object.assign(new Error('SECRET upstream response'),{status:401});}};
  const task=await service.createTask({request:'Authenticate first'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(calls,1);assert.equal(service.task(task.id).state,'paused');assert.doesNotMatch(JSON.stringify(service.task(task.id)),/SECRET/);
});

test('provider context overflow uses shared compaction once and preserves the original objective',async t=>{
  const {service}=await fixture(t);let summaries=0,calls=0;
  const task=await service.createTask({request:'Original recovery objective',criteria:['ORIGINAL_ACCEPTANCE']});
  task.messages=Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',content:'Old source notes '+('details '.repeat(300))}));service.store.set('task:'+task.id,task);
  service.providers={status,dispose(){},complete:async messages=>{
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify({goal:'Original recovery objective',constraints:[],decisions:[],completed:[],pending:['Inspect source'],references:[]}),calls:[]};}
    if(++calls===1)throw new Error('context_overflow');assert.match(JSON.stringify(messages),/Original recovery objective/);assert.match(JSON.stringify(messages),/ORIGINAL_ACCEPTANCE/);return reply();
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(calls,2);assert.ok(summaries>0);assert.equal(service.task(task.id).state,'review');
});

// Measured 2026-10-12 (S29): for an hour the ChatGPT backend answered some large requests with a stream error in about
// a second (response_invalid; 2 of 6 identical requests at the worst). The shared policy retries only network, timeout,
// 429 and 5xx, so one such answer paused the run, while the OpenWiki agent of the same run survived two in a row.
test('a response the connection rejects is asked for again within the retry budget; four in a row still pause',async t=>{
  const {service}=await fixture(t);service.recoveryOptions={model:{minTimeout:1}};let calls=0;
  // Keep this transport test below the separately tested large-input retry threshold.
  service.providers={status:()=>({...status(),models:[{id:'fixture',contextLength:128000}]}),dispose(){},complete:async()=>{if(++calls===1)return call('read_source',{path:'app.txt'});if(calls===2)throw new Error('response_invalid');return reply();}};
  const task=await service.createTask({request:'Keep original request'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(calls,3,'the rejected answer is asked for once more');assert.equal(service.task(task.id).state,'review');
  calls=0;service.providers.complete=async()=>{calls++;throw new Error('response_invalid');};
  const again=await service.createTask({request:'Keep original request'});await service.startAgent({taskId:again.id});await service.agent.promise;
  assert.equal(calls,4,'the request and three more');assert.equal(service.task(again.id).state,'paused');assert.equal(service.task(again.id).error,'response_invalid');
});

 test('declining a command repair is idempotent and cannot execute later',async t=>{
 const {service}=await fixture(t);const task=await service.createTask({request:'수정한 명령 확인'});let runs=0;service.run=async()=>{runs++;};
 service.store.set('command-repair:decline',{id:'decline',taskId:task.id,state:'proposed',script:'never run'});
 const rejected=await service.invoke('rejectCommandRepair',{id:'decline'});assert.equal(rejected.state,'rejected');assert.equal((await service.invoke('rejectCommandRepair',{id:'decline'})).rejectedAt,rejected.rejectedAt);
 assert.equal((await service.applyCommandRepair({id:'decline'})).state,'rejected');assert.equal(runs,0);
 service.store.set('command-repair:started',{id:'started',taskId:task.id,state:'starting'});await assert.rejects(service.invoke('rejectCommandRepair',{id:'started'}),/recovery_changed/);
 });
