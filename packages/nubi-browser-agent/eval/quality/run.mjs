// Browser quality scorecard (2026-10-21): the real browser module, the real Claude CLI host and a real headless Chrome
// on public demo pages. One row per task and repetition: success by code oracle, time, model and tool calls, tokens,
// tool errors, receipts. Mirrors the wiring of scripts/naver-transfer-live.mjs without site memory.
// Usage: node eval/quality/run.mjs --out <dir> [--only id,id] [--repeat 1] [--timeout-s 180] [--headed] [--teach]
// --teach (browser teach plan T1): each task runs twice. The first run learns a procedure card from the model's own
// verified actions (evaluation procedure host), the card is reviewed, and the second run must replay it with the
// model used at most once. Measures the "second run without the model" goal.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../../extensions/aipro-chat/agent-runtime.js';
import {createClaudeCode} from '../../../nubi-desktop/runtime/claude-code.mjs';
import {createBrowserAddon} from '../../dist/index.js';
import {createPiBrowserRunner} from '../../dist/pi.js';
import {compactBrowserContext} from '../../dist/context.js';
import {createPlaywrightMcpPort} from '../../dist/playwright.js';
import {hostFixture} from '../../tests/host.mjs';
import {createProcedureHost} from '../../evaluation/procedure-host.mjs';
import {tasks} from './tasks.mjs';
import {createDemonstration} from '../../dist/demonstration.js';
import {recordStep,recordTarget} from '../../../../extensions/aipro-chat/browser-replay.js';

