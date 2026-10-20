// Browser quality scorecard (2026-10-21): the real browser module, the real Claude CLI host and a real headless Chrome
// on public demo pages. One row per task and repetition: success by code oracle, time, model and tool calls, tokens,
// tool errors, receipts. Mirrors the wiring of scripts/naver-transfer-live.mjs without site memory.
// Usage: node eval/quality/run.mjs --out <dir> [--only id,id] [--repeat 1] [--timeout-s 180] [--headed]
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
import {tasks} from './tasks.mjs';

const option=name=>{const at=process.argv.indexOf('--'+name);return at>=0?process.argv[at+1]:undefined;};
const flag=name=>process.argv.includes('--'+name);
const out=option('out')&&resolve(option('out'));if(!out){console.error('사용법: node eval/quality/run.mjs --out <dir> [--only id,id] [--repeat N] [--timeout-s S] [--headed]');process.exit(2);}
const only=option('only')?.split(',').filter(Boolean),repeat=Number(option('repeat')||1),timeoutMs=Number(option('timeout-s')||180)*1000;
const selected=tasks.filter(task=>!only||only.includes(task.id));
await mkdir(out,{recursive:true});
const report={schemaVersion:1,startedAt:new Date().toISOString(),actualModel:true,actualBrowser:true,publicSitesOnly:true,trials:[]};
const persist=()=>writeFile(resolve(out,'report.json'),JSON.stringify(report,null,1));
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});let browser;
try{
 const status=await provider.connect();report.model=status.model;report.effort=status.reasoningEffort;
 browser=await chromium.launch({channel:'chrome',headless:!flag('headed')});report.browserVersion=browser.version();
 for(let index=1;index<=repeat;index++)for(const task of selected){
  const row={index,taskId:task.id,title:task.title,success:false,state:null,answer:null,oracle:null,totalMs:null,modelCalls:0,toolCalls:0,toolErrors:0,promptTokens:0,completionTokens:0,errors:[],receipts:[],metrics:[]};report.trials.push(row);await persist();
  const context=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900}}),page=await context.newPage(),controller=new AbortController();let addon,client,server;
  const started=performance.now(),timer=setTimeout(()=>{row.timeout=true;controller.abort();},timeoutMs);
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
   const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},model,tabs:()=>[{tabId:'main'}],prepareContext:compactBrowserContext,onMetric:metric=>{row.metrics.push(metric);
    if(metric.kind==='model_end'){row.modelCalls++;row.promptTokens+=metric.promptTokens||0;row.completionTokens+=metric.completionTokens||0;}
    if(metric.kind==='tool_end'){row.toolCalls++;if(metric.error){row.toolErrors++;row.errors.push({tool:metric.tool,error:metric.error});}}}});
   const outcome=await runner.run({task:{taskId:randomUUID(),runId:randomUUID(),request:task.request,criteria:['task-complete']},tabId:'main',signal:controller.signal,initialToolChoice:'required'});
   row.state=outcome.state;row.answer=outcome.answer;row.error=outcome.error??null;
   row.receipts=outcome.checkpoint.receipts.map(r=>({tool:r.tool,status:r.status,effect:r.effect}));
   // What the agent left for a human: a question or a completion waiting for confirmation.
   row.pending=[...controls.present.values()].map(r=>({kind:r.kind,title:String(r.title??'').slice(0,200),text:String(r.text??r.question??r.answer??'').slice(0,400)}));
   row.oracle=await task.oracle(page,outcome.answer).catch(error=>({success:false,detail:{error:error.message}}));row.success=row.oracle.success;
  }catch(error){row.error=error.code??error.message;}
  finally{clearTimeout(timer);row.totalMs=Math.round(performance.now()-started);await addon?.detach().catch(()=>{});await client?.close().catch(()=>{});await server?.close().catch(()=>{});await context.close().catch(()=>{});await persist();
   console.log(JSON.stringify({task:task.id,success:row.success,state:row.state,ms:row.totalMs,modelCalls:row.modelCalls,toolCalls:row.toolCalls,toolErrors:row.toolErrors,promptTokens:row.promptTokens,error:row.error,oracle:row.oracle?.detail}));}
 }
 const finished=report.trials.filter(r=>Number.isFinite(r.totalMs));
 report.summary={trials:report.trials.length,successes:report.trials.filter(r=>r.success).length,medianMs:finished.map(r=>r.totalMs).sort((a,b)=>a-b)[Math.floor(finished.length/2)]??null,modelCalls:report.trials.reduce((s,r)=>s+r.modelCalls,0),toolCalls:report.trials.reduce((s,r)=>s+r.toolCalls,0),toolErrors:report.trials.reduce((s,r)=>s+r.toolErrors,0),promptTokens:report.trials.reduce((s,r)=>s+r.promptTokens,0)};
 report.finishedAt=new Date().toISOString();console.log('summary',JSON.stringify(report.summary));
}finally{provider.disconnect?.();await browser?.close();await persist();}
