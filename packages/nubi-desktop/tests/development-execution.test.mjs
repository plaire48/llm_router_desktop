import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,fixturePlan,fixtureReview} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {shellProfiles} from '../runtime/processes.mjs';
import {readProcessOutput} from '../runtime/process-output.mjs';
import {prepareSetupAction} from '../runtime/setup-actions.mjs';
import {developmentChecks,bindDevelopmentEvidence} from '../runtime/development-workflow.mjs';

const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,25));}assert.fail('process observation timeout');};
const command=file=>quote(process.execPath)+' '+quote(file);
installAgent(ProjectService);

test('agent shell discovery selects the same installed PowerShell 7 as human terminals',async()=>{
  const profiles=await shellProfiles({platform:'win32',env:{ProgramFiles:'C:\\Program Files',SystemRoot:'C:\\Windows'},
    lookup:async()=>{throw Error('not on PATH');},exists:async file=>{if(file!=='C:\\Program Files\\PowerShell\\7\\pwsh.exe')throw Error('missing');}});
  assert.equal(profiles.find(p=>p.id==='powershell').executable,'C:\\Program Files\\PowerShell\\7\\pwsh.exe');
});

test('an approved interactive command keeps a real TTY and accepts its observed input exactly once',async t=>{
  if(process.platform==='win32')return t.skip('POSIX command fixture; native Windows is separate');
  const {service,root}=await fixture(t);
  await writeFile(path.join(root,'ask.cjs'),`console.log('TTY:'+process.stdin.isTTY);console.log('Name?');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{console.log('Hello '+line);process.exit(0);});`);
  const task=await service.createTask({request:'대화형 개발 도구 실행'});
  const source=await service.read({taskId:task.id,path:'ask.cjs'});
  const observations={files:new Map([['ask.cjs',{hash:source.hash}]]),processes:new Map()};
  const action=await prepareSetupAction(service,task.id,{kind:'start',title:'도구 실행',interactive:true,script:command('ask.cjs'),reason:'개발 환경 준비',effects:'로컬 프로세스 실행',verification:'질문에 입력하고 결과 확인',references:[{path:'ask.cjs',hash:source.hash}]},observations);
  await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  const record=()=>service.processes.poll(service.store.get('setup-action:'+action.id).resultProcessId);
  await until(()=>record().output.includes('Name?'));
  assert.match(record().output,/TTY:true/);
  assert.equal(record().interactive,true);
  const observed=await readProcessOutput(service,task.id,{processId:record().id});
  assert.match(observed.inputRevision,/^sha256:/);
  observations.processes.set(record().id,observed.inputRevision);
  const input=await prepareSetupAction(service,task.id,{kind:'input',processId:record().id,processRevision:observed.inputRevision,
    title:'이름 입력',script:'Nubi\n',reason:'현재 Name 질문에 답변',effects:'실행 중인 도구에 이름 전달',verification:'Hello 출력 확인',references:[]},observations);
  assert.equal(input.script,'Nubi\n','the approved input bytes include the newline');
  const approval={id:input.id,fingerprint:input.fingerprint,decision:'approve'};
  await service.decideSetupAction(approval);
  await service.decideSetupAction(approval);
  await until(()=>record().state==='completed');
  assert.match(record().output,/Hello Nubi/);
  assert.equal(record().inputCount,1);
  assert.equal(service.store.list('process:').length,1);
});

test('process input cannot target another task or a changed, unobserved prompt',async t=>{
  const {service,root}=await fixture(t);
  const task=await service.createTask({request:'first'}),other=await service.createTask({request:'other'});
  const p=await service.processes.start({cwd:root,taskId:task.id,script:process.platform==='win32'?'ping -n 5 127.0.0.1':'sleep 5',autoDiagnose:false});
  const args={kind:'input',processId:p.id,processRevision:'sha256:'+'a'.repeat(64),title:'input',script:'yes\n',reason:'answer',effects:'input',verification:'read output',references:[]};
  await assert.rejects(()=>prepareSetupAction(service,other.id,args,{files:new Map(),processes:new Map()}),/process_input_unavailable/);
  await assert.rejects(()=>prepareSetupAction(service,task.id,args,{files:new Map(),processes:new Map()}),/process_input_unavailable/);
});

