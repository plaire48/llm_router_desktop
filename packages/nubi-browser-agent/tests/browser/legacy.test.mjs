import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createBrowserAddon} from '../../dist/index.js';
import {createPlaywrightMcpPort} from '../../dist/playwright.js';
import {deferred,hostFixture} from '../host.mjs';
import {startLegacySite} from '../../evaluation/legacy-site.mjs';

let browser;
before(async()=>{browser=await chromium.launch({headless:true,channel:process.env.NUBI_TEST_BROWSER_CHANNEL??'chrome'});});
after(async()=>{await browser?.close();});

async function setup(t,siteOptions,scope){
  const site=await startLegacySite(siteOptions),context=await browser.newContext(),page=await context.newPage();
  await page.goto(site.origin);await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('[contenteditable=true]').waitFor();
  const server=await createConnection({timeouts:{action:2000,navigation:3000,settle:0},saveSession:false,codegen:'none',snapshot:{mode:'none'},console:{level:'error'}},async()=>context);
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);
  const client=new Client({name:'nubi-browser-contract-test',version:'0.2.0'},{capabilities:{}});await client.connect(a);
  const calls=[],callTool=client.callTool.bind(client);client.callTool=async(...args)=>{const result=await callTool(...args);calls.push({tool:args[0].name,isError:result.isError,...(result.isError?{content:result.content}:{})});return result;};
  const tabs=[{tabId:'tab-1',page,client}],{host}=hostFixture();let access='ready';
  host.browser=createPlaywrightMcpPort({tabs:()=>tabs,...(scope?{scope:tab=>scope(tab.page)}:{}),access:async()=>access,verify:async(_ctx,checkpoint)=>({criteria:checkpoint.criteria.map(id=>({id,satisfied:site.snapshot()?.body==='변경 작업 전 보안팀 확인',evidenceRefs:site.snapshot()?['fixture:saved']:[]}))}),reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]})});
  const errors=[],execute=host.browser.execute;host.browser.execute=async(...args)=>{try{return await execute(...args);}catch(e){errors.push(e.code??e.message);throw e;}};
  const addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'legacy-project'}),taskId='legacy-task';
  await session.openTask({taskId,runId:'run-1',request:'관찰한 작성 화면에 입력하고 저장 결과를 확인한다',criteria:['saved-body']});
  t.after(async()=>{await addon.detach();await client.close();await server.close();await context.close();await site.close();});
  const act=(observation,tool,args)=>session.execute(taskId,{actionId:crypto.randomUUID(),tool,arguments:args,binding:observation.binding,observationId:observation.observationId,catalogVersion:session.catalog().version});
  return {site,page,context,tabs,session,taskId,act,errors,calls,addon,client,setAccess:value=>{access=value;}};
}

test('official MCP snapshot and click use the same host page; after-action observation is reusable',async t=>{
  const {session,taskId,act,page,errors,calls}=await setup(t);
  const observation=await session.observe(taskId,'tab-1');assert.equal(observation.data.mode,'accessibility');
  const line=observation.data.snapshot.split('\n').find(x=>x.includes('button "주소록 열기"'));
  assert.ok(line,observation.data.snapshot);const targetId=line.match(/\[ref=([^\]]+)\]/)[1];
  const popup=page.waitForEvent('popup',{timeout:2000}).catch(()=>null);const result=await act(observation,'browser_click',{targetId});
  assert.equal(result.receipt.status,'confirmed',JSON.stringify({errors,calls}));const child=await popup;assert.ok(child);assert.equal(await child.title(),'복합 웹 시험');assert.ok(result.observation);
  assert.notEqual(result.observation.observationId,observation.observationId);
});

