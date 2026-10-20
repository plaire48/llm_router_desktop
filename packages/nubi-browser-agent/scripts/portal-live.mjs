import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {createInterface} from 'node:readline';
import {chromium} from 'playwright-core';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../extensions/aipro-chat/agent-runtime.js';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {createBrowserAddon} from '../dist/index.js';
import {createPiBrowserRunner} from '../dist/pi.js';
import {createPlaywrightMcpPort} from '../dist/playwright.js';
import {createProcedureHost} from '../evaluation/procedure-host.mjs';
import {hostFixture} from '../tests/host.mjs';
const output=process.argv[2];if(!output)throw Error('report_path_required');
const config={naver:{home:'https://www.naver.com/',hosts:['www.naver.com','search.naver.com'],results:'#main_pack a > .sds-comps-text-type-headline1'}};
const report={schemaVersion:1,scope:'anonymous_naver_only',startedAt:new Date().toISOString(),actualModel:true,actualBrowser:true,workspaceIntegrated:false,trials:[],limitations:['Public live development cases, not a general quality or p95 estimate.','Same Pi/model/permissions and host-defined observation roots; fresh home for each public trial. Browser launch is excluded.','Anonymous public search only. No login, mail, credentials, cookies or network headers are collected.','The host evaluation profile covers one general result layout; unsupported layouts remain failures in the denominator.']};
report.hashes=Object.fromEntries(await Promise.all(['../src/playwright.ts','../src/pi.ts','../src/replay-memory.ts','../dist/playwright.js','../dist/pi.js','../dist/replay-memory.js','../evaluation/procedure-host.mjs','../scripts/portal-live.mjs'].map(async file=>[file,createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex')])));
const persist=async()=>{await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');};
const emit=value=>console.log(JSON.stringify(value));
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});
const browser=await chromium.launch({headless:false,channel:'chrome'});report.browserVersion=browser.version();const services=new Map();let status;
async function get(name){
 if(!config[name])throw Error('unknown_service');if(services.has(name))return services.get(name);
 const context=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900}}),page=await context.newPage();
 const server=await createConnection({timeouts:{action:5000,navigation:15000,settle:0},saveSession:false,snapshot:{mode:'none'},console:{level:'error'}},async()=>context);
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);const client=new Client({name:'nubi-portal-development',version:'0.4.0'});await client.connect(a);
 const learning=createProcedureHost({page,origin:new URL(config[name].home).origin,projectId:'portal-'+name,title:'공개 검색 절차'});
 const state={name,context,page,server,client,learning};services.set(name,state);return state;
}
async function classify(state){
 const u=new URL(state.page.url());
 if(/(^|\.)(accounts.google.com|nid.naver.com)$/.test(u.hostname)||/captcha|\/sorry\//i.test(u.pathname))return 'login_required';
 if(!config[state.name].hosts.includes(u.hostname))return 'forbidden';
 if(u.hostname==='search.naver.com'){try{await state.page.locator(config.naver.results).nth(2).waitFor({state:'visible',timeout:10000});}catch{return 'forbidden';}}
 const protectedInput=await state.page.locator('input[type=password],input[autocomplete=one-time-code]').evaluateAll(xs=>xs.some(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}));
 return protectedInput?'login_required':'ready';
}
async function results(state){
 const page=state.page,c=config[state.name];
 const found=await page.locator(c.results).evaluateAll(nodes=>nodes.flatMap(el=>{const r=el.getBoundingClientRect(),a=el.closest('a');if(!r.width||!r.height||!a)return [];const title=el.textContent.trim().replace(/\s+/g,' ');let url;try{const u=new URL(a.href);if(!/^https?:$/.test(u.protocol))return [];url=u.origin+u.pathname;}catch{return [];}return title?[{title,url}]:[];}));
 return found.filter((x,i,a)=>a.findIndex(y=>y.title===x.title&&y.url===x.url)===i).slice(0,3);
}
async function publicTrial(name,kind,index,query){
 const state=await get(name),row={service:name,kind,index,query,success:false,metrics:[],decisions:[],feedback:[]};report.trials.push(row);await persist();const start=performance.now();let addon,timer;
 try{
  await state.page.goto(config[name].home,{waitUntil:'load',timeout:30000});
  try{await state.page.waitForLoadState('networkidle',{timeout:10000});row.initialNetworkIdle=true;}catch{row.initialNetworkIdle=false;}
  if(await classify(state)!=='ready'){row.state='WAITING_FOR_USER';row.reason='access_or_challenge';return;}
  status??=await provider.connect();report.model=status.model;report.effort=status.reasoningEffort;
  const {host}=hostFixture();const port=createPlaywrightMcpPort({tabs:()=>[{tabId:name,page:state.page,client:state.client}],scope:()=>{const page=state.page;return [{frame:page.mainFrame(),root:page.locator('form[role=search],form#sform').first()},...(new URL(page.url()).hostname==='search.naver.com'?[0,1,2].map(i=>({frame:page.mainFrame(),root:page.locator('#main_pack a').filter({has:page.locator('.sds-comps-text-type-headline1')}).nth(i).locator('..')})):[])];},access:async()=>{const access=await classify(state);if(access!=='ready'){const u=new URL(state.page.url());(row.accessChanges??=[]).push({access,host:u.hostname,path:u.pathname});}return access;},reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]}),verify:async(_ctx,cp,candidate)=>{
   let data;try{data=JSON.parse(candidate?.answer??'');}catch{}
   const actual=await results(state),url=new URL(state.page.url());const reflected=url.searchParams.get('query')===query;
   const satisfied=reflected&&actual.length===3&&Array.isArray(data)&&data.length===3&&actual.every((x,i)=>x.title===data[i]?.title);
   row.verification={queryReflected:reflected,visibleResultCount:actual.length,exactTitles:satisfied};return {criteria:cp.criteria.map(id=>({id,satisfied,evidenceRefs:['live:visible-result-titles']}))};
  }});
  const observed=new Map();const remember=o=>{if(o?.state==='ready')observed.set(o.observationId,o);return o;};
  const diagnostic=async(name,operation)=>{try{return await operation();}catch(error){(row.hostErrors??=[]).push({operation:name,name:error.name,message:error.message.slice(0,200)});throw error;}};
  host.browser={...port,observe:async(...args)=>remember(await diagnostic('observe',()=>port.observe(...args))),execute:async(...args)=>{const result=await port.execute(...args);remember(result.observation);return result;},tools:async(...args)=>(await port.tools(...args)).filter(x=>['browser_click','browser_type','browser_press_key'].includes(x.name))};
  // Evaluation-only permission scope: public search controls and submission, no other navigation or mutations.
  host.policy.decide=async({action})=>{
   if(await classify(state)!=='ready')return 'deny';
   const el=state.page.locator('aria-ref='+action.arguments.targetId);let handle;
   try{handle=await el.elementHandle();if(!handle)return 'deny';return await handle.evaluate((el,tool)=>{
    const form=el.closest('form'),role=el.getAttribute('role'),input=el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement;
    if(tool==='browser_type')return input&&!['password','hidden'].includes(el.type)&&!!form?'allow':'deny';
    const name=[el.getAttribute('aria-label'),el.getAttribute('title'),el.value,el.textContent].filter(Boolean).join(' ');
    return (form||role==='button')&&/검색|search|google/i.test(name)&&!/로그인|sign in|삭제|delete|send|전송/i.test(name)?'allow':'deny';
   },action.tool);}catch{return 'deny';}finally{await handle?.dispose();}
  };
  // Structural opaque targets use the same native validation; allow policy only after exact semantic lookup below.
  const baseDecide=host.policy.decide;host.policy.decide=async ctx=>{if(!ctx.action.arguments.targetId.match(/^(?:f\d+)?e\d+$/)){if(await classify(state)!=='ready')return 'deny';const c=observed.get(ctx.action.observationId)?.data?.candidates?.find(x=>x.targetId===ctx.action.arguments.targetId);if(!c)return 'deny';const label=c.name+' '+c.context;if(ctx.action.tool==='browser_press_key')return ctx.action.arguments.key==='Enter'&&['input','textarea'].includes(c.tag)&&/검색|search|query/i.test(label)?'allow':'deny';if(ctx.action.tool==='browser_type')return ['input','textarea'].includes(c.tag)&&!['password','hidden','submit','button'].includes(c.type)&&/검색|search|query/i.test(label)?'allow':'deny';return /검색|search/i.test(label)&&!['input','textarea'].includes(c.tag)||c.tag==='input'&&c.type==='submit'?'allow':'deny';}return baseDecide(ctx);};
  addon=createBrowserAddon();const session=await addon.attach(host,{projectId:'portal-'+name}),controller=new AbortController();timer=setTimeout(()=>{row.budgetExceeded=true;controller.abort();},180000);
  const memory=kind!=='no-memory'?state.learning.memory:undefined;
  const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},...(memory?{memory}:{}),tabs:()=>[{tabId:name}],onMetric:event=>{row.metrics.push(event);if(event.kind==='model_end'||event.kind==='run_end')emit({service:name,kind,index,event:event.kind,ms:event.elapsedMs,state:event.state});},model:{id:status.model,complete:async(messages,tools,ctx)=>{
   for(const m of messages.filter(x=>x.role==='tool')){try{const v=JSON.parse(m.content);if(v.error||v.stopped){const f={error:v.error,cause:v.cause,stoppedAt:v.stopped?.index,operations:v.operations};if(!row.feedback.some(x=>JSON.stringify(x)===JSON.stringify(f)))row.feedback.push(f);}}catch{}}
   const result=await provider.complete(messages,tools,ctx.signal,text=>{if(text)ctx.onEvent({type:'first_content'});},()=>{},()=>{},{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});row.decisions.push((result.calls??[]).map(x=>x.function.name));return result;
  }}});
  const outcome=await runner.run({task:{taskId:name+'-'+kind+'-'+index+'-'+crypto.randomUUID(),runId:crypto.randomUUID(),request:`현재 ${name} 공개 홈의 검색창에 입력하고 Enter를 눌러 일반 통합검색으로 "${query}"를 검색하세요. AI 검색 버튼은 사용하지 않습니다. 검색 결과의 앞쪽 일반 결과 제목 3개를 화면 그대로 읽어 [{"title":"제목"},{"title":"제목"},{"title":"제목"}] JSON 배열만 답하세요. 광고나 자동완성 후보는 검색 결과로 세지 마세요. 결과 링크를 열거나 로그인하지 않습니다.`,criteria:['query-and-visible-results']},tabId:name,signal:controller.signal});
  row.pendingKind=outcome.checkpoint.pending?.kind;row.pendingQuestion=outcome.checkpoint.pending?.question;row.state=outcome.state;row.success=outcome.state==='COMPLETED';row.error=outcome.error;row.receipts=outcome.checkpoint.receipts.map(x=>({tool:x.tool,status:x.status}));row.modelCalls=row.metrics.filter(x=>x.kind==='model_end').length;row.runMs=row.metrics.findLast(x=>x.kind==='run_end')?.elapsedMs;
  if(row.success)row.publicAnswer=JSON.parse(outcome.answer);if(kind==='learning'&&row.success&&state.learning.drafts.length===1){state.learning.review();row.draftReviewedForQualification=true;row.reviewedArtifact=structuredClone(state.learning.cards.values().next().value);}
 }catch(error){row.error=error.name;row.state='FAILED';}
 finally{clearTimeout(timer);await addon?.detach();row.totalMs=performance.now()-start;await persist();emit({event:'trial_end',service:name,kind,index,success:row.success,state:row.state,totalMs:row.totalMs,calls:row.modelCalls,feedback:row.feedback});}
}
async function dispatch(command){
 const {op,service}=command;
 if(op==='extension'){const extension=await import('../evaluation/portal-public-extension.mjs?revision='+Date.now());return extension.run({command,config,services,get,provider,report,persist,emit});}
 if(op==='results'){const state=await get(service);if(await classify(state)==='ready')emit({event:'public_results',service,results:await results(state)});return;}
 if(op==='inspect'){
  const state=await get(service);if(state.page.url()==='about:blank')await state.page.goto(config[service].home,{waitUntil:'domcontentloaded',timeout:30000});
  const access=await classify(state);emit({event:'inspect',service,access,...(access==='ready'?{controls:await state.page.locator('input,textarea,button,a').evaluateAll(xs=>xs.filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height;}).map(el=>({tag:el.tagName,type:el.type,role:el.getAttribute('role'),name:(el.getAttribute('aria-label')||el.getAttribute('title')||el.value||el.textContent||'').trim().slice(0,70)})).filter(x=>/검색|search|로그인|sign in/i.test(x.name)||['TEXTAREA','INPUT'].includes(x.tag)).slice(0,24))}:{})});return;
 }
 if(op==='trial')return publicTrial(service,command.kind,command.index,command.query);
 if(op==='suite'){
  for(const name of ['naver']){
   await publicTrial(name,'learning',0,'Playwright 공식 문서');
   const initial=report.trials.at(-1);if(!initial.success||!initial.draftReviewedForQualification){emit({event:'suite_service_stopped',service:name,reason:'learning_not_qualified'});continue;}
   for(let i=1;i<=3;i++)for(const kind of i%2?['reuse','no-memory']:['no-memory','reuse'])await publicTrial(name,kind,i,['기상청 날씨누리','국립중앙박물관 관람시간','한국관광공사 대한민국 구석구석'][i-1]);
  }return;
 }
 if(op==='status'){emit({event:'status',services:[...services.values()].map(s=>{const u=new URL(s.page.url());return {service:s.name,host:u.hostname,path:u.pathname};})});return;}
 if(op==='close'){for(const s of services.values()){await s.client.close();await s.server.close();await s.context.close();}provider.disconnect();await browser.close();report.finishedAt=new Date().toISOString();await persist();process.exit(0);}
 throw Error('unknown_command');
}
await persist();emit({event:'ready',browser:report.browserVersion});
let queue=Promise.resolve();createInterface({input:process.stdin}).on('line',line=>{queue=queue.then(()=>dispatch(JSON.parse(line))).catch(error=>emit({event:'command_failed',error:error.name,message:error.message.slice(0,180)}));});
