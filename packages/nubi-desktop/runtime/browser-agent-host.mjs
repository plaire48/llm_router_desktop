import {workspaceScreenKnowledge,workspaceScreenLearning,screenEvidence,screenKnowledgeText} from './browser-screen-knowledge.mjs';
import {makeQuestion} from '../../../extensions/aipro-chat/user-question.js';
import {randomUUID} from 'node:crypto';
import {createBrowserAddon,browserAgentManifest} from '../generated/browser-agent-core.mjs';
import {hash,fail} from './files.mjs';
import {prepareWorkflow,runWorkflow} from './browser-workflow.mjs';

// The Desktop Pi remains the only model loop. This replaces direct browser
// execution for all ordinary web tasks, with an optional development binding.
// It injects the existing
// protected MCP connection, SQL checkpoints and already-decided host approval
// into the independent BrowserSession; it launches no browser or provider.
const OPEN='mcp__playwright__browser_open',SNAPSHOT='mcp__playwright__browser_snapshot';
const writes=new Set(['browser_click','browser_type','browser_fill_form','browser_press_key','browser_select_option','browser_hover','browser_mouse_wheel','browser_navigate','browser_navigate_back']);
const adapters=new WeakMap(),key=taskId=>'development-preview:'+taskId;
const parsed=text=>{for(const line of String(text||'').split('\n'))try{const value=JSON.parse(line);if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{}return null;};
const pendingKey=taskId=>'development-preview-open:'+taskId;
const proposalKey=(taskId,fingerprint)=>'development-browser-action:'+taskId+':'+hash(fingerprint);
const workflowKey=(taskId,fingerprint)=>'browser-workflow:'+taskId+':'+hash(fingerprint);
const unresolved=checkpoint=>checkpoint.receipts.some(r=>['issued','unconfirmed'].includes(r.status));
function alive(service,preview,signal){
 signal?.throwIfAborted();if(service.disposed||service.projectId!==preview.projectId)fail('project_changed');
 if(service.task(preview.taskId).state==='cancelled')fail('setup_cancelled');
 if(preview.kind==='web')return;
 const record=service.processes.records.get(preview.processId);
 if(!record||record.taskId!==preview.taskId||record.state!=='running'||record.execution!=='started')fail('development_server_not_ready');
}
async function checked(service,preview,documentId,signal){
 alive(service,preview,signal);
 const binding=await service.playwrightRequest('check',{tabId:preview.tabId,...(documentId?{documentId}:{})},{signal});
 alive(service,preview,signal);
 if(binding.tabId!==preview.tabId)fail('development_tab_changed');
 if(preview.kind!=='web'&&binding.origin!==new URL(preview.url).origin)fail('development_origin_changed');
 return binding;
}
function metadata(preview,extra={}){return {addonId:browserAgentManifest.addonId,version:browserAgentManifest.version,taskId:preview.taskId,processId:preview.processId,previewId:preview.id,tabId:preview.tabId,functionalVerified:false,...extra};}

async function adapter(service,preview){
 let entry=adapters.get(service.store);
 if(entry&&entry.projectId!==service.projectId){await entry.addon.dispose();adapters.delete(service.store);entry=null;}
 if(!entry){
  const addon=createBrowserAddon(),store=service.store,observations=new Map(),previews=new Map(),grants=new Set(),seeds=new Map();
  const browser={
   async acquire(){return randomUUID();},async release(){observations.clear();previews.clear();grants.clear();seeds.clear();},
   async tools(){return [...writes].map(name=>({name,effect:'write'}));},
   async observe(context,tabId){
    const current=previews.get(context.scope.taskId);if(!current||tabId!==current.tabId)fail('development_tab_changed');
    const before=await checked(service,current,undefined,context.signal);
    // The open tool may already return a fresh DOM. Consume it once, only for
    // that exact document; action validation still rereads the current DOM.
    const seed=seeds.get(context.scope.taskId);seeds.delete(context.scope.taskId);
    const outcome=seed?.documentId===before.documentId?{ok:true,text:JSON.stringify(before)+'\n'+seed.snapshot}:await service.mcpRegistry().call(SNAPSHOT,{tabId,documentId:before.documentId},{signal:context.signal});
    if(!outcome.ok)fail('development_observation_unavailable');
    const after=await checked(service,current,before.documentId,context.signal);
    current.documentId=after.documentId;store.set(key(current.taskId),current);
    const observation={state:'ready',observationId:randomUUID(),binding:{tabId,documentId:after.documentId,revision:hash(outcome.text)},data:{outcome}};
    observations.set(context.scope.taskId,observation);return observation;
   },
   async validate(context,binding){
    const current=previews.get(context.scope.taskId);if(!current)return false;
    try{
     await checked(service,current,binding.documentId,context.signal);
     const fresh=await service.mcpRegistry().call(SNAPSHOT,{tabId:binding.tabId,documentId:binding.documentId},{signal:context.signal});
     await checked(service,current,binding.documentId,context.signal);
     return fresh.ok&&hash(fresh.text)===binding.revision;
    }catch{return false;}
   },
   async execute(context,action){
    const current=previews.get(context.scope.taskId);await checked(service,current,action.binding.documentId,context.signal);
    let outcome;
    try{outcome=await service.mcpRegistry().call('mcp__playwright__'+action.tool,action.arguments,{signal:context.signal});}
    catch{return {status:'unconfirmed',evidenceRefs:[]};}
    if(!outcome.ok)return {status:'unconfirmed',evidenceRefs:[],data:{outcome}};
    // A failed follow-up never reissues the confirmed input or click.
    let observation;try{observation=await browser.observe(context,current.tabId);}catch{}
    return {status:'confirmed',evidenceRefs:['action:'+action.actionId],data:{outcome},...(observation?{observation}:{})};
   },
   async reconcile(){return {status:'unconfirmed',evidenceRefs:[]};},
   async verify(_context,checkpoint){return {criteria:checkpoint.criteria.map(id=>({id,satisfied:false,evidenceRefs:[]}))};},
  };
  const session=await addon.attach({apiVersion:'1.3.0',capabilities:['browser','policy','human','task-store','events'],browser,
   store:{async read(scope){return store.get('development-browser:'+scope.taskId)||null;},async compareAndSet(scope,version,next){const old=store.get('development-browser:'+scope.taskId);if((old?.version??null)!==version)return false;store.set('development-browser:'+scope.taskId,next);return true;},async flush(){}},
   policy:{async decide(context){return grants.has(context.action.actionId)?'allow':'deny';}},
   human:{async present(){fail('development_host_approval_required');},async dismiss(){}},
   events:{emit(event){store.event('development_browser',{kind:event.kind,taskId:event.taskId,state:event.state});}},
  },{projectId:service.projectId});
  entry={addon,session,observations,previews,grants,seeds,projectId:service.projectId,opened:new Set()};adapters.set(service.store,entry);
 }
 const taskId=preview.sessionTaskId;entry.previews.set(taskId,preview);
 if(!entry.opened.has(taskId)){
  await entry.session.openTask({taskId,runId:preview.id,request:preview.request,criteria:['development-behavior']});entry.opened.add(taskId);
 }
 return entry;
}
async function observe(service,preview,signal,inline){
 alive(service,preview,signal);const entry=await adapter(service,preview),id=preview.sessionTaskId;
 const checkpoint=entry.session.checkpoint(id);
 if(unresolved(checkpoint))fail('development_execution_unconfirmed');
 if(checkpoint.state==='PAUSED')await entry.session.resumeTask(id);
 if(inline&&inline.tabId===preview.tabId&&inline.documentId===preview.documentId&&typeof inline.snapshot==='string'&&inline.snapshot.trim()&&inline.snapshot.length<=200000)entry.seeds.set(id,{documentId:inline.documentId,snapshot:inline.snapshot});
 const observation=await entry.session.observe(id,preview.tabId);signal?.throwIfAborted();
 let screenNotes=[];try{const binding=await checked(service,preview,observation.binding.documentId,signal);const knowledge=workspaceScreenKnowledge(service,{preview:{...preview,url:binding.origin,knowledgeScope:binding.knowledgeScope},text:observation.data.outcome.text,validate:async()=>{const current=await checked(service,preview,observation.binding.documentId,signal);return current.origin===binding.origin&&current.knowledgeScope===binding.knowledgeScope;}});screenNotes=(await knowledge.recall(signal)).notes;}catch(error){signal?.throwIfAborted();}
 return {...observation.data.outcome,...(screenNotes.length?{screenKnowledge:{notes:screenNotes,authority:'historical_guidance_only',targetsRequireFreshObservation:true}}:{}),browserAgent:metadata(preview,{documentId:observation.binding.documentId,observationId:observation.observationId,observedAt:new Date().toISOString(),readback:true})};
}

export function developmentPreviewReceipt(service,taskId){
 const preview=service.store.get(key(taskId));
 if(!preview)return null;
 const record=service.processes.records.get(preview.processId);
 return {...metadata(preview),kind:preview.kind||'development',url:preview.url,serverRunning:preview.kind==='web'?null:record?.state==='running'&&record.taskId===taskId,documentId:preview.documentId};
}

export async function prepareDevelopmentPreview(service,{taskId,processId,url,signal}){
 const task=service.task(taskId);signal?.throwIfAborted();
 if(task.state==='cancelled')fail('setup_cancelled');
 const server=await service.inspectDevServer({taskId,processId,url,signal});
 if(!server.responding)fail('development_server_not_ready');
 const registry=service.mcpRegistry();if(!registry.tool(OPEN)||typeof service.playwrightRequest!=='function')fail('development_browser_unavailable');
 const previous=service.store.get(key(taskId));
 if(previous&&previous.processId===processId&&previous.url===server.url){
  const result=await observe(service,previous,signal);return {reused:true,result:{...result,serverCheck:server}};
 }
 const pending=service.store.get(pendingKey(taskId));
 if(pending&&['issued','unconfirmed'].includes(pending.state))fail('development_execution_unconfirmed');
 const args={url:server.url},fingerprint=registry.fingerprint(OPEN,args);
 const prepared={id:randomUUID(),kind:'development',projectId:service.projectId,taskId,processId,url:server.url,request:task.request.slice(0,20000),fingerprint,state:'prepared'};
 alive(service,prepared,signal);service.store.set(pendingKey(taskId),prepared);
 return {request:{name:OPEN,args},server,requiresApproval:true};
}

// Called before the existing MCP approval form is shown, never after approval
// to silently replace the page/targets that the person approved.
export async function prepareDevelopmentBrowserCall(service,{taskId,name,args,signal}){
 if(typeof service.playwrightRequest!=='function')return;
 const preview=service.store.get(key(taskId)),tool=name.replace('mcp__playwright__','');
 if(!name.startsWith('mcp__playwright__'))return;
 if(tool==='browser_run_workflow'){
  if(!preview||args.tabId!==preview.tabId)fail('development_observation_required');
  const binding=await checked(service,preview,args.documentId,signal),entry=await adapter(service,preview),observation=entry.observations.get(preview.sessionTaskId);
  if(!observation||observation.binding.documentId!==args.documentId)fail('development_observation_required');
  if(unresolved(entry.session.checkpoint(preview.sessionTaskId)))fail('development_execution_unconfirmed');
  const fingerprint=service.mcpRegistry().fingerprint(name,args),saved=workflowKey(taskId,fingerprint);
  if(service.store.get(saved))return;
  const plan=prepareWorkflow(observation.data.outcome.text,args);
  service.store.set(saved,{state:'prepared',previewId:preview.id,binding:observation.binding,origin:binding.origin,plan,confirmedSteps:0});return;
 }
 if(name===OPEN){
  const fingerprint=service.mcpRegistry().fingerprint(name,args),pending=service.store.get(pendingKey(taskId));
  if(pending?.fingerprint===fingerprint&&pending.state==='prepared')return;
  if(pending&&['issued','unconfirmed'].includes(pending.state))fail('development_execution_unconfirmed');
  const task=service.task(taskId);
  service.store.set(pendingKey(taskId),{id:randomUUID(),kind:'web',projectId:service.projectId,taskId,processId:null,url:args.url,request:task.request.slice(0,20000),fingerprint,state:'prepared'});return;
 }
 if(!writes.has(tool))return;
 if(!preview)fail('development_observation_required');
 alive(service,preview,signal);
 if(args.tabId!==preview.tabId)fail('development_tab_changed');
 const entry=await adapter(service,preview),observation=entry.observations.get(preview.sessionTaskId);
 if(!observation)fail('development_observation_required');
 if(args.documentId!==observation.binding.documentId)fail('development_observation_changed');
 if(preview.kind!=='web'&&tool==='browser_navigate'&&new URL(args.url,preview.url).origin!==new URL(preview.url).origin)fail('development_origin_changed');
 if(preview.kind!=='web'&&tool==='browser_navigate_back')fail('development_navigation_scope');
 const targets=[args.target,args.ref,...(args.fields||[]).map(field=>field.ref)].filter(value=>value!==undefined);
 const refs=new Set([...observation.data.outcome.text.matchAll(/\[ref=([^\]]+)\]/g)].map(match=>match[1]));
 if(targets.some(target=>typeof target!=='string'||!refs.has(target))||['browser_click','browser_type','browser_select_option','browser_hover'].includes(tool)&&!targets.length)fail('development_target_not_observed');
 const fingerprint=service.mcpRegistry().fingerprint(name,args),recordKey=proposalKey(taskId,fingerprint),old=service.store.get(recordKey);
 if(old&&old.action.observationId===observation.observationId)return;
 if(old&&unresolved(entry.session.checkpoint(preview.sessionTaskId)))fail('development_execution_unconfirmed');
 service.store.set(recordKey,{previewId:preview.id,action:{actionId:randomUUID(),tool,arguments:structuredClone(args),binding:observation.binding,observationId:observation.observationId,catalogVersion:entry.session.catalog().version}});
}

