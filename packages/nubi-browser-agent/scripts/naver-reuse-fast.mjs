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

if(!process.argv[2]||!process.argv[3]||!process.argv[4])throw Error('report_wikiRoot_cardPath_required');
const output=resolve(process.argv[2]),trainingRoot=resolve(process.argv[3]),cardPath=resolve(process.argv[4]),stage=process.argv[5]??'measure';
if(!['prepare','qualify','measure','probe'].includes(stage))throw Error('stage_invalid');
const mode='optimized',count=stage==='measure'?3:1,baseQuery='site:developers.naver.com/docs/serviceapi/search 뉴스 블로그 웹문서';
const docs={news:{path:'/docs/serviceapi/search/news/news.md',endpoint:'https://openapi.naver.com/v1/search/news.json',sort:['date','sim'],timeField:'pubDate'},blog:{path:'/docs/serviceapi/search/blog/blog.md',endpoint:'https://openapi.naver.com/v1/search/blog.json',sort:['date','sim'],timeField:'postdate'},web:{path:'/docs/serviceapi/search/web/web.md',endpoint:'https://openapi.naver.com/v1/search/webkr.json',sort:[],timeField:null}};
const report={schemaVersion:1,contract:'naver-three-official-details-v1',startedAt:new Date().toISOString(),mode,actualModel:true,actualBrowser:true,actualPi:true,workspaceIntegrated:false,companyVerified:false,query:baseQuery,stage,trials:[],limits:['One fixed anonymous public documentation comparison, not a general browser quality score.','Reuse-only measurement: existing disk screen wiki plus a learned, separately qualified search subprocedure. Every run rereads three real pages.','Provider/browser startup is separate. totalMs includes home navigation, DOM, models, wiki I/O, detail reading, and final independent host verification.','No cached answers, current search inputs, link refs or document bodies are stored in screen wiki.','Training and qualification are separate and cannot pass the 25 second measurement. Failed measured trials remain in their cohort.']};
report.hashes=Object.fromEntries(await Promise.all(['../src/research.ts','../src/research-playwright.ts','../src/knowledge.ts','../src/knowledge-playwright.ts','../src/pi.ts','../scripts/naver-reuse-fast.mjs','../src/context.ts','../src/replay-memory.ts','../evaluation/procedure-host.mjs','../package-lock.json'].map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,import.meta.url))).digest('hex')])));
await mkdir(dirname(output),{recursive:true});const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');const emit=x=>console.log(JSON.stringify(x));
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});let browser;const connect=performance.now();
try{
 const status=await provider.connect();report.providerConnectMs=performance.now()-connect;report.model=status.model;report.effort=status.reasoningEffort;
 const launch=performance.now();browser=await chromium.launch({channel:'chrome',headless:true});report.browserStartMs=performance.now()-launch;report.browserVersion=browser.version();
 for(let index=1;index<=count;index++)for(const phase of stage==='prepare'?['train','qualify']:stage==='qualify'?['qualify']:['reuse']){
  const query=baseQuery+(phase==='train'?' API':'');
  const row={index,phase,success:false,metrics:[],knowledge:[],documents:[],errors:[],modelCalls:0,toolChoices:[],actorMs:0,analysisMs:0,analysisCalls:0,openedDocuments:0};report.trials.push(row);await persist();
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
  const wikiRoot=trainingRoot,wikiStore=createWikiScreenStore(fileWikiDocuments(wikiRoot));
  const hostModel={id:status.model,async complete(messages,tools,ctx){const at=performance.now();row.analysisCalls++;try{return await provider.complete(messages,tools,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});}finally{row.analysisMs+=performance.now()-at;}}};
  const knowledgeFor=p=>{
   const isDoc=new URL(p.url()).hostname==='developers.naver.com',screen=isDoc?'api-'+Object.keys(docs).find(k=>docs[k].path===new URL(p.url()).pathname):isResults(p)?'results':'home';
   return createScreenKnowledge({scope:{projectId:'public-comparison',systemId:isDoc?'naver-developers':'naver-search',environmentId:'public',accessScopeId:'anonymous'},source:createPlaywrightScreenSource({page:p,screenId:screen,variantId:'default',includeDocumentTitle:isDoc,access:()=>access(p),roots:()=>isDoc?[{frame:p.mainFrame(),root:p.locator('#content h1').first()}]:[{frame:p.mainFrame(),root:form(p)}]}),store:wikiStore,analyzer:createModelScreenAnalyzer(hostModel)});
  };
  const acquireKnowledge=async p=>{const at=performance.now(),found=await knowledgeFor(p).recall(controller.signal);if(found.status!=='matched')throw Error('current_screen_wiki_not_matched');row.knowledge.push({screen:found.record.evidence.screenId,reused:true,ms:performance.now()-at});return screenKnowledgeText(found.record);};
  const homeScope={projectId:'public-comparison',systemId:'naver-search',environmentId:'public',accessScopeId:'anonymous'},homePath=await screenWikiPath(homeScope,'home','default');
  const learning=createProcedureHost({page,origin:'https://www.naver.com',allowedOrigins:['https://www.naver.com','https://search.naver.com'],projectId:'public-comparison',title:'검증한 검색 입력과 제출'});
  const readCard=async()=>JSON.parse(await readFile(cardPath,'utf8'));
  const procedure=createReplayMemory({qualification:phase==='qualify',replay:{runReplay,recordTarget},view:learning.view,store:{
    async find(){const card=await readCard();return {notes:[],cards:[card]};},
    async get(id,version){const card=await readCard();return card.id===id&&card.version===version?card:null;},
    async current(card,context){const current=await readCard(),wiki=await wikiStore.read(homeScope,'home','default',context.signal);return context.projectId===homeScope.projectId&&['https://www.naver.com','https://search.naver.com'].includes(new URL(page.url()).origin)&&JSON.stringify(current)===JSON.stringify(card)&&card.wikiRef.id===homePath&&card.wikiRef.version===1&&wiki?.version===card.wikiRef.hash&&await access(page);},
    async propose(){throw Error('implicit_learning_not_allowed');},
  }});
  try{
   await page.goto('https://www.naver.com/',{waitUntil:'domcontentloaded',timeout:20000});await form(page).locator('input[name=query]').waitFor();
   server=await createConnection({timeouts:{action:5000,navigation:15000,settle:0},saveSession:false,snapshot:{mode:'none'},console:{level:'error'}},async()=>ctxBrowser);const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);client=new Client({name:'nubi-public-detail-evaluation',version:'0.5.0'});await client.connect(a);
   const {host}=hostFixture();
   const base=createPlaywrightMcpPort({tabs:()=>[{tabId:'search',page,client}],scope:()=>[{frame:page.mainFrame(),root:form(page)},...(isResults(page)?roots(page):[])],access:async()=>{
    if(!await access(page))return 'forbidden';if(isResults(page)){await resultAnchors(page).nth(2).waitFor({timeout:15000});row.resultCount=await resultAnchors(page).count();}return 'ready';
   },reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]}),verify:async(_ctx,cp,candidate)=>{
    let answer;try{answer=JSON.parse(candidate?.answer??'');}catch{}
    const checks={query:new URL(page.url()).searchParams.get('query')===query,threeFreshDocuments:oracles.size===3,items:Array.isArray(answer?.items)&&answer.items.length===3,fields:false,summary:typeof answer?.summary==='string'&&answer.summary.length>=20};
    checks.fields=checks.items&&new Set(answer.items.map(x=>x.kind)).size===3&&Object.entries(docs).every(([kind,expected])=>{const item=answer.items.find(x=>x.kind===kind),actual=oracles.get(kind),source=sources.get(item?.sourceId);return actual&&source&&source.url==='https://developers.naver.com'+expected.path&&item.url===source.url&&item.endpoint===expected.endpoint&&item.displayMax===100&&JSON.stringify([...(item.sort??[])].sort())===JSON.stringify(expected.sort)&&item.timeField===expected.timeField&&actual.endpoint&&actual.display&&actual.sort&&actual.time;});
    row.verifications??=[];row.verifications.push(checks);return {criteria:cp.criteria.map(id=>({id,satisfied:Object.values(checks).every(Boolean),evidenceRefs:[...sources.keys()]}))};
   }});
   const reader=createPlaywrightDocumentReader({page:()=>page,roots,allowUrl,access,async open(url){const p=await ctxBrowser.newPage();row.openedDocuments++;const at=performance.now();try{await p.goto(url,{waitUntil:mode==='optimized'?'domcontentloaded':'load',timeout:20000});row.documents.push({url,openMs:performance.now()-at});return p;}catch(e){await p.close();throw e;}},close:p=>p.close(),async ready(p){await p.locator('#content h1').first().waitFor({timeout:12000});await p.locator('#content table').nth(2).waitFor({timeout:12000});},async knowledge(p){await acquireKnowledge(p);const kind=Object.keys(docs).find(k=>new URL(p.url()).pathname===docs[k].path),body=await p.locator('#content').innerText();const tables=await p.locator('#content table').evaluateAll(xs=>xs.map(x=>[...x.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(cell=>cell.innerText.trim()).join('\t'))));
    const display=tables.flat().find(line=>/^display\s/.test(line))??'',sort=tables.flat().find(line=>/^sort\s/.test(line))??'';
    oracles.set(kind,{endpoint:body.includes(docs[kind].endpoint),display:/100/.test(display),sort:docs[kind].sort.length?(/sim/.test(sort)&&/date/.test(sort)):sort==='',time:docs[kind].timeField?tables.flat().some(t=>t.includes(docs[kind].timeField)):!tables.flat().some(t=>/pubDate|postdate/.test(t))});
   },maxCharacters:24000,...(mode==='optimized'?{focusHeadings:['요청 URL','파라미터','응답']}:{} )});
   const readOriginal=reader.read.bind(reader);reader.read=async(...args)=>{const at=performance.now();const result=await readOriginal(...args);sources.set(result.sourceId,result);(row.readTimings??=[]).push({url:result.url,ms:performance.now()-at,characters:result.text.length,truncated:result.truncated,selection:result.selection});return result;};
   const research=createDocumentResearchPort({browser:base,documents:reader,concurrency:mode==='optimized'?3:1});
   const observe=research.observe.bind(research),execute=research.execute.bind(research),tools=research.tools.bind(research);
   const annotate=async o=>{if(o?.state==='ready'){const key=new URL(page.url()).hostname;if(lastKnowledge!==key){lastKnowledge=key;await acquireKnowledge(page);}}return o;};
   host.browser={...research,observe:async(...args)=>annotate(await observe(...args)),execute:async(...args)=>{const result=await execute(...args);if(result.observation){try{await annotate(result.observation);}catch(e){row.errors.push({stage:'post_action_knowledge',code:e.code??'read_failed'});delete result.observation;}}return result;},tools:async(...args)=>(await tools(...args)).filter(t=>['browser_type','browser_press_key','browser_read_documents'].includes(t.name))};
   // Only the public search input and Enter, plus observed document reads, are authorized by this eval profile.
   host.policy.decide=async({action})=>action.tool==='browser_read_documents'?'allow':action.tool==='browser_type'&&action.arguments.text===query||action.tool==='browser_press_key'&&action.arguments.key==='Enter'?'allow':'deny';
   addon=createBrowserAddon();const session=await addon.attach(host,{projectId:'public-comparison'});
   const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},tabs:()=>[{tabId:'search'}],memory:knowledgeFor(page).memory(phase==='train'?learning.memory:withDocumentReadContinuation(procedure,{required:true})),prepareContext:compactBrowserContext,onMetric:m=>{row.metrics.push(m);if(m.kind==='model_end'||m.kind==='run_end')emit({index,phase,kind:m.kind,ms:m.elapsedMs,state:m.state});},model:{id:status.model,async complete(messages,tools,ctx){const at=performance.now();row.modelCalls++;row.toolChoices.push(ctx.toolChoice);if(messages.some(m=>typeof m.content==='string'&&m.content.includes('과거 화면 안내입니다.')))row.wikiDelivered=true;for(const m of messages.filter(m=>m.role==='tool')){try{const data=JSON.parse(m.content);if(stage!=='measure'){(row.contextDiagnostics??=[]).push({keys:Object.keys(data),observation:data.observation?.observationId,links:data.observation?.data?.documentLinks?.length,observationDataKeys:Object.keys(data.observation?.data??{}),toolCount:tools.length});}if(data.procedureId){row.procedureCompleted=!!data.completed&&Number(data.completed.steps)===2&&data.confirmedSteps?.length===2;row.procedureResult={completed:data.completed,confirmedSteps:data.confirmedSteps?.length,operations:data.operations,error:data.error,cause:data.cause,stopped:data.stopped,recovery:data.recovery};}if(data.error&&!row.errors.some(e=>e.code===data.error))row.errors.push({stage:'tool_feedback',code:data.error});}catch{}}try{const reply=await provider.complete(messages,tools,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true,toolChoice:ctx.toolChoice});if(stage!=='measure'&&!(reply.calls?.length)){(row.outputPreviews??=[]).push(reply.content?.slice(0,400));emit({phase,answerPreview:reply.content?.slice(0,400),availableTools:tools.map(t=>t.function.name)});}if(reply.calls?.some(c=>c.function.name==='use_browser_procedure')){row.usedProcedure=true;try{row.readAfterRequested=JSON.parse(reply.calls.find(c=>c.function.name==='use_browser_procedure').function.arguments).readAfter?.titles;}catch{}}emit({index,phase,decision:(reply.calls??[]).map(c=>c.function.name),answerCharacters:reply.content?.length??0});return reply;}finally{row.actorMs+=performance.now()-at;}}}});
   const request=`현재 요청에 맞는 검증된 검색 하위 절차가 있으면 현재 검색어와 조회할 문서 제목 조건을 함께 지정하세요. 절차 완료 후에도 상세 조회와 비교를 끝내야 합니다. 네이버 검색창에 "${query}"를 입력하고 Enter로 통합 검색하세요. AI 검색은 누르지 마세요. 검색 결과에서 공식 네이버 개발자 문서의 뉴스, 블로그, 웹문서 검색 API 상세 페이지 3개를 browser_read_documents로 실제 읽고 비교하세요. 현재 documentLinks의 linkId만 선택하고 검색 요약으로 답하지 마세요. JSON 요청 endpoint, display 최댓값, 문서에 명시한 sort 값(명시하지 않으면 빈 배열), 결과 시간 필드(없으면 null)를 비교하세요. 최종 답변은 {"items":[{"kind":"news|blog|web","url":"실제로 읽은 상세 URL","sourceId":"읽기 결과의 sourceId","endpoint":"JSON 요청 URL","displayMax":숫자,"sort":["지원 값"],"timeField":"필드명 또는 null"}],"summary":"공통점과 차이를 한국어 120자 안팎으로 요약"} JSON 객체만 반환하세요. 로그인, API 호출과 다른 데이터 변경은 하지 않습니다.`;
   const outcome=await runner.run({task:{taskId:crypto.randomUUID(),runId:crypto.randomUUID(),request,criteria:['search-three-details-and-exact-comparison']},tabId:'search',signal:controller.signal,initialToolChoice:'required'});row.state=outcome.state;row.error=outcome.error;row.pending=outcome.checkpoint.pending?.question;row.success=outcome.state==='COMPLETED';if(outcome.answer)row.answer=JSON.parse(outcome.answer);row.analysisSkipped=row.analysisCalls===0;row.within25Seconds=performance.now()-start<25000;
   if(phase==='train'&&row.success){const draft=learning.drafts[0];if(learning.drafts.length!==1||draft.steps.length!==2||draft.inputs.length!==1||JSON.stringify(draft).includes(query))throw Error('search_subprocedure_training_invalid');const wiki=await wikiStore.read(homeScope,'home','default',controller.signal);const reviewed={...draft,status:'reviewed',wikiRef:{id:homePath,version:1,hash:wiki.version}};await mkdir(dirname(cardPath),{recursive:true});await writeFile(cardPath,JSON.stringify(reviewed,null,2)+'\n');row.draftSaved=true;}
   if(phase==='qualify'&&row.success){if(!row.usedProcedure||!row.procedureCompleted)throw Error('qualification_did_not_complete_procedure');const card=await readCard();card.status='revalidated';await writeFile(cardPath,JSON.stringify(card,null,2)+'\n');row.revalidated=true;}
   if(phase==='reuse'&&(!row.usedProcedure||!row.procedureCompleted||!row.wikiDelivered))row.success=false;row.receipts=outcome.checkpoint.receipts.map(r=>({tool:r.tool,status:r.status,effect:r.effect}));
  }catch(e){row.success=false;row.error=e.code??e.message;}
  finally{clearTimeout(timeout);row.totalMs=performance.now()-start;row.within25Seconds=row.totalMs<25000;row.goalSuccess=phase==='reuse'&&row.success&&row.within25Seconds;row.oracle=[...oracles].map(([kind,checks])=>({kind,...checks}));await addon?.detach();await client?.close();await server?.close();await ctxBrowser.close();await persist();emit({index,phase,success:row.success,totalMs:row.totalMs,actorCalls:row.modelCalls,analysisCalls:row.analysisCalls,within25Seconds:row.within25Seconds,usedProcedure:row.usedProcedure,procedureCompleted:row.procedureCompleted,error:row.error});}
 }
 report.finishedAt=new Date().toISOString();
}finally{provider.disconnect();await browser?.close();await persist();}
