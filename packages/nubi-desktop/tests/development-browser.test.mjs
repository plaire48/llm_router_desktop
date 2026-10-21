import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,fixtureReview} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {bindDevelopmentEvidence} from '../runtime/development-workflow.mjs';
import {prepareDevelopmentPreview,prepareDevelopmentBrowserCall,callDevelopmentBrowser,developmentPreviewReceipt} from '../runtime/browser-agent-host.mjs';
installAgent(ProjectService);

test('one approved hybrid workflow uses per-step BrowserSession receipts and never replays its confirmed prefix',async t=>{
 const f=await browserFixture(t),prepared=await prepareDevelopmentPreview(f.service,{taskId:f.task.id,processId:f.p.id});
 const opened=await callDevelopmentBrowser(f.service,{taskId:f.task.id,...prepared.request,approved:true});
 const name='mcp__playwright__browser_run_workflow',args={tabId:opened.browserAgent.tabId,documentId:opened.browserAgent.documentId,steps:[{action:'type',target:'e1',text:'first'},{action:'type',target:'e1',text:'second'}]};
 await prepareDevelopmentBrowserCall(f.service,{taskId:f.task.id,name,args});
 await assert.rejects(callDevelopmentBrowser(f.service,{taskId:f.task.id,name,args,approved:false}),/development_approval_required/);
 const result=await callDevelopmentBrowser(f.service,{taskId:f.task.id,name,args,approved:true});
 assert.equal(result.ok,true);assert.equal(result.browserAgent.workflow.confirmedSteps,2);assert.equal(f.value(),'second');assert.equal(f.counts().writes,2);
 const again=await callDevelopmentBrowser(f.service,{taskId:f.task.id,name,args,approved:true});assert.equal(again.reused,true);assert.equal(f.counts().writes,2);
});

// Browser wire fixtures stand in only for Electron IPC. Session/checkpoint,
// server/process provenance, policy boundary and SQL persistence are real.
async function browserFixture(t,options={}){
 const {service,root}=await fixture(t,options),task=await service.createTask({request:'개발 서버에서 이름을 입력하고 결과를 확인해 주세요.'});
 await writeFile(path.join(root,'server.cjs'),`const s=require('node:http').createServer((q,r)=>r.end('<title>Preview</title>'));s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));`);
 // The host shell is PowerShell on Windows, where a quoted path runs only through the call operator; a cold Windows
 // runner also needs more than one second to start node (Windows gates 2026-10-21).
 const p=await service.processes.start({cwd:root,taskId:task.id,script:process.platform==='win32'?`& '${process.execPath}' server.cjs`:`'${process.execPath}' server.cjs`,autoDiagnose:false});
 for(let i=0;i<300&&!service.processes.poll(p.id).output.includes('http://');i++)await new Promise(r=>setTimeout(r,50));
 const url=service.processes.poll(p.id).output.match(/http:\/\/\S+/)[0];
 let documentId='doc-1',value='',opens=0,writes=0,origin=new URL(url).origin,uncertain=false;
 const wire=(text,ok=true)=>({ok,text,structured:undefined});
 const snapshot=()=>wire(JSON.stringify({tabId:'preview-tab',documentId,origin})+'\n### Snapshot\n- textbox "Name" [ref=e1]\n- button "Apply" [ref=e2]\n- generic: '+value);
 const registry={tool:name=>({serverId:'playwright',tool:{name:name.replace('mcp__playwright__','')},readOnly:/snapshot|tabs/.test(name)}),fingerprint:(name,args)=>name+JSON.stringify(args),
  async call(name,args){const tool=name.replace('mcp__playwright__','');if(tool==='browser_tabs')return wire(JSON.stringify({tabs:opens?[{tabId:'preview-tab',documentId,url}]:[]}));if(tool==='browser_open'){opens++;return wire(JSON.stringify({tabId:'preview-tab',documentId}));}if(tool==='browser_snapshot')return snapshot();if(tool==='browser_type'){writes++;value=args.text;if(uncertain)throw Error('mcp_call_timeout');return snapshot();}throw Error('unexpected_wire_call');}};
 service.mcpRegistry=()=>registry;service.playwrightRequest=async(action,args)=>{assert.equal(action,'check');if(args.documentId&&args.documentId!==documentId)throw Error('browser_document_changed');return {tabId:'preview-tab',documentId,origin};};
 return {service,task,p,url,registry,change(){documentId='doc-2';},changeOrigin(){origin='https://elsewhere.invalid';},uncertain(){uncertain=true;},counts:()=>({opens,writes}),value:()=>value};
}

