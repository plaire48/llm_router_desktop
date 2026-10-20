import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../extensions/aipro-chat/agent-runtime.js';
import {createBrowserAddon} from '../dist/index.js';
import {BrowserAgentError} from '../dist/index.js';
import {createPiBrowserRunner} from '../dist/pi.js';
import {hostFixture,task,deferred,until} from './host.mjs';

const pi={answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent};
const tool=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const answer=content=>({content,calls:[],finishReason:'stop',usage:{prompt_tokens:11,completion_tokens:3}});
function observed(messages){
  for(const message of [...messages].reverse()){
    try{const data=JSON.parse(message.role==='tool'?message.content:message.content.slice(message.content.indexOf('\n')+1));const o=data.observation??(data.binding?data:null);if(o?.state==='ready')return o;}catch{}
  }throw Error('no_observation');
}
async function setup(t,complete,changes={}){
  const {host,controls}=hostFixture();Object.assign(host,changes);const addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'pi-project'});
  const metrics=[];const runner=createPiBrowserRunner({session,pi,model:{id:'injected-model',complete},tabs:()=>[{tabId:'tab-1',label:'Test',privateToken:'must-not-leak'}],onMetric:e=>metrics.push(e)});
  t.after(()=>addon.dispose());return {host,controls,addon,session,runner,metrics,input:{task,tabId:'tab-1'}};
}

test('existing Pi uses injected model and initial evidence without a planner or duplicate observation call',async t=>{
  let calls=0;const {runner,input,controls,host,metrics}=await setup(t,async(messages,tools,context)=>{
    calls++;assert.equal(context.modelId,'injected-model');assert.ok(tools.some(x=>x.function.name==='browser_action'));assert.ok(!JSON.stringify(messages).includes('must-not-leak'));context.onEvent({type:'first_content'});
    return calls===1?tool('browser_action',{actionId:'fill-1',observationId:observed(messages).observationId,tool:'fill',input:{value:'PRIVATE_DRAFT_VALUE'}}):answer('작성 완료');
  });
  let reads=0;const observe=host.browser.observe;host.browser.observe=async(...args)=>{reads++;return observe(...args);};
  const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.equal(result.answer,'작성 완료');assert.equal(controls.writes,1);assert.equal(calls,2);assert.equal(reads,1);
  assert.equal(metrics.filter(x=>x.kind==='model_end').length,2);assert.ok(metrics.some(x=>x.kind==='tool_end'&&x.purpose==='verification'));
  assert.ok(!JSON.stringify(metrics).includes('PRIVATE_DRAFT_VALUE'));assert.ok(metrics.filter(x=>x.kind==='model_end').every(x=>x.firstEventMs!==null));
});

test('host outcome rejection stays inside the same Pi follow-up loop and withholds a false final answer',async t=>{
  let calls=0;const {runner,input,controls,host}=await setup(t,async messages=>{
    calls++;if(calls===1)return answer('가짜 완료');
    if(calls===2){assert.ok(JSON.stringify(messages).includes('Host outcome verification did not confirm'));return tool('browser_action',{actionId:'repair',observationId:observed(messages).observationId,tool:'fill',input:{value:'correct'}});}
    return answer('확인한 결과');
  });
  let candidate;const verify=host.browser.verify;host.browser.verify=async(ctx,cp,c)=>{candidate=c;return verify(ctx,cp);};
  const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.equal(result.answer,'확인한 결과');assert.equal(controls.writes,1);assert.equal(calls,3);assert.equal(candidate.answer,'확인한 결과');
});