test('structure fallback fills unnamed input and nested contenteditable; server and reopened page confirm save',async t=>{
  const {session,taskId,act,site,page}=await setup(t,{saveDelayMs:160});
  let observation=await session.observe(taskId,'tab-1',{mode:'structure'});
  assert.equal(observation.data.frames.length,3);
  const recipient=observation.data.candidates.find(x=>x.tag==='input'&&x.context.includes('수신자 주소'));
  // A table cell's text may be outside its immediate parent; metadata must preserve its row context.
  assert.ok(recipient,JSON.stringify(observation.data.candidates));
  let result=await act(observation,'browser_type',{targetId:recipient.targetId,text:'minsu.ops@example.invalid'});assert.equal(result.receipt.status,'confirmed');observation=result.observation;
  const body=observation.data.candidates.find(x=>x.editable&&x.tag==='div');assert.ok(body);
  result=await act(observation,'browser_type',{targetId:body.targetId,text:'변경 작업 전 보안팀 확인'});assert.equal(result.receipt.status,'confirmed');observation=result.observation;
  const save=observation.data.candidates.find(x=>x.name==='저장');assert.ok(save);
  const persisted=page.waitForResponse(r=>r.url()===site.origin+'/save'&&r.request().method()==='POST',{timeout:3000});
  result=await act(observation,'browser_click',{targetId:save.targetId});assert.equal(result.receipt.status,'confirmed');
  await persisted;
  assert.deepEqual(site.snapshot(),{recipient:'minsu.ops@example.invalid',body:'변경 작업 전 보안팀 확인'});
  assert.ok(result.observation,'late child form navigation returns fresh evidence');
  const reopen=result.observation.data.candidates.find(x=>x.name==='저장된 내용 보기');
  const opened=await act(result.observation,'browser_click',{targetId:reopen.targetId});assert.equal(opened.receipt.status,'confirmed');
  assert.equal(page.url(),site.origin+'/saved');assert.match(await page.locator('body').innerText(),/변경 작업 전 보안팀 확인/);assert.equal(site.saveCount(),1);
  assert.equal((await session.complete(taskId)).completed,true);
});

test('child-only reload invalidates frame binding despite unchanged parent URL; no stale write occurs',async t=>{
  const {session,taskId,act,page,site}=await setup(t);
  const old=await session.observe(taskId,'tab-1',{mode:'structure'}),parentURL=page.url();
  await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('input[name=recipient]').fill('user edit');
  const candidate=old.data.candidates.find(x=>x.tag==='input');assert.ok(candidate);
  await assert.rejects(act(old,'browser_type',{targetId:candidate.targetId,text:'stale overwrite'}),/binding_changed/);
  const fresh=await session.observe(taskId,'tab-1',{mode:'structure'});
  await page.getByRole('button',{name:'하위 화면 새로고침'}).click();
  await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('[contenteditable=true]').waitFor();
  assert.equal(page.url(),parentURL);assert.equal(site.snapshot(),null);
  const other=fresh.data.candidates.find(x=>x.tag==='input');
  await assert.rejects(act(fresh,'browser_type',{targetId:other.targetId,text:'old child'}),/binding_changed/);
});

test('replaced elements and unobserved targets cannot be reused; hidden inputs are not candidates',async t=>{
  const {session,taskId,act,page}=await setup(t);
  const old=await session.observe(taskId,'tab-1',{mode:'structure'}),target=old.data.candidates.find(x=>x.tag==='input');
  assert.equal(old.data.candidates.filter(x=>x.tag==='input').length,1,'hidden body transport field is excluded');
  await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('input[name=recipient]').evaluate(el=>el.replaceWith(el.cloneNode(true)));
  await assert.rejects(act(old,'browser_type',{targetId:target.targetId,text:'wrong'}),/binding_changed/);
  const fresh=await session.observe(taskId,'tab-1',{mode:'structure'});
  const outcome=await act(fresh,'browser_click',{targetId:'target-from-another-tab'});
  assert.equal(outcome.receipt.status,'not_started');assert.equal(outcome.data.error,'target_unobserved');
});

test('official MCP typing resolves an unnamed textbox inside the nested frame',async t=>{
  const {session,taskId,act,page,calls}=await setup(t);
  const observed=await session.observe(taskId,'tab-1');
  const line=observed.data.snapshot.split('\n').find(x=>/- textbox \[ref=/.test(x));assert.ok(line,observed.data.snapshot.slice(0,2000));
  const targetId=line.match(/\[ref=([^\]]+)\]/)[1];
  const result=await act(observed,'browser_type',{targetId,text:'native-mcp@example.invalid'});
  assert.equal(result.receipt.status,'confirmed');assert.ok(calls.some(x=>x.tool==='browser_type'&&!x.isError));
  assert.equal(await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('input[name=recipient]').inputValue(),'native-mcp@example.invalid');
});