test('open inline DOM is consumed once and later observations still read the current page',async t=>{
 const f=await browserFixture(t),original=f.registry.call.bind(f.registry);let snapshots=0;
 f.registry.call=async(name,args)=>{if(name==='mcp__playwright__browser_open')return {ok:true,text:JSON.stringify({tabId:'preview-tab',documentId:'doc-1',snapshot:'### Snapshot\n- textbox "Name" [ref=e1]'})};if(name==='mcp__playwright__browser_snapshot')snapshots++;return original(name,args);};
 const opened=await callDevelopmentBrowser(f.service,{taskId:f.task.id,name:'mcp__playwright__browser_open',args:{url:f.url},approved:true});
 assert.equal(opened.browserAgent.readback,true);assert.match(opened.text,/ref=e1/);assert.equal(snapshots,0);
 await callDevelopmentBrowser(f.service,{taskId:f.task.id,name:'mcp__playwright__browser_snapshot',args:{tabId:'preview-tab'}});assert.equal(snapshots,1);
});

test('inline DOM from a different document is discarded before observing the current page',async t=>{
 const f=await browserFixture(t),original=f.registry.call.bind(f.registry);let snapshots=0;
 f.registry.call=async(name,args)=>{if(name==='mcp__playwright__browser_open'){f.change();return {ok:true,text:JSON.stringify({tabId:'preview-tab',documentId:'doc-1',snapshot:'STALE DOM'})};}if(name==='mcp__playwright__browser_snapshot')snapshots++;return original(name,args);};
 const result=await callDevelopmentBrowser(f.service,{taskId:f.task.id,name:'mcp__playwright__browser_open',args:{url:f.url},approved:true});assert.equal(snapshots,1);assert.doesNotMatch(result.text,/STALE DOM/);assert.equal(result.browserAgent.documentId,'doc-2');
});

test('development preview requires the current task server and binds its approved opening to the existing addon',async t=>{
 const f=await browserFixture(t),other=await f.service.createTask({request:'other'});
 await assert.rejects(()=>prepareDevelopmentPreview(f.service,{taskId:other.id,processId:f.p.id}),/process_missing/);
 const prepared=await prepareDevelopmentPreview(f.service,{taskId:f.task.id,processId:f.p.id});
 assert.equal(prepared.request.name,'mcp__playwright__browser_open');assert.equal(prepared.request.args.url,f.url+'/');assert.equal(f.counts().opens,0);
 await assert.rejects(()=>callDevelopmentBrowser(f.service,{taskId:f.task.id,...prepared.request,approved:false}),/development_approval_required/);
 const opened=await callDevelopmentBrowser(f.service,{taskId:f.task.id,...prepared.request,approved:true});
 assert.equal(opened.browserAgent.addonId,'nubi.browser-agent');assert.equal(opened.browserAgent.processId,f.p.id);assert.equal(opened.browserAgent.tabId,'preview-tab');
 const reused=await prepareDevelopmentPreview(f.service,{taskId:f.task.id,processId:f.p.id});
 assert.equal(reused.reused,true);assert.equal(reused.result.browserAgent.tabId,'preview-tab');assert.equal(f.counts().opens,1);
 assert.equal(developmentPreviewReceipt(f.service,f.task.id).functionalVerified,false);
});

