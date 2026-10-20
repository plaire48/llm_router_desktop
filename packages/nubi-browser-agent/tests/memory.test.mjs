import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../extensions/aipro-chat/agent-runtime.js';
import {runReplay,recordTarget} from '../../../extensions/aipro-chat/browser-replay.js';
import {createBrowserAddon} from '../dist/index.js';
import {createPiBrowserRunner} from '../dist/pi.js';
import {createReplayMemory} from '../dist/memory.js';
import {hostFixture,task,deferred} from './host.mjs';
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),function:{name,arguments:JSON.stringify(args)}}]});
const summary={id:'procedure',version:1,title:'Reviewed input',inputs:[{slot:'v1',label:'Current input'}]};
const answer=()=>({content:'확인 완료',calls:[]});
async function setup(t,model,memory){
  const {host,controls}=hostFixture(),addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'memory-test'});t.after(()=>addon.dispose());
  const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},model:{id:'test',complete:model},memory,tabs:()=>[{tabId:'tab-1'}]});
  return {runner,session,input:{task,tabId:'tab-1'},host,controls};
}
const select=()=>call('use_browser_procedure',{id:summary.id,version:1,values:{v1:'NEW_INPUT'}});
test('a model-declared read continuation stays in the existing policy lane and original host verification',async t=>{
 let calls=0,reads=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async(_s,_c,api)=>{await api.act('fill',{value:'NEW_INPUT'});await api.observe();return {completed:{steps:1},confirmedSteps:[{index:0}]};},followUp:{required:true,parameters:{type:'object',properties:{subject:{type:'string'}},required:['subject'],additionalProperties:false},run:async(_s,_c,api)=>api.act('find',{})}};
 const f=await setup(t,async(_messages,tools)=>{assert.ok(tools.find(t=>t.function.name==='use_browser_procedure').function.parameters.required.includes('readAfter'));return ++calls===1?call('use_browser_procedure',{id:summary.id,version:1,values:{v1:'NEW_INPUT'},readAfter:{subject:'current detail'}}):answer();},memory);
 const execute=f.host.browser.execute;f.host.browser.execute=async(...args)=>{if(args[1].tool==='find')reads++;return execute(...args);};f.host.browser.verify=async(_ctx,cp)=>({criteria:cp.criteria.map(id=>({id,satisfied:reads===1&&f.controls.writes===1,evidenceRefs:['current:detail']}))});
 const result=await f.runner.run(f.input);assert.equal(result.state,'COMPLETED');assert.equal(calls,2);assert.equal(reads,1);assert.equal(f.controls.writes,1);assert.ok(result.metrics.some(x=>x.tool==='procedure_read_after'));
});
test('missing required read intent is rejected before any procedure action starts',async t=>{
 let calls=0,runs=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async()=>{runs++;return {completed:true};},followUp:{required:true,parameters:{type:'object',properties:{}},run:async()=>({})}};
 const f=await setup(t,async()=>++calls===1?select():call('ask_user',{question:'Provide a complete read intent?'}),memory);assert.equal((await f.runner.run(f.input)).state,'WAITING_FOR_USER');assert.equal(runs,0);assert.equal(f.controls.writes,0);
});
test('a read continuation cannot dispatch writes through the procedure API',async t=>{
 let calls=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async(_s,_c,api)=>{await api.act('fill',{value:'prefix'});await api.observe();return {completed:{steps:1}};},followUp:{parameters:{type:'object',properties:{}},run:async(_s,_c,api)=>api.act('fill',{value:'forbidden second write'})}};
 const f=await setup(t,async messages=>{if(++calls===1)return call('use_browser_procedure',{id:summary.id,version:1,values:{v1:'NEW_INPUT'},readAfter:{}});assert.ok(JSON.stringify(messages).includes('procedure_followup_write_forbidden'));return call('ask_user',{question:'Continue with a permitted read?'});},memory);
 const result=await f.runner.run(f.input);assert.equal(result.state,'WAITING_FOR_USER');assert.equal(f.controls.writes,1);
});
test('a stopped procedure cannot run a queued read continuation',async t=>{
 let calls=0,reads=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async()=>({stopped:{index:0},confirmedSteps:[]}),followUp:{parameters:{type:'object',properties:{}},run:async()=>{reads++;return {};}}};
 const f=await setup(t,async()=>++calls===1?call('use_browser_procedure',{id:summary.id,version:1,values:{v1:'NEW_INPUT'},readAfter:{}}):call('ask_user',{question:'Inspect the changed target?'}),memory);assert.equal((await f.runner.run(f.input)).state,'WAITING_FOR_USER');assert.equal(reads,0);assert.equal(f.controls.writes,0);
});
test('Pi reuses one host procedure with two model calls and verifies the original outcome',async t=>{
  let calls=0,learned=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async(selection,_ctx,api)=>{await api.observe();return api.act('fill',{value:selection.values.v1});},capture:async()=>({label:'input'}),learn:async x=>{learned++;assert.equal(x.trace[0].arguments.value,'NEW_INPUT');}};
  const {runner,input,controls}=await setup(t,async()=>++calls===1?select():answer(),memory);
  const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.equal(calls,2);assert.equal(controls.writes,1);assert.equal(learned,1);
});
test('knowledge lookup failure falls back to normal Pi and does not advertise a procedure',async t=>{
  let calls=0;const {runner,input,controls}=await setup(t,async(messages,tools)=>{assert.ok(!tools.some(x=>x.function.name==='use_browser_procedure'));if(++calls===1){const state=JSON.parse(messages.find(x=>x.content?.startsWith?.('Host task')).content.split('\n')[1]);return call('browser_action',{actionId:'normal',observationId:state.observation.observationId,tool:'fill',input:{value:'draft'}});}return answer();},{lookup:async()=>{throw Error('offline');},run:async()=>{throw Error('must-not-run');}});
  assert.equal((await runner.run(input)).state,'COMPLETED');assert.equal(controls.writes,1);
});
test('a partially executed procedure cannot be repeated by a new proposal',async t=>{
  let calls=0,runs=0;const {runner,input,controls}=await setup(t,async()=>++calls<3?select():answer(),{lookup:async()=>({notes:[],procedures:[summary]}),run:async(_selection,_ctx,api)=>{runs++;await api.observe();await api.act('fill',{value:'draft'});return {stopped:{index:1},confirmedSteps:[{index:0}]};}});
  assert.equal((await runner.run(input)).state,'COMPLETED');assert.equal(runs,1);assert.equal(controls.writes,1);
});
test('approval inside replay waits and resuming cannot restart confirmed procedure steps',async t=>{
  let calls=0,runs=0;const {runner,input,controls}=await setup(t,async()=>++calls<3?select():answer(),{lookup:async()=>({notes:[],procedures:[summary]}),run:async(_selection,_ctx,api)=>{runs++;await api.observe();return api.act('fill',{value:'draft'});}});
  controls.policy='ask';const held=await runner.run(input);assert.equal(held.state,'WAITING_FOR_USER');assert.equal(calls,1);assert.equal(controls.writes,0);
  controls.grants.add(held.checkpoint.pending.requestId);const result=await runner.run({...input,response:{taskId:task.taskId,...held.checkpoint.pending}});assert.equal(result.state,'COMPLETED');assert.equal(runs,1);assert.equal(controls.writes,1);
});
test('late replay after cancellation cannot issue a write',async t=>{
  const entered=deferred(),finish=deferred(),controller=new AbortController();let late;
  const {runner,input,controls}=await setup(t,async()=>select(),{lookup:async()=>({notes:[],procedures:[summary]}),run:async(_selection,_ctx,api)=>{late=api;entered.resolve();await finish.promise;return {};}});
  const running=runner.run({...input,signal:controller.signal});await entered.promise;controller.abort();assert.equal((await running).state,'CANCELLED');await assert.rejects(late.act('fill',{value:'late'}),/run_cancelled/);assert.equal(controls.writes,0);finish.resolve();
});
test('learning failure cannot replace a verified task result',async t=>{
  let calls=0;const {runner,input}=await setup(t,async()=>++calls===1?select():answer(),{lookup:async()=>({notes:[],procedures:[summary]}),run:async(_s,_c,api)=>{await api.observe();return api.act('fill',{value:'draft'});},learn:async()=>{throw Error('enqueue failed');}});
  const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.equal(result.answer,'확인 완료');assert.ok(result.metrics.some(x=>x.tool==='memory_learn_enqueue'&&x.error));
});
test('cancelling a pending learning enqueue preserves the already verified answer',async t=>{
  let calls=0;const entered=deferred(),finish=deferred(),controller=new AbortController();const {runner,input}=await setup(t,async()=>++calls===1?select():answer(),{lookup:async()=>({notes:[],procedures:[summary]}),run:async(_s,_c,api)=>{await api.observe();return api.act('fill',{value:'draft'});},learn:async()=>{entered.resolve();await finish.promise;}});
  const running=runner.run({...input,signal:controller.signal});await entered.promise;controller.abort();const result=await running;assert.equal(result.state,'COMPLETED');assert.equal(result.answer,'확인 완료');finish.resolve();
});

