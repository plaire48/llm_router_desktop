// Paired real-Chrome experiment with deterministic model transport.
// Reports every model request and durable host primitive; no real LLM claim.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {PLAN_PROMPT} from '../task-plan.js';
import {scopeAuditCompletion,goalReviewPayload} from '../tests/fixtures/goal-review.mjs';
import {createLinkProcedure} from '../site-procedures.js';
import {learnPage} from '../browser-knowledge.js';
const before=process.env.NUBI_COMPARE_BEFORE,after=process.env.NUBI_COMPARE_AFTER||resolve('dist');
assert(before,'Set NUBI_COMPARE_BEFORE to the frozen pre-change dist folder');
const runs=[],repeat=Number(process.env.NUBI_COMPARE_REPEATS||3);
const completion=(name,args={},content='')=>({choices:[{message:{content,...(name?{tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{})},finish_reason:name?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}});
async function sample(variant,iteration,mode='warm') {
  let nativeClicks=0,writes=0;
  const server=createServer((req,res)=>{
    if(req.url==='/click'){nativeClicks++;res.end('ok');return;}
    if(req.url==='/write'){writes++;res.end('ok');return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(req.url==='/rules'?'<title>접수 규정</title><h1>접수 규정</h1><p>마감일은 2026년 10월 15일입니다. 마감 이후 신청은 접수하지 않습니다.</p>':'<title>서비스 안내</title><h1>서비스 안내</h1><label>초안<input value="keep-original-data" oninput="navigator.sendBeacon(\'/write\')"></label><a id="info" href="/rules" onclick="navigator.sendBeacon(\'/click\')">접수 규정 안내</a>');
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${server.address().port}`,start=origin+'/start',destination=origin+'/rules';
  const profile=await mkdtemp(resolve(tmpdir(),'nubi-read-compare-')),extension=resolve(profile,'extension');
  let context,ui,page,routeError;const requests=[],modelTools=[],phases=[];let planned=false,verified=false,updated=false,executions=0;
  const steps=[{text:'접수 규정 확인',status:'in_progress',expected_outcome:'접수 규정의 마감일과 마감 이후 제외 조건을 실제 페이지에서 확인하고 입력하지 않음'},{text:'결과 보고',status:'pending',expected_outcome:'확인한 마감일과 제외 조건을 답변에 함께 표시함'}];
  try {
    await cp(variant==='before'?before:after,extension,{recursive:true});
    const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
    context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    await context.route('https://aipro.sdsdev.co.kr/api/models',route=>route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144,max_input_tokens:221184}]}}));
    await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions',async route=>{
      try {
        const body=route.request().postDataJSON();const audit=scopeAuditCompletion(body);
        if(audit){requests.push('scope_audit');return route.fulfill({json:audit});}
        if(body.messages[0].content.startsWith(PLAN_PROMPT)){requests.push('plan');return route.fulfill({json:completion('update_plan',{steps})});}
        const review=goalReviewPayload(body.messages);
        if(review){requests.push(review.phase);phases.push(review.phase);
          const text=await page.locator('body').innerText(),correct=page.url()===destination&&text.includes('2026년 10월 15일')&&text.includes('마감 이후 신청은 접수하지 않습니다')&&nativeClicks===1&&writes===0;
          assert(correct,'Independent fixture state must pass before accepting review');
          const proof=review.evidence.findLast(item=>item.usable&&item.tool==='verify_page');assert(proof);
          return route.fulfill({json:completion(null,{},JSON.stringify({status:'complete',checks:[{requirement:steps[0].expected_outcome,status:'met',evidence_ids:[proof.id]}],next_step:''}))});
        }
        requests.push('execution');assert(++executions<=9,'Unbounded fixture executor');
        const result=JSON.parse(body.messages.findLast(m=>m.role==='tool')?.content||'null');
        let name,args={};
        if(!planned){planned=true;name=body.tools?.some(t=>t.function.name==='open_site_procedure')?'open_site_procedure':'browser_snapshot';if(name==='open_site_procedure')args={procedure_id:'fixture-route'};}
        else if(result?.error){name='browser_snapshot';}
        else if((result?.observation||result)?.url===start){
          const candidates=(result.observation||result).frames.flatMap(f=>f.elements||[]).filter(e=>e.role==='link'&&e.name==='접수 규정 안내'&&e.destination===destination);
          // Mismatch scenario preserves the original requested exact destination;
          // the ordinary executor uses the currently observed unique valid link.
          assert.equal(candidates.length,1);name='click_element';args={ref:candidates[0].ref};
        } else if(!verified){verified=true;name='verify_page';args={checks:[{kind:'text_present',expected:'2026년 10월 15일'},{kind:'text_present',expected:'마감 이후 신청은 접수하지 않습니다'}]};}
        else if(!updated){updated=true;name='update_plan';args={steps:steps.map((s,i)=>({...s,status:i?'in_progress':'completed'}))};}
        const content=name?'':'마감일은 2026년 10월 15일입니다. 마감 이후 신청은 접수하지 않습니다.';
        if(name)modelTools.push(name);
        await route.fulfill({json:completion(name,args,content)});
      } catch(error){routeError=error;await route.abort();}
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(()=>chrome.storage.local.set({browserWorkMode:'current'}));
    page=await context.newPage();await page.goto(start);
    ui=await context.newPage();await ui.setViewportSize({width:420,height:850});await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
    await ui.getByRole('button',{name:'AI Pro',exact:true}).waitFor();
    await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:1}}));
    await ui.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
    const uiId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
    await worker.evaluate(async({uiId,start})=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===start);await chrome.storage.session.set({chatSourceTabs:{[uiId]:tab.id}});},{uiId,start});
    const now=Date.now(),entry={url:destination,origin,provider:'aipro',title:'접수 규정',sourceHash:'a'.repeat(64),document:{title:'접수 규정',headings:['접수 규정'],fields:[],controls:[]},verifiedAt:now,reviewedAt:now,markdown:'# 접수 규정\n마감일 2026년 10월 15일. 이후 신청 제외.'};
    const knowledge=learnPage({enabled:true,revision:0,entries:[]},entry,0);
    const card=createLinkProcedure({version:1,goalReviewed:true,startPage:start,steps:[{tool:'click_element',args:{},target:{role:'link',tag:'a',name:'접수 규정 안내',id:'info',destination},navigation:{from:start,title:'서비스 안내',to:destination}},{tool:'verify_page',checks:[{kind:'text_present',expected:'접수 규정'}]}]},knowledge.entries[0],{id:'fixture-route',now});assert(card);
    await worker.evaluate(({knowledge,card,mode})=>chrome.storage.local.set({browserKnowledge:knowledge,browserSiteProcedures:mode==='cold'?[]:[card]}),{knowledge,card,mode});
    if(mode==='mismatch')await page.locator('#info').evaluate(el=>{const other=el.cloneNode(true);other.removeAttribute('id');other.href='/other';el.after(other);});
    await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('접수 규정 안내를 열고 마감일과 마감 이후 제외 조건을 알려주세요. 입력하지 마세요.');
    const started=performance.now();await ui.getByRole('button',{name:'전송',exact:true}).click();
    await ui.waitForFunction(()=>document.querySelector('.message-assistant[data-state="done"],.message-assistant[data-state="error"]'),null,{timeout:60000});
    const durationMs=Math.round(performance.now()-started);
    if(routeError)throw routeError;
    const chat=await ui.evaluate(async()=>(await chrome.storage.local.get('chat')).chat);
    assert.equal(chat.messages.at(-1).state,'done',JSON.stringify(chat.messages.at(-1)));assert.equal(chat.task.goalReview.status,'complete');assert.equal(chat.task.verification.status,'passed');assert(chat.task.plan.every(s=>s.status==='completed'));assert.equal(phases.at(-1),'final');
    const answer=chat.messages.at(-1).content;assert(answer.includes('10월 15일'));assert(answer.includes('접수하지 않습니다'));assert.equal(page.url(),destination);assert.equal(nativeClicks,1);assert.equal(writes,0);
    const hostTools=chat.task.steps.map(s=>s.tool),row={variant,iteration,mode,durationMs,modelRequests:requests.length,requestPhases:requests,modelToolCalls:modelTools.length,modelTools,hostPrimitiveCalls:hostTools.length,hostTools,nativeClicks,writes,success:true,actualBrowser:true,actualModel:false};
    runs.push(row);console.log(JSON.stringify(row));
    await ui.waitForTimeout(5000);
  } finally {await context?.close();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true});}
}
for(let i=1;i<=repeat;i++)for(const variant of i%2?['before','after']:['after','before'])await sample(variant,i);
await sample('after',1,'cold');await sample('after',1,'mismatch');
const output=process.env.NUBI_COMPARE_OUTPUT||resolve('verification/read-procedure-quality-2026-10-01/comparison.json');await mkdir(resolve(output,'..'),{recursive:true});
await writeFile(output,JSON.stringify({scope:'one information-link task; paired 3 fresh profiles plus cold/mismatch; deterministic model transport, not Sol/Luna/Qwen accuracy',actualBrowser:true,actualModel:false,before,after,runs},null,2)+'\n');
