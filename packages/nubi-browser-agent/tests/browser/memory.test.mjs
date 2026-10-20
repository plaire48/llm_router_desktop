import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createConnection} from '@playwright/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../../extensions/aipro-chat/agent-runtime.js';
import {createBrowserAddon} from '../../dist/index.js';
import {createPiBrowserRunner} from '../../dist/pi.js';
import {createPlaywrightMcpPort} from '../../dist/playwright.js';
import {hostFixture} from '../host.mjs';
import {startLegacySite} from '../../evaluation/legacy-site.mjs';
import {createProcedureHost} from '../../evaluation/procedure-host.mjs';

let browser;before(async()=>{browser=await chromium.launch({headless:true,channel:'chrome'});});after(()=>browser?.close());
const answer=content=>({content,calls:[]});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
function observed(messages){for(const m of [...messages].reverse()){try{const x=JSON.parse(m.role==='tool'?m.content:m.content.slice(m.content.indexOf('\n')+1)),o=x.observation??(x.binding?x:null);if(o?.state==='ready')return o;}catch{}}throw Error('no_observation');}

test('verified Pi experience creates a value-free draft and existing replay handles three new inputs',async t=>{
  const site=await startLegacySite(),context=await browser.newContext(),page=await context.newPage(),learning=createProcedureHost({page,origin:site.origin});
  const server=await createConnection({timeouts:{action:2000,navigation:3000,settle:0},saveSession:false,snapshot:{mode:'none'},console:{level:'error'}},async()=>context);
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);const client=new Client({name:'memory-contract',version:'1'});await client.connect(a);
  t.after(async()=>{await client.close();await server.close();await context.close();await site.close();});
  async function trial(index,recipient,body,reuse=false,changed=false,preflight=false){
    site.reset({changed});await page.goto(site.origin);await page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('[contenteditable=true]').waitFor();
    const {host}=hostFixture();host.browser=createPlaywrightMcpPort({tabs:()=>[{tabId:'tab',page,client}],access:async()=> 'ready',reconcile:async()=>({status:'unconfirmed',evidenceRefs:[]}),verify:async(_ctx,cp,candidate)=>({criteria:cp.criteria.map(id=>({id,satisfied:site.snapshot()?.recipient===recipient&&site.snapshot()?.body===body&&page.url()===site.origin+'/saved'&&candidate?.answer===recipient+' '+body,evidenceRefs:['server:readback']}))})});
    if(preflight){const execute=host.browser.execute;let withheld=false;host.browser.execute=async(...args)=>{if(!withheld&&args[1].tool==='browser_click'){withheld=true;return {status:'not_started',evidenceRefs:[],data:{error:'binding_changed'}};}return execute(...args);};}
    const addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'memory-evaluation'});let calls=0;const feedback=[];
    const runner=createPiBrowserRunner({session,pi:{answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent},memory:learning.memory,tabs:()=>[{tabId:'tab'}],model:{id:'synthetic-policy',complete:async messages=>{
      calls++;for(const m of messages.filter(m=>m.role==='tool')){try{const x=JSON.parse(m.content);if(x.stopped||x.error)feedback.push({error:x.error,stopped:x.stopped,operations:x.operations,confirmedSteps:x.confirmedSteps});}catch{}}const o=observed(messages);
      if(reuse&&calls===1){const card=learning.cards.values().next().value;return call('use_browser_procedure',{id:card.id,version:card.version,values:{v1:recipient,v2:body}});}
      if(reuse&&!changed||reuse&&changed&&calls===3)return answer(recipient+' '+body);
      if(reuse&&changed&&calls===2){const result=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);return call('resume_browser_procedure',{continuationId:result.recovery.continuationId,observationId:o.observationId,targets:[{stepIndex:1,targetId:o.data.candidates.find(c=>c.tag==='div'&&c.editable).targetId},{stepIndex:2,targetId:o.data.candidates.find(c=>c.name==='저장').targetId}]});}
      if(o.data.mode!=='structure')return call('browser_observe',{tabId:'tab',mode:'structure'});
      const choose=fn=>o.data.candidates.find(fn)?.targetId;
      let name='browser_type',args;
      if(!reuse&&calls===2)args={targetId:choose(c=>c.tag==='input'),text:recipient};
      else if(!reuse&&calls===3||reuse&&changed&&calls===2)args={targetId:choose(c=>c.tag==='div'&&c.editable),text:body};
      else if(!reuse&&calls===4||reuse&&changed&&calls===3){name='browser_click';args={targetId:choose(c=>c.name==='저장')};}
      else if(!reuse&&calls===5){name='browser_click';args={targetId:choose(c=>c.name==='저장된 내용 보기')};}
      else return answer(recipient+' '+body);
      return call(name,{...args,actionId:crypto.randomUUID(),observationId:o.observationId});
    }}});
    const result=await runner.run({task:{taskId:'task-'+index,runId:'run-'+index,request:`수신자 ${recipient}, 본문 ${body}를 저장하고 다시 열어 확인한다`,criteria:['saved']},tabId:'tab'});await addon.detach();return {result,calls,feedback};
  }
  const learned=await trial(0,'learn@example.invalid','INITIAL_PRIVATE_BODY');assert.equal(learned.result.state,'COMPLETED',JSON.stringify({result:learned.result,server:site.snapshot()}));
  assert.equal(learning.drafts.length,1,JSON.stringify(learned.result.metrics.filter(x=>x.purpose==='knowledge')));assert.ok(!JSON.stringify(learning.drafts).includes('INITIAL_PRIVATE_BODY'));assert.ok(!JSON.stringify(learning.drafts).includes('learn@example.invalid'));assert.equal(learning.cards.size,0,'learning is not approval');
  learning.review();
  for(let i=1;i<=3;i++){const {result,calls,feedback}=await trial(i,`new-${i}@example.invalid`,'NEW_PRIVATE_BODY_'+i,true);assert.equal(result.state,'COMPLETED',JSON.stringify({state:result.state,receipts:result.checkpoint.receipts,feedback}));assert.equal(calls,2);assert.equal(site.saveCount(),1);}
  const invalidated=await trial(5,'unissued@example.invalid','UNISSUED_BODY',true,false,true);assert.equal(invalidated.result.state,'COMPLETED',JSON.stringify(invalidated.feedback));assert.equal(invalidated.calls,2);assert.equal(site.saveCount(),1);assert.equal(invalidated.result.checkpoint.receipts.filter(r=>r.status==='not_started').length,1);assert.equal(invalidated.result.checkpoint.receipts.filter(r=>r.tool==='browser_type'&&r.status==='confirmed').length,2,'confirmed fields are not replayed after an unissued click');
  const changed=await trial(4,'changed@example.invalid','CHANGED_BODY',true,true);assert.equal(changed.result.state,'COMPLETED',JSON.stringify(changed.feedback));assert.equal(changed.calls,3);assert.equal(site.saveCount(),1);assert.equal(changed.result.checkpoint.receipts.length,4,'confirmed first field is not replayed after mismatch');
});