const target={role:'textbox',name:'Recipient',kind:'field',tag:'input',type:'email'};
function replaySetup(){
  let card={schemaVersion:1,...summary,status:'revalidated',wikiRef:{id:'wiki',version:1,hash:'a'.repeat(64)},steps:[{tool:'fill_form',fields:[{target,slot:'v1'}]}]},writes=0;
  const observation={state:'ready',binding:{tabId:'tab',documentId:'doc',revision:'1'},observationId:'observation'},context={projectId:'project',task,observation,signal:new AbortController().signal};
  const view={url:'https://fixture.invalid/',frames:[{frame:0,url:'https://fixture.invalid/',elements:[{...target,ref:'current-ref'}]}]};
  const options={replay:{runReplay,recordTarget},view:async()=>view,store:{find:async()=>({notes:[],cards:[structuredClone(card)]}),get:async()=>structuredClone(card),current:async()=>true,propose:async()=>{}}};
  const api={observe:async()=>observation,act:async()=>{writes++;return {};}};
  return {options,api,context,view,get card(){return card;},set card(x){card=x;},get writes(){return writes;}};
}
test('automatic replay refuses a changed input type even when the existing matcher selects it',async()=>{
  const f=replaySetup();f.view.frames[0].elements[0].type='text';const result=await createReplayMemory(f.options).run({id:'procedure',version:1,values:{v1:'new'}},f.context,f.api);assert.ok(result.stopped);assert.equal(f.writes,0);
});
test('stored card content changing without a version bump stops before action',async()=>{
  const f=replaySetup();f.api.observe=async()=>{f.card={...f.card,title:'mutated'};return f.context.observation;};const result=await createReplayMemory(f.options).run({id:'procedure',version:1,values:{v1:'new'}},f.context,f.api);assert.equal(result.error,'procedure_stopped');assert.equal(f.writes,0);
});
test('drafts and executable scripts are never offered as reviewed procedures',async()=>{
  const f=replaySetup();f.card={...f.card,status:'draft'};assert.equal((await createReplayMemory(f.options).lookup(f.context)).procedures.length,0);
  f.card={...f.card,status:'revalidated',steps:[{tool:'run_playwright',code:'dangerous()'}]};assert.equal((await createReplayMemory(f.options).lookup(f.context)).procedures.length,0);
});
test('review alone needs explicit qualification mode before ordinary automatic reuse',async()=>{
  const f=replaySetup();f.card={...f.card,status:'reviewed'};assert.equal((await createReplayMemory(f.options).lookup(f.context)).procedures.length,0);
  assert.equal((await createReplayMemory({...f.options,qualification:true}).lookup(f.context)).procedures.length,1);
});
test('current multiline input retained in a candidate is rejected before storage',async()=>{
  const f=replaySetup();let stored=false;f.options.store.propose=async()=>{stored=true;};f.options.buildCandidate=async()=>({...f.card,status:'draft',title:'private\nvalue'});
  await assert.rejects(createReplayMemory(f.options).learn({projectId:'project',task,trace:[{tool:'browser_type',arguments:{text:'private\nvalue'},receipt:{}}],signal:f.context.signal}),/procedure_values_retained/);assert.equal(stored,false);
});