export async function callDevelopmentBrowser(service,{taskId,name,args={},approved=false,signal}){
 signal?.throwIfAborted();const registry=service.mcpRegistry();
 if(typeof service.playwrightRequest!=='function')return registry.call(name,args,{signal});
 const fingerprint=registry.fingerprint(name,args);
 if(name===OPEN&&!service.store.get(pendingKey(taskId)))await prepareDevelopmentBrowserCall(service,{taskId,name,args,signal});
 const pending=service.store.get(pendingKey(taskId));
 if(name===OPEN&&pending?.fingerprint===fingerprint){
  if(!approved)fail('development_approval_required');
  if(['issued','unconfirmed'].includes(pending.state))fail('development_execution_unconfirmed');
  const existing=service.store.get(key(taskId));
  if(pending.state==='bound'&&existing?.id===pending.id)return {...await observe(service,existing,signal),reused:true};
  alive(service,pending,signal);
  const server=pending.kind==='web'?null:await service.inspectDevServer({taskId,processId:pending.processId,url:pending.url,signal});
  if(server&&!server.responding)fail('development_server_not_ready');
  pending.state='issued';service.store.set(pendingKey(taskId),pending);
  let outcome;
  try{outcome=await registry.call(name,args,{signal});if(!outcome.ok)throw Error('development_open_unconfirmed');}
  catch(error){pending.state='unconfirmed';service.store.set(pendingKey(taskId),pending);throw error;}
  const binding=parsed(outcome.text);
  if(!binding?.tabId||!binding?.documentId){pending.state='unconfirmed';service.store.set(pendingKey(taskId),pending);fail('development_open_unconfirmed');}
  const preview={...pending,tabId:binding.tabId,documentId:binding.documentId,sessionTaskId:'preview-'+pending.id,state:'bound'};
  service.store.set(key(taskId),preview);pending.state='bound';service.store.set(pendingKey(taskId),pending);
  try{return {...await observe(service,preview,signal,binding),...(server?{serverCheck:server}:{})};}catch(error){return {...outcome,...(server?{serverCheck:server}:{}),browserAgent:metadata(preview,{documentId:binding.documentId,readback:false}),observationError:error.message};}
 }
 let preview=service.store.get(key(taskId));const tool=name.replace('mcp__playwright__','');
 if(['browser_bring','browser_detach'].includes(tool)){if(!approved)fail('development_approval_required');return registry.call(name,args,{signal});}
 if(!name.startsWith('mcp__playwright__')||tool==='browser_tabs')return registry.call(name,args,{signal});
 if(!preview&&tool==='browser_snapshot'){
  const binding=await service.playwrightRequest('check',{tabId:args.tabId},{signal}),id=randomUUID();
  preview={id,kind:'web',projectId:service.projectId,taskId,processId:null,url:binding.origin,request:service.task(taskId).request.slice(0,20000),tabId:args.tabId,documentId:binding.documentId,sessionTaskId:'preview-'+id,state:'bound'};
  service.store.set(key(taskId),preview);
 }
 if(!preview)fail('development_observation_required');
 if(args.tabId!==preview.tabId)fail('development_tab_changed');
 await checked(service,preview,args.documentId,signal);
 if(tool==='browser_run_workflow'){
  if(!approved)fail('development_approval_required');
  const saved=workflowKey(taskId,fingerprint),record=service.store.get(saved);
  if(!record||record.previewId!==preview.id)fail('development_observation_required');
  if(record.result)return {...record.result,reused:true};
  if(record.state!=='prepared')fail('development_execution_unconfirmed');
  const entry=await adapter(service,preview);
  if(unresolved(entry.session.checkpoint(preview.sessionTaskId)))fail('development_execution_unconfirmed');
  await observe(service,preview,signal);
  if(entry.observations.get(preview.sessionTaskId).binding.revision!==record.binding.revision)fail('development_observation_changed');
  record.state='running';service.store.set(saved,record);
  let result;
  try{
   result=await runWorkflow(record.plan,{signal,observe:async()=>{await checked(service,preview,undefined,signal);return (await observe(service,preview,signal)).text;},
    act:async(tool,input)=>{
     const current=entry.observations.get(preview.sessionTaskId),binding=await checked(service,preview,current.binding.documentId,signal);
     if(binding.origin!==record.origin)fail('development_workflow_origin_changed');
     const callName='mcp__playwright__'+tool,callArgs={tabId:preview.tabId,documentId:current.binding.documentId,...input};
     await prepareDevelopmentBrowserCall(service,{taskId,name:callName,args:callArgs,signal});
     const outcome=await callDevelopmentBrowser(service,{taskId,name:callName,args:callArgs,approved:true,signal});
     return {...outcome,text:outcome.browserAgent?.readback?outcome.text:''};
    },onConfirmed:count=>{record.confirmedSteps=count;service.store.set(saved,record);}});
  }catch(error){result={stopped:{reason:signal?.aborted?'cancelled':error.message},confirmedSteps:record.confirmedSteps,text:'',taskCompleted:false};}
  const uncertain=unresolved(entry.session.checkpoint(preview.sessionTaskId));
  const {text,...report}=result;
  const outcome={ok:!!result.completed,execution:uncertain?'unconfirmed':result.completed?'confirmed':'stopped',text:(text||'')+'\n### Workflow result\n'+JSON.stringify(report),browserAgent:metadata(preview,{documentId:preview.documentId,workflow:report,readback:!!text,observedAt:new Date().toISOString()})};
  record.state=result.completed?'complete':'stopped';record.result=outcome;service.store.set(saved,record);return outcome;
 }
 if(tool==='browser_snapshot'){
  const entry=await adapter(service,preview);
  if(unresolved(entry.session.checkpoint(preview.sessionTaskId)))return {...await registry.call(name,args,{signal}),execution:'unconfirmed',browserAgent:metadata(preview,{documentId:args.documentId,readback:false}),instruction:'Current page read only. This does not resolve the uncertain receipt or permit another input.'};
  return observe(service,preview,signal);
 }
 if(!writes.has(tool)){
  return {...await registry.call(name,args,{signal}),browserAgent:metadata(preview,{documentId:args.documentId,readback:false})};
 }
 if(!approved)fail('development_approval_required');
 const proposal=service.store.get(proposalKey(taskId,fingerprint));
 if(!proposal||proposal.previewId!==preview.id)fail('development_observation_required');
 const entry=await adapter(service,preview),id=preview.sessionTaskId,checkpoint=entry.session.checkpoint(id);
 if(unresolved(checkpoint))fail('development_execution_unconfirmed');
 if(!entry.observations.has(id)){
  await observe(service,preview,signal);const current=entry.observations.get(id);
  if(JSON.stringify(current.binding)!==JSON.stringify(proposal.action.binding))fail('development_observation_changed');
  proposal.action.observationId=current.observationId;
 }
 signal?.throwIfAborted();entry.grants.add(proposal.action.actionId);
 const stop=()=>{void entry.session.cancelTask(id).catch(()=>{});};signal?.addEventListener('abort',stop,{once:true});
 try{
  const result=await entry.session.execute(id,proposal.action);signal?.throwIfAborted();
  const outcome=result.observation?.data?.outcome||result.data?.outcome||{ok:result.receipt.status==='confirmed',text:''};
  return {...outcome,browserAgent:metadata(preview,{documentId:result.observation?.binding.documentId||proposal.action.binding.documentId,receipt:result.receipt,reused:result.reused===true,readback:!!result.observation,observedAt:new Date().toISOString()}),...(result.receipt.status!=='confirmed'?{ok:false,execution:'unconfirmed',instruction:'Preserve this receipt. Read current state; never replay uncertain browser input.'}:{})};
 }finally{entry.grants.delete(proposal.action.actionId);signal?.removeEventListener('abort',stop);}
}

