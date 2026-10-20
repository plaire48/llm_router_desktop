import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../extensions/aipro-chat/agent-runtime.js';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {createBrowserAddon} from '../dist/index.js';
import {createPiBrowserRunner} from '../dist/pi.js';
import {createPlaywrightMcpPort} from '../dist/playwright.js';
import {hostFixture} from '../tests/host.mjs';
import {startLegacySite} from '../evaluation/legacy-site.mjs';
import {createProcedureHost} from '../evaluation/procedure-host.mjs';

const output=process.argv[2],recoveryGate=process.argv[3]==='recovery-gate',reuseOnly=recoveryGate||process.argv[3]==='reuse-only',inputSet=process.argv[4]??'oct16';if(!output)throw Error('report_path_required');
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});
const report={schemaVersion:1,inputSet,mode:'learned_procedure_development_comparison',startedAt:new Date().toISOString(),actualModel:true,actualBrowser:true,workspaceIntegrated:false,companySSO:false,realMail:false,trials:[],limitations:['One local development task; no held-out task or general quality/speed claim.','Same browser/Page and model/effort. Each trial reloads DOM and resets independent server state. Browser and CLI process startup are separate.','Learning creates only a draft. Evaluation host explicitly reviews the synthetic artifact; this is not production automatic promotion.','Paired no-memory/reuse trials use identical new inputs, alternating order. No retries or failures are excluded.','Existing Pi and replay engine execute host proposals; this is not a direct Codex/Claude product comparison.']};
const persist=async()=>{await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');};
if(reuseOnly){report.mode=recoveryGate?'reopen_and_screen_change_gate':'learned_procedure_reuse_gate';report.limitations[3]='Reuse gate only; earlier paired development baseline is a separate report, not a same-revision causal comparison.';}
report.hashes=Object.fromEntries(await Promise.all(['../scripts/memory-live.mjs','../dist/pi.js','../dist/memory.js','../dist/replay-memory.js','../dist/playwright.js','../src/pi.ts','../src/memory.ts','../src/replay-memory.ts','../src/playwright.ts','../evaluation/procedure-host.mjs','../evaluation/legacy-site.mjs','../../../extensions/aipro-chat/browser-replay.js','../../../extensions/aipro-chat/agent-runtime.js','../../nubi-desktop/runtime/claude-code.mjs'].map(async file=>[file,createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex')])));
let browser,site,context,client,server;
try{
  const at=performance.now(),status=await provider.connect();report.connectionMs=performance.now()-at;report.modelId=status.model;report.effort=status.reasoningEffort;report.node=process.version;
  browser=await chromium.launch({headless:true,channel:'chrome'});report.browserVersion=browser.version();site=await startLegacySite();context=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900}});const page=await context.newPage();
  server=await createConnection({timeouts:{action:5000,navigation:15000,settle:0},saveSession:false,snapshot:{mode:'none'},console:{level:'error'}},async()=>context);
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);client=new Client({name:'nubi-procedure-live',version:'0.4.0'});await client.connect(a);
  const learning=createProcedureHost({page,origin:site.origin});
  async function trial(kind,index,recipient,body,{memory=false,changed=false}={}){
    const row={kind,index,recipient,body,success:false,metrics:[],decisions:[],procedureFeedback:[]};report.trials.push(row);await persist();
    site.reset({changed});const setup=performance.now();await page.goto(site.origin);await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('[contenteditable=true]').waitFor();row.setupMs=performance.now()-setup;
    const {host}=hostFixture();host.browser=createPlaywrightMcpPort({tabs:()=>[{tabId:'tab',page,client}],access:async()=>new URL(page.url()).origin===site.origin?'ready':'forbidden',reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]}),verify:async(_ctx,cp,candidate)=>({criteria:cp.criteria.map(id=>({id,satisfied:site.snapshot()?.recipient===recipient&&site.snapshot()?.body===body&&page.url()===site.origin+'/saved'&&site.saveCount()===1&&candidate?.answer.includes(recipient)&&candidate?.answer.includes(body),evidenceRefs:['evaluation:server-and-reopen']}))})});
    const addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'memory-evaluation'}),controller=new AbortController();const timer=setTimeout(()=>{row.budgetExceeded=true;controller.abort();},180000);
    try{
      const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},...(memory?{memory:learning.memory}:{}),tabs:()=>[{tabId:'tab'}],onMetric:event=>{row.metrics.push(event);if(event.kind==='model_end'||event.kind==='run_end')console.log(JSON.stringify({kind,index,event:event.kind,ms:event.elapsedMs,state:event.state,error:event.error}));},model:{id:status.model,complete:async(messages,tools,ctx)=>{
        for(const message of messages.filter(m=>m.role==='tool')){try{const value=JSON.parse(message.content);if(value.procedureId||value.error){const feedback={procedureId:value.procedureId,error:value.error,cause:value.cause,stopped:value.stopped,operations:value.operations,confirmedIndices:value.confirmedSteps?.map(s=>s.index),recovery:!!value.recovery};if(!row.procedureFeedback.some(x=>JSON.stringify(x)===JSON.stringify(feedback)))row.procedureFeedback.push(feedback);}}catch{}}
        const result=await provider.complete(messages,tools,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});
        row.decisions.push({tools:(result.calls??[]).map(x=>x.function.name),transport:result.proposalTransport});return result;
      }}});
      const result=await runner.run({task:{taskId:kind+'-'+index,runId:crypto.randomUUID(),request:`업무 화면에서 수신자 주소에 ${recipient}, 본문에 "${body}"를 입력하고 저장하세요. 저장된 내용 보기로 다시 열어서 실제 저장 값을 확인한 뒤 수신자와 본문을 간단히 알려 주세요. 실제 메일 발송은 하지 않습니다.`,criteria:['saved-and-reopened']},tabId:'tab',signal:controller.signal});
      row.state=result.state;row.error=result.error;row.answer=result.answer;row.pending=result.checkpoint.pending;row.success=result.state==='COMPLETED';row.receipts=result.checkpoint.receipts.map(x=>({tool:x.tool,status:x.status}));
      row.runMs=row.metrics.findLast(x=>x.kind==='run_end')?.elapsedMs;row.totalMs=row.setupMs+row.runMs;row.modelCalls=row.metrics.filter(x=>x.kind==='model_end').length;row.modelMs=row.metrics.filter(x=>x.kind==='model_end').reduce((sum,x)=>sum+x.elapsedMs,0);row.stored=site.snapshot();row.saveCount=site.saveCount();
    }finally{clearTimeout(timer);await addon.detach();await persist();}
    console.log(JSON.stringify({kind,index,success:row.success,totalMs:row.totalMs,modelCalls:row.modelCalls}));return row;
  }
  const trained=await trial('first-learning',0,'training@example.invalid','최초 학습용 보안 검토',{memory:true});
  report.draftCount=learning.drafts.length;
  if(!trained.success||learning.drafts.length!==1)throw Error('learning_failed');
  report.reviewedArtifact=learning.review();await persist();
  for(let i=1;i<=3;i++){
    const recipient=recoveryGate?`reopen-r${i}-${inputSet}@example.invalid`:`operator-${i}@example.invalid`,body=recoveryGate?`재열기 ${inputSet} ${i}차 신규 요청 검토 일정 확인`:`반복 검증 ${i}차 작업 전 담당자 확인`;
    const pair=reuseOnly?['reuse']:i%2===1?['reuse','no-memory']:['no-memory','reuse'];
    for(const kind of pair)await trial(kind,i,recipient,body,{memory:kind==='reuse'});
  }
  for(let i=1;i<=(recoveryGate?3:1);i++)await trial('changed-screen',i,recoveryGate?`recovery-r${i}-${inputSet}@example.invalid`:'changed@example.invalid',recoveryGate?`화면 변경 ${inputSet} ${i}차 신규 요청 담당자 확인`:'화면 변경 뒤 새 내용 확인',{memory:true,changed:true});
  const reuse=report.trials.filter(x=>x.kind==='reuse');const gate=rows=>({required:3,completed:rows.filter(x=>x.success).length,allUnder25Seconds:rows.length===3&&rows.every(x=>x.success&&x.totalMs<=25000)});report.reuseGate=gate(reuse);report.recoveryGate=gate(report.trials.filter(x=>x.kind==='changed-screen'));report.combinedGate=report.reuseGate.allUnder25Seconds&&report.recoveryGate.allUnder25Seconds;
}catch(error){report.error=error.message;console.log(JSON.stringify({error:report.error}));process.exitCode=1;}
finally{provider.disconnect();await client?.close();await server?.close();await context?.close();await browser?.close();await site?.close();report.finishedAt=new Date().toISOString();await persist();}
console.log(JSON.stringify({gate:report.reuseGate,recoveryGate:report.recoveryGate,combinedGate:report.combinedGate,trials:report.trials.map(x=>({kind:x.kind,index:x.index,state:x.state,totalMs:x.totalMs,modelCalls:x.modelCalls}))}));
