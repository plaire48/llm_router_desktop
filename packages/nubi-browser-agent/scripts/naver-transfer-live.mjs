import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../extensions/aipro-chat/agent-runtime.js';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {createBrowserAddon} from '../dist/index.js';
import {createPiBrowserRunner} from '../dist/pi.js';
import {compactBrowserContext} from '../dist/context.js';
import {createReplayMemory} from '../dist/memory.js';
import {createProcedureHost} from '../evaluation/procedure-host.mjs';
import {runReplay,recordTarget} from '../../../extensions/aipro-chat/browser-replay.js';
import {screenWikiPath} from '../dist/knowledge-wiki.js';
import {createPlaywrightMcpPort} from '../dist/playwright.js';
import {createDocumentResearchPort,withDocumentReadContinuation} from '../dist/research.js';
import {createPlaywrightDocumentReader} from '../dist/research-playwright.js';
import {createScreenKnowledge,createModelScreenAnalyzer,screenKnowledgeText} from '../dist/knowledge.js';
import {createPlaywrightScreenSource} from '../dist/knowledge-playwright.js';
import {createWikiScreenStore} from '../dist/knowledge-wiki.js';
import {fileWikiDocuments} from '../evaluation/wiki-document-host.mjs';
import {hostFixture} from '../tests/host.mjs';
import {readdir} from 'node:fs/promises';
import {cases,documents,schedule,requestFor,verifyAnswer,summarize} from '../evaluation/transfer-cases.mjs';

