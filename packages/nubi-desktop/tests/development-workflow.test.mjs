import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {developmentChecks,bindDevelopmentEvidence,enforceDevelopmentEvidence} from '../runtime/development-workflow.mjs';
import {resultReviewInput,reviewResult} from '../runtime/result-review.mjs';
import {fixture,fixturePlan,fixtureReview} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {readProcessOutput} from '../runtime/process-output.mjs';
installAgent(ProjectService);
const before='2026-10-15T01:00:00.000Z',applied='2026-10-15T01:00:01.000Z',after='2026-10-15T01:00:02.000Z';
function sample(){
 const task={request:'검색 기능 개발',criteria:[],messages:[],changePlan:{createdAt:before,targets:[{path:'app.js'}],checks:[{requirementId:'r',method:'test',description:'검색 회귀 검사'},{requirementId:'r',method:'browser',description:'검색 입력 후 결과 확인'}]}};
 const receipts={proposals:[{path:'app.js',state:'applied',createdAt:before,appliedAt:applied}],setupActions:[{kind:'verify',state:'started',resultProcessId:'p'}],processes:[{id:'p',profile:'bash',cwd:'/project',script:'npm test',state:'completed',execution:'started',exitCode:0,startedAt:after,output:'1 test passed'}]};
 const browser={tool:'mcp__playwright__browser_snapshot',observedAt:after,result:{ok:true,server:'playwright',tool:'browser_snapshot',text:'검색 결과: apple'}};
 return {task,receipts,evidence:[browser],candidate:'검색 동작을 확인했습니다.',model:{id:'fixture',contextLength:32000}};
}
test('development review carries planned checks and post-application evidence',()=>{
 const {data}=resultReviewInput(sample());assert(data.requirements.some(r=>r.id==='host:development'));
 assert.deepEqual(data.developmentChecks.map(c=>c.eligibleEvidenceIds),[['host'],['tool:0']]);
});
test('unapplied edits and a later scope change do not impose stale development checks',()=>{
 const x=sample();x.receipts.proposals[0].state='proposed';assert.deepEqual(developmentChecks(x.task,x.receipts),[]);
 x.receipts.proposals[0].state='applied';x.task.messages=[{role:'user',at:after,content:'실행하지 말고 설명만'}];assert.deepEqual(developmentChecks(x.task,x.receipts),[]);
});
for(const [name,mutate] of [
 ['running',x=>x.receipts.processes[0].state='running'],['failed',x=>x.receipts.processes[0].exitCode=1],
 ['pre-edit',x=>x.receipts.processes[0].startedAt=before],['missing timestamp',x=>delete x.receipts.proposals[0].appliedAt],
 ['unknown execution',x=>x.receipts.processes[0].execution='unknown'],['empty output',x=>x.receipts.processes[0].output=''],
 ['truncated output',x=>x.receipts.processes[0].outputTruncated=true],['build only',x=>x.receipts.setupActions[0].kind='build'],
])test(name+' cannot certify tests',()=>{const x=sample();mutate(x);assert.deepEqual(resultReviewInput(x).data.developmentChecks[0].eligibleEvidenceIds,[]);});
for(const [name,mutate] of [
 ['tab open',e=>{e.tool='open_workspace_page';e.result.tool='browser_open';}],
 ['capture',e=>{e.tool='mcp__playwright__browser_capture';e.result.tool='browser_capture';}],
 ['failed snapshot',e=>e.result.ok=false],['old snapshot',e=>e.observedAt=before],
 ['other MCP server',e=>e.result.server='other'],
])test(name+' cannot certify browser behavior',()=>{const x=sample();mutate(x.evidence[0]);assert.deepEqual(resultReviewInput(x).data.developmentChecks[1].eligibleEvidenceIds,[]);});
test('a reviewer cannot mark missing development evidence supported',async()=>{
 const x=sample();x.evidence=[];
 const result=await reviewResult({...x,signal:new AbortController().signal,invoke:async messages=>({calls:[],content:JSON.stringify({status:'ready',nextStep:'',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'supported',evidenceIds:['host'],detail:'완료'}))})})});
 assert.equal(result.status,'revise');assert.equal(result.normalized,'development_verification_missing');
 assert.equal(result.checks.find(c=>c.requirementId==='host:development').state,'unknown');
 const truthful={status:'ready',checks:[{requirementId:'host:development',state:'unknown',evidenceIds:[],detail:'로그인이 필요해 확인 못 함'}]};
 assert.equal(enforceDevelopmentEvidence(truthful,{}),truthful,'a truthful limitation is not a success claim');
});