test('server inspection checks the observed loopback URL and never starts a second process',async t=>{
  if(process.platform==='win32')return t.skip('POSIX fixture');
  const {service,root}=await fixture(t),task=await service.createTask({request:'서버 실행 확인'});
  await writeFile(path.join(root,'server.cjs'),`const s=require('node:http').createServer((q,r)=>r.end('<title>Development preview</title><h1>Ready</h1>'));s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));`);
  const p=await service.processes.start({cwd:root,taskId:task.id,script:command('server.cjs'),autoDiagnose:false});
  await until(()=>service.processes.poll(p.id).output.includes('http://'));
  const result=await service.invoke('inspectDevServer',{taskId:task.id,processId:p.id});
  assert.equal(result.responding,true);assert.equal(result.status,200);assert.equal(result.title,'Development preview');
  assert.equal(result.functionalVerified,false);assert.equal(result.processOwnership,'not_verified');
  assert.equal(service.store.list('process:').length,1);
  await assert.rejects(()=>service.invoke('inspectDevServer',{taskId:task.id,processId:p.id,url:'http://127.0.0.1:1/'}),/server_url_not_observed/);
  await assert.rejects(()=>service.invoke('inspectDevServer',{taskId:task.id,processId:p.id,url:'http://example.com:80/'}),/server_url_not_observed/);
});

test('server-only requests carry readiness evidence without requiring a file edit',()=>{
  const start='2026-10-16T10:00:00.000Z';
  const task={id:'task',request:'개발 서버 실행',messages:[],criteria:[]};
  const receipts={setupActions:[{id:'a',taskId:'task',kind:'start',state:'started',resultProcessId:'p',createdAt:start}],processes:[{id:'p',taskId:'task',state:'running',execution:'started',startedAt:start}]};
  const checks=developmentChecks(task,receipts);
  assert.equal(checks.length,1);assert.equal(checks[0].method,'server');
  const evidence={id:'tool:1',tool:'inspect_dev_server',usable:true,observedAt:start,result:{processId:'p',responding:true,status:200,state:'running',execution:'started',functionalVerified:false}};
  const host={id:'host',usable:true,result:receipts};
  assert.deepEqual(bindDevelopmentEvidence(checks,[host,evidence])[0].eligibleEvidenceIds,['host','tool:1']);
  assert.deepEqual(bindDevelopmentEvidence(checks,[host,{...evidence,result:{...evidence.result,state:'failed'}}])[0].eligibleEvidenceIds,[]);
  assert.deepEqual(bindDevelopmentEvidence(checks,[host,evidence,{...evidence,id:'tool:2',observedAt:'2026-10-16T10:00:01.000Z',result:{...evidence.result,responding:false}}])[0].eligibleEvidenceIds,[]);
  assert.deepEqual(bindDevelopmentEvidence(checks,[{...host,result:{...receipts,processes:[{...receipts.processes[0],state:'completed'}]}},evidence])[0].eligibleEvidenceIds,[]);
});

test('a non-server interactive start does not require an HTTP response',()=>{
  const task={id:'task',request:'대화형 프로젝트 생성 도구 실행',messages:[],criteria:[]};
  assert.deepEqual(developmentChecks(task,{setupActions:[{id:'a',taskId:'task',kind:'start',title:'프로젝트 생성',verification:'파일 확인',state:'started',resultProcessId:'p'}],processes:[]}),[]);
});

test('an observed prompt change invalidates approval and terminal control escapes are refused',async t=>{
  if(process.platform==='win32')return t.skip('POSIX fixture');
  const {service,root}=await fixture(t),task=await service.createTask({request:'대화형 도구 질문 확인'});
  await writeFile(path.join(root,'prompt.cjs'),`console.log('First?');setTimeout(()=>console.log('Changed?'),200);setInterval(()=>{},1000);`);
  const p=await service.processes.start({cwd:root,taskId:task.id,script:command('prompt.cjs'),interactive:true,autoDiagnose:false});
  await until(()=>service.processes.poll(p.id).output.includes('First?'));
  const observed=await readProcessOutput(service,task.id,{processId:p.id});
  const args={kind:'input',processId:p.id,processRevision:observed.inputRevision,title:'input',script:'yes\n',reason:'answer',effects:'input',verification:'output',references:[]};
  const observations={files:new Map(),processes:new Map([[p.id,observed.inputRevision]])};
  await assert.rejects(()=>prepareSetupAction(service,task.id,{...args,script:'\u001b[2Jyes\n'},observations),/process_input_invalid/);
  const proposal=await prepareSetupAction(service,task.id,args,observations);
  await until(()=>service.processes.poll(p.id).output.includes('Changed?'));
  await assert.rejects(()=>service.decideSetupAction({id:proposal.id,fingerprint:proposal.fingerprint,decision:'approve'}),/process_input_changed/);
  assert.equal(service.processes.poll(p.id).inputCount,0);
});