if(!process.argv[2]||!process.argv[3]||!process.argv[4])throw Error('report_wikiRoot_cardPath_required');
const output=resolve(process.argv[2]),trainingRoot=resolve(process.argv[3]),cardPath=resolve(process.argv[4]),stage=process.argv[5]??'measure';
if(!['measure','probe'].includes(stage))throw Error('stage_invalid');
const mode='optimized',matrix=stage==='probe'?schedule(1):schedule(3),docs=documents;
const report={schemaVersion:1,contract:'naver-memory-transfer-v1',startedAt:new Date().toISOString(),actualModel:true,actualBrowser:true,actualPi:true,workspaceIntegrated:false,companyVerified:false,stage,schedule:matrix,trials:[],training:'Existing five screen wiki files and separately qualified search prefix; frozen throughout this run.',limits:['Three fixed within-site transfer cases; not cross-site generality or official benchmark scores.','Both arms use the same Pi/model/compaction/read concurrency/current content sections, permissions and output requirements.','The reuse arm combines historical screen guidance and applicable verified search subprocedures; this is not an ablation of screen notes alone.','No online knowledge/procedure learning or candidate promotion during measurement.','All failures and timeouts stay in the denominator; valid alternative execution routes can pass independently of replay adoption.','Provider/browser/context startup is separate; per-task totalMs includes start navigation, all browser/model/wiki operations and independent final verification.']};
const frozenFiles=async(root)=>{const result={};const walk=async(dir)=>{for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('frozen_memory_symlink');if(entry.isDirectory())await walk(path);else if(entry.isFile())result[path.slice(root.length+1)]=createHash('sha256').update(await readFile(path)).digest('hex');}};await walk(root);return result;};
const freeze=async()=>({wiki:await frozenFiles(trainingRoot),card:createHash('sha256').update(await readFile(cardPath)).digest('hex')});
report.memoryBefore=await freeze();
report.hashes=Object.fromEntries(await Promise.all(['../src/research.ts','../src/research-playwright.ts','../src/knowledge.ts','../src/knowledge-playwright.ts','../src/pi.ts','../scripts/naver-transfer-live.mjs','../evaluation/transfer-cases.mjs','../src/context.ts','../src/replay-memory.ts','../evaluation/procedure-host.mjs','../package-lock.json'].map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,import.meta.url))).digest('hex')])));
await mkdir(dirname(output),{recursive:true});const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');const emit=x=>console.log(JSON.stringify(x));
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});let browser;const connect=performance.now();
try{
 const status=await provider.connect();report.providerConnectMs=performance.now()-connect;report.model=status.model;report.effort=status.reasoningEffort;
 const launch=performance.now();browser=await chromium.launch({channel:'chrome',headless:true});report.browserStartMs=performance.now()-launch;report.browserVersion=browser.version();
 for(const {index,caseId,arm} of matrix){
  const task=cases.find(x=>x.id===caseId),query=task.query,phase=arm;
  const row={index,caseId,arm,phase,success:false,metrics:[],knowledge:[],documents:[],errors:[],modelCalls:0,toolChoices:[],actorMs:0,analysisMs:0,analysisCalls:0,openedDocuments:0};report.trials.push(row);await persist();
  const ctxBrowser=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900}}),page=await ctxBrowser.newPage(),controller=new AbortController();let addon,client,server;
  const timeout=setTimeout(()=>{row.timeout=true;controller.abort();},240000),start=performance.now();const oracles=new Map(),sources=new Map();let lastKnowledge='';
  const allowUrl=async text=>{try{const u=new URL(text);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='www.naver.com'&&u.pathname==='/'||u.hostname==='search.naver.com'&&u.pathname==='/search.naver'||u.hostname==='developers.naver.com'&&Object.values(docs).some(x=>x.path===u.pathname));}catch{return false;}};
  // The eval host guards every main-document navigation before dispatch, including redirects.
  await ctxBrowser.route('**/*',async route=>{const req=route.request();if(req.isNavigationRequest()&&req.frame()===req.frame().page().mainFrame()&&!await allowUrl(req.url()))return route.abort();return route.continue();});
  const access=async p=>{if(!await allowUrl(p.url()))return false;return !await p.locator('input[type=password],input[autocomplete=one-time-code],iframe[src*=captcha]').evaluateAll(xs=>xs.some(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0;}));};
  const form=p=>p.locator('form[role=search],form#sform').first();
  const isResults=p=>new URL(p.url()).hostname==='search.naver.com';
  const resultAnchors=p=>p.locator('#main_pack a[href^="https://developers.naver.com/docs/serviceapi/search/"]').filter({hasText:/^검색 > /});
  const roots=p=>new URL(p.url()).hostname==='developers.naver.com'?[{frame:p.mainFrame(),root:p.locator('#content')}]:isResults(p)?Array.from({length:Math.min(15,row.resultCount??0)},(_,i)=>({frame:p.mainFrame(),root:resultAnchors(p).nth(i)})):[{frame:p.mainFrame(),root:form(p)}];
  const wikiRoot=trainingRoot,documentsHost=fileWikiDocuments(wikiRoot),wikiStore=createWikiScreenStore({...documentsHost,compareAndSet:async()=>{throw Error('frozen_wiki_write_forbidden');}});
  const hostModel={id:status.model,async complete(messages,tools,ctx){const at=performance.now();row.analysisCalls++;try{return await provider.complete(messages,tools,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});}finally{row.analysisMs+=performance.now()-at;}}};
  const knowledgeFor=p=>{
   const isDoc=new URL(p.url()).hostname==='developers.naver.com',screen=isDoc?'api-'+Object.keys(docs).find(k=>docs[k].path===new URL(p.url()).pathname):isResults(p)?'results':'home';
   return createScreenKnowledge({scope:{projectId:'public-comparison',systemId:isDoc?'naver-developers':'naver-search',environmentId:'public',accessScopeId:'anonymous'},source:createPlaywrightScreenSource({page:p,screenId:screen,variantId:'default',includeDocumentTitle:isDoc,access:()=>access(p),roots:()=>isDoc?[{frame:p.mainFrame(),root:p.locator('#content h1').first()}]:[{frame:p.mainFrame(),root:form(p)}]}),store:wikiStore,analyzer:createModelScreenAnalyzer(hostModel)});
  };
  const acquireKnowledge=async p=>{if(arm==='none')return '';const at=performance.now(),found=await knowledgeFor(p).recall(controller.signal);row.knowledge.push({url:new URL(p.url()).origin+new URL(p.url()).pathname,status:found.status,ms:performance.now()-at});return found.status==='matched'?screenKnowledgeText(found.record):'';};
  const homeScope={projectId:'public-comparison',systemId:'naver-search',environmentId:'public',accessScopeId:'anonymous'},homePath=await screenWikiPath(homeScope,'home','default');
  const learning=createProcedureHost({page,origin:'https://www.naver.com',allowedOrigins:['https://www.naver.com','https://search.naver.com'],projectId:'public-comparison',title:'검증한 검색 입력과 제출'});
  const readCard=async()=>JSON.parse(await readFile(cardPath,'utf8'));
  const procedure=createReplayMemory({qualification:false,replay:{runReplay,recordTarget},view:learning.view,store:{
    async find(context){const card=await readCard();const initial=card.steps[0].fields[0].target,current=await learning.view(context.observation),matches=current.frames.flatMap(f=>f.elements).filter(e=>JSON.stringify(recordTarget(e,current))===JSON.stringify(initial));row.procedureApplicable=matches.length===1;return {notes:[],cards:row.procedureApplicable?[card]:[]};},
    async get(id,version){const card=await readCard();return card.id===id&&card.version===version?card:null;},
    async current(card,context){const current=await readCard(),wiki=await wikiStore.read(homeScope,'home','default',context.signal);return context.projectId===homeScope.projectId&&['https://www.naver.com','https://search.naver.com'].includes(new URL(page.url()).origin)&&JSON.stringify(current)===JSON.stringify(card)&&card.wikiRef.id===homePath&&card.wikiRef.version===1&&wiki?.version===card.wikiRef.hash&&await access(page);},
    async propose(){throw Error('implicit_learning_not_allowed');},
  }});
  try{
   const startUrl=task.start==='results'?'https://search.naver.com/search.naver?query='+encodeURIComponent('site:developers.naver.com/docs/serviceapi/search 뉴스 블로그 웹문서'):'https://www.naver.com/';await page.goto(startUrl,{waitUntil:'domcontentloaded',timeout:20000});await form(page).locator('input[name=query]').waitFor();
   server=await createConnection({timeouts:{action:5000,navigation:15000,settle:0},saveSession:false,snapshot:{mode:'none'},console:{level:'error'}},async()=>ctxBrowser);const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);client=new Client({name:'nubi-public-detail-evaluation',version:'0.5.0'});await client.connect(a);
   const {host}=hostFixture();
   const base=createPlaywrightMcpPort({tabs:()=>[{tabId:'search',page,client}],scope:()=>[{frame:page.mainFrame(),root:form(page)},...(isResults(page)?roots(page):[])],access:async()=>{
    if(!await access(page))return 'forbidden';if(isResults(page)){await resultAnchors(page).first().waitFor({timeout:15000});row.resultCount=await resultAnchors(page).count();}return 'ready';
   },reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]}),verify:async(_ctx,cp,candidate)=>{
    let answer;try{answer=JSON.parse(candidate?.answer??'');}catch{}
    const checks=verifyAnswer(task,answer,{query:new URL(page.url()).searchParams.get('query'),sources,oracles});
    row.verifications??=[];row.verifications.push(checks);return {criteria:cp.criteria.map(id=>({id,satisfied:Object.values(checks).every(Boolean),evidenceRefs:[...sources.keys()]}))};
   }});
   const reader=createPlaywrightDocumentReader({page:()=>page,roots,allowUrl,access,async open(url){const p=await ctxBrowser.newPage();row.openedDocuments++;const at=performance.now();try{await p.goto(url,{waitUntil:mode==='optimized'?'domcontentloaded':'load',timeout:20000});row.documents.push({url,openMs:performance.now()-at});return p;}catch(e){await p.close();throw e;}},close:p=>p.close(),async ready(p){await p.locator('#content h1').first().waitFor({timeout:12000});await p.locator('#content table').nth(2).waitFor({timeout:12000});},async knowledge(p){await acquireKnowledge(p);const kind=Object.keys(docs).find(k=>new URL(p.url()).pathname===docs[k].path),body=await p.locator('#content').innerText();const tables=await p.locator('#content table').evaluateAll(xs=>xs.map(x=>[...x.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(cell=>cell.innerText.trim()).join('\t'))));
    const display=tables.flat().find(line=>/^display\s/.test(line))??'',sort=tables.flat().find(line=>/^sort\s/.test(line))??'';
    oracles.set(kind,{endpoint:body.includes(docs[kind].endpoint),display:/100/.test(display),sort:docs[kind].sort.length?docs[kind].sort.every(value=>sort.includes(value)):sort==='',time:docs[kind].timeField?tables.flat().some(t=>t.includes('/'+docs[kind].timeField)||t.startsWith(docs[kind].timeField+'\t')):!tables.flat().some(t=>/\/(pubDate|postdate|pubdate)\s/.test(t))});
   },maxCharacters:24000,...(mode==='optimized'?{focusHeadings:['요청 URL','파라미터','응답']}:{} )});
   const readOriginal=reader.read.bind(reader);reader.read=async(...args)=>{const at=performance.now();const result=await readOriginal(...args);sources.set(result.sourceId,result);(row.readTimings??=[]).push({url:result.url,ms:performance.now()-at,characters:result.text.length,truncated:result.truncated,selection:result.selection});return result;};
   const research=createDocumentResearchPort({browser:base,documents:reader,concurrency:mode==='optimized'?3:1});
   const observe=research.observe.bind(research),execute=research.execute.bind(research),tools=research.tools.bind(research);
   const annotate=async o=>{if(o?.state==='ready'){const key=new URL(page.url()).hostname;if(lastKnowledge!==key){lastKnowledge=key;await acquireKnowledge(page);}}return o;};
   host.browser={...research,observe:async(...args)=>annotate(await observe(...args)),execute:async(...args)=>{const result=await execute(...args);if(result.observation){try{await annotate(result.observation);}catch(e){row.errors.push({stage:'post_action_knowledge',code:e.code??'read_failed'});delete result.observation;}}return result;},tools:async(...args)=>(await tools(...args)).filter(t=>['browser_type','browser_press_key','browser_read_documents'].includes(t.name))};
   // Only the public search input and Enter, plus observed document reads, are authorized by this eval profile.
   host.policy.decide=async({action})=>action.tool==='browser_read_documents'?'allow':action.tool==='browser_type'&&action.arguments.text===query||action.tool==='browser_press_key'&&action.arguments.key==='Enter'?'allow':'deny';
   addon=createBrowserAddon();const session=await addon.attach(host,{projectId:'public-comparison'});
   const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},tabs:()=>[{tabId:'search'}],...(arm==='reuse'?{memory:knowledgeFor(page).memory(withDocumentReadContinuation(procedure,{required:true}))}:{}),prepareContext:compactBrowserContext,onMetric:m=>{row.metrics.push(m);if(m.kind==='model_end'||m.kind==='run_end')emit({index,phase,kind:m.kind,ms:m.elapsedMs,state:m.state});},model:{id:status.model,async complete(messages,tools,ctx){const at=performance.now();row.modelCalls++;row.toolChoices.push(ctx.toolChoice);if(messages.some(m=>typeof m.content==='string'&&m.content.includes('과거 화면 안내입니다.')))row.wikiDelivered=true;for(const m of messages.filter(m=>m.role==='tool')){try{const data=JSON.parse(m.content);if(stage==='probe'){(row.contextDiagnostics??=[]).push({keys:Object.keys(data),observation:data.observation?.observationId,links:data.observation?.data?.documentLinks?.length,observationDataKeys:Object.keys(data.observation?.data??{}),toolCount:tools.length});}if(data.procedureId){row.procedureCompleted=!!data.completed&&Number(data.completed.steps)===2&&data.confirmedSteps?.length===2;row.procedureResult={completed:data.completed,confirmedSteps:data.confirmedSteps?.length,operations:data.operations,error:data.error,cause:data.cause,stopped:data.stopped,recovery:data.recovery};}if(data.error&&!row.errors.some(e=>e.code===data.error))row.errors.push({stage:'tool_feedback',code:data.error});}catch{}}try{const reply=await provider.complete(messages,tools,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true,toolChoice:ctx.toolChoice});if(!(reply.calls?.length)&&oracles.size!==task.kinds.length){(row.outputPreviews??=[]).push(reply.content?.slice(0,400));emit({phase,answerPreview:reply.content?.slice(0,400),availableTools:tools.map(t=>t.function.name)});}if(reply.calls?.some(c=>c.function.name==='use_browser_procedure')){row.usedProcedure=true;try{row.readAfterRequested=JSON.parse(reply.calls.find(c=>c.function.name==='use_browser_procedure').function.arguments).readAfter?.titles;}catch{}}emit({index,phase,decision:(reply.calls??[]).map(c=>c.function.name),answerCharacters:reply.content?.length??0});return reply;}finally{row.actorMs+=performance.now()-at;}}}});
   const request=requestFor(task);
   const outcome=await runner.run({task:{taskId:crypto.randomUUID(),runId:crypto.randomUUID(),request,criteria:['current-search-and-exact-requested-comparison']},tabId:'search',signal:controller.signal,initialToolChoice:'required',preferVerifiedProcedure:true});row.state=outcome.state;row.error=outcome.error;row.pending=outcome.checkpoint.pending?.question;row.success=outcome.state==='COMPLETED';if(outcome.answer)row.answer=JSON.parse(outcome.answer);row.analysisSkipped=row.analysisCalls===0;row.within25Seconds=performance.now()-start<25000;
   row.receipts=outcome.checkpoint.receipts.map(r=>({tool:r.tool,status:r.status,effect:r.effect}));
  }catch(e){row.success=false;row.error=e.code??e.message;}
  finally{clearTimeout(timeout);row.totalMs=performance.now()-start;row.within25Seconds=row.totalMs<25000;row.goalSuccess=row.success&&row.within25Seconds;row.oracle=[...oracles].map(([kind,checks])=>({kind,...checks}));await addon?.detach();await client?.close();await server?.close();await ctxBrowser.close();await persist();emit({caseId,arm,index,phase,success:row.success,totalMs:row.totalMs,actorCalls:row.modelCalls,analysisCalls:row.analysisCalls,within25Seconds:row.within25Seconds,usedProcedure:row.usedProcedure,procedureCompleted:row.procedureCompleted,error:row.error});}
 }
 report.memoryAfter=await freeze();report.memoryUnchanged=JSON.stringify(report.memoryBefore)===JSON.stringify(report.memoryAfter);if(!report.memoryUnchanged)throw Error('frozen_memory_changed');report.summary=summarize(report);report.finishedAt=new Date().toISOString();
}finally{provider.disconnect();await browser?.close();await persist();}