test('sensitive inputs cannot reenter structure candidates through tabindex or receive MCP typing',async t=>{
  const {session,taskId,act,page}=await setup(t);
  const structural=await session.observe(taskId,'tab-1',{mode:'structure'});assert.equal(structural.data.candidates.filter(x=>x.tag==='input').length,1);
  const observed=await session.observe(taskId,'tab-1'),line=observed.data.snapshot.split('\n').find(x=>x.includes('textbox "보호 입력"'));assert.ok(line);
  const targetId=line.match(/\[ref=([^\]]+)\]/)[1],outcome=await act(observed,'browser_type',{targetId,text:'must-not-enter'});
  assert.equal(outcome.receipt.status,'not_started');assert.equal(outcome.data.error,'target_sensitive');
  assert.equal(await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').getByLabel('보호 입력').inputValue(),'');
});

test('typing a noneditable observed button is refused before MCP dispatch',async t=>{
  const {session,taskId,act,calls}=await setup(t),observed=await session.observe(taskId,'tab-1');
  const line=observed.data.snapshot.split('\n').find(x=>x.includes('button "주소록 열기"')),targetId=line.match(/\[ref=([^\]]+)\]/)[1];
  const outcome=await act(observed,'browser_type',{targetId,text:'must-not-enter'});assert.equal(outcome.receipt.status,'not_started');
  assert.equal(outcome.data.error,'target_not_editable');assert.equal(calls.filter(x=>x.tool==='browser_type').length,0);
});