function repairSetup(){
  const f=replaySetup(),body={role:'textbox',name:'Body',kind:'field',tag:'textarea'},save={role:'button',name:'Save',kind:'control',tag:'button'};
  f.card={...f.card,inputs:[...f.card.inputs,{slot:'v2',label:'Body'}],steps:[...f.card.steps,{tool:'fill_form',fields:[{target:body,slot:'v2'}]},{tool:'click_element',target:save}]};
  f.view.frames[0].elements.push({...body,name:'Message',ref:'body-now'},{...save,name:'Store',ref:'save-now'});
  return f;
}
test('actor repairs only an unissued suffix, preserving prefix and input slots without changing the stored card',async()=>{
  const f=repairSetup(),memory=createReplayMemory(f.options),original=JSON.stringify(f.card);
  const stopped=await memory.run({id:'procedure',version:1,values:{v1:'first-new',v2:'second-new'}},f.context,f.api);
  assert.equal(stopped.stopped.index,1);assert.equal(f.writes,1);
  const selection={continuationId:stopped.recovery.continuationId,observationId:'observation',targets:[{stepIndex:1,targetId:'body-now'},{stepIndex:2,targetId:'save-now'}]};
  const result=await memory.resume(selection,f.context,f.api);assert.ok(result.completed);assert.equal(f.writes,3);assert.deepEqual(result.confirmedSteps.map(x=>x.index),[0,1,2]);assert.equal(JSON.stringify(f.card),original);
  assert.equal((await memory.resume(selection,f.context,f.api)).error,'procedure_continuation_invalid');assert.equal(f.writes,3);
});
for(const kind of ['prefix','other-run','other-observation','revoked','wrong-type','ambiguous'])test('suffix repair rejects '+kind+' before writing',async()=>{
  const f=repairSetup(),memory=createReplayMemory(f.options),stopped=await memory.run({id:'procedure',version:1,values:{v1:'new',v2:'body'}},f.context,f.api);
  const selection={continuationId:stopped.recovery.continuationId,observationId:'observation',targets:[{stepIndex:1,targetId:'body-now'}]},context={...f.context};
  if(kind==='prefix')selection.targets=[{stepIndex:0,targetId:'current-ref'}];
  if(kind==='other-run')context.signal=new AbortController().signal;
  if(kind==='other-observation')selection.observationId='stale';
  if(kind==='revoked')f.options.store.current=async()=>false;
  if(kind==='wrong-type')f.view.frames[0].elements[1].tag='input';
  if(kind==='ambiguous')f.view.frames[0].elements.push({...f.view.frames[0].elements[1],ref:'duplicate'});
  assert.ok((await memory.resume(selection,context,f.api)).error);assert.equal(f.writes,1);
});
test('an uncertain issued step never offers a suffix continuation',async()=>{
  const f=repairSetup();f.api.act=async()=>({error:'execution_unconfirmed'});const result=await createReplayMemory(f.options).run({id:'procedure',version:1,values:{v1:'new',v2:'body'}},f.context,f.api);assert.ok(result.stopped);assert.equal(result.recovery,undefined);
});
test('cancellation discards an offered continuation before it can issue anything',async()=>{
  const f=repairSetup(),controller=new AbortController();f.context.signal=controller.signal;const memory=createReplayMemory(f.options),stopped=await memory.run({id:'procedure',version:1,values:{v1:'new',v2:'body'}},f.context,f.api);controller.abort();
  assert.equal((await memory.resume({continuationId:stopped.recovery.continuationId,observationId:'observation',targets:[{stepIndex:1,targetId:'body-now'}]},f.context,f.api)).error,'procedure_continuation_invalid');assert.equal(f.writes,1);
});
test('approval during repaired suffix stops and consumes its continuation without another step',async()=>{
  const f=repairSetup(),memory=createReplayMemory(f.options),stopped=await memory.run({id:'procedure',version:1,values:{v1:'new',v2:'body'}},f.context,f.api);let actions=0;f.api.act=async()=>{actions++;return {requiresUserInput:true,actionIssued:false};};
  const selection={continuationId:stopped.recovery.continuationId,observationId:'observation',targets:[{stepIndex:1,targetId:'body-now'},{stepIndex:2,targetId:'save-now'}]};
  const result=await memory.resume(selection,f.context,f.api);assert.ok(result.stopped||result.awaitingApproval);assert.equal(result.recovery,undefined);assert.equal(actions,1);assert.equal((await memory.resume(selection,f.context,f.api)).error,'procedure_continuation_invalid');
});
test('a repaired target is re-observed and must still match exactly before dispatch',async()=>{
  const f=repairSetup(),memory=createReplayMemory(f.options),stopped=await memory.run({id:'procedure',version:1,values:{v1:'new',v2:'body'}},f.context,f.api);
  f.api.observe=async()=>{f.view.frames[0].elements[1].name='Different again';return f.context.observation;};
  const result=await memory.resume({continuationId:stopped.recovery.continuationId,observationId:'observation',targets:[{stepIndex:1,targetId:'body-now'}]},f.context,f.api);assert.ok(result.stopped);assert.equal(f.writes,1);
});
test('Pi refuses a continuation after an intervening action changed the receipt ledger',async t=>{
  let calls=0,resumes=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async(_s,_c,api)=>{await api.observe();return {recovery:{continuationId:'one-use-token'}};},resume:async()=>{resumes++;return {};}};
  const {runner,input,controls}=await setup(t,async messages=>{
    calls++;if(calls===1)return select();const latest=JSON.parse(messages.filter(x=>x.role==='tool').at(-1).content),o=latest.observation??latest;
    if(calls===2)return call('browser_action',{actionId:'intervening',observationId:o.observationId,tool:'fill',input:{value:'another action'}});
    if(calls===3)return call('browser_observe',{tabId:'tab-1'});
    if(calls===4)return call('resume_browser_procedure',{continuationId:'one-use-token',observationId:o.observationId,targets:[{stepIndex:0,targetId:'observed'}]});
    assert.equal(latest.error,'procedure_continuation_changed');return answer();
  },memory);
  assert.equal((await runner.run(input)).state,'COMPLETED');assert.equal(resumes,0);assert.equal(controls.writes,1);
});