test('an empty model turn is repaired in the existing Pi loop without a redundant observation or false host verification',async t=>{
 let calls=0;const {runner,input,host,controls}=await setup(t,async messages=>{calls++;if(calls===1)return answer('');if(calls===2)return tool('browser_action',{actionId:'after-empty',observationId:observed(messages).observationId,tool:'fill',input:{value:'correct'}});return answer('완료');});
 let reads=0,verifications=0;const observe=host.browser.observe,verify=host.browser.verify;host.browser.observe=async(...args)=>{reads++;return observe(...args);};host.browser.verify=async(...args)=>{verifications++;return verify(...args);};
 const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.equal(calls,3);assert.equal(reads,1);assert.equal(verifications,1);assert.equal(controls.writes,1);
});

test('a newly forbidden observation stops the existing Pi invocation without repeated model calls or a fake input form',async t=>{
  let calls=0;const {runner,input,controls}=await setup(t,async()=>{calls++;controls.mode='forbidden';return tool('browser_observe',{tabId:'tab-1'});});
  const result=await runner.run(input);assert.equal(result.state,'PAUSED');assert.equal(result.answer,null);assert.equal(calls,1);assert.equal(controls.writes,0);assert.equal(controls.present.size,0);
});

test('approval wait stops before another model call; authorized resume preserves the exact action once',async t=>{
  let calls=0;const {runner,input,controls}=await setup(t,async messages=>++calls===1?tool('browser_action',{actionId:'approved',observationId:observed(messages).observationId,tool:'fill',input:{value:'draft'}}):answer('완료'));
  controls.policy='ask';const held=await runner.run(input);assert.equal(held.state,'WAITING_FOR_USER');assert.equal(calls,1);assert.equal(controls.writes,0);
  const pending=held.checkpoint.pending;controls.grants.add(pending.requestId);
  const resumed=await runner.run({...input,response:{taskId:task.taskId,...pending}});assert.equal(resumed.state,'COMPLETED');assert.equal(controls.writes,1);assert.equal(calls,2);
});

test('clarification is persisted and an explicit answer resumes with the original request',async t=>{
  let calls=0;const {runner,input}=await setup(t,async messages=>{
    calls++;if(calls===1)return tool('ask_user',{question:'어느 항목을 사용할까요?',choices:[{label:'첫 항목'},{label:'둘째 항목'}]});
    assert.ok(messages.some(m=>m.role==='user'&&m.content==='둘째 항목'));assert.ok(messages.some(m=>m.role==='user'&&m.content===task.request));
    if(calls===2)return tool('browser_action',{actionId:'chosen',observationId:observed(messages).observationId,tool:'fill',input:{value:'chosen'}});return answer('완료');
  });
  const held=await runner.run(input);assert.equal(held.state,'WAITING_FOR_USER');assert.equal(held.checkpoint.pending.question,'어느 항목을 사용할까요?');assert.equal(calls,1);
  const resumed=await runner.run({...input,response:{taskId:task.taskId,...held.checkpoint.pending,answer:'둘째 항목'}});assert.equal(resumed.state,'COMPLETED');
});

test('three unchanged failed completion claims ask the user instead of looping or marking completion',async t=>{
  let calls=0;const {runner,input}=await setup(t,async()=>{calls++;return answer('완료라고 주장');});
  const result=await runner.run(input);assert.equal(result.state,'WAITING_FOR_USER');assert.equal(result.answer,null);assert.equal(calls,3);assert.ok(result.checkpoint.pending.question);
});

test('external cancellation interrupts an uncooperative model and ignores its late response',async t=>{
  const late=deferred(),started=deferred(),controller=new AbortController();let calls=0;
  const {runner,input,controls}=await setup(t,async()=>{calls++;started.resolve();return late.promise;});
  const running=runner.run({...input,signal:controller.signal});await started.promise;controller.abort();const result=await running;
  assert.equal(result.state,'CANCELLED');assert.equal(calls,1);late.resolve(tool('browser_action',{actionId:'late',observationId:'old',tool:'fill',input:{value:'late'}}));await Promise.resolve();assert.equal(controls.writes,0);
});