export async function disposeDevelopmentBrowser(service){const entry=adapters.get(service.store);adapters.delete(service.store);await entry?.addon.dispose();}

export async function cancelBrowserAgent(service,taskId){
 service.store?.set(learningKey(taskId),null);
 const preview=service.store?.get(key(taskId)),entry=adapters.get(service.store);
 if(preview&&entry?.opened.has(preview.sessionTaskId))await entry.session.cancelTask(preview.sessionTaskId);
}

export async function rememberBrowserScreen(service,taskId,signal,complete){
 const preview=service.store.get(key(taskId));if(!preview)fail('development_observation_required');
 const observed=await observe(service,preview,signal),before=await checked(service,preview,preview.documentId,signal);
 const knowledge=workspaceScreenKnowledge(service,{preview:{...preview,url:before.origin,knowledgeScope:before.knowledgeScope},text:observed.text,complete,validate:async()=>{const current=await checked(service,preview,before.documentId,signal);const fresh=await service.mcpRegistry().call(SNAPSHOT,{tabId:preview.tabId,documentId:before.documentId},{signal});const after=await checked(service,preview,before.documentId,signal);return current.knowledgeScope===before.knowledgeScope&&after.knowledgeScope===before.knowledgeScope&&current.origin===before.origin&&after.origin===before.origin&&after.documentId===before.documentId&&fresh.ok&&hash(fresh.text)===hash(observed.text);}});
 const saved=await knowledge.analyzeAndSave(signal);return {saved:true,reused:saved.reused,notes:[screenKnowledgeText(saved.record).slice(0,1800)],authority:'historical_guidance_only',storage:'project_private_screen_wiki',procedureVerified:false};
}