function repeatVerification(x,changes={}){
 const process={...x.receipts.processes[0],id:'p2',startedAt:'2026-10-15T01:00:03.000Z',...changes};
 x.receipts.processes.unshift(process);
 x.receipts.setupActions.unshift({kind:'verify',state:'started',resultProcessId:process.id});
 return process;
}
for(const state of ['failed','running','cancelled'])test(`a later ${state} verification supersedes the same command's old pass`,()=>{
 const x=sample();repeatVerification(x,{state,exitCode:state==='failed'?1:null});
 assert.deepEqual(resultReviewInput(x).data.developmentChecks[0].eligibleEvidenceIds,[]);
});
test('a successful rerun qualifies regardless of receipt ordering; another command remains independent',()=>{
 const x=sample();x.receipts.processes[0].state='failed';x.receipts.processes[0].exitCode=1;
 repeatVerification(x,{state:'completed',exitCode:0});x.receipts.processes.reverse();
 let check=resultReviewInput(x).data.developmentChecks[0];assert.deepEqual(check.eligibleProcessIds,['p2']);
 x.receipts.processes.find(p=>p.id==='p2').script='npm run lint';x.receipts.processes.find(p=>p.id==='p').state='completed';x.receipts.processes.find(p=>p.id==='p').exitCode=0;
 check=resultReviewInput(x).data.developmentChecks[0];assert.deepEqual(new Set(check.eligibleProcessIds),new Set(['p','p2']));
});
test('approved command repair inherits verification provenance and supersedes its failed parent',()=>{
 const x=sample();x.receipts.processes[0].state='failed';x.receipts.processes[0].exitCode=1;
 x.receipts.processes.unshift({...x.receipts.processes[0],id:'fixed',repairOf:'p',script:'npm test -- --run',startedAt:'2026-10-15T01:00:03.000Z',state:'completed',exitCode:0});
 const check=resultReviewInput(x).data.developmentChecks[0];assert.deepEqual(check.eligibleEvidenceIds,['host']);assert.deepEqual(check.eligibleProcessIds,['fixed']);
});
test('a repair without its original verify receipt cannot certify development',()=>{
 const x=sample();x.receipts.processes[0].repairOf='missing';x.receipts.setupActions=[];
 assert.deepEqual(resultReviewInput(x).data.developmentChecks[0].eligibleEvidenceIds,[]);
});
test('the same text in another workspace or shell does not supersede a verification',()=>{
 for(const change of [{cwd:'/other-project'},{profile:'powershell'}]){
  const x=sample();repeatVerification(x,{state:'failed',exitCode:1,...change});
  assert.deepEqual(resultReviewInput(x).data.developmentChecks[0].eligibleProcessIds,['p']);
 }
});
test('a conflicting timestamp tie is not a current pass and repairing an inspect command is not a test',()=>{
 const x=sample();repeatVerification(x,{startedAt:after,state:'failed',exitCode:1});
 assert.deepEqual(resultReviewInput(x).data.developmentChecks[0].eligibleEvidenceIds,[]);
 x.receipts.setupActions=[{kind:'inspect',state:'started',resultProcessId:'p'}];
 Object.assign(x.receipts.processes[0],{repairOf:'p',state:'completed',exitCode:0,startedAt:'2026-10-15T01:00:04.000Z'});
 assert.deepEqual(resultReviewInput(x).data.developmentChecks[0].eligibleEvidenceIds,[]);
});
test('cyclic repair records and missing rerun times never revive an old success',()=>{
 const x=sample();repeatVerification(x,{startedAt:undefined,state:'failed',exitCode:1});
 assert.deepEqual(resultReviewInput(x).data.developmentChecks[0].eligibleEvidenceIds,[]);
 x.receipts.processes[0].repairOf='p';x.receipts.processes[1].repairOf='p2';x.receipts.setupActions=[];
 assert.deepEqual(resultReviewInput(x).data.developmentChecks[0].eligibleEvidenceIds,[]);
});

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const until=async predicate=>{for(let i=0;i<400;i++){if(predicate())return;await new Promise(r=>setTimeout(r,25));}assert.fail('continuation timeout');};
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
test('approved server continues before exit, reads output and opens observed page once',async t=>{
 if(process.platform==='win32')return t.skip('POSIX fixture command; Windows runtime remains a separate gate');
 const {service,root}=await fixture(t,{scriptedPlanning:true,scriptedReview:true});
 await writeFile(path.join(root,'server.cjs'),`const http=require('node:http');const s=http.createServer((q,r)=>r.end('<h1>Ready preview</h1>'));s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));`);
 let actor=0,plans=0,opened=0;
 service.openWorkspacePage=async({url})=>{assert.match(await(await fetch(url)).text(),/Ready preview/);opened++;return {tabId:'preview',url};};
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
  const plan=fixturePlan(messages);if(plan){plans++;return plan;}const review=fixtureReview(messages);if(review)return review;
  actor++;
  if(actor===1)return call('read_source',{path:'server.cjs'});
  if(actor===2){const hash=service.task(service.agent.taskId).sources.find(s=>s.path==='server.cjs').hash;return call('propose_setup_action',{title:'미리보기 실행',kind:'start',script:shellQuote(process.execPath)+' server.cjs',reason:'웹 화면 확인',effects:'로컬 서버 실행',verification:'출력 주소에서 화면 확인',references:[{path:'server.cjs',hash}]});}
  const record=service.store.list('process:')[0];assert.equal(record.state,'running');
  if(actor===3)return call('read_process_output',{processId:record.id,waitMs:100});
  if(actor===4){const url=record.output.trim();assert.match(JSON.stringify(messages),/http:\/\/127\.0\.0\.1:/);return call('open_workspace_page',{url});}
  return {content:'미리보기를 열었습니다. 브라우저 동작 검증은 아직입니다.',calls:[]};
 }};
 const task=await service.createTask({request:'로컬 웹 서버를 실행하고 인앱에서 열어 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 const action=service.store.list('setup-action:')[0];assert(action,JSON.stringify({actor,task:service.task(task.id)}));await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
 await until(()=>opened===1&&!service.agent.running);
 assert.equal(plans,1,'reuse provisional plan after approved start');assert.equal(actor,5);assert.equal(service.store.list('process:').length,1);
 const running=service.processes.poll(service.store.get('setup-action:'+action.id).resultProcessId);assert.equal(running.state,'running');assert(running.startContinuationAt);
 service.processStarted(running);await new Promise(r=>setTimeout(r,100));assert.equal(actor,5,'no duplicate continuation');
 service.processes.stop(running.id);await until(()=>!service.processes.active.size);assert.equal(actor,5,'user stop does not restart the task');
});
test('waiting for process output is bounded and does not relaunch a quiet process',async t=>{
 if(process.platform==='win32')return t.skip('POSIX fixture');
 const {service,root}=await fixture(t);const task=await service.createTask({request:'출력 기다리기'});
 const p=await service.processes.start({cwd:root,taskId:task.id,profile:'bash',script:'sleep 5',autoDiagnose:false});
 const result=await readProcessOutput(service,task.id,{processId:p.id,waitMs:30});assert.equal(result.state,'running');assert.equal(result.text,'');
 await assert.rejects(()=>readProcessOutput(service,task.id,{processId:p.id,waitMs:5001}),/process_log_arguments/);
 const controller=new AbortController();const pending=readProcessOutput(service,task.id,{processId:p.id,waitMs:5000},controller.signal);controller.abort();await assert.rejects(()=>pending);
 assert.equal(service.store.list('process:').length,1);service.processes.stop(p.id);
});