test('different runners cannot concurrently own the same browser session',async t=>{
  const waiting=deferred(),entered=deferred();const {runner,input,session}=await setup(t,async()=>{entered.resolve();await waiting.promise;return answer('不完全');});
  const controller=new AbortController(),first=runner.run({...input,signal:controller.signal});await entered.promise;
  const other=createPiBrowserRunner({session,pi,model:{id:'other',complete:async()=>answer('x')},tabs:()=>[{tabId:'tab-1'}],onMetric:()=>{throw Error('sink');}});
  await assert.rejects(other.run(input),/browser_runner_busy/);controller.abort();await first;waiting.resolve();
});

test('a failing metric sink cannot interrupt a completed task',async t=>{
  const {session,input,controls}=await setup(t,async()=>answer('unused'));controls.writes=1;
  const runner=createPiBrowserRunner({session,pi,model:{id:'sink-test',complete:async()=>answer('검증 완료')},tabs:()=>[{tabId:'tab-1'}],onMetric:()=>{throw Error('sink unavailable');}});
  const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.ok(result.metrics.length>0);
});

test('invalid task opening preserves its original error and releases runner ownership',async t=>{
  const {runner,input,controls}=await setup(t,async()=>answer('완료'));controls.writes=1;
  await assert.rejects(runner.run({...input,task:{...task,taskId:''}}),/task_invalid/);
  assert.equal((await runner.run(input)).state,'COMPLETED');
});

test('host detach cancels a model call without accepting a late answer',async t=>{
  const entered=deferred(),late=deferred();const {runner,input,addon}=await setup(t,async()=>{entered.resolve();return late.promise;});
  const running=runner.run(input);await entered.promise;await addon.detach();const result=await running;
  assert.notEqual(result.state,'COMPLETED');assert.equal(result.answer,null);late.resolve(answer('late'));
});

test('a transient invalidated observation is reread before inference, with no action replay',async t=>{
  const {runner,input,host,controls}=await setup(t,async()=>answer('읽기 완료'));controls.writes=1;
  const read=host.browser.observe;let attempts=0;host.browser.observe=async(...args)=>{if(++attempts===1)throw new BrowserAgentError('observation_changed');return read(...args);};
  const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.equal(attempts,2);assert.equal(result.metrics.filter(x=>x.kind==='tool_end'&&x.error==='observation_changed').length,1);
});

test('host argument schemas reject encoded nested inputs before dispatch and accept a corrected proposal',async t=>{
  let calls=0;const {runner,input,controls}=await setup(t,async messages=>{
    calls++;const observation=observed(messages);
    if(calls===1)return tool('browser_action',{actionId:'bad',observationId:observation.observationId,tool:'fill',input:JSON.stringify({value:'draft'})});
    if(calls===2)return tool('browser_action',{actionId:'good',observationId:observation.observationId,tool:'fill',input:{value:'draft'}});
    return answer('完了');
  });
  const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.equal(controls.writes,1);assert.equal(calls,3);
});

test('typed host actions are exposed directly and preserve exact observation binding',async t=>{
  const {host,controls}=hostFixture();host.browser.tools=async()=>[{name:'fill',effect:'write',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}];
  const addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'direct-test'});t.after(()=>addon.dispose());let calls=0;
  const runner=createPiBrowserRunner({session,pi,tabs:()=>[{tabId:'tab-1'}],model:{id:'direct',complete:async(messages,tools)=>{
    assert.ok(tools.some(x=>x.function.name==='fill'));assert.ok(!tools.some(x=>x.function.name==='browser_action'));
    const o=observed(messages);return ++calls===1?tool('fill',{actionId:'direct-fill',observationId:o.observationId,value:'draft'}):answer('完成');
  }}});
  const result=await runner.run({task,tabId:'tab-1'});assert.equal(result.state,'COMPLETED');assert.equal(controls.writes,1);assert.equal(calls,2);
});

