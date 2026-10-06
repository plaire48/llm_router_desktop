import test from 'node:test';
import assert from 'node:assert/strict';
import {recordStep,replayRecord} from '../browser-replay.js';
import {createFormProcedure,formContract,planningKnowledge,prepareFormProcedure} from '../site-procedures.js';
import {planMessages} from '../task-plan.js';
const now=Date.now(),url='https://portal.example/draft';
const field=(ref,name,more={})=>({ref,name,role:'textbox',tag:'input',kind:'field',type:'text',editable:true,required:false,...more});
const observation=(elements=[field('old-title','제목'),field('old-body','내용')],more={})=>({url,title:'초안',frames:[{frame:0,url,elements}],...more});
const entry=()=>({url,origin:'https://portal.example',provider:'chatgpt',title:'초안',documentVersion:1,sourceHash:'a'.repeat(64),verifiedAt:now,reviewedAt:now,markdown:'# 초안\n제목과 내용 작성',document:{headings:['초안'],fields:[{name:'제목',role:'textbox'}],controls:[]}});
const knowledge=()=>({enabled:true,revision:1,entries:[entry()]});
const verified={ok:true,verified:true,applied:2,matched:2,actionIssued:true};
function recorded(){const step=recordStep('fill_form',{fields:[{field_id:'old-title',value:'private-old-title'},{field_id:'old-body',value:'private-old-body'}]},observation(),verified);return replayRecord({steps:[step.step],startPage:url},{id:'old-run',goal:'private old goal',goalReviewed:true});}
function card(){return createFormProcedure(recorded(),entry(),{id:'card',now});}
const inputs={procedure_id:'card',values:[{slot:'v0',value:'새 제목'},{slot:'v1',value:'새 본문\n두 번째 줄'}]};
const fresh=()=>observation([field('new-title','제목'),field('new-body','내용')]);
test('a host verified form produces a reviewed value-free wiki-linked transaction',()=>{
  const saved=JSON.stringify(card());assert(card());assert(!saved.includes('private'));assert(!saved.includes('old-title'));assert(!saved.includes('old-run'));assert.equal(card().wikiVersion,1);
  const prepared=prepareFormProcedure([card()],knowledge(),inputs,fresh(),{provider:'chatgpt',now});
  assert.equal(prepared.prepared,true);assert.equal(prepared.actionIssued,false);assert.deepEqual(prepared.fields,[{field_id:'new-title',value:'새 제목'},{field_id:'new-body',value:'새 본문\n두 번째 줄'}]);
});
test('input structure and restrictions changing rejects before any input is prepared',()=>{
  const mutations=[observation([field('a','제목'),field('b','내용'),field('c','필수 코드',{required:true})]),observation([field('a','제목'),field('b','내용',{required:true})]),observation([field('a','제목'),field('b','내용',{editable:false})]),observation([field('a','제목'),field('b','내용',{type:'email'})]),observation([field('a','제목'),field('b','내용',{inputLimits:{maxlength:'2'}})]),observation([field('a','제목'),field('b','제목')]),observation([field('a','제목'),field('b','내용',{coveredBy:'dialog'})])];
  for(const seen of mutations){const result=prepareFormProcedure([card()],knowledge(),inputs,seen,{provider:'chatgpt',now});assert.equal(result.actionIssued,false);assert(result.error);assert.equal(result.fields,undefined);}
});
test('changed wiki version, hash, review, provider, route and expiry revoke execution',()=>{
  for(const patch of [{documentVersion:2},{sourceHash:'b'.repeat(64)},{invalidated:true},{markdownNeedsReview:true},{reviewedAt:now-31*86400000}]){
    const state=knowledge();Object.assign(state.entries[0],patch);assert(prepareFormProcedure([card()],state,inputs,fresh(),{provider:'chatgpt',now}).error);
  }
  assert(prepareFormProcedure([card()],{...knowledge(),enabled:false},inputs,fresh(),{provider:'chatgpt',now}).error);
  assert(prepareFormProcedure([card()],knowledge(),inputs,fresh(),{provider:'fabrix',now}).error);
  assert(prepareFormProcedure([card()],knowledge(),inputs,{...fresh(),url:url+'?menu=admin'},{provider:'chatgpt',now}).error);
});
test('missing, duplicate and unknown input slots never inherit saved values',()=>{
  for(const values of [[],[inputs.values[0]],[inputs.values[0],inputs.values[0]],[inputs.values[0],{slot:'v9',value:'bad'}]])assert.equal(prepareFormProcedure([card()],knowledge(),{...inputs,values},fresh(),{provider:'chatgpt',now}).error,'procedure_values');
});
test('partial observations, child frames, ordinal targets and conditional workflows cannot promote',()=>{
  assert.equal(formContract({...fresh(),frames:[{...fresh().frames[0],truncated:true}]}),null);
  assert.equal(formContract({...fresh(),frames:[...fresh().frames,{frame:1,elements:[]}]}),null);
  const replay=recorded();replay.steps.unshift({tool:'click_element',target:{role:'button',name:'열기'}});assert.equal(createFormProcedure(replay,entry(),{id:'bad'}),null);
  const ambiguous=recorded();ambiguous.steps[0].fields[0].target.ordinal=0;assert.equal(createFormProcedure(ambiguous,entry(),{id:'bad'}),null);
});
test('a damaged stored contract cannot hide another control by matching one ref twice',()=>{
  const damaged=card();damaged.contract[1]=damaged.contract[0];assert.equal(prepareFormProcedure([damaged],knowledge(),inputs,fresh(),{provider:'chatgpt',now}).error,'procedure_structure');
});
test('upfront retrieval is local, scoped, historical and delivered to first planning unchanged',()=>{
  const packet=planningKnowledge(knowledge(),[card()],{url,provider:'chatgpt',query:'제목 초안 작성'},now);assert(packet);assert.equal(packet.procedures.length,1);assert.equal(packet.dataKind,'historical_site_knowledge');
  const planning=JSON.parse(planMessages('작성해주세요',[],{userRequests:['본문 보존'],siteKnowledge:packet})[1].content);assert.deepEqual(planning.user_requests,['본문 보존']);assert.deepEqual(planning.site_knowledge,packet);
  assert.equal(planningKnowledge(knowledge(),[card()],{url:'https://another.example/draft',provider:'chatgpt',query:'작성'},now),null);
  assert.equal(planningKnowledge({...knowledge(),enabled:false},[card()],{url,provider:'chatgpt',query:'작성'},now),null);
});