const learningKey=taskId=>'browser-screen-learning:'+taskId;
function learningHost(service,pending,signal,complete){
 const store=service.store,context={projectId:pending.projectId,task:{taskId:pending.taskId},observation:{state:'ready',binding:{tabId:pending.tabId,documentId:pending.documentId,revision:pending.snapshotHash}},signal};
 const owns=()=>service.store===store&&service.projectId===pending.projectId&&!service.disposed&&store.get(key(pending.taskId))?.id===pending.previewId&&store.get(learningKey(pending.taskId))?.id===pending.id&&service.task(pending.taskId).state!=='cancelled';
 const validate=async()=>{
  if(!owns())return false;
  const preview=store.get(key(pending.taskId)),before=await checked(service,preview,pending.documentId,signal);
  if(before.documentId!==pending.documentId||before.origin!==pending.origin||before.knowledgeScope!==pending.knowledgeScope)return false;
  const fresh=await service.mcpRegistry().call(SNAPSHOT,{tabId:pending.tabId,documentId:pending.documentId},{signal});
  const after=await checked(service,preview,pending.documentId,signal);
  return owns()&&after.documentId===pending.documentId&&after.origin===pending.origin&&after.knowledgeScope===pending.knowledgeScope&&fresh.ok&&hash(fresh.text)===pending.snapshotHash;
 };
 return {context,...workspaceScreenLearning(service,{preview:{url:pending.origin,tabId:pending.tabId,knowledgeScope:pending.knowledgeScope},evidence:pending.evidence,complete,validate,validateContext:async()=>owns(),allowAnswer:async()=>owns()&&store.get(learningKey(pending.taskId))?.state==='answering'})};
}
export async function learnBrowserScreen(service,taskId,signal,complete){
 const store=service.store,preview=store.get(key(taskId));if(!preview)fail('development_observation_required');
 const observed=await observe(service,preview,signal),binding=await checked(service,preview,preview.documentId,signal);
 if(service.store!==store)fail('project_changed');
 const pending={id:randomUUID(),taskId,projectId:service.projectId,previewId:preview.id,tabId:preview.tabId,documentId:binding.documentId,origin:binding.origin,knowledgeScope:binding.knowledgeScope,snapshotHash:hash(observed.text),evidence:screenEvidence(observed.text),state:'analyzing'};
 store.set(learningKey(taskId),pending);
 try{
  const host=learningHost(service,pending,signal,complete),next=await host.port.next(host.context);await host.knowledge.publishStructure(signal);
  if(!next){store.set(learningKey(taskId),null);return {saved:true,questionRequired:false,authority:'historical_guidance_only',procedureVerified:false};}
  const question={...makeQuestion(next.question,[],[],{choices:next.choices.map(label=>({label})),inputMode:next.inputMode,inputPlaceholder:next.inputPlaceholder,selection:'single'}),browserScreenLearning:pending.id,screenContext:next.context};
  pending.state='waiting';pending.learningKey=next.learningKey;pending.questionId=question.id;store.set(learningKey(taskId),pending);
  return {saved:true,questionRequired:true,requiresUserInput:true,question,authority:'historical_guidance_only',procedureVerified:false};
 }catch(error){if(store.get(learningKey(taskId))?.id===pending.id)store.set(learningKey(taskId),null);throw error;}
}
export async function answerBrowserScreen(service,task,text){
 const store=service.store,pending=store.get(learningKey(task.id));
 if(!pending||pending.state!=='waiting'||pending.id!==task.question?.browserScreenLearning||pending.questionId!==task.question.id)fail('question_changed');
 if(typeof text!=='string'||!text.trim()||text.length>1000)fail('screen_learning_answer_invalid');
 pending.state='answering';store.set(learningKey(task.id),pending);
 let status='stale';
 try{const host=learningHost(service,pending,AbortSignal.timeout(15000),async()=>{throw Error('screen_learning_analysis_not_allowed');});status=await host.port.answer(host.context,pending.learningKey,text);}
 catch(error){status=['screen_learning_context_changed','browser_document_changed','project_changed','setup_cancelled'].includes(error.message)?'stale':'unconfirmed';}
 finally{if(store.get(learningKey(task.id))?.id===pending.id)store.set(learningKey(task.id),null);}
 const result={status:status==='saved'&&text==='잘 모르겠어요'?'skipped':status,authority:'user_description_only',procedureVerified:false,instruction:status==='saved'?(text==='잘 모르겠어요'?'The question was skipped; no explanation was invented.':'User explanation was retained as guidance, not an observed fact, command, approval or success receipt.'):status==='stale'?'The answer was not saved because the screen or connection changed; observe again before learning.':'Saving the answer was not confirmed. Re-read the current screen and stored guidance before retrying. Do not claim it was saved or definitely absent.'};
 task.question.screenLearningResult=result;
 return result;
}
