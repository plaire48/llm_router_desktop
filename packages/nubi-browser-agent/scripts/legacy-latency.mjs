import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createBrowserAddon} from '../dist/index.js';
import {createPlaywrightMcpPort} from '../dist/playwright.js';
import {hostFixture} from '../tests/host.mjs';
import {startLegacySite} from '../evaluation/legacy-site.mjs';

const launch=performance.now(),browser=await chromium.launch({headless:true,channel:process.env.NUBI_TEST_BROWSER_CHANNEL??'chrome'}),browserLaunchMs=performance.now()-launch;
const runs=[];
try{
  for(let index=0;index<11;index++){
    const started=performance.now(),stages={},row={index,success:false,stages};runs.push(row);
    let site,context,client,server,addon;
    const timed=async(name,fn)=>{const t=performance.now();try{return await fn();}finally{stages[name]=performance.now()-t;}};
    try{
      let page;
      await timed('setup',async()=>{
        site=await startLegacySite();context=await browser.newContext();page=await context.newPage();await page.goto(site.origin);
        await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('[contenteditable=true]').waitFor();
        server=await createConnection({timeouts:{action:2000,navigation:3000,settle:0},saveSession:false,codegen:'none',snapshot:{mode:'none'},console:{level:'error'}},async()=>context);
        const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);client=new Client({name:'nubi-latency-fixture',version:'0.2.0'});await client.connect(a);
      });
      const {host}=hostFixture();host.browser=createPlaywrightMcpPort({tabs:()=>[{tabId:'trial-tab',page,client}],access:async()=> 'ready',reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]}),verify:async(_ctx,checkpoint)=>({criteria:checkpoint.criteria.map(id=>({id,satisfied:site.snapshot()?.recipient==='ops@example.invalid'&&site.snapshot()?.body==='변경 작업 전 보안팀 확인',evidenceRefs:site.snapshot()?['fixture:readback']:[]}))})});
      addon=createBrowserAddon();
      const session=await timed('attach',()=>addon.attach(host,{projectId:'latency-trial'}));
      await timed('open',()=>session.openTask({taskId:'task',runId:'run',request:'관찰한 입력칸과 편집기에 입력하고 저장을 확인한다',criteria:['persisted']}));
      await timed('accessibility',()=>session.observe('task','trial-tab'));
      let observed=await timed('structure',()=>session.observe('task','trial-tab',{mode:'structure'}));
      const act=async(stage,tool,targetId,text)=>{
        const result=await timed(stage,()=>session.execute('task',{actionId:stage,tool,arguments:{targetId,...(text!==undefined?{text}:{})},binding:observed.binding,observationId:observed.observationId,catalogVersion:session.catalog().version}));
        if(result.receipt.status!=='confirmed')throw Error('dispatch_not_confirmed');if(result.observation)observed=result.observation;return result;
      };
      const recipient=observed.data.candidates.find(x=>x.tag==='input'&&x.context.includes('수신자 주소'));if(!recipient)throw Error('recipient_not_observed');
      await act('fillRecipient','browser_type',recipient.targetId,'ops@example.invalid');
      const body=observed.data.candidates.find(x=>x.tag==='div'&&x.editable);if(!body)throw Error('editor_not_observed');
      await act('fillEditor','browser_type',body.targetId,'변경 작업 전 보안팀 확인');
      const save=observed.data.candidates.find(x=>x.name==='저장');if(!save)throw Error('save_not_observed');
      const persisted=page.waitForResponse(r=>r.url()===site.origin+'/save'&&r.request().method()==='POST',{timeout:3000});
      await act('save','browser_click',save.targetId);
      await timed('readbackAndVerify',async()=>{await persisted;await page.goto(site.origin+'/saved');if(!(await page.locator('body').innerText()).includes('변경 작업 전 보안팀 확인'))throw Error('reopen_failed');if(!(await session.complete('task')).completed)throw Error('oracle_failed');});
      await timed('detach',()=>addon.detach());row.success=true;row.explicitObservations=2;row.actions=3;
    }catch(error){row.error=error.code??error.message;}
    finally{row.totalMs=performance.now()-started;await addon?.detach().catch(()=>{});await client?.close().catch(()=>{});await server?.close().catch(()=>{});await context?.close().catch(()=>{});await site?.close().catch(()=>{});}
  }
}finally{await browser.close();}
const quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const warm=runs.slice(1),summary=values=>({p50:quantile(values,.5),p95:quantile(values,.95),max:Math.max(...values)});
const report={schemaVersion:1,mode:'local_legacy_browser_development_fixture',actualBrowser:true,actualModel:false,companySSO:false,realMailSend:false,workspaceIntegrated:false,unit:'milliseconds',browserLaunchMs,processFirstTrial:runs[0],warmBrowserProcess:{runs:warm.length,successes:warm.filter(x=>x.success).length,total:summary(warm.map(x=>x.totalMs)),stages:Object.fromEntries(Object.keys(warm[0].stages).map(key=>[key,summary(warm.map(x=>x.stages[key]).filter(x=>x!==undefined))]))},trials:runs,node:process.version,platform:process.platform,limitations:['Small development sample; not a held-out or LLM performance comparison.','Every trial uses a fresh synthetic server and browser context; only the browser and Node processes are warm.','Total includes setup/readiness, MCP connection, core, structural fallback actions, readback and detach. Browser launch is separate; Node startup/import and final context/server cleanup are excluded.','Memory checkpoint store and local HTTP fixture; no real company network, SSO, Windows or semantic model judgement.','MCP fixture settle=0; browser actionability waits remain. This is not a production timing configuration.','No baseline/change comparison; these numbers do not establish an improvement.']};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({successes:runs.filter(x=>x.success).length,total:runs.length,warm:report.warmBrowserProcess.total,failed:runs.filter(x=>!x.success)},null,2));
if(runs.some(x=>!x.success))process.exitCode=1;
