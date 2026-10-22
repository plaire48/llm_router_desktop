import {featureTest} from './beta-feature.mjs';const test=featureTest('workflows');
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,fixturePlan,fixtureReview} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {createWorkflowRunner} from '../runtime/workflow-runner.mjs';
import {loadWorkflowPackage} from '../runtime/workflow-package.mjs';
import {validateWorkflow} from '../runtime/workflow-schema.mjs';
import {git} from '../runtime/files.mjs';
installAgent(ProjectService);
const condition={kind:'output_schema'};
const step=(id='decide',tools=['read_source'],done_when=condition)=>({id,kind:'agent',goal:'합성 자료를 읽고 판단 결과와 실제 근거 영수증 id를 evidence 배열로 제출한다.',tools,done_when,outputs:{schema:{type:'object',required:['summary','evidence'],properties:{summary:{type:'string'},evidence:{type:'array',items:{type:'string'}}},additionalProperties:false}}});
const definition=steps=>({name:'합성 결과 판단',version:1,permissions:{tools:['documents','terminal','wiki','skills','mail'],externalWrite:'never'},steps});
const call=(name,args)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
async function setup(t,steps=[step()]){
 const f=await fixture(t),dir=path.join(f.root,'.nubi/workflows/sample');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'workflow.yaml'),JSON.stringify(definition(steps)));
 const pkg=await loadWorkflowPackage(f.root,'sample');f.service.store.set('workflow-qualified:sample:'+pkg.definitionHash,{definitionHash:pkg.definitionHash,hash:pkg.hash});
 return {...f,runner:createWorkflowRunner(f.service)};
}
function provider(f,actor){f.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),complete:(messages,...args)=>fixturePlan(messages)||fixtureReview(messages)||actor(messages,...args),dispose(){}};}
const results=messages=>messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).filter(Boolean);

test('output-only completion allows closed read tools but refuses writes commands and process input',()=>{
 assert.equal(validateWorkflow(definition([step()])).ok,true);
 for(const tool of ['propose_new_file','propose_setup_action','propose_process_input']){
  const result=validateWorkflow(definition([step('decide',[tool])]));assert.equal(result.ok,false,tool);assert.equal(result.errors[0].code,'workflow_done_when_unobservable',tool);
 }
 assert.equal(validateWorkflow(definition([step('decide',['propose_new_file'],{kind:'all_of',all_of:[condition,{kind:'file_exists',path:'out.md'}]})])).ok,true);
 assert.equal(validateWorkflow(definition([step('decide',['propose_new_file'],{kind:'all_of',all_of:[condition,{kind:'truthy'}]})])).errors[0].code,'workflow_done_when_unobservable');
});
test('malformed empty or deeply nested completion contracts fail before a run',()=>{
 for(const done_when of [{kind:'all_of',all_of:[]},{kind:'output_schema',evidence:{min:-1}},{kind:'output_schema',evidence:{min:1.5}},{kind:'all_of',all_of:[null]}])assert.equal(validateWorkflow(definition([step('decide',[],done_when)])).ok,false);
});
test('a real source read exposes a host receipt and completes a schema-only stage',async t=>{
 const f=await setup(t);let count=0;
 provider(f,async messages=>{if(count++===0)return {content:'',calls:[call('read_source',{path:'app.txt',start:1,end:1})]};const read=results(messages).find(row=>row.workflowEvidence?.length);assert.ok(read,'host receipt is in the model result');return {content:'',calls:[call('submit_step_output',{output:{summary:'읽은 합성 자료',evidence:read.workflowEvidence.map(row=>row.id)}})]};});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');assert.equal(run.steps.decide.status,'complete');assert.match(run.report,/결과 제출 확인/);
 const child=f.service.task(run.steps.decide.taskId),id=run.steps.decide.output.evidence[0];assert.ok(child.trace.some(row=>row.workflowEvidence?.some(e=>e.id===id&&e.sources[0].path==='app.txt'&&e.sources[0].start===1&&e.sources[0].end===1)));
});
test('two fabricated receipt submissions close partial with the evidence error',async t=>{
 const f=await setup(t);const errors=[];
 provider(f,async messages=>{errors.push(...results(messages).map(row=>row.error).filter(Boolean));return {content:'',calls:[call('submit_step_output',{output:{summary:'가짜 근거',evidence:['operation:missing']}})]};});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_evidence_invalid');assert.equal(run.steps.decide.submissionErrors,2);assert.equal(run.steps.decide.output,undefined);assert.ok(errors.includes('workflow_evidence_invalid'));
});
test('one evidence correction reuses an actual receipt without rereading',async t=>{
 const f=await setup(t);let count=0;
 provider(f,async messages=>{if(count++===0)return {content:'',calls:[call('read_source',{path:'app.txt'})]};const id=results(messages).find(row=>row.workflowEvidence?.length)?.workflowEvidence[0].id;return {content:'',calls:[call('submit_step_output',{output:{summary:'교정',evidence:[count===2?'operation:missing':id]}})]};});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');assert.equal(run.steps.decide.submissionErrors,1);assert.equal(f.service.store.list('operation:').filter(row=>row.tool==='read_source').length,1);
});
test('a receipt from another step conversation is rejected despite existing in this workflow',async t=>{
 const f=await setup(t,[step('first'),step('second')]);let firstId;const counts=new Map();
 provider(f,async messages=>{const text=JSON.stringify(messages),second=text.includes('second');const key=second?'second':'first';const n=counts.get(key)||0;counts.set(key,n+1);if(!n&&!second)return {content:'',calls:[call('read_source',{path:'app.txt'})]};firstId ||=results(messages).find(row=>row.workflowEvidence?.length)?.workflowEvidence[0].id;return {content:'',calls:[call('submit_step_output',{output:{summary:key,evidence:[firstId]}})]};});
 // Distinguish isolated stages by their literal goal, rather than model call counts.
 const file=path.join(f.root,'.nubi/workflows/sample/workflow.yaml');const doc=definition([step('first'),{...step('second'),goal:'second 단계에서 이전 영수증 재사용 금지'}]);await writeFile(file,JSON.stringify(doc));const pkg=await loadWorkflowPackage(f.root,'sample');f.service.store.set('workflow-qualified:sample:'+pkg.definitionHash,{definitionHash:pkg.definitionHash,hash:pkg.hash});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.steps.first.status,'complete');assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_evidence_invalid');assert.equal(run.steps.second.output,undefined);
});
test('source tools default to one receipt while a tool-free schema stage needs none',async t=>{
 for(const tools of [[],['read_source']]){const f=await setup(t,[step('decide',tools)]);provider(f,async()=>({content:'',calls:[call('submit_step_output',{output:{summary:'합성 판단',evidence:[]}})]}));const run=await f.runner.start({slug:'sample'});assert.equal(run.status,tools.length?'partial':'complete');if(tools.length)assert.equal(run.reason,'workflow_evidence_invalid');}
});
test('all_of retains independent file verification after a valid structured submission',async t=>{
 const f=await setup(t,[step('decide',['propose_new_file'],{kind:'all_of',all_of:[{kind:'output_schema',evidence:{min:0}},{kind:'file_exists',path:'missing.md'}]})]);provider(f,async()=>({content:'',calls:[call('submit_step_output',{output:{summary:'파일은 없음',evidence:[]}})]}));const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.reason,'workflow_verify_failed');assert.ok(run.steps.decide.candidate);assert.equal(run.steps.decide.output,undefined);
});