test('code intelligence finds a type error and its cross-file definition within the admitted snapshot',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'타입 오류와 호출 위치 확인'});
  await writeFile(path.join(root,'value.ts'),'export const amount: number = "wrong";\n');
  await writeFile(path.join(root,'use.ts'),'import {amount} from "./value";\nexport const total = amount + 1;\n');
  const diagnostics=await service.invoke('inspectCode',{taskId:task.id,path:'value.ts',mode:'diagnostics'});
  assert(diagnostics.diagnostics.some(d=>d.code==='TS2322'&&d.path==='value.ts'));
  const definitions=await service.invoke('inspectCode',{taskId:task.id,path:'use.ts',mode:'definition',line:2,column:23});
  assert(definitions.locations.some(d=>d.path==='value.ts'&&d.line===1));
  const references=await service.invoke('inspectCode',{taskId:task.id,path:'value.ts',mode:'references',line:1,column:15});
  assert(references.locations.some(d=>d.path==='use.ts'&&d.line===2));
  assert.equal(diagnostics.editObservation,false);
  await assert.rejects(()=>service.invoke('inspectCode',{taskId:task.id,path:'.env',mode:'diagnostics'}),/path_scope/);
});

test('Pi continues an interactive configuration through its prompt approval to actual completion',async t=>{
  if(process.platform==='win32')return t.skip('POSIX fixture');
  const {service,root}=await fixture(t,{scriptedPlanning:true,scriptedReview:true});
  await writeFile(path.join(root,'configure.cjs'),`console.log('Project name?');require('node:readline').createInterface({input:process.stdin}).on('line',name=>{console.log('Configured '+name);process.exit(0);});`);
  let actor=0,plans=0;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages,tools){
    const plan=fixturePlan(messages);if(plan){plans++;return plan;}
    const review=fixtureReview(messages);if(review)return review;
    const last=messages.findLast(m=>m.role==='tool'),result=last?JSON.parse(last.content):null;
    switch(actor++){
      case 0:return call('read_source',{path:'configure.cjs'});
      case 1:return call('propose_setup_action',{kind:'configure',title:'개발 도구 초기화',script:command('configure.cjs'),interactive:true,reason:'프로젝트 초기화',effects:'로컬 도구 실행',verification:'Configured 출력 확인',references:[{path:'configure.cjs',hash:result.hash}]});
      case 2:return call('read_process_output',{processId:service.store.list('process:')[0].id,waitMs:1000});
      case 3:assert.match(result.text,/Project name/);assert(tools.some(t=>t.function.name==='propose_process_input'));return call('propose_process_input',{processId:result.processId,revision:result.inputRevision,input:'Nubi\n',reason:'현재 프로젝트 이름 질문에 답변'});
      case 4:return call('read_process_output',{processId:service.store.list('process:')[0].id,waitMs:1000});
      default:assert.match(result.text,/Configured Nubi/);return {content:'프로그램의 Configured Nubi 출력을 확인했습니다.',calls:[]};
    }
  }};
  const task=await service.createTask({request:'개발 도구를 초기화하고 질문에 Nubi로 답한 뒤 결과를 확인해 주세요.'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const start=service.store.list('setup-action:')[0];
  await service.decideSetupAction({id:start.id,fingerprint:start.fingerprint,decision:'approve'});
  await until(()=>!service.agent.running&&service.store.list('setup-action:').some(a=>a.kind==='input'));
  const input=service.store.list('setup-action:').find(a=>a.kind==='input');
  await service.decideSetupAction({id:input.id,fingerprint:input.fingerprint,decision:'approve'});
  await until(()=>!service.agent.running&&service.task(task.id).messages.some(m=>m.role==='assistant'&&m.content.includes('Configured Nubi')));
  assert.equal(plans,1);assert.equal(service.store.list('process:').length,1);assert.equal(service.processes.poll(start.resultProcessId||service.store.get('setup-action:'+start.id).resultProcessId).inputCount,1);
});