test('reviewed target-bound keypress reuses the existing engine and rejects arbitrary keys/arguments',async()=>{
 const f=replaySetup();f.card={...f.card,steps:[...f.card.steps,{tool:'press_key',target,args:{key:'Enter'}}]};const actions=[];f.api.act=async(name,args)=>{actions.push({name,args});return {};};
 const result=await createReplayMemory(f.options).run({id:'procedure',version:1,values:{v1:'new'}},f.context,f.api);assert.ok(result.completed);assert.equal(actions[1].name,'browser_press_key');assert.equal(actions[1].args.key,'Enter');
 for(const args of [{key:'F5'},{key:'Enter',extra:true}]){f.card={...f.card,steps:[{tool:'press_key',target,args}]};assert.equal((await createReplayMemory(f.options).lookup(f.context)).procedures.length,0);}
});

test('returned binding invalidation retries only the unissued current step with fresh exact evidence',async()=>{
 const f=replaySetup();f.card={...f.card,steps:[...f.card.steps,{tool:'press_key',target,args:{key:'Enter'}}]};const actions=[];
 f.api.act=async(name,args)=>{actions.push(name);return actions.length===2?{error:'execution_not_started',receipt:{status:'not_started'},data:{error:'binding_changed'}}:{receipt:{status:'confirmed'}};};
 const result=await createReplayMemory(f.options).run({id:'procedure',version:1,values:{v1:'new'}},f.context,f.api);assert.ok(result.completed);assert.deepEqual(actions,['browser_type','browser_press_key','browser_press_key']);assert.equal(result.operations,2);assert.deepEqual(result.confirmedSteps.map(x=>x.index),[0,1]);
});
for(const kind of ['unconfirmed','confirmed','wrong-cause','missing-receipt','waiting','changed-target','ambiguous','repeated'])test('unissued retry respects '+kind+' boundary',async()=>{
 const f=replaySetup();let attempts=0;const outcome={error:'execution_not_started',receipt:{status:'not_started'},data:{error:'binding_changed'}};
 if(kind==='unconfirmed'||kind==='confirmed')outcome.receipt.status=kind;if(kind==='wrong-cause')outcome.data.error='target_not_editable';if(kind==='missing-receipt')delete outcome.receipt;if(kind==='waiting')outcome.requiresUserInput=true;
 f.api.act=async()=>{attempts++;if(kind==='changed-target')f.view.frames[0].elements[0].type='text';if(kind==='ambiguous')f.view.frames[0].elements.push({...f.view.frames[0].elements[0],ref:'duplicate'});return outcome;};
 const result=await createReplayMemory(f.options).run({id:'procedure',version:1,values:{v1:'new'}},f.context,f.api);assert.ok(!result.completed);assert.equal(attempts,kind==='repeated'?2:1);assert.equal(result.operations,0);
});