test('parallel reads keep distinct same-tool receipts bound to their trace entries',async t=>{
 const f=await setup(t);await writeFile(path.join(f.root,'other.txt'),'other synthetic data\n');let count=0;
 provider(f,async messages=>{if(count++===0)return {content:'',calls:[call('read_source',{path:'app.txt',start:1,end:1}),call('read_source',{path:'other.txt',start:1,end:1})]};const receipts=results(messages).flatMap(row=>row.workflowEvidence||[]);assert.deepEqual(receipts.map(row=>row.sources[0].path).sort(),['app.txt','other.txt']);return {content:'',calls:[call('submit_step_output',{output:{summary:'두 자료',evidence:receipts.map(row=>row.id)}})]};});
 const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete');assert.equal(new Set(run.steps.decide.output.evidence).size,2);
});
test('schema and evidence errors consume one shared correction allowance',async t=>{
 const f=await setup(t);const seen=[];provider(f,async messages=>{seen.push(...results(messages).map(row=>row.error).filter(Boolean));return {content:'',calls:[call('submit_step_output',{output:seen.includes('workflow_output_schema')?{summary:'형식 교정',evidence:['operation:missing']}:{summary:12,evidence:[]}})]};});const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'partial');assert.equal(run.steps.decide.submissionErrors,2);assert.equal(run.reason,'workflow_evidence_invalid');assert.equal(run.steps.decide.candidate,undefined);assert.ok(seen.includes('workflow_output_schema'));
});

test('an explicitly external stage also requires independently observable completion',()=>{
 const result=validateWorkflow({...definition([{...step('decide',[]),externalWrite:true}]),permissions:{tools:[],externalWrite:'ask'}});assert.equal(result.ok,false);assert.equal(result.errors[0].code,'workflow_done_when_unobservable');
});