test('approved browser input uses the observed page, durable module receipt and actual readback without a second dispatch',async t=>{
 const f=await browserFixture(t),prepared=await prepareDevelopmentPreview(f.service,{taskId:f.task.id,processId:f.p.id});
 await callDevelopmentBrowser(f.service,{taskId:f.task.id,...prepared.request,approved:true});
 const request={taskId:f.task.id,name:'mcp__playwright__browser_type',args:{tabId:'preview-tab',documentId:'doc-1',target:'e1',text:'Nubi'}};
 await prepareDevelopmentBrowserCall(f.service,request);
 await assert.rejects(()=>callDevelopmentBrowser(f.service,{...request,approved:false}),/development_approval_required/);
 const result=await callDevelopmentBrowser(f.service,{...request,approved:true});
 assert.equal(result.browserAgent.receipt.status,'confirmed');assert.match(result.text,/Nubi/);assert.equal(f.value(),'Nubi');
 const duplicate=await callDevelopmentBrowser(f.service,{...request,approved:true});
 assert.equal(duplicate.browserAgent.reused,true);assert.equal(f.counts().writes,1);
 const checkpoints=f.service.store.list('development-browser:');assert(checkpoints.some(c=>c.receipts.some(r=>r.status==='confirmed')));
});

test('changed documents, unobserved targets, foreign tabs and stopped servers cannot receive the approved action',async t=>{
 const f=await browserFixture(t),prepared=await prepareDevelopmentPreview(f.service,{taskId:f.task.id,processId:f.p.id});
 await callDevelopmentBrowser(f.service,{taskId:f.task.id,...prepared.request,approved:true});
 const request={taskId:f.task.id,name:'mcp__playwright__browser_type',args:{tabId:'preview-tab',documentId:'doc-1',target:'e1',text:'Nubi'}};
 await assert.rejects(()=>prepareDevelopmentBrowserCall(f.service,{...request,args:{...request.args,target:'e99'}}),/development_target_not_observed/);
 await assert.rejects(()=>prepareDevelopmentBrowserCall(f.service,{...request,args:{...request.args,tabId:'another-tab'}}),/development_tab_changed/);
 await prepareDevelopmentBrowserCall(f.service,request);f.change();
 await assert.rejects(()=>callDevelopmentBrowser(f.service,{...request,approved:true}),/browser_document_changed|development_observation_changed|binding_changed/);
 assert.equal(f.counts().writes,0);
 const fresh=await callDevelopmentBrowser(f.service,{taskId:f.task.id,name:'mcp__playwright__browser_snapshot',args:{tabId:'preview-tab'}});
 assert.equal(fresh.browserAgent.documentId,'doc-2');assert.equal(developmentPreviewReceipt(f.service,f.task.id).documentId,'doc-2');
 f.service.processes.stop(f.p.id);
 await assert.rejects(()=>prepareDevelopmentPreview(f.service,{taskId:f.task.id,processId:f.p.id}),/development_server_not_ready/);
});

test('uncertain browser input remains unresolved across fresh observations and cannot be replayed',async t=>{
 const f=await browserFixture(t),prepared=await prepareDevelopmentPreview(f.service,{taskId:f.task.id,processId:f.p.id});
 await callDevelopmentBrowser(f.service,{taskId:f.task.id,...prepared.request,approved:true});
 const request={taskId:f.task.id,name:'mcp__playwright__browser_type',args:{tabId:'preview-tab',documentId:'doc-1',target:'e1',text:'Nubi'}};
 await prepareDevelopmentBrowserCall(f.service,request);f.uncertain();
 const result=await callDevelopmentBrowser(f.service,{...request,approved:true});
 assert.equal(result.browserAgent.receipt.status,'unconfirmed');assert.equal(f.counts().writes,1);
 const read=await callDevelopmentBrowser(f.service,{taskId:f.task.id,name:'mcp__playwright__browser_snapshot',args:{tabId:'preview-tab'}});
 assert.match(read.text,/Nubi/);assert.equal(read.browserAgent.readback,false);assert.equal(read.execution,'unconfirmed');
 await assert.rejects(()=>callDevelopmentBrowser(f.service,{...request,approved:true}),/execution_unconfirmed|development_execution_unconfirmed/);
 assert.equal(f.counts().writes,1);
});

test('stopping the workspace task cancels the browser module before any pending input can execute',async t=>{
 const f=await browserFixture(t),open={taskId:f.task.id,name:'mcp__playwright__browser_open',args:{url:f.url}};
 await prepareDevelopmentBrowserCall(f.service,open);await callDevelopmentBrowser(f.service,{...open,approved:true});
 const input={taskId:f.task.id,name:'mcp__playwright__browser_type',args:{tabId:'preview-tab',documentId:'doc-1',target:'e1',text:'cancelled'}};
 await prepareDevelopmentBrowserCall(f.service,input);await f.service.stopAgent({taskId:f.task.id});
 await assert.rejects(()=>callDevelopmentBrowser(f.service,{...input,approved:true}),/setup_cancelled/);assert.equal(f.counts().writes,0);
 assert.equal(f.service.store.list('development-browser:')[0].state,'CANCELLED');
});