test('cancelled MCP dispatch stays uncertain; detach waits for the physical call and preserves the host page',async t=>{
  const {session,taskId,act,page,addon,client}=await setup(t),entered=deferred(),finish=deferred();
  const observed=await session.observe(taskId,'tab-1');
  const line=observed.data.snapshot.split('\n').find(x=>/- textbox \[ref=/.test(x));assert.ok(line);
  const targetId=line.match(/\[ref=([^\]]+)\]/)[1],callTool=client.callTool.bind(client);
  client.callTool=async(...args)=>{if(args[0].name==='browser_type'){entered.resolve();await finish.promise;}return callTool(...args);};
  const writing=act(observed,'browser_type',{targetId,text:'pending@example.invalid'});await entered.promise;
  await session.cancelTask(taskId);assert.equal((await writing).receipt.status,'unconfirmed');
  let detached=false;const draining=addon.detach().then(()=>{detached=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(detached,false);
  finish.resolve();await draining;assert.equal(page.isClosed(),false);assert.equal(session.checkpoint(taskId).receipts[0].status,'unconfirmed');
});

test('cross-origin nested frame supports a scoped structural observation and native input',async t=>{
  const {session,taskId,act,page,site}=await setup(t);
  await page.goto(site.origin+'/outer?cross=1');await page.frameLocator('iframe[name=editor]').locator('[contenteditable=true]').waitFor();
  const initial=await session.observe(taskId,'tab-1',{mode:'structure'});
  const field=initial.data.candidates.find(x=>x.tag==='input');assert.ok(field);
  const scoped=await session.observe(taskId,'tab-1',{mode:'structure',frameId:field.frameId});
  assert.ok(scoped.data.candidates.every(x=>x.frameId===field.frameId));
  const recipient=scoped.data.candidates.find(x=>x.tag==='input');
  const outcome=await act(scoped,'browser_type',{targetId:recipient.targetId,text:'cross-origin@example.invalid'});
  assert.equal(outcome.receipt.status,'confirmed');
  assert.equal(await page.frameLocator('iframe[name=editor]').locator('input[name=recipient]').inputValue(),'cross-origin@example.invalid');
});

test('same-frame DOM replacement invalidates the exact previously observed input',async t=>{
  const {session,taskId,act,page}=await setup(t);
  const observation=await session.observe(taskId,'tab-1',{mode:'structure'}),candidate=observation.data.candidates.find(x=>x.tag==='input');
  // Host policy path is already covered by core tests; this exercises a late native target replacement.
  await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('input[name=recipient]').evaluate(el=>el.outerHTML='<input name="recipient" value="user changed">');
  await assert.rejects(act(observation,'browser_type',{targetId:candidate.targetId,text:'old draft'}),/binding_changed/);
  assert.equal(await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('input[name=recipient]').inputValue(),'user changed');
});

test('protected surface returns no DOM or structural candidates',async t=>{
  const {session,taskId,setAccess}=await setup(t);setAccess('login_required');
  const observed=await session.observe(taskId,'tab-1',{mode:'structure'});
  assert.equal(observed.state,'login_required');assert.equal(observed.data,undefined);assert.equal(session.checkpoint(taskId).state,'WAITING_FOR_USER');
});


test('prevented form submit does not wait for a nonexistent navigation',async t=>{
  const {session,taskId,act,page,site}=await setup(t);
  await page.frames().find(f=>f.name()==='editor').evaluate(()=>document.querySelector('form').addEventListener('submit',event=>event.preventDefault()));
  const observation=await session.observe(taskId,'tab-1',{mode:'structure'}),save=observation.data.candidates.find(x=>x.name==='저장');
  const start=performance.now(),result=await act(observation,'browser_click',{targetId:save.targetId});assert.equal(result.receipt.status,'confirmed');assert.ok(performance.now()-start<2000);assert.equal(site.saveCount(),0);assert.ok(result.observation);
});

test('document navigation racing tracker installation is a known invalidated read, then fresh observation recovers',async t=>{
 const {session,taskId,page}=await setup(t),frame=page.frames().find(f=>f.name()==='editor'),evaluate=frame.evaluateHandle.bind(frame);let replaced=false;
 frame.evaluateHandle=async(...args)=>{const handle=await evaluate(...args);if(!replaced){replaced=true;await frame.goto(new URL('/editor?replacement=1',page.url()).href,{waitUntil:'domcontentloaded'});}return handle;};
 await assert.rejects(session.observe(taskId,'tab-1',{mode:'structure'}),error=>['frame_changed','observation_changed'].includes(error.code));
 frame.evaluateHandle=evaluate;const fresh=await session.observe(taskId,'tab-1',{mode:'structure'});assert.equal(fresh.state,'ready');assert.equal(fresh.data.frames.length,3);assert.equal(session.checkpoint(taskId).receipts.length,0);
});

test('host-scoped roots ignore unrelated frame churn but reject changes to an observed scoped target',async t=>{
 const {session,taskId,page,act}=await setup(t,undefined,page=>[{frame:page.mainFrame(),root:page.locator('#focus-root')}]);
 await page.evaluate(()=>{const root=document.createElement('form');root.id='focus-root';root.innerHTML='<label>Query<input aria-label="Query"></label><button type="button">Search</button>';document.body.prepend(root);});
 const observation=await session.observe(taskId,'tab-1');assert.equal(observation.data.mode,'accessibility');assert.equal(observation.data.frames.length,1);assert.equal(observation.data.candidates.length,2);assert.match(observation.data.snapshot,/Query/);
 const editor=page.frames().find(f=>f.name()==='editor');await editor.goto(new URL('/editor?outside=1',page.url()).href);await page.evaluate(()=>document.body.append(document.createElement('aside')));
 const input=observation.data.candidates.find(x=>x.tag==='input'),result=await act(observation,'browser_type',{targetId:input.targetId,text:'new query'});assert.equal(result.receipt.status,'confirmed');assert.equal(await page.locator('#focus-root input').inputValue(),'new query');
 const current=result.observation,target=current.data.candidates.find(x=>x.tag==='input');await page.locator('#focus-root input').evaluate(el=>el.replaceWith(el.cloneNode(true)));
 await assert.rejects(act(current,'browser_type',{targetId:target.targetId,text:'stale'}),/binding_changed/);assert.notEqual(await page.locator('#focus-root input').inputValue(),'stale');
});

test('scoped binding rejects a changed link destination and form submission destination without a text change',async t=>{
 const {session,taskId,page,act}=await setup(t,undefined,page=>[{frame:page.mainFrame(),root:page.locator('#scope-form')}]);
 await page.evaluate(()=>{const root=document.createElement('form');root.id='scope-form';root.action='/first';root.innerHTML='<input aria-label="Query"><a href="/first">Read</a><button>Search</button>';document.body.prepend(root);});
 const old=await session.observe(taskId,'tab-1'),link=old.data.candidates.find(x=>x.tag==='a');
 await page.locator('#scope-form a').evaluate(el=>el.setAttribute('href','/different'));
 await assert.rejects(act(old,'browser_click',{targetId:link.targetId}),/binding_changed/);
 const fresh=await session.observe(taskId,'tab-1'),input=fresh.data.candidates.find(x=>x.tag==='input');
 await page.locator('#scope-form').evaluate(el=>el.setAttribute('action','/different'));
 await assert.rejects(act(fresh,'browser_press_key',{targetId:input.targetId,key:'Enter'}),/binding_changed/);assert.equal(new URL(page.url()).pathname,'/');
});
