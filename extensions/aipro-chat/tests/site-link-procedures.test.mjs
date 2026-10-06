import test from 'node:test';
import assert from 'node:assert/strict';
import {recordStep,replayRecord} from '../browser-replay.js';
import {createLinkProcedure,createSiteProcedure,prepareLinkProcedure,planningKnowledge,procedureCards,linkProcedureTool} from '../site-procedures.js';
const now=Date.now(),start='https://portal.example/start',url='https://portal.example/rules';
const link=(ref='old-link',more={})=>({ref,role:'link',tag:'a',name:'접수 규정 안내',destination:url,...more});
const observation=(elements=[link()],more={})=>({url:start,title:'서비스 안내',tabId:1,frames:[{frame:0,url:start,elements}],...more});
const entry=()=>({url,origin:'https://portal.example',provider:'chatgpt',title:'접수 규정',sourceHash:'a'.repeat(64),documentVersion:1,reviewedAt:now,verifiedAt:now,document:{headings:['접수 규정'],fields:[],controls:[]},markdown:'# 접수 규정'});
function replay(){
  const clicked=recordStep('click_element',{ref:'old-link'},observation(),{ok:true,actionIssued:true,observation:{url,title:'접수 규정',frames:[]}});
  return replayRecord({startPage:start,steps:[clicked.step,{tool:'verify_page',checks:[{kind:'title',expected:'접수 규정'}]}]},{id:'old-run',goal:'old request',goalReviewed:true});
}
const card=()=>createLinkProcedure(replay(),entry(),{id:'read-card',now});
const knowledge=()=>({enabled:true,revision:1,entries:[entry()]});
const prepare=(seen=observation([link('fresh-link')]),state=knowledge(),options={})=>prepareLinkProcedure([card()],state,{procedure_id:'read-card'},seen,{provider:'chatgpt',currentURL:start,now,...options});
test('a verified one-link navigation becomes a value-free reviewed route with fresh targets',()=>{
  assert(card());assert.deepEqual(createSiteProcedure(replay(),entry(),{id:'read-card',now}),card());
  assert.equal(procedureCards([card()]).length,1);
  assert.equal(prepare().ref,'fresh-link');assert.equal(prepare().actionIssued,false);
  const stored=JSON.stringify(card());assert(!stored.includes('old-link'));assert(!stored.includes('old request'));assert(!stored.includes('old-run'));
  const packet=planningKnowledge(knowledge(),[card()],{url:start,provider:'chatgpt',query:'접수 규정'},now);
  assert.equal(packet.procedures[0].tool,'open_site_procedure');assert.equal(packet.procedures[0].url,url);
});
test('only unambiguous live top-frame links with exact destination and context are prepared',()=>{
  const cases=[observation([link('a'),link('b')]),observation([link('a',{destination:'https://portal.example/other'})]),
    observation([link('a',{role:'button'})]),observation([link('a',{tag:'button'})]),observation([link('a',{disabled:true})]),
    observation([link('a',{coveredBy:'dialog'})]),observation([link('a',{context:[{role:'dialog',name:'別の画面'}]})]),
    observation([link('a')],{frames:[{frame:1,elements:[link('a')]}]}),
    observation([link('a')],{frames:[{frame:0,elements:[link('a')],omittedControls:1}]}),
    observation([link('a')],{frames:[{frame:0,elements:[link('a')],textFiltered:true}]}),
    observation([link('a')],{frameCoverage:{discovered:2,inspected:1,unavailable:1}}),
    observation([link('a')],{url:start+'/other'}),observation([link('a')],{title:'変更されたページ'})];
  for(const seen of cases){const result=prepare(seen);assert(result.error,JSON.stringify(seen));assert.equal(result.actionIssued,false);assert.equal(result.ref,undefined);}
  assert.equal(prepare(undefined,undefined,{currentURL:start+'?record=private'}).error,'procedure_scope');
});
test('wiki deletion, provider/version/hash/review/freshness revoke a read route',()=>{
  for(const patch of [{invalidated:true},{markdownNeedsReview:true},{documentVersion:2},{sourceHash:'b'.repeat(64)},{reviewedAt:now-31*86400000}]) {
    const state=knowledge();Object.assign(state.entries[0],patch);assert.equal(prepare(undefined,state).error,'procedure_changed');
  }
  assert.equal(prepare(undefined,{...knowledge(),entries:[]}).error,'procedure_changed');
  assert.equal(prepare(undefined,{...knowledge(),enabled:false}).error,'procedure_changed');
  assert.equal(prepare(undefined,undefined,{provider:'aipro'}).error,'procedure_changed');
});
test('uncertain, unreviewed, conditional, transactional, private and cross-origin records cannot promote',()=>{
  for(const mutate of [r=>r.goalReviewed=false,r=>r.steps.push({tool:'fill_form'}),r=>r.steps[0].args={double:'yes'},
    r=>delete r.steps[0].navigation,r=>r.steps[0].target.ordinal=0,r=>r.steps[0].target.name='삭제 안내',
    r=>r.steps[0].target.name='접수 규정 123456789 안내',r=>r.steps[0].target.destination=url+'?record=private',
    r=>r.steps[0].navigation.from='https://another.example/start']) {
    const value=replay();mutate(value);assert.equal(createLinkProcedure(value,entry(),{id:'bad',now}),null);
  }
  const step=recordStep('click_element',{ref:'old-link'},observation(),{error:'action_outcome_unknown',actionIssued:true});assert.equal(step.unreplayable,'uncertain');
  assert.deepEqual(procedureCards([{version:2,kind:'link_read',url:'',startURL:''}]),[]);
});
test('expanded information link keeps actual dispatch and whole-goal review',async()=>{
  const {runAgent}=await import('../agent-runtime.js');const {browserTools,BUILTIN_SKILLS}=await import('../skills.js');
  const tools=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')).filter(t=>t.function.name!=='update_plan');tools.push(linkProcedureTool());
  let rounds=0,reviews=0,issued=0;
  const before=observation([link('fresh-link')]),after={url,title:'接수 규정',tabId:1,frames:[{frame:0,url,elements:[],text:'마감일은 10월 15일이며 이후 접수 불가입니다.',documentId:'after'}],topDocumentId:'after'};
  await runAgent({messages:[{role:'user',content:'접수 규정 안내를 열고 마감일과 제외 조건을 알려주세요. 입력하지 마세요.'}],tools,harness:true,signal:new AbortController().signal,
    complete:async()=>++rounds===1?{content:'',calls:[{id:'route',type:'function',function:{name:'open_site_procedure',arguments:'{"procedure_id":"read-card"}'}}]}:{content:'마감일은 10월 15일이며 이후 접수 불가입니다.',calls:null},
    execute:async name=>{if(name==='read_page')return {error:'source_unavailable'};assert.equal(name,'open_site_procedure');issued++;return {ok:true,actionIssued:true,navigationOnly:true,observation:after,siteProcedureExecution:{tool:'click_element',args:{ref:'fresh-link'},before}};},
    reviewGoal:async({evidence})=>{reviews++;const click=evidence.find(e=>e.tool==='click_element');assert(click);assert(evidence.some(e=>e.tool==='browser_snapshot'));assert(!evidence.some(e=>e.tool==='open_site_procedure'));return {status:'complete',checks:[{requirement:'마감일과 제외 조건',status:'met',evidence_ids:[click.id]}],next_step:''};}});
  assert.equal(issued,1);assert.equal(reviews,1);
});