const option=name=>{const at=process.argv.indexOf('--'+name);return at>=0?process.argv[at+1]:undefined;};
const flag=name=>process.argv.includes('--'+name);
const out=option('out')&&resolve(option('out'));if(!out){console.error('사용법: node eval/quality/run.mjs --out <dir> [--only id,id] [--repeat N] [--timeout-s S] [--headed]');process.exit(2);}
const only=option('only')?.split(',').filter(Boolean),repeat=Number(option('repeat')||1),timeoutMs=Number(option('timeout-s')||180)*1000;
const selected=tasks.filter(task=>!only||only.includes(task.id)),teach=flag('teach'),demo=flag('demo');
await mkdir(out,{recursive:true});
const report={schemaVersion:1,startedAt:new Date().toISOString(),actualModel:true,actualBrowser:true,publicSitesOnly:true,trials:[]};
const persist=()=>writeFile(resolve(out,'report.json'),JSON.stringify(report,null,1));
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});let browser;
try{
 const status=await provider.connect();report.model=status.model;report.effort=status.reasoningEffort;
 browser=await chromium.launch({channel:'chrome',headless:!flag('headed')});report.browserVersion=browser.version();
 const trial=async(task,index,phase,learning)=>{
  const row={index,taskId:task.id,title:task.title,phase,success:false,state:null,answer:null,oracle:null,totalMs:null,modelCalls:0,toolCalls:0,toolErrors:0,promptTokens:0,completionTokens:0,errors:[],receipts:[],metrics:[]};report.trials.push(row);await persist();
  const context=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900}}),page=await context.newPage(),controller=new AbortController();let addon,client,server;
  if(learning?.pageRef)learning.pageRef.page=page;
  const started=performance.now(),timer=setTimeout(()=>{row.timeout=true;controller.abort();},timeoutMs);
  row.dialogs=[];page.on('dialog',async dialog=>{row.dialogs.push({type:dialog.type(),message:dialog.message().slice(0,80)});await dialog.accept().catch(()=>{});});
  const allowed=url=>{try{const u=new URL(url);return u.protocol==='https:'&&task.origins.includes(u.origin);}catch{return false;}};
  await context.route('**/*',route=>{const request=route.request();if(request.isNavigationRequest()&&request.frame()===request.frame().page().mainFrame()&&!allowed(request.url()))return route.abort();return route.continue();});
  try{
   await page.goto(task.url,{waitUntil:'domcontentloaded',timeout:30000});
   server=await createConnection({timeouts:{action:5000,navigation:15000,settle:0},saveSession:false,snapshot:{mode:'none'},console:{level:'error'}},async()=>context);
   const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);client=new Client({name:'nubi-browser-quality',version:'1.0.0'});await client.connect(a);
   const {host,controls}=hostFixture();
   host.browser=createPlaywrightMcpPort({tabs:()=>[{tabId:'main',page,client}],
    // Public demo pages: a visible password or one-time-code field would make the page protected; none is expected.
    access:async()=>allowed(page.url())&&!await page.locator('input[type=password],input[autocomplete=one-time-code]').evaluateAll(xs=>xs.some(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0;}))?'ready':'forbidden',
    reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]}),
    verify:async(_ctx,checkpoint,candidate)=>{const result=await task.oracle(page,candidate?.answer).catch(error=>({success:false,detail:{error:error.message}}));(row.verifications??=[]).push({answer:String(candidate?.answer??'').slice(0,400),...result});// A satisfied criterion needs evidence refs or the module treats the completion as unproven (baseline 1, 2026-10-21).
    return {criteria:checkpoint.criteria.map(id=>({id,satisfied:result.success,evidenceRefs:result.success?['oracle:'+task.id+':ok']:[]}))};}});
   host.policy.decide=async({action})=>{if(action.tool==='browser_navigate')return allowed(action.arguments?.url)?'allow':'deny';if(['browser_file_upload','browser_pdf_save'].includes(action.tool))return 'deny';return 'allow';};
   const model={id:status.model,async complete(messages,tools,ctx){return provider.complete(messages,tools,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});}};
   addon=createBrowserAddon();const session=await addon.attach(host,{projectId:'public-quality'});
   const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},model,tabs:()=>[{tabId:'main'}],prepareContext:compactBrowserContext,...(learning?{memory:learning.memory}:{}),onMetric:metric=>{row.metrics.push(metric);
    if(metric.kind==='model_end'){row.modelCalls++;row.promptTokens+=metric.promptTokens||0;row.completionTokens+=metric.completionTokens||0;}
    if(metric.kind==='tool_end'){row.toolCalls++;if(metric.error){row.toolErrors++;row.errors.push({tool:metric.tool,error:metric.error});}}}});
   const preface=learning&&phase==='reuse'?'현재 요청에 맞는 검증된 절차가 있으면 그 절차와 이번 입력값을 지정하세요. 없거나 대상이 다르면 현재 관찰의 일반 도구로 진행하세요. ':'';
   const outcome=await runner.run({task:{taskId:randomUUID(),runId:randomUUID(),request:preface+task.request,criteria:['task-complete']},tabId:'main',signal:controller.signal,initialToolChoice:'required',...(learning&&phase==='reuse'?{preferVerifiedProcedure:true}:{})});
   row.state=outcome.state;row.answer=outcome.answer;row.error=outcome.error??null;
   row.receipts=outcome.checkpoint.receipts.map(r=>({tool:r.tool,status:r.status,effect:r.effect}));
   // What the agent left for a human: a question or a completion waiting for confirmation.
   row.pending=[...controls.present.values()].map(r=>({kind:r.kind,title:String(r.title??'').slice(0,200),text:String(r.text??r.question??r.answer??'').slice(0,400)}));
   row.oracle=await Promise.race([task.oracle(page,outcome.answer),new Promise(resolve=>setTimeout(()=>resolve({success:false,detail:{error:'oracle_timeout'}}),15000))]).catch(error=>({success:false,detail:{error:error.message}}));row.success=row.oracle.success;
  }catch(error){row.error=error.code??error.message;}
  finally{clearTimeout(timer);row.totalMs=Math.round(performance.now()-started);await addon?.detach().catch(()=>{});await client?.close().catch(()=>{});await server?.close().catch(()=>{});await context.close().catch(()=>{});await persist();
   console.log(JSON.stringify({task:task.id,phase,success:row.success,state:row.state,ms:row.totalMs,modelCalls:row.modelCalls,toolCalls:row.toolCalls,toolErrors:row.toolErrors,promptTokens:row.promptTokens,error:row.error,oracle:row.oracle?.detail}));}
  return row;
 };
 // Direct replay (teach plan T1, second measure): the reviewed card runs through the session's own observe and execute
 // with no model at all, the way a saved script in a workflow step would. Success is the page-state oracle.
 const directReplay=async(task,index,learning,card)=>{
  const row={index,taskId:task.id,title:task.title,phase:'direct',success:false,modelCalls:0,toolCalls:0,toolErrors:0,promptTokens:0,completionTokens:0,errors:[],receipts:[],metrics:[],totalMs:null};report.trials.push(row);await persist();
  const context=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900}}),page=await context.newPage(),controller=new AbortController();let addon,client,server;
  learning.pageRef.page=page;
  const started=performance.now(),timer=setTimeout(()=>{row.timeout=true;controller.abort();},timeoutMs);
  row.dialogs=[];page.on('dialog',async dialog=>{row.dialogs.push({type:dialog.type(),message:dialog.message().slice(0,80)});await dialog.accept().catch(()=>{});});
  const allowed=url=>{try{const u=new URL(url);return u.protocol==='https:'&&task.origins.includes(u.origin);}catch{return false;}};
  await context.route('**/*',route=>{const request=route.request();if(request.isNavigationRequest()&&request.frame()===request.frame().page().mainFrame()&&!allowed(request.url()))return route.abort();return route.continue();});
  try{
   await page.goto(task.url,{waitUntil:'domcontentloaded',timeout:30000});
   server=await createConnection({timeouts:{action:5000,navigation:15000,settle:0},saveSession:false,snapshot:{mode:'none'},console:{level:'error'}},async()=>context);
   const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);client=new Client({name:'nubi-browser-quality',version:'1.0.0'});await client.connect(a);
   const {host}=hostFixture();
   host.browser=createPlaywrightMcpPort({tabs:()=>[{tabId:'main',page,client}],access:async()=>allowed(page.url())?'ready':'forbidden',reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]}),verify:async(_ctx,checkpoint)=>{const result=await task.oracle(page,null).catch(()=>({success:false}));return {criteria:checkpoint.criteria.map(id=>({id,satisfied:result.success,evidenceRefs:result.success?['oracle:'+task.id+':ok']:[]}))};}});
   host.policy.decide=async()=>'allow';
   addon=createBrowserAddon();const session=await addon.attach(host,{projectId:'public-quality'});
   const open={taskId:randomUUID(),runId:randomUUID(),request:task.request,criteria:['task-complete']};await session.openTask(open);
   let current=null;
   const observe=async settings=>{for(let attempt=0;;attempt++){try{current=await session.observe(open.taskId,'main',settings??{mode:'structure'});return current;}catch(error){if(attempt>=2||!['observation_changed','frame_changed'].includes(error?.code??error?.message))throw error;}}};
   const catalogVersion=session.catalog().version;
   const api={observe,act:async(tool,values)=>{if(!current)throw Error('procedure_observation_required');row.toolCalls++;const outcome=await session.execute(open.taskId,{actionId:randomUUID(),tool,arguments:values,binding:structuredClone(current.binding),observationId:current.observationId,catalogVersion});current=null;return outcome;}};
   await observe({mode:'structure'});
   const values=Object.fromEntries((card.inputs??[]).map((input,i)=>[input.slot,(task.slotValues??[])[i]??'']));
   const result=await learning.memory.run({id:card.id,version:card.version,values},{projectId:'public-quality',task:open,observation:current,signal:controller.signal},api);
   row.replay={stopped:result?.stopped??null,error:result?.error??null,confirmedSteps:result?.confirmedSteps??result?.confirmedIndices??null,operations:result?.operations??null};
   row.oracle=await task.oracle(page,null).catch(error=>({success:false,detail:{error:error.message}}));row.success=row.oracle.success;
  }catch(error){row.error=error.code??error.message;}
  finally{clearTimeout(timer);row.totalMs=Math.round(performance.now()-started);await addon?.detach().catch(()=>{});await client?.close().catch(()=>{});await server?.close().catch(()=>{});await context.close().catch(()=>{});await persist();
   console.log(JSON.stringify({task:task.id,phase:'direct',success:row.success,ms:row.totalMs,toolCalls:row.toolCalls,error:row.error,replay:row.replay,oracle:row.oracle?.detail}));}
  return row;
 };
 // Demonstration arm (teach plan T3): a scripted person performs the task while the recorder listens; the card it
 // yields is adopted as reviewed and replayed directly with no model.
 const demonstrate=async(task,index)=>{
  const row={index,taskId:task.id,title:task.title,phase:'demo',success:false,events:0,steps:0,error:null,totalMs:null};report.trials.push(row);
  const context=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900}}),page=await context.newPage();const started=performance.now();
  try{
   const recorder=await createDemonstration({page,recorder:{recordStep,recordTarget},allowUrl:url=>{try{return task.origins.includes(new URL(url).origin);}catch{return false;}}});
   await page.goto(task.url,{waitUntil:'domcontentloaded',timeout:30000});
   recorder.start();await task.demo(page);await page.waitForTimeout(300);const events=recorder.stop();
   row.events=events.length;const card=recorder.card({id:'demo-'+task.id,title:task.title,wikiRef:{id:'evaluation-wiki',version:1}});
   row.steps=card?.steps.length??0;row.inputs=card?.inputs.length??0;row.success=!!card;row.card=card;
  }catch(error){row.error=error.code??error.message;}
  finally{row.totalMs=Math.round(performance.now()-started);await context.close().catch(()=>{});await persist();console.log(JSON.stringify({task:task.id,phase:'demo',card:!!row.card,events:row.events,steps:row.steps,inputs:row.inputs,error:row.error}));}
  return row;
 };
 for(let index=1;index<=repeat;index++)for(const task of selected){
  if(demo){
   if(typeof task.demo!=='function'){console.log(JSON.stringify({task:task.id,phase:'demo',skipped:true}));continue;}
   const shown=await demonstrate(task,index);if(!shown.card)continue;
   const pageRef={page:null};const learning=createProcedureHost({page:()=>pageRef.page,origin:task.origins[0],allowedOrigins:task.origins,projectId:'public-quality',title:task.title,qualification:true});
   Object.assign(learning,{pageRef});const reviewed=learning.adopt(shown.card);
   const direct=await directReplay(task,index,learning,reviewed);
   console.log(JSON.stringify({task:task.id,phase:'demo-direct',success:direct.success,ms:direct.totalMs,steps:reviewed.steps.length}));
   continue;
  }
  if(!teach){await trial(task,index,'single',null);continue;}
  // Teach arm: learn with the model, review the one draft, then reuse without it.
  const pageRef={page:null};
  const learning=createProcedureHost({page:()=>pageRef.page,origin:task.origins[0],allowedOrigins:task.origins,projectId:'public-quality',title:task.title,qualification:true});
  const learned=await trial(task,index,'learn',Object.assign(learning,{pageRef}));
  learned.drafts=learning.drafts.length;learned.captureErrors=learning.captureErrors;
  if(!learned.success||learning.drafts.length!==1){console.log(JSON.stringify({task:task.id,phase:'teach',skipped:true,reason:!learned.success?'learn_failed':'drafts_'+learning.drafts.length,captureErrors:learning.captureErrors.slice(0,3),captures:learning.captureCount,lastCandidate:learning.lastCandidate?JSON.stringify(learning.lastCandidate).slice(0,900):null}));continue;}
  learned.card=learning.review();
  const reused=await trial(task,index,'reuse',Object.assign(learning,{pageRef}));
  const direct=await directReplay(task,index,learning,learned.card);
  console.log(JSON.stringify({task:task.id,phase:'teach',reuseSuccess:reused.success,reuseModelCalls:reused.modelCalls,reuseMs:reused.totalMs,directSuccess:direct.success,directMs:direct.totalMs,cardSteps:learned.card.steps.length,inputs:learned.card.inputs?.length??0}));
 }
 const finished=report.trials.filter(r=>Number.isFinite(r.totalMs));
 report.summary={trials:report.trials.length,successes:report.trials.filter(r=>r.success).length,medianMs:finished.map(r=>r.totalMs).sort((a,b)=>a-b)[Math.floor(finished.length/2)]??null,modelCalls:report.trials.reduce((s,r)=>s+r.modelCalls,0),toolCalls:report.trials.reduce((s,r)=>s+r.toolCalls,0),toolErrors:report.trials.reduce((s,r)=>s+r.toolErrors,0),promptTokens:report.trials.reduce((s,r)=>s+r.promptTokens,0)};
 report.finishedAt=new Date().toISOString();console.log('summary',JSON.stringify(report.summary));
}finally{provider.disconnect?.();await browser?.close();await persist();}