test('host opt-in exposes one applicable procedure and inspection before restoring all tools',async t=>{
 let calls=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async(_s,_c,api)=>{await api.act('fill',{value:'NEW_INPUT'});return {completed:{steps:1}};}};
 const f=await setup(t,async(_messages,tools)=>{calls++;const names=tools.map(x=>x.function.name);if(calls===1){assert.deepEqual(names.sort(),['ask_user','browser_observe','use_browser_procedure']);return select();}assert.ok(names.includes('browser_action'));return answer();},memory);
 assert.equal((await f.runner.run({...f.input,preferVerifiedProcedure:true})).state,'COMPLETED');assert.equal(calls,2);assert.equal(f.controls.writes,1);
});
test('a stopped initial preferred procedure leaves ordinary tools available for a valid alternative',async t=>{
 let calls=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async()=>({stopped:{index:0},actionIssued:false})};
 const f=await setup(t,async(messages,tools)=>{if(++calls===1)return select();if(calls===2){assert.ok(tools.some(x=>x.function.name==='browser_action'));const x=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);return call('browser_action',{actionId:'alternative',observationId:x.observation.observationId,tool:'fill',input:{value:'current'}});}return answer();},memory);
 assert.equal((await f.runner.run({...f.input,preferVerifiedProcedure:true})).state,'COMPLETED');assert.equal(f.controls.writes,1);assert.equal(calls,3);
});
test('ambiguous or missing procedure catalogs retain ordinary first-turn actions',async t=>{
 for(const procedures of [[],[summary,{...summary,id:'another'}]]){let calls=0;const f=await setup(t,async(messages,tools)=>{assert.ok(tools.some(x=>x.function.name==='browser_action'));if(++calls===1){const x=JSON.parse(messages.find(m=>m.content?.startsWith?.('Host task')).content.split('\n')[1]);return call('browser_action',{actionId:'normal',observationId:x.observation.observationId,tool:'fill',input:{value:'current'}});}return answer();},{lookup:async()=>({notes:[],procedures}),run:async()=>{throw Error('not selected');}});assert.equal((await f.runner.run({...f.input,preferVerifiedProcedure:true})).state,'COMPLETED');}
});

