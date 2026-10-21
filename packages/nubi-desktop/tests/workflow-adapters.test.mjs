import {removeLater} from './helpers-cleanup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,symlink,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {createAdapters,createSyntheticAdapters,ADAPTER_CATALOG} from '../runtime/workflow-adapters.mjs';
import {hash} from '../runtime/files.mjs';
installAgent(ProjectService);
const ctx={stepId:'read',summary:'합성 자료를 확인합니다.'};
async function setup(t){const f=await fixture(t),task=await f.service.createTask({request:'합성 워크플로우를 확인합니다.'});f.service.store.set('task:'+task.id,{...task,state:'review'});return {...f,task,adapters:createAdapters(f.service,{taskId:task.id,runId:'run-test'})};}
test('catalog and synthetic adapters have the same actions and missing responses fail explicitly',async()=>{
  const synthetic=createSyntheticAdapters({responses:{read:{ok:true,result:{value:'합성'},receipts:['fixture:read']}}});
  assert.deepEqual(ADAPTER_CATALOG,{web:['read','verify'],terminal:['run'],documents:['exists','read','hash'],mcp:['call'],browser:['script']});
  for(const [name,actions] of Object.entries(ADAPTER_CATALOG))for(const action of actions){const result=await synthetic[name][action]({},ctx);assert.equal(result.ok,true);assert.equal(result.result.value,'합성');assert.equal(typeof synthetic[name].irreversible,'function');}
  assert.equal((await synthetic.web.read({},{stepId:'missing'})).error,'workflow_fixture_missing');
});
test('document reads, existence and hashes produce bound host receipts',async t=>{
  const {adapters,service,task}=await setup(t);const read=await adapters.documents.read({path:'app.txt'},ctx);
  assert.equal(read.ok,true);assert.match(read.result.content,/first/);assert.equal(read.result.hash,hash(read.result.content));
  const hashed=await adapters.documents.hash({path:'app.txt'},ctx);assert.equal(hashed.result.hash,read.result.hash);
  assert.equal((await adapters.documents.exists({path:'app.txt'},ctx)).result.exists,true);
  assert.equal((await adapters.documents.exists({path:'missing.md'},ctx)).result.exists,false);
  const receipt=service.store.get(read.receipts[0]);assert.equal(receipt.taskId,task.id);assert.equal(receipt.runId,'run-test');assert.equal(receipt.stepId,'read');assert.equal(receipt.summary,ctx.summary);
});
test('document adapters reject traversal, absolute paths and escaping links',async t=>{
  const {adapters,root}=await setup(t);for(const value of ['../outside','/etc/passwd'])await assert.rejects(adapters.documents.hash({path:value},ctx),/path_scope/);
  const external=await mkdtemp(path.join(tmpdir(),'nubi-adapter-out-'));removeLater(external);await writeFile(path.join(external,'x.txt'),'outside');await symlink(path.join(external,'x.txt'),path.join(root,'escape.txt'));
  await assert.rejects(adapters.documents.read({path:'escape.txt'},ctx),/path_scope/);
});
function browser(service,{navigate=false}={}){
  const calls=[];let checks=0;
  service.playwrightRequest=async(action,args)=>{calls.push({action,args});if(action==='open')return {tabId:'tab-one',documentId:'doc-one'};if(action==='check'){checks++;if(navigate&&checks>1)throw Error('browser_document_changed');return {tabId:'tab-one',documentId:'doc-one',origin:'https://example.invalid'};}throw Error('unexpected action');};
  service.mcpRegistry=()=>({call:async(name,args)=>{calls.push({name,args});return {ok:true,text:'{"tabId":"tab-one","documentId":"doc-one","origin":"https://example.invalid"}\n### Page\n- Page URL: https://example.invalid/ticket/12\n### Snapshot\n- heading "합성 요청" [level=1]\n- button "저장" [ref=e2]\n- paragraph: 저장 안 됨'};}});
  return calls;
}
test('web read uses the existing tab bridge and snapshot with durable binding',async t=>{
  const {adapters,service}=await setup(t),calls=browser(service);const result=await adapters.web.read({url:'https://example.invalid/ticket/12'},ctx);
  assert.equal(result.ok,true);assert.equal(result.observation.tabId,'tab-one');assert.equal(result.observation.documentId,'doc-one');assert.match(result.observation.text,/합성 요청/);
  assert(calls.some(call=>call.action==='open'));assert(calls.some(call=>call.name==='mcp__playwright__browser_snapshot'));
});
test('web verification reads current text, named roles and exact URL rather than model claims',async t=>{
  const {adapters,service}=await setup(t);browser(service);await adapters.web.read({url:'https://example.invalid/ticket/12'},ctx);
  for(const condition of [{kind:'text_present',value:'합성 요청'},{kind:'element_visible',role:'button',name:'저장'},{kind:'url_is',value:'https://example.invalid/ticket/12'}])assert.equal((await adapters.web.verify(condition,ctx)).result.verified,true);
  assert.equal((await adapters.web.verify({kind:'element_visible',role:'textbox',name:'저장'},ctx)).result.verified,false);
  assert.equal((await adapters.web.verify({kind:'url_is',value:'https://example.invalid/ticket/13'},ctx)).result.verified,false);
  await assert.rejects(adapters.web.verify({kind:'unsupported'},ctx),/workflow_verify_unknown/);
});
test('a URL or host metadata match does not prove visible page text',async t=>{
  const {adapters,service}=await setup(t);browser(service);await adapters.web.read({url:'https://example.invalid/ticket/12'},ctx);
  assert.equal((await adapters.web.verify({kind:'text_present',value:'ticket/12'},ctx)).result.verified,false);
});
test('web observations reject a document change and never switch to another tab',async t=>{
  const {adapters,service}=await setup(t);browser(service,{navigate:true});await assert.rejects(adapters.web.read({url:'https://example.invalid'},ctx),/browser_document_changed/);
  await assert.rejects(adapters.web.verify({tabId:'other',kind:'text_present',value:'x'},ctx),/workflow_browser_missing|workflow_browser_changed/);
});
test('web without a usable automation connection reports unavailable',async t=>{
  const {adapters}=await setup(t);await assert.rejects(adapters.web.read({url:'https://example.invalid'},ctx),/workflow_browser_unavailable/);
});
test('terminal creates the existing approval card and repeated polling never creates another command',async t=>{
  const {adapters,service}=await setup(t);const first=await adapters.terminal.run({script:'echo workflow'},ctx);
  assert.equal(first.waiting,true);assert.equal(first.ok,false);assert.equal(service.store.list('setup-action:').length,1);assert.equal(service.store.list('process:').length,0);
  assert.equal(first.receipts[0].startsWith('setup-action:'),true);assert.deepEqual((await adapters.terminal.run({script:'echo workflow'},ctx)).receipts,first.receipts);
  await assert.rejects(adapters.terminal.run({script:'echo changed'},ctx),/workflow_binding_changed/);
});
test('terminal approval then readback verifies the real process and no command is replayed',async t=>{
  const {adapters,service}=await setup(t),first=await adapters.terminal.run({script:'echo workflow'},ctx),action=service.store.get(first.receipts[0]);
  await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  for(let i=0;i<200&&service.processes.active.size;i++)await new Promise(resolve=>setTimeout(resolve,10));
  const result=await adapters.terminal.run({script:'echo workflow'},ctx);
  assert.equal(result.ok,true);assert.equal(result.result.exitCode,0);assert.match(result.result.output,/workflow/);assert.equal(service.store.list('process:').length,1);
});
test('a rejected or uncertain command stays stopped and is never recreated',async t=>{
  const {adapters,service}=await setup(t),first=await adapters.terminal.run({script:'echo workflow'},ctx),action=service.store.get(first.receipts[0]);
  await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'reject'});
  assert.equal((await adapters.terminal.run({script:'echo workflow'},ctx)).error,'workflow_command_rejected');
  service.store.set(first.receipts[0],{...action,state:'attention',error:'setup_execution_unconfirmed'});
  const uncertain=await adapters.terminal.run({script:'echo workflow'},ctx);assert.equal(uncertain.execution,'unconfirmed');assert.equal(service.store.list('setup-action:').length,1);assert.equal(service.store.list('process:').length,0);
});
test('terminal automatic checks retain manifest-change and irreversible protections',async t=>{
  const {adapters,service,root,task}=await setup(t);await writeFile(path.join(root,'package.json'),'{"scripts":{"test":"echo workflow"}}');service.setApprovalMode({mode:'commands'});
  service.store.set('setting:after-edit-check-untrusted',[root]);
  const result=await adapters.terminal.run({script:'npm test'},ctx);assert.equal(result.waiting,true);assert.equal(service.store.get(result.receipts[0]).manifestChanged,true);assert.equal(service.store.list('process:').length,0);
  assert.equal(adapters.terminal.irreversible({script:'rm -rf out'}),true);
  assert.equal(adapters.documents.irreversible(),false);assert.equal(adapters.web.irreversible(),false);
  assert.equal(service.task(task.id).state,'review');
});
test('terminal uses only existing always-allow approval for an exact harmless command',async t=>{
  const {adapters,service}=await setup(t);const first=await adapters.terminal.run({script:'echo workflow'},ctx),action=service.store.get(first.receipts[0]);service.allowCommand({id:action.id});
  const current=await adapters.terminal.run({script:'echo workflow'},ctx);assert.equal(current.waiting,true);
  for(let i=0;i<200&&service.processes.active.size;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await adapters.terminal.run({script:'echo workflow'},ctx)).ok,true);
});
test('cancelled calls issue no file, browser or command operation',async t=>{
  const {adapters,service}=await setup(t),controller=new AbortController();controller.abort();
  for(const adapter of [()=>adapters.documents.read({path:'app.txt'},{...ctx,signal:controller.signal}),()=>adapters.terminal.run({script:'echo x'},{...ctx,signal:controller.signal})])await assert.rejects(adapter);
  assert.equal(service.store.list('setup-action:').length,0);assert.equal(service.store.list('workflow-receipt:').length,0);
});
test('synthetic process readback caps UTF-8 output at 8KB and retains nonzero exit',async t=>{
  const {adapters,service}=await setup(t),args={script:'echo workflow'},prepared=await adapters.terminal.run(args,ctx),action=service.store.get(prepared.receipts[0]);
  service.store.set(prepared.receipts[0],{...action,state:'started',resultProcessId:'synthetic-process'});
  service.store.set('process:synthetic-process',{id:'synthetic-process',state:'failed',exitCode:2,output:'한'.repeat(5000)});
  const result=await adapters.terminal.run(args,ctx);assert.equal(result.ok,false);assert.equal(result.result.exitCode,2);assert.equal(result.result.outputTruncated,true);assert(Buffer.byteLength(result.result.output)<=8192);assert.equal(result.result.output.includes('\uFFFD'),false);
});
test('an old always-allow entry cannot automatically execute an irreversible command',async t=>{
  const {adapters,service}=await setup(t),args={script:'rm -rf synthetic-output'},prepared=await adapters.terminal.run(args,ctx);service.allowCommand({id:service.store.get(prepared.receipts[0]).id});
  const result=await adapters.terminal.run(args,ctx);assert.equal(result.waiting,true);assert.equal(service.store.list('process:').length,0);
});
test('a valid long action summary fits the existing card title without losing its reason',async t=>{
  const {adapters,service}=await setup(t),summary='합성 명령의 목적을 확인합니다. '.repeat(22).slice(0,490);
  const result=await adapters.terminal.run({script:'echo workflow'},{...ctx,summary});
  assert.equal(result.waiting,true);const action=service.store.get(result.receipts[0]);assert(action.title.length<=120);assert.equal(action.reason,summary.trim());
});
test('a stale approval card reports changed state rather than waiting forever',async t=>{
  const {adapters,service}=await setup(t),args={script:'echo workflow'},prepared=await adapters.terminal.run(args,ctx),action=service.store.get(prepared.receipts[0]);service.store.set(prepared.receipts[0],{...action,state:'stale'});
  const result=await adapters.terminal.run(args,ctx);assert.equal(result.error,'workflow_command_changed');assert.notEqual(result.waiting,true);
});
test('missing snapshot content is an observation failure, not proof of missing text',async t=>{
  const {adapters,service}=await setup(t);browser(service);await adapters.web.read({url:'https://example.invalid/ticket/12'},ctx);service.mcpRegistry=()=>({call:async()=>({ok:true,text:'### Page\n- Page URL: https://example.invalid/ticket/12'})});
  await assert.rejects(adapters.web.verify({kind:'text_present',value:'합성 요청'},ctx),/workflow_browser_snapshot/);
});
test('W8 cancellation during command preparation cannot leave a late approval card',async t=>{
 const {service,adapters}=await setup(t),controller=new AbortController(),target=service.target.bind(service);let count=0;
 service.target=async(...args)=>{const root=await target(...args);if(++count===2)controller.abort(Error('workflow_step_timeout'));return root;};
 await assert.rejects(adapters.terminal.run({script:'echo fixture'},{...ctx,signal:controller.signal}),/workflow_step_timeout/);assert.equal(service.store.list('setup-action:').length,0);
});