test('a preview that left the development origin is blocked before a DOM read',async t=>{
 const f=await browserFixture(t),prepared=await prepareDevelopmentPreview(f.service,{taskId:f.task.id,processId:f.p.id});
 await callDevelopmentBrowser(f.service,{taskId:f.task.id,...prepared.request,approved:true});f.changeOrigin();
 await assert.rejects(()=>callDevelopmentBrowser(f.service,{taskId:f.task.id,name:'mcp__playwright__browser_snapshot',args:{tabId:'preview-tab'}}),/development_origin_changed/);
});

test('ordinary web opening and input are owned by the browser addon without a development server binding',async t=>{
 const f=await browserFixture(t),open={taskId:f.task.id,name:'mcp__playwright__browser_open',args:{url:f.url}};
 await prepareDevelopmentBrowserCall(f.service,open);
 const result=await callDevelopmentBrowser(f.service,{...open,approved:true});
 assert.equal(result.browserAgent.addonId,'nubi.browser-agent');assert.equal(result.browserAgent.processId,null);
 const input={taskId:f.task.id,name:'mcp__playwright__browser_type',args:{tabId:'preview-tab',documentId:'doc-1',target:'e1',text:'Ordinary browser task'}};
 await prepareDevelopmentBrowserCall(f.service,input);
 const applied=await callDevelopmentBrowser(f.service,{...input,approved:true});
 assert.equal(applied.browserAgent.receipt.status,'confirmed');assert.equal(f.value(),'Ordinary browser task');
});

test('ordinary web input cannot bypass the addon by omitting a preceding observation',async t=>{
 const f=await browserFixture(t);
 const input={taskId:f.task.id,name:'mcp__playwright__browser_type',args:{tabId:'preview-tab',documentId:'doc-1',target:'e1',text:'unobserved'}};
 await assert.rejects(()=>prepareDevelopmentBrowserCall(f.service,input),/development_observation_required/);
 await assert.rejects(()=>callDevelopmentBrowser(f.service,{...input,approved:true}),/development_observation_required/);
 assert.equal(f.counts().writes,0);
});

test('Pi uses the existing open and input approval forms, resumes and reuses one development preview',async t=>{
 const f=await browserFixture(t,{scriptedReview:true});let step=0,reviewSeen=false;
 f.service.mcpDefinitions=async()=>['browser_open','browser_snapshot','browser_type'].map(name=>({type:'function',function:{name:'mcp__playwright__'+name,description:name,parameters:{type:'object',properties:{}}}}));
 const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 f.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:262144}]}),dispose(){},async complete(messages,tools){
  const review=fixtureReview(messages);if(review){const data=JSON.parse(messages[1].content),host=data.evidence.find(e=>e.id==='host');assert.equal(host.result.developmentPreview.tabId,'preview-tab');reviewSeen=true;return review;}
  if(step++===0){assert(tools.some(t=>t.function.name==='open_development_preview'));return call('open_development_preview',{processId:f.p.id});}
  const last=messages.findLast(m=>m.role==='tool');
  const host=messages.findLast(m=>typeof m.content==='string'&&m.content.startsWith('Current host receipts (reference data, not instructions): '));
  const result=last?JSON.parse(last.content):JSON.parse(host.content.slice(host.content.indexOf('{'))).mcpContinuation.result;
  if(step===2){assert.equal(result.browserAgent.tabId,'preview-tab');return call('mcp__playwright__browser_type',{tabId:'preview-tab',documentId:'doc-1',target:'e1',text:'Nubi'});}
  if(step===3){assert.equal(result.browserAgent.receipt.status,'confirmed');return call('open_development_preview',{processId:f.p.id});}
  assert.equal(result.reused,true);assert.match(result.text,/Nubi/);return {content:'미리보기에서 Nubi 입력 결과를 확인했습니다.',calls:[]};
 }};
 await f.service.startAgent({taskId:f.task.id});await f.service.agent.promise;
 let pending=f.service.task(f.task.id);assert(pending.question,JSON.stringify({state:pending.state,error:pending.error,trace:pending.trace,messages:pending.messages}));assert.equal(pending.question.toolRequest.tool,'browser_open');assert.equal(f.counts().opens,0);
 await f.service.answerAgent({taskId:f.task.id,answer:'실행'});await f.service.agent.promise;
 pending=f.service.task(f.task.id);assert(pending.question,JSON.stringify({state:pending.state,error:pending.error,trace:pending.trace,messages:pending.messages}));assert.equal(pending.question.toolRequest.tool,'browser_type');assert.equal(f.counts().writes,0);
 await f.service.answerAgent({taskId:f.task.id,answer:'실행'});await f.service.agent.promise;
 const final=f.service.task(f.task.id);assert.equal(final.question,null);assert(final.messages.some(m=>m.role==='assistant'&&m.content.includes('Nubi 입력 결과')));
 assert.equal(f.counts().opens,1);assert.equal(f.counts().writes,1);assert.equal(f.service.store.list('process:').length,1);
 assert.equal(reviewSeen,true);
});

