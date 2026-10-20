import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../extensions/aipro-chat/agent-runtime.js';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {createBrowserAddon} from '../dist/index.js';
import {createPlaywrightMcpPort} from '../dist/playwright.js';
import {createPiBrowserRunner} from '../dist/pi.js';
import {hostFixture} from '../tests/host.mjs';
import {startLegacySite} from '../evaluation/legacy-site.mjs';

// Development evaluation host only. No company account, persistent profile or mail send.
const output=process.argv[2],selected=(process.argv[3]??'legacy,google,naver').split(',');
if(!output||selected.some(x=>!['legacy','google','naver'].includes(x)))throw Error('usage: pi-live.mjs /absolute/report.json [legacy,google,naver]');
const report={schemaVersion:1,mode:'pi_claude_live_development',startedAt:new Date().toISOString(),actualModel:true,actualBrowser:true,workspaceIntegrated:false,companySSO:false,realMail:false,node:process.version,platform:process.platform,trials:[],limitations:['Development cases, one trial per selected case, not a general success rate or before/after comparison.','Claude CLI proposes actions only; existing Nubi Pi owns the loop. This is not a direct Claude Code browser-agent comparison.','Fresh temporary Chrome context; no credentials, cookies, account profiles, mail or private company data.','Trial budget 180 seconds including initial browser observation and model turns. Setup and CLI discovery are separate.','Memory checkpoint store is an evaluation host, not production durability.']};
const persist=async()=>{await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');};
const hash=async path=>createHash('sha256').update(await readFile(new URL(path,import.meta.url))).digest('hex');
report.sourceHashes=Object.fromEntries(await Promise.all(['../src/pi.ts','../src/lifecycle.ts','../src/playwright.ts','../../../extensions/aipro-chat/agent-runtime.js','../../nubi-desktop/runtime/claude-code.mjs'].map(async path=>[path,await hash(path)])));
// Disable optional background model metadata lookup; official CLI remains authentication owner.
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});let browser;
const searchSelector='input[type=search],input[aria-label*="검색"],input[title*="검색"],input[placeholder*="검색"],textarea[title*="검색"],textarea[aria-label*="검색"],input[aria-label*="Search"],textarea[title*="Search"]';
const hasSearch=page=>page.locator(searchSelector).evaluateAll(xs=>xs.some(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden';}));
try{
  const connectedAt=performance.now(),status=await provider.connect();report.connectionMs=performance.now()-connectedAt;
  const modelId=status.model;report.modelId=modelId;report.effort=status.reasoningEffort;
  console.log(JSON.stringify({event:'connected',modelId,connectionMs:report.connectionMs}));await persist();
  const launchAt=performance.now();browser=await chromium.launch({channel:process.env.NUBI_TEST_BROWSER_CHANNEL??'chrome',headless:true});report.browserLaunchMs=performance.now()-launchAt;report.browserVersion=browser.version();
  for(const name of selected){
    const row={name,success:false,metrics:[],startedAt:new Date().toISOString()};report.trials.push(row);await persist();
    let site,context,client,server,addon,timer;
    try{
      const setupAt=performance.now();if(name==='legacy')site=await startLegacySite();
      context=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900}});const page=await context.newPage();
      const origin=site?.origin??(name==='google'?'https://www.google.com':'https://www.naver.com');
      await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
      if(site)await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('[contenteditable=true]').waitFor();
      else await page.locator(searchSelector).first().waitFor({timeout:15000});
      server=await createConnection({timeouts:{action:5000,navigation:15000,settle:0},saveSession:false,codegen:'none',snapshot:{mode:'none'},console:{level:'error'}},async()=>context);
      const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);client=new Client({name:'nubi-pi-live-evaluation',version:'0.3.0'});await client.connect(a);
      const {host}=hostFixture();
      // Only synthetic local edits are authorized. Public portal trials are read-only.
      host.policy.decide=async()=>site?'allow':'deny';
      host.browser=createPlaywrightMcpPort({tabs:()=>[{tabId:'trial-tab',page,client}],
        access:async()=>{
          if(site)return new URL(page.url()).origin===site.origin?'ready':'forbidden';
          const url=new URL(page.url());
          const visiblePassword=await page.locator('input[type=password],input[autocomplete=one-time-code]').evaluateAll(xs=>xs.some(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}));
          const authSurface=/^(accounts\.google\.com|nid\.naver\.com)$/.test(url.hostname);
          if(visiblePassword||authSurface)return 'login_required';
          // Access success includes both expected service and an accessible search surface.
          if(![new URL(origin).hostname,'www.google.co.kr'].includes(url.hostname))return 'forbidden';
          return await hasSearch(page)?'ready':'forbidden';
        },
        verify:async(_ctx,checkpoint,candidate)=>{
          let satisfied=false;
          if(site){const state=site.snapshot();satisfied=state?.recipient==='ops@example.invalid'&&state?.body==='변경 작업 전 보안팀 확인'&&new URL(page.url()).pathname==='/saved'&&(await page.locator('body').innerText()).includes(state.body)&&candidate?.answer.includes(state.recipient)&&candidate?.answer.includes(state.body);}
          else{const body=await page.locator('body').innerText(),title=await page.title();const service=name==='google'?'Google':'NAVER';satisfied=(title.toLowerCase().includes(name)||body.toLowerCase().includes(name))&&await hasSearch(page)&&candidate?.answer.toLowerCase().includes(service.toLowerCase())&&/검색|search/i.test(candidate?.answer??'');}
          return {criteria:checkpoint.criteria.map(id=>({id,satisfied:!!satisfied,evidenceRefs:satisfied?['evaluation:independent-readback']:[]}))};
        },reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]})});
      addon=createBrowserAddon();const session=await addon.attach(host,{projectId:'pi-live-'+name});row.setupMs=performance.now()-setupAt;
      const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},model:{id:modelId,complete:async(messages,tools,ctx)=>{
        const feedback=messages.filter(x=>x.role==='tool').flatMap(x=>{try{const value=JSON.parse(x.content);return value.error?[{error:value.error,issues:value.issues}]:[];}catch{return [];}});
        const result=await provider.complete(messages,tools,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>ctx.onEvent({type:'activity'}),{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});
        const proposals=(result.calls??[]).map(x=>{let keys=[];try{keys=Object.keys(JSON.parse(x.function.arguments));}catch{}return {name:x.function.name,keys};});
        (row.decisions??=[]).push({feedback,proposals,transport:result.proposalTransport});console.log(JSON.stringify({trial:name,feedback,proposals,transport:result.proposalTransport}));return result;
      }},tabs:()=>[{tabId:'trial-tab',label:name}],onMetric:event=>{
        row.metrics.push(event);if(event.kind.endsWith('_end'))console.log(JSON.stringify({trial:name,kind:event.kind,tool:event.tool,elapsedMs:event.elapsedMs,state:event.state,error:event.error}));
        // Reports contain event metadata only; no page snapshots, model prompts or tool arguments.
      }});
      const controller=new AbortController();timer=setTimeout(()=>{row.budgetExceeded=true;controller.abort();},180000);
      const result=await runner.run({task:{taskId:name+'-trial',runId:crypto.randomUUID(),request:site?'업무 화면에서 수신자 주소에 ops@example.invalid, 본문에 "변경 작업 전 보안팀 확인"을 입력하고 저장하세요. 저장된 내용 보기로 다시 열어서 실제 저장 값을 확인한 뒤 수신자와 본문을 간단히 알려 주세요. 실제 메일 발송은 하지 않습니다.':`${name==='google'?'Google':'NAVER'} 공개 홈에서 검색 입력 화면을 읽고, 어떤 서비스인지와 검색 기능이 있는지 한국어로 간단히 알려 주세요. 링크 클릭이나 입력, 로그인은 하지 마세요.`,criteria:[site?'saved-and-reopened':'public-home-read']},tabId:'trial-tab',signal:controller.signal});
      clearTimeout(timer);row.state=result.state;row.error=result.error;row.success=result.state==='COMPLETED';row.answer=result.answer;row.pending=result.checkpoint.pending;
      row.modelCalls=row.metrics.filter(x=>x.kind==='model_end').length;row.modelMs=row.metrics.filter(x=>x.kind==='model_end').reduce((sum,x)=>sum+x.elapsedMs,0);row.toolMs=row.metrics.filter(x=>x.kind==='tool_end').reduce((sum,x)=>sum+x.elapsedMs,0);row.totalMs=row.metrics.findLast(x=>x.kind==='run_end')?.elapsedMs;row.firstEvidenceMs=row.metrics.findLast(x=>x.kind==='run_end')?.firstEvidenceMs;
      row.navigationSetupAndRunMs=row.setupMs+row.totalMs;
      row.actions=result.checkpoint.receipts.map(x=>({tool:x.tool,status:x.status}));row.resolvedModel=provider.status().models.find(x=>x.id===modelId)?.resolvedModel??null;
      if(site)row.independentStoredValue=site.snapshot();
    }catch(error){row.error=typeof error.code==='string'?error.code:'trial_failed';row.errorClass=error.name;console.log(JSON.stringify({trial:name,error:row.error,errorClass:row.errorClass}));}
    finally{clearTimeout(timer);await addon?.detach().catch(()=>{});await client?.close().catch(()=>{});await server?.close().catch(()=>{});await context?.close().catch(()=>{});await site?.close().catch(()=>{});await persist();}
    console.log(JSON.stringify({trial:name,success:row.success,state:row.state,totalMs:row.totalMs,modelCalls:row.modelCalls}));
  }
}finally{provider.disconnect();await browser?.close();report.finishedAt=new Date().toISOString();await persist();}
console.log(JSON.stringify({successes:report.trials.filter(x=>x.success).length,total:report.trials.length,report:fileURLToPath(new URL('file://'+output))}));
if(report.trials.some(x=>!x.success))process.exitCode=1;