test('initial procedure preference cannot narrow tools after a confirmed action already exists',async t=>{
 const f=await setup(t,async(_messages,tools)=>{assert.ok(tools.some(x=>x.function.name==='browser_action'));return answer();},{lookup:async()=>({notes:[],procedures:[summary]}),run:async()=>{throw Error('must not repeat prefix');}});
 await f.session.openTask(task);const o=await f.session.observe(task.taskId,'tab-1');await f.session.execute(task.taskId,{actionId:'already-confirmed',tool:'fill',arguments:{value:'current'},binding:o.binding,observationId:o.observationId,catalogVersion:f.session.catalog().version});
 assert.equal((await f.runner.run({...f.input,preferVerifiedProcedure:true})).state,'COMPLETED');assert.equal(f.controls.writes,1);
});
test('preferred procedure approval still waits and resumes without narrowing or repeating the write',async t=>{
 let calls=0,runs=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async(_s,_c,api)=>{runs++;return api.act('fill',{value:'current'});}};
 const f=await setup(t,async(_messages,tools)=>{calls++;if(calls===1){assert.ok(!tools.some(x=>x.function.name==='browser_action'));return select();}assert.ok(tools.some(x=>x.function.name==='browser_action'));return answer();},memory);f.controls.policy='ask';
 const held=await f.runner.run({...f.input,preferVerifiedProcedure:true});assert.equal(held.state,'WAITING_FOR_USER');assert.equal(f.controls.writes,0);f.controls.grants.add(held.checkpoint.pending.requestId);
 const result=await f.runner.run({...f.input,preferVerifiedProcedure:true,response:{taskId:task.taskId,...held.checkpoint.pending}});assert.equal(result.state,'COMPLETED');assert.equal(f.controls.writes,1);assert.equal(runs,1);assert.equal(calls,2);
});