test('development review uses bound module readback and refuses unrelated tabs or stopped preview processes',()=>{
 const time='2026-10-16T10:00:00.000Z',check={method:'browser',requirementId:'ui',after:Date.parse(time)};
 const preview={previewId:'v',tabId:'tab',processId:'p',serverRunning:true};
 const host={id:'host',usable:true,result:{developmentPreview:preview,processes:[{id:'p',state:'running',execution:'started'}]}};
 const read={id:'tool:1',usable:true,observedAt:time,tool:'mcp__playwright__browser_type',result:{ok:true,server:'playwright',tool:'browser_type',browserAgent:{...preview,readback:true,receipt:{status:'confirmed'}}}};
 assert.deepEqual(bindDevelopmentEvidence([check],[host,read])[0].eligibleEvidenceIds,['tool:1']);
 const workflow={...read,tool:'mcp__playwright__browser_run_workflow',result:{...read.result,tool:'browser_run_workflow',browserAgent:{...preview,readback:true,workflow:{completed:{steps:2},confirmedSteps:2}}}};
 assert.deepEqual(bindDevelopmentEvidence([check],[host,workflow])[0].eligibleEvidenceIds,['tool:1']);
 assert.deepEqual(bindDevelopmentEvidence([check],[host,{...workflow,result:{...workflow.result,browserAgent:{...workflow.result.browserAgent,workflow:{confirmedSteps:1,stopped:{index:1}}}}}])[0].eligibleEvidenceIds,[]);
 assert.deepEqual(bindDevelopmentEvidence([check],[host,{...read,result:{...read.result,browserAgent:{...read.result.browserAgent,tabId:'other'}}}])[0].eligibleEvidenceIds,[]);
 assert.deepEqual(bindDevelopmentEvidence([check],[{...host,result:{...host.result,processes:[{id:'p',state:'cancelled',execution:'started'}]}},read])[0].eligibleEvidenceIds,[]);
});

