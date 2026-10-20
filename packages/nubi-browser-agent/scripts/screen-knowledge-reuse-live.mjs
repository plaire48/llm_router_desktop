import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../extensions/aipro-chat/agent-runtime.js';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {createBrowserAddon} from '../dist/index.js';
import {createPiBrowserRunner} from '../dist/pi.js';
import {createPlaywrightMcpPort} from '../dist/playwright.js';
import {createScreenKnowledge,createModelScreenAnalyzer} from '../dist/knowledge.js';
import {createPlaywrightScreenSource} from '../dist/knowledge-playwright.js';
import {createWikiScreenStore} from '../dist/knowledge-wiki.js';
import {fileWikiDocuments} from '../evaluation/wiki-document-host.mjs';
import {stagehandBrowserHost} from '../evaluation/stagehand-browser-host.mjs';
import {startScreenKnowledgeSite} from '../evaluation/screen-knowledge-site.mjs';
import {hostFixture} from '../tests/host.mjs';

const output=process.argv[2],training=process.argv[3];if(!output||!training)throw Error('report_and_training_paths_required');
const report={schemaVersion:1,startedAt:new Date().toISOString(),actualModel:true,actualBrowser:true,actualPi:true,workspaceIntegrated:false,trials:[],limits:['Synthetic new-input task, not public/company speed or general quality.','Training wiki must exist on disk from the separate Stagehand comparison. No initial analyzer is run here.','Pi owns all action turns and host verifies the new input readback and answer.']};
report.contract='json-answer-v2';report.trainingReportHash=createHash('sha256').update(await readFile(training)).digest('hex');
report.hashes=Object.fromEntries(await Promise.all(['../src/knowledge.ts','../src/knowledge-wiki.ts','../src/knowledge-playwright.ts','../src/knowledge-files.ts','../src/pi.ts','../scripts/screen-knowledge-reuse-live.mjs'].map(async name=>[name,createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex')])));
await mkdir(dirname(output),{recursive:true});const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});let browser,site,client,server,controller=new AbortController();
try{
 const status=await provider.connect();report.model=status.model;report.effort=status.reasoningEffort;
 const dummy={id:status.model,complete:async()=>{throw Error('analysis_must_not_run_during_reuse');}};
 browser=await stagehandBrowserHost(dummy,()=>controller.signal);site=await startScreenKnowledgeSite();const page=browser.page;
 server=await createConnection({timeouts:{action:5000,navigation:10000,settle:0},saveSession:false,snapshot:{mode:'none'},console:{level:'error'}},async()=>browser.context);
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);client=new Client({name:'nubi-screen-reuse-evaluation',version:'0.5.0'});await client.connect(a);
 for(let index=1;index<=(process.argv[4]==='probe'?1:3);index++)for(const withWiki of process.argv[4]==='probe'?[true]:index%2?[true,false]:[false,true]){
  const row={index,withWiki,success:false,metrics:[],modelMs:[]};report.trials.push(row);const start=performance.now();let addon;controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90000);
  try{
   await page.goto(site.origin+'/search',{waitUntil:'load'});const value='연결검증'+index;
   const source=createPlaywrightScreenSource({page,screenId:'search',variantId:'default',access:async()=>new URL(page.url()).origin===site.origin,roots:()=>[{frame:page.mainFrame(),root:page.locator('body')}]});
   const scope={projectId:'screen-live',systemId:'fixture-search',environmentId:'evaluation',accessScopeId:'anonymous'};
   const knowledge=createScreenKnowledge({scope,source,store:createWikiScreenStore(fileWikiDocuments(join(dirname(training),'wiki-stagehand-1'))),analyzer:createModelScreenAnalyzer(dummy)});
   const {host}=hostFixture();host.browser=createPlaywrightMcpPort({tabs:()=>[{tabId:'screen',page,client}],scope:()=>[{frame:page.mainFrame(),root:page.locator('main')}],access:async()=>new URL(page.url()).origin===site.origin?'ready':'forbidden',reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]}),verify:async(_ctx,checkpoint,candidate)=>{const actual=await page.locator('input[name=query]').inputValue();let answer;try{answer=JSON.parse(candidate?.answer??'');}catch{}const inputExact=actual===value,answerExact=answer?.value===value;row.actualReadback=inputExact;(row.verificationAttempts??=[]).push({inputExact,answerExact,answerLength:candidate?.answer.length});return {criteria:checkpoint.criteria.map(id=>({id,satisfied:id==='new-input-readback'?inputExact:answerExact,evidenceRefs:['fixture:current-input-readback']}))};}});
   const tools=host.browser.tools.bind(host.browser);host.browser.tools=async(...args)=>(await tools(...args)).filter(t=>t.name==='browser_type');host.policy.decide=async()=> 'allow';
   addon=createBrowserAddon();const session=await addon.attach(host,{projectId:scope.projectId});
   const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},tabs:()=>[{tabId:'screen'}],...(withWiki?{memory:knowledge.memory()}:{}),onMetric:m=>row.metrics.push(m),model:{id:status.model,async complete(messages,definitions,ctx){
    if(messages.some(m=>typeof m.content==='string'&&m.content.includes('과거 화면 안내입니다.')))row.wikiDelivered=true;
    const at=performance.now();try{const reply=await provider.complete(messages,definitions,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});(row.decisions??=[]).push({tools:(reply.calls??[]).map(x=>x.function.name),contentLength:reply.content?.length??0});return reply;}finally{row.modelMs.push(performance.now()-at);}
   }}});
   const result=await runner.run({task:{taskId:crypto.randomUUID(),runId:crypto.randomUUID(),request:`현재 화면의 검색어 필드에 "${value}"를 입력하세요. 조회 버튼은 누르지 마세요. 최종 답변은 {"value":"입력한 값"} JSON 객체만 반환하세요.`,criteria:['new-input-readback','answer-value']},tabId:'screen',signal:controller.signal});row.state=result.state;row.success=result.state==='COMPLETED'&&(!withWiki||row.wikiDelivered===true);row.error=result.error;
  }catch(error){row.error=error.code??error.message;}
  finally{clearTimeout(timer);await addon?.detach();row.totalMs=performance.now()-start;await persist();console.log(JSON.stringify({index,withWiki,success:row.success,ms:row.totalMs,calls:row.modelMs.length,wikiDelivered:row.wikiDelivered,error:row.error}));}
 }
 report.finishedAt=new Date().toISOString();
}finally{controller.abort();provider.disconnect();await client?.close();await server?.close();await browser?.close();await site?.close();await persist();}