test('failed post-procedure reads retain the completed prefix and require actual remaining read verification',async t=>{
 const {BrowserAgentError}=await import('../dist/index.js');let calls=0,reads=0;const memory={lookup:async()=>({notes:[],procedures:[summary]}),run:async(_s,_c,api)=>{await api.act('fill',{value:'current'});await api.observe();return {procedureId:summary.id,completed:{steps:1},confirmedSteps:[{index:0}]};},followUp:{parameters:{type:'object',properties:{}},run:async()=>{throw new BrowserAgentError('binding_changed');}}};
 const f=await setup(t,async(messages)=>{if(++calls===1)return call('use_browser_procedure',{id:summary.id,version:1,values:{v1:'NEW_INPUT'},readAfter:{}});if(calls===2){const x=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);assert.equal(x.completed.steps,1);assert.equal(x.confirmedSteps.length,1);assert.equal(x.followUp.cause,'binding_changed');assert.equal(f.controls.writes,1);return call('browser_action',{actionId:'remaining-read',observationId:x.observation.observationId,tool:'find',input:{}});}return answer();},memory);
 const execute=f.host.browser.execute;f.host.browser.execute=async(...args)=>{if(args[1].tool==='find')reads++;return execute(...args);};f.host.browser.verify=async(_ctx,cp)=>({criteria:cp.criteria.map(id=>({id,satisfied:reads===1&&f.controls.writes===1,evidenceRefs:['current:read']}))});assert.equal((await f.runner.run(f.input)).state,'COMPLETED');assert.equal(reads,1);assert.equal(f.controls.writes,1);
});
