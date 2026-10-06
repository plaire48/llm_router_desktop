import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchWorkers,groundResearchReport,researchEligible} from '../research-workers.js';
import {createResearchBrowser,researchAddress,researchRules,RESEARCH_RULE_BASE} from '../research-browser.js';
import {runAgent} from '../agent-runtime.js';

const text='Opening hours are 09:00–18:00. Closed March 2026. Membership excludes non-residents.';
const packet=(url='https://example.test/a',hash='a'.repeat(64))=>({ok:true,dataKind:'page_content',url,frame:0,source_key:(url.endsWith('B')?'b':'a').repeat(64),source_document_id:'doc-1',content_hash:hash,observedAt:'2026-10-01T00:00:00Z',characters:text.length,ranges:[{start:0,end:text.length,markdown:text}],coverage:{partial:true}});
const assignment=(subject='A')=>({subject,question:'Find the schedule and its exceptions',fields:['schedule','eligibility'],start_url:`https://example.test/${subject}`,constraints:'Official sources only. Include temporary closure and exclusions.'});
const call=(name,args)=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
test('only independent comparison lookups offer workers; simple, write and current-page-only requests keep direct tools',()=>{
  assert(researchEligible('세 기관의 이용 자격과 운영시간을 비교해줘'));
  for(const goal of ['운영시간 알려줘','두 기관을 비교해서 신청 양식에 입력해줘','현재 페이지 안에서만 두 결과를 비교해줘','Compare two pages. Do not navigate.'])assert(!researchEligible(goal),goal);
});
test('reports reject unread and changed-source quotes, retain eligibility gaps and do not certify interpretations',()=>{
  const sources=new Map([['s',packet()]]);
  const good=groundResearchReport(assignment(),{findings:[{name:'schedule',value:'Closed March 2026',reference_id:'s',quote:'Closed March 2026.'}],gaps:[]},sources);
  assert.equal(good.fields.length,1);assert.equal(good.fields[0].interpretation_verified,false);assert(good.gaps.some(g=>g.startsWith('eligibility')));assert.equal(good.fields[0].start,text.indexOf('Closed'));
  const bad=groundResearchReport(assignment(),{findings:[{name:'schedule',value:'open',reference_id:'s',quote:'Open throughout March 2026.'},{name:'eligibility',value:'all',reference_id:'unread',quote:'Membership excludes non-residents.'}],gaps:[]},sources);
  assert.equal(bad.fields.length,0);assert.equal(bad.status,'partial');
});
test('real Pi children run at concurrency two with isolated briefs, quoted exceptions, cleanup and no page-writing tools',async()=>{
  const signal=new AbortController().signal,events=[],closed=[],evidence=[];let active=0,max=0;
  const browser=async op=>{
    if(op.operation==='close'){closed.push(op.worker_id);active--;return {ok:true};}
    if(op.operation==='open'){active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,15));}
    return packet(op.url);
  };
  const workers=createResearchWorkers({browser,signal,goal:'Compare three agencies with temporary closures and membership restrictions',modelId:'synthetic',run:runAgent,onStep:e=>events.push(e),onEvidence:(name,args,result)=>evidence.push(result),
    complete:async wire=>{
      const source=JSON.parse(wire.find(m=>m.role==='user').content).source;
      assert(wire[0].content.includes('eligibility'));assert(wire.length<5,'No parent transcript');
      const result=wire.findLast(m=>m.role==='tool');
      if(result)return {content:'Reported.'};
      await new Promise(resolve=>setTimeout(resolve,10));
      return call('submit_research',{findings:[{name:'schedule',value:'09:00–18:00 except closed March 2026',reference_id:source.reference_id,quote:'Opening hours are 09:00–18:00. Closed March 2026.'},{name:'eligibility',value:'Non-residents excluded',reference_id:source.reference_id,quote:'Membership excludes non-residents.'}],gaps:[]});
    }});
  const tasks=['A','B','C'].map(assignment),result=await workers.execute({tasks});
  assert.equal(max,2);assert.equal(closed.length,3);assert.equal(active,0);assert.equal(evidence.length,3);assert.equal(result.verification,'not_run');
  assert(result.research.every(r=>r.fields.length===2&&r.fields.every(f=>f.quote_checked&& !f.interpretation_verified)));
  assert.equal((await workers.execute({tasks})).error,'research_duplicate');assert(events.some(e=>e.analysis.reads===1));workers.close();
});
test('invalid batch and forbidden execution start no worker or tab',async()=>{
  let opens=0;const workers=createResearchWorkers({signal:new AbortController().signal,goal:'lookup',run:runAgent,browser:async()=>{opens++;},allowed:()=>false});
  assert.equal((await workers.execute({tasks:[assignment()]})).error,'tool_arguments_invalid');
  assert.equal((await workers.execute({tasks:[assignment(),assignment('B')]})).error,'research_unavailable');assert.equal(opens,0);workers.close();
});
test('leader receives independently read sources in its final review and shared hosts do not gain the Chrome transport',async()=>{
  const tasks=['A','B'].map(assignment),names=[],reviews=[];let rounds=0,children=0;
  const tools=[{type:'function',function:{name:'verify_page',parameters:{type:'object',properties:{}}}}];
  const result=await runAgent({goal:'Compare two agencies and disclose closure exceptions',messages:[{role:'user',content:'Compare two agencies and disclose closure exceptions'}],tools,
    harness:true,signal:new AbortController().signal,researchBrowser:async op=>op.operation==='close'?{ok:true}:packet(op.url),
    completeAnalysis:async wire=>{children++;if(wire.some(m=>m.role==='tool'))return {content:'Reported.'};const {source}=JSON.parse(wire.find(m=>m.role==='user').content);return call('submit_research',{findings:[{name:'schedule',value:'Closed March 2026',reference_id:source.reference_id,quote:'Closed March 2026.'}],gaps:['eligibility: not confirmed']});},
    complete:async(_messages,selected)=>{names.push(selected.map(tool=>tool.function.name));if(++rounds===1)return call('delegate_research',{tasks});return {content:'Both agencies are closed in March 2026. Eligibility remains unconfirmed.'};},execute:async()=>assert.fail('No leader page writes'),
    reviewGoal:async payload=>{reviews.push(payload);assert.equal(payload.evidence.filter(e=>e.tool==='read_page'&&e.usable).length,2);assert(payload.evidence.some(e=>e.tool==='delegate_research'&&e.result.research.every(report=>report.gaps.length)));return {status:'complete',checks:[{requirement:'closure exceptions and disclosed gaps',status:'met',evidence_ids:[1,2]}],next_step:''};},
  });
  assert.equal(result.content,'Both agencies are closed in March 2026. Eligibility remains unconfirmed.');assert(names[0].includes('delegate_research'));assert(children>=4);assert.equal(reviews.length,1);assert.equal(reviews[0].phase || 'final','final');
  await runAgent({goal:'Compare two agencies',messages:[{role:'user',content:'Compare two agencies'}],tools,signal:new AbortController().signal,harness:true,completeAnalysis:async()=>assert.fail('No child'),complete:async(_wire,selected)=>{assert(!selected.some(tool=>tool.function.name==='delegate_research'));return {content:'No browser attached.'};},execute:async()=>assert.fail('No transport')});
});
test('auth failure cancels active peers and queued work, then cleans every started tab',async()=>{
  let started=0,cleaned=0;const workers=createResearchWorkers({signal:new AbortController().signal,goal:'lookup',run:runAgent,
    browser:async op=>{if(op.operation==='close'){cleaned++;return {ok:true};}started++;return packet();},
    complete:async(_m,_t,{signal})=>{if(started>=2)throw new Error('unauthorized');await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});setTimeout(resolve,30);});return {content:'stopped'};}});
  await assert.rejects(workers.execute({tasks:['A','B','C','D'].map(assignment)}),/unauthorized/);
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(started,2);assert.equal(cleaned,2);workers.close();
});
function native({access=async()=>{},checkOwner=async()=>{}}={}) {
  const state=new Map([[1,{id:1,url:'https://personal.test',status:'complete'}]]),removed=[],changed=[],ruleChanges=[];let seq=1,saved=[];
  const browser=createResearchBrowser({tabs:{create:async()=>{const tab={id:++seq,url:'about:blank',status:'complete'};state.set(tab.id,tab);return tab;},get:async id=>{if(!state.has(id))throw Error('gone');return state.get(id);},update:async(id,patch)=>{changed.push(id);Object.assign(state.get(id),patch);return state.get(id);},remove:async id=>{removed.push(id);state.delete(id);}},rules:{getSessionRules:async()=>[],updateSessionRules:async x=>ruleChanges.push(x)},save:async x=>{saved=structuredClone(x);},load:async()=>saved,read:async(task)=>({...packet(state.get(task.tabId).url),research_links:[{id:'link-1',url:'https://example.test/b',name:'Details'}]}),access,checkOwner});
  return {browser,state,removed,changed,ruleChanges};
}
test('native reads isolate owned tabs and reject foreign worker IDs/redirected documents; cleanup keeps user tab',async()=>{
  const n=native(),args={worker_id:'worker-0001',operation:'open',url:'https://example.test/a'};
  const a=await n.browser.execute('run-1',args),b=await n.browser.execute('run-2',args);assert.equal(a.url,b.url);assert.equal(n.state.size,3);
  await assert.rejects(n.browser.execute('run-foreign',{worker_id:'worker-0001',operation:'read'}),/browser_stale/);
  await assert.rejects(n.browser.execute('run-1',{worker_id:'worker-0001',operation:'follow',args:{link_id:'unobserved'}}),/browser_stale/);
  n.state.get(2).url='https://evil.test/redirect';await assert.rejects(n.browser.execute('run-1',{worker_id:'worker-0001',operation:'read'}),/browser_stale/);
  await n.browser.closeOwner('run-1');assert(!n.removed.includes(1));assert(n.state.has(3));await n.browser.recover();assert(n.state.has(1));assert.equal(n.state.size,1);
  assert(n.ruleChanges.some(x=>x.addRules?.some(r=>r.priority===1&&r.action.type==='block')));
});
test('navigation fences allow only exact GET addresses, deny approval/auth endpoints and missing origin access before opening',async()=>{
  for(const url of ['https://example.test/delete','https://example.test/logout','https://example.test/auth/login','https://example.test/?action=submit','https://u:p@example.test/a'])assert.throws(()=>researchAddress(url),/page_restricted/);
  const rules=researchRules(0,42,'https://example.test/a?q=test');assert.equal(rules[0].id,RESEARCH_RULE_BASE);assert.deepEqual(rules[1].condition.requestMethods,['get']);assert(new RegExp(rules[1].condition.regexFilter).test('https://example.test/a?q=test'));assert(!new RegExp(rules[1].condition.regexFilter).test('https://evil.test/a?q=test'));
  const n=native({access:async()=>{throw Error('page_access_required');}});
  await assert.rejects(n.browser.execute('run-1',{worker_id:'worker-0001',operation:'open',url:'https://example.test/a'}),/page_access_required/);assert.equal(n.state.size,1);assert.equal(n.changed.length,0);
});