test('expanded form receipts retain the ordinary independent final requirement review',async()=>{
  const {runAgent}=await import('../agent-runtime.js');
  const {browserTools,BUILTIN_SKILLS}=await import('../skills.js');
  const {procedureTool}=await import('../site-procedures.js');
  const tools=browserTools({},BUILTIN_SKILLS.find(skill=>skill.id==='browser-agent')).filter(tool=>tool.function.name!=='update_plan');tools.push(procedureTool());
  const before=fresh(),fields=[{field_id:'new-title',value:'새 제목'},{field_id:'new-body',value:'새 본문'}];
  let round=0,reviews=0,issued=0;
  const answer={content:'입력했습니다. 등록하지 않았습니다.',calls:null};
  await runAgent({messages:[{role:'user',content:'제목과 본문 입력. 등록하지 마세요.'}],tools,harness:true,signal:new AbortController().signal,
    complete:async()=>++round===1 ? {content:'',calls:[{id:'procedure',type:'function',function:{name:'fill_site_procedure',arguments:JSON.stringify(inputs)}}]} : answer,
    execute:async name=>{assert.equal(name,'fill_site_procedure');issued++;return {...verified,observation:before,siteProcedureExecution:{tool:'fill_form',args:{fields},before}};},
    reviewGoal:async({evidence})=>{reviews++;const fill=evidence.find(item=>item.tool==='fill_form');assert(fill);assert(evidence.some(item=>item.tool==='browser_snapshot'));assert.equal(fill.arguments.fields[0].value,'새 제목');assert(!evidence.some(item=>item.tool==='fill_site_procedure'));return {status:'complete',checks:[{requirement:'새 입력과 등록하지 않음',status:'met',evidence_ids:[fill.id]}],next_step:''};}});
  assert.equal(issued,1);assert.equal(reviews,1);
});
