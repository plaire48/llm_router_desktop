// Real Chrome, fixture account/site. No real-model accuracy claim.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {recordStep,replayRecord} from '../browser-replay.js';
import {createLinkProcedure} from '../site-procedures.js';
import {documentObservedPage,observationHash,learnPage} from '../browser-knowledge.js';
let clicks=0;
const server=createServer((req,res)=>{
  if(req.url==='/clicked'){clicks++;res.end('ok');return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(req.url==='/rules'?'<title>접수 규정</title><h1>접수 규정</h1><p>마감일은 2026년 10월 15일입니다. 마감 이후 신청은 접수하지 않습니다.</p>':'<title>서비스 안내</title><h1>서비스 안내</h1><label>초안<input value="keep-original-data"></label><a id="info" href="/rules" onclick="navigator.sendBeacon(\'/clicked\')">접수 규정 안내</a>');
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/start';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-read-route-')),extension=resolve(profile,'extension');
let context,ui;const checks=[];const pass=text=>{checks.push(text);console.log('PASS '+text);};
try {
  await cp('dist',extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route('https://aipro.sdsdev.co.kr/**',route=>route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:20000}),page=await context.newPage();await page.goto(url);
  await worker.evaluate(()=>{chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:1}});return chrome.storage.local.set({browserWorkMode:'current'});});
  ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const rpc=async message=>{const result=await ui.evaluate(message=>chrome.runtime.sendMessage(message),message);assert(result.ok,JSON.stringify(result));return result.data;};
  for(let i=0;i<40;i++){if((await rpc({type:'GET_STATE'})).catalog?.models?.length)break;await ui.waitForTimeout(100);}
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,url),uiId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId,uiId})=>chrome.storage.session.set({chatSourceTabs:{[uiId]:tabId}}),{tabId,uiId});
  let request=await rpc({type:'START_CHAT',text:'접수 규정 안내를 열고 마감일과 제외 조건을 알려주세요. 입력하지 마세요.'});
  const tool=(name,args={},extra={})=>rpc({type:'RUN_TOOL',requestId:request.requestId,name,args,...extra});
  const before=await tool('browser_snapshot'),target=before.frames.flatMap(f=>f.elements||[]).find(e=>e.name==='접수 규정 안내');assert(target);
  const clicked=await tool('click_element',{ref:target.ref});assert.equal(clicked.actionIssued,true,JSON.stringify(clicked));assert.equal(clicked.navigationOnly,true,JSON.stringify(clicked));
  const verified=await tool('verify_page',{checks:[{kind:'text_present',expected:'2026년 10월 15일'},{kind:'text_present',expected:'마감 이후 신청은 접수하지 않습니다'}]});assert.equal(verified.verified,true);
  const replay=replayRecord({startPage:url,steps:[recordStep('click_element',{ref:target.ref},before,clicked).step,recordStep('verify_page',{checks:[{kind:'text_present',expected:'2026년 10월 15일'}]},clicked.observation,verified).step]},{id:'reviewed-fixture',goalReviewed:true});
  const document=documentObservedPage(verified.observation),entry={url:origin+'/rules',origin,provider:'aipro',title:'접수 규정',sourceHash:await observationHash(document),document,verifiedAt:Date.now(),reviewedAt:Date.now(),markdown:'# 접수 규정\n마감일 2026년 10월 15일. 이후 신청 제외.'};
  const knowledge=learnPage({enabled:true,revision:0,entries:[]},entry,0),card=createLinkProcedure(replay,knowledge.entries[0],{id:'read-route'});assert(card,JSON.stringify(replay));
  await rpc({type:'FINISH_CHAT',requestId:request.requestId,content:'fixture',status:200});await page.goto(url);
  await worker.evaluate(({knowledge,card})=>chrome.storage.local.set({browserKnowledge:knowledge,browserSiteProcedures:[card]}),{knowledge,card});
  await rpc({type:'NEW_CHAT'});request=await rpc({type:'START_CHAT',text:'접수 규정 안내를 열고 마감일과 제외 조건을 알려주세요. 입력하지 마세요.'});
  assert.equal(request.siteKnowledge.procedures[0].tool,'open_site_procedure');pass('reviewed route is selected from its start page before execution');
  const prepare=()=>tool('open_site_procedure',{procedure_id:card.id});
  const dispatch=prepared=>tool('click_element',{ref:prepared.ref},{procedureToken:prepared.procedureToken});
  let prepared=await prepare();assert.equal(prepared.prepared,true);
  const actual=await dispatch(prepared);assert.equal(actual.actionIssued,true);assert.equal(actual.actionTargetReceipt.status,'observed');assert.equal(actual.actionTargetReceipt.target.href,origin+'/rules');assert.equal(actual.siteProcedurePrimitive.before.url,url);assert.equal(page.url(),origin+'/rules');
  assert((await page.locator('body').innerText()).includes('마감 이후 신청은 접수하지 않습니다'));pass('normal click opens the expected document and retains actual target evidence');
  const count=clicks;assert.equal((await dispatch(prepared)).actionIssued,false);assert.equal(clicks,count);pass('single-use capability does not repeat navigation');
  await page.goto(url);prepared=await prepare();await page.locator('#info').evaluate(el=>{el.href='/other';});
  assert.equal((await dispatch(prepared)).actionIssued,false);assert.equal(clicks,count);pass('destination change after preparation blocks dispatch');
  await page.goto(url);prepared=await prepare();await page.locator('#info').evaluate(el=>el.after(el.cloneNode(true)));
  assert.equal((await dispatch(prepared)).actionIssued,false);assert.equal(clicks,count);pass('duplicate semantic target blocks dispatch');
  await page.goto(url);prepared=await prepare();await page.locator('#info').evaluate(el=>el.addEventListener('mouseenter',()=>{el.href='/other';}));
  const hoverChanged=await dispatch(prepared);assert.equal(hoverChanged.actionIssued,false,JSON.stringify(hoverChanged));assert.equal(clicks,count);pass('hover-time destination replacement is rejected before a native click');
  await page.goto(url);prepared=await prepare();await worker.evaluate(()=>chrome.storage.local.get('browserKnowledge').then(({browserKnowledge})=>chrome.storage.local.set({browserKnowledge:{...browserKnowledge,entries:browserKnowledge.entries.map(e=>({...e,documentVersion:e.documentVersion+1}))}})));
  assert.equal((await dispatch(prepared)).error,'procedure_changed');assert.equal(clicks,count);pass('changed wiki version revokes a prepared route');
  assert.equal(await page.getByRole('textbox',{name:'초안'}).inputValue(),'keep-original-data');
  const stored=await worker.evaluate(()=>chrome.storage.local.get('browserSiteProcedures'));assert(!JSON.stringify(stored).includes('keep-original-data'));pass('current inputs are preserved and never stored in the route');
  await rpc({type:'FINISH_CHAT',requestId:request.requestId,content:'fixture',status:200});
  // Synthetic draft/review metadata; native navigation/verification above is real.
  await worker.evaluate(async({knowledge,replay})=>{const {chat}=await chrome.storage.local.get('chat');const source=chat.messages.at(-1);source.replay=replay;chat.messages.push({id:'route-draft',role:'assistant',state:'done',content:'사이트 위키 초안을 만들었습니다.',wikiDraft:{title:'접수 규정',markdown:'# 접수 규정',procedureAvailable:true,procedureKind:'link_read'},creationSource:{kind:'wiki',revision:knowledge.revision,targetVersion:knowledge.entries[0].documentVersion,candidate:knowledge.entries[0],sourceId:source.id}});await chrome.storage.local.set({chat,browserKnowledge:knowledge});},{knowledge,replay});
  await ui.getByRole('button',{name:'사이트 위키 검토',exact:true}).click();
  for(const width of [320,1100]){await ui.setViewportSize({width,height:850});await ui.getByRole('checkbox',{name:'확인한 조회 절차도 연결',exact:true}).waitFor();assert.equal(await ui.locator('body').evaluate(el=>el.scrollWidth>window.innerWidth),false);}
  await ui.screenshot({path:'verification/read-procedure-quality-2026-10-01/route-option.png'});await ui.getByRole('checkbox',{name:'확인한 조회 절차도 연결',exact:true}).check();await ui.getByRole('button',{name:'위키 저장',exact:true}).click();await ui.getByRole('button',{name:'사이트 위키 검토',exact:true}).click();
  await ui.getByText('조회 절차 연결됨. 실행할 때 화면과 목적지를 다시 확인합니다.',{exact:true}).waitFor();
  const saved=await worker.evaluate(()=>chrome.storage.local.get(['browserSiteProcedures','chat']));assert.equal(saved.browserSiteProcedures.length,1);assert.equal(saved.browserSiteProcedures[0].kind,'link_read');assert.equal(saved.chat.messages.at(-1).wikiDraft.procedureKind,'link_read');pass('accessible draft approval saves and displays a reviewed information route');
  await rpc({type:'UPDATE_BROWSER_KNOWLEDGE',clear:true});assert.deepEqual((await worker.evaluate(()=>chrome.storage.local.get('browserSiteProcedures'))).browserSiteProcedures,[]);pass('wiki deletion removes its route');
  console.log(JSON.stringify({checks:checks.length,realChrome:true,actualModel:false,clicks}));
} finally {await context?.close();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true});}