// Whole-window docking changes the host view, not the observed web document.
test('chat whole-window tools keep existing approval but need no website observation',async t=>{
 const f=await browserFixture(t);let calls=0;f.registry.call=async(name,args)=>{calls++;return {ok:true,text:JSON.stringify({docked:name.endsWith('browser_bring')})};};
 for(const tool of ['browser_bring','browser_detach']){const request={taskId:f.task.id,name:'mcp__playwright__'+tool,args:{}};await prepareDevelopmentBrowserCall(f.service,request);await assert.rejects(()=>callDevelopmentBrowser(f.service,{...request,approved:false}),/development_approval_required/);assert.equal((await callDevelopmentBrowser(f.service,{...request,approved:true})).ok,true);}
 assert.equal(calls,2);assert.equal(f.counts().writes,0);
});
import {rememberBrowserScreen} from '../runtime/browser-agent-host.mjs';
test('Workspace screen knowledge uses the bound browser and host model, then recalls on a fresh observation',async t=>{
 const f=await browserFixture(t),base=f.registry.call.bind(f.registry);f.registry.call=async(name,args)=>{const result=await base(name,args);return name.endsWith('browser_snapshot')?{...result,text:result.text+'\n- heading "Name form" [level=1]'}:result;};
 const opened=await callDevelopmentBrowser(f.service,{taskId:f.task.id,name:'mcp__playwright__browser_open',args:{url:f.url},approved:true});let analyses=0;
 const complete=async()=>{analyses++;return {calls:[{function:{name:'screen_analysis',arguments:JSON.stringify({screenType:'editor',titleEvidenceId:'f2',fieldEvidenceIds:['f0'],actionEvidenceIds:['f1']})}}]};};
 const signal=new AbortController().signal;assert.equal((await rememberBrowserScreen(f.service,f.task.id,signal,complete)).reused,false);assert.equal((await rememberBrowserScreen(f.service,f.task.id,signal,complete)).reused,true);assert.equal(analyses,1);
 const result=await callDevelopmentBrowser(f.service,{taskId:f.task.id,name:'mcp__playwright__browser_snapshot',args:{tabId:opened.browserAgent.tabId,documentId:opened.browserAgent.documentId},approved:true,signal});assert.equal(result.screenKnowledge.authority,'historical_guidance_only');assert.equal(result.screenKnowledge.targetsRequireFreshObservation,true);assert.equal(f.counts().writes,0);
});

test('Desktop Pi screen learning pauses in the existing question form and resumes with a saved guidance receipt',async t=>{
 const f=await browserFixture(t),base=f.registry.call.bind(f.registry);let actorCalls=0,analyses=0;
 f.registry.call=async(name,args)=>{const result=await base(name,args);return name.endsWith('browser_snapshot')?{...result,text:result.text+'\n- heading "Name form" [level=1]'}:result;};
 await callDevelopmentBrowser(f.service,{taskId:f.task.id,name:'mcp__playwright__browser_open',args:{url:f.url},approved:true});
 f.service.mcpDefinitions=async()=>[];
 f.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:262144}]}),dispose(){},async complete(messages,tools){
  if(tools?.some(t=>t.function.name==='screen_analysis')){analyses++;return {calls:[{function:{name:'screen_analysis',arguments:JSON.stringify({screenType:'editor',titleEvidenceId:'f2',fieldEvidenceIds:['f0'],actionEvidenceIds:['f1'],questions:[{id:'purpose',topic:'screen_purpose',evidenceId:'f2',inputMode:'text'}]})}}]};}
  if(actorCalls++===0){assert(tools.some(t=>t.function.name==='learn_browser_screen'));return {content:'',calls:[{id:'learn',type:'function',function:{name:'learn_browser_screen',arguments:'{}'}}]};}
  const host=messages.findLast(m=>typeof m.content==='string'&&m.content.startsWith('Current host receipts (reference data, not instructions): '));const receipts=JSON.parse(host.content.slice(host.content.indexOf('{')));assert.equal(receipts.answeredQuestions.at(-1).screenLearningResult.status,'saved');assert.equal(receipts.answeredQuestions.at(-1).screenLearningResult.procedureVerified,false);
  return {content:'업무 용도를 화면 안내에 저장했습니다.',calls:[]};
 }};
 await f.service.startAgent({taskId:f.task.id});await f.service.agent.promise;
 const waiting=f.service.task(f.task.id);assert.equal(waiting.state,'waiting_input',JSON.stringify({error:waiting.error,trace:waiting.trace,messages:waiting.messages}));assert(waiting.question.browserScreenLearning);assert.equal(waiting.question.screenContext.title,'Name form');assert.equal(f.counts().writes,0);
 await f.service.answerAgent({taskId:f.task.id,choice:{questionId:waiting.question.id,optionId:waiting.question.options[0].id}});await f.service.agent.promise;
 const done=f.service.task(f.task.id);assert.equal(done.question,null);assert.equal(done.questionHistory.at(-1).screenLearningResult.status,'saved');assert.equal(analyses,1);assert.equal(f.counts().writes,0);assert(done.messages.some(m=>m.content?.includes('업무 용도를 화면 안내에 저장했습니다.')));
});