test('known non-dispatch recovers with a fresh read and a new decision without replaying',async t=>{
  let calls=0;const {runner,input,host,controls}=await setup(t,async messages=>{
    calls++;if(calls===2)return tool('browser_observe',{tabId:'tab-1',mode:'structure'});
    if(calls<4)return tool('browser_action',{actionId:calls===1?'non-dispatch':'corrected',observationId:observed(messages).observationId,tool:'fill',input:{value:'draft'}});
    return answer('확인 완료');
  });
  const execute=host.browser.execute;let attempts=0;host.browser.execute=async(...args)=>++attempts===1?{status:'not_started',evidenceRefs:[],data:{error:'target_not_editable'}}:execute(...args);
  const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.equal(controls.writes,1);assert.equal(calls,4);assert.deepEqual(result.checkpoint.receipts.map(x=>x.status),['not_started','confirmed']);
});

test('unresolved readback yields to the user without a new model call or write',async t=>{
  let calls=0;const {runner,input,host}=await setup(t,async messages=>++calls===1?tool('browser_action',{actionId:'uncertain',observationId:observed(messages).observationId,tool:'fill',input:{value:'draft'}}):tool('browser_reconcile',{actionId:'uncertain'}));
  host.browser.execute=async()=>({status:'unconfirmed',evidenceRefs:[]});host.browser.reconcile=async()=>({status:'unconfirmed',evidenceRefs:[]});
  const result=await runner.run(input);assert.equal(result.state,'WAITING_FOR_USER');assert.equal(calls,2);assert.equal(result.checkpoint.receipts[0].status,'unconfirmed');assert.equal(result.answer,null);
});

test('non-authorized tabs and terminal tasks never trigger model execution',async t=>{
  let calls=0;const {runner,input}=await setup(t,async()=>{calls++;return answer('x');});
  const result=await runner.run({...input,tabId:'foreign'});assert.equal(result.state,'PAUSED');assert.equal(result.error,'tab_not_allowed');assert.equal(calls,0);
});
test('pre-dispatch binding exception returns fresh evidence to the same Pi task without issuing or replaying',async t=>{
 let calls=0;const {runner,input,controls,host}=await setup(t,async messages=>{
  calls++;if(calls===2){const last=JSON.parse(messages.filter(x=>x.role==='tool').at(-1).content);assert.equal(last.error,'execution_not_started');assert.equal(last.actionIssued,false);assert.equal(last.observation.state,'ready');assert.equal(controls.writes,0);}
  return calls<=2?tool('browser_action',{actionId:'attempt-'+calls,observationId:observed(messages).observationId,tool:'fill',input:{value:'new'}}):answer('확인 완료');
 });let checks=0;const validate=host.browser.validate;host.browser.validate=async(...args)=>++checks===1?false:validate(...args);
 const result=await runner.run(input);assert.equal(result.state,'COMPLETED');assert.equal(calls,3);assert.equal(controls.writes,1);assert.equal(result.checkpoint.receipts.length,1);
});

test('host may require an initial action proposal while later model turns remain auto',async t=>{
 const choices=[];let calls=0;const {runner,input,controls}=await setup(t,async(messages,tools,context)=>{choices.push(context.toolChoice);return ++calls===1?tool('browser_action',{actionId:'first-action',observationId:observed(messages).observationId,tool:'fill',input:{value:'current'}}):answer('확인 완료');});
 const result=await runner.run({...input,initialToolChoice:'required'});assert.equal(result.state,'COMPLETED');assert.equal(controls.writes,1);assert.deepEqual(choices,['required','auto']);
});
test('initial tool selection defaults to auto and rejects invalid host settings before execution',async t=>{
 const {runner,input,controls}=await setup(t,async(messages,tools,context)=>{assert.equal(context.toolChoice,'auto');return answer('확인 완료');});controls.writes=1;
 await assert.rejects(runner.run({...input,initialToolChoice:'invalid'}),/tool_choice_invalid/);assert.equal((await runner.run(input)).state,'COMPLETED');
});