test('wiki and mail receipts retain source identity and hash rather than model supplied labels',async t=>{
 for(const kind of ['wiki','mail']){
  const tool=kind==='wiki'?'wiki_query':'read_personal_mail',f=await setup(t,[step('decide',[tool])]);
  // Only the external source boundary is synthetic; agent dispatch, trace and validation are real.
  if(kind==='wiki')f.service.wikiQuery=async()=>({results:[{path:'openwiki/synthetic.md',hash:'sha256:synthetic',excerpt:'합성 근거',provenance:{start:2,end:3}}]});
  else f.service.mail=async()=>({id:'a'.repeat(64),sourceHash:'sha256:synthetic-mail',mail:{subject:'합성 안내',text:'합성 본문',attachments:[]}});
  let index=0;provider(f,async messages=>{if(index++===0)return {content:'',calls:[call(tool,kind==='wiki'?{query:'합성'}:{id:'a'.repeat(64)})]};const receipt=results(messages).find(row=>row.workflowEvidence?.length)?.workflowEvidence[0];assert.ok(receipt);assert.equal(receipt.sources[0].kind,kind);assert.equal(receipt.sources[0].hash,kind==='wiki'?'sha256:synthetic':'sha256:synthetic-mail');return {content:'',calls:[call('submit_step_output',{output:{summary:'합성 확인',evidence:[receipt.id]}})]};});
  const run=await f.runner.start({slug:'sample'});assert.equal(run.status,'complete',JSON.stringify(run));
 }
});

test('existing read-only skill discovery and isolated research remain output-only stages',()=>{
 for(const tool of ['use_skill','delegate_research','analyze_documents'])assert.equal(validateWorkflow({...definition([step('decide',[tool])]),permissions:{tools:['skills','research'],externalWrite:'never'}}).ok,true,tool);
});

for(const oldestFirst of [false,true])for(const sameQuestion of [false,true])test(`two delegated Wiki answers retain their own operation and earlier receipt (same question: ${sameQuestion}, oldest first: ${oldestFirst})`,async t=>{
 const f=await setup(t,[step('decide',['ask_openwiki'])]);if(oldestFirst){const list=f.service.store.list.bind(f.service.store);f.service.store.list=(prefix,...args)=>{const rows=list(prefix,...args);return prefix==='operation:'?rows.reverse():rows;};}await writeFile(path.join(f.root,'openwiki','synthetic.md'),'# Synthetic workflow\n\nSynthetic workflow rules are read before a decision.\n');await git(f.root,['add','openwiki/synthetic.md']);await git(f.root,['commit','-qm','add synthetic wiki']);let index=0,firstReceipt,delivered;
 provider(f,async(messages)=>{
  const prompt=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
  if(!messages[0].content.startsWith('You are Nubi Desktop')){
   if(prompt.includes('Plan OpenWiki research'))return {content:JSON.stringify({mode:'focused',questions:['What are the synthetic workflow rules?']})};
   const reads=results(messages);if(prompt.includes('Synthesize')){const evidence=JSON.parse(messages.at(-1).content).evidence;return {content:JSON.stringify({status:'complete',answer:'Synthetic workflow rules are read first.',findings:[{text:'Read the rules first.',citations:evidence.slice(0,1).map(row=>row.id)}],uncertainties:[]})};}
   const found=reads.find(Array.isArray);if(!found)return {content:'',calls:[call('search_wiki',{query:'synthetic workflow'})]};const read=reads.find(row=>!Array.isArray(row)&&row.id&&row.excerpt);if(!read)return {content:'',calls:[call('read_wiki',{documentId:found[0].documentId,start:0,length:6000})]};return {content:JSON.stringify({status:'complete',answer:'Synthetic workflow rules are read first.',findings:[{text:'Read the rules first.',citations:[read.id]}],uncertainties:[]})};
  }
  const receipts=results(messages).flatMap(row=>row.workflowEvidence||[]);
  if(index++===0)return {content:'',calls:[call('ask_openwiki',{wiki:'external',question:'What are the synthetic workflow rules?'})]};
  if(index===2){assert.equal(receipts.length,1);firstReceipt=structuredClone(receipts[0]);return {content:'',calls:[call('ask_openwiki',{wiki:'external',question:sameQuestion?'What are the synthetic workflow rules?':'Why are synthetic workflow rules read first?'})]};}
  delivered=structuredClone(receipts);return {content:'',calls:[call('submit_step_output',{output:{summary:'합성 위키 두 번 확인',evidence:receipts.map(row=>row.id)}})]};
 });
 const run=await f.runner.start({slug:'sample'});assert.equal(delivered?.length,2);assert.notEqual(delivered[0].id,delivered[1].id);assert.deepEqual(f.service.store.get(firstReceipt.id).workflowEvidence,firstReceipt,'the second answer must not overwrite the first operation');assert.equal(run.status,'complete',run.reason);const child=f.service.task(run.steps.decide.taskId),ids=run.steps.decide.output.evidence;assert.equal(new Set(ids).size,2);for(const id of ids){const operation=f.service.store.get(id);assert.equal(operation.state,'completed');assert.ok(child.trace.some(row=>row.workflowEvidence?.some(receipt=>receipt.id===id)));}
});
