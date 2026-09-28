import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOfficeView} from '../worker/office-view.mjs';
import {createActivityLog} from '../worker/activity.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=',sha=createHash('sha256').update(Buffer.from(png,'base64')).digest('hex');
function setup({vision=true,complete,call,approve,reviewTimeoutMs,status}={}){
  let binding={scopeId:'s',expectedFingerprint:'f'};const calls=[],controller=new AbortController(),activity=createActivityLog(),metrics={};
  const view=createOfficeView({enabled:true,host:'excel',getBinding:()=>binding,call:async(name,args)=>{calls.push({name,args});return call?call(name,args):name==='view_observe'?{id:'abcdef0123456789',observedAt:Date.now(),elements:[{name:'수능 성적표',type:'Text'}],binding:{scopeId:'s',fingerprint:'f'},truncated:false,imageStatus:'captured',imageSha256:sha,imageWidth:1,imageHeight:1}:{id:'abcdef0123456789',data:png,sha256:sha};},providers:{status:status||(()=>({vision,provider:'aipro',model:'baseline'})),complete:complete|| (async(messages,tools)=>{assert.deepEqual(tools,[]);assert.equal(Array.isArray(messages[1].content),vision);return{content:JSON.stringify({status:'complete',checks:[{requirement:'제목 표시',status:'met',evidence_ids:[1]}],next_step:''})};})},signal:controller.signal,activity,metrics,approve,reviewTimeoutMs});
  return {view,calls,controller,activity,metrics,change(){binding={...binding,expectedFingerprint:'changed'};}};
}
test('Office view tools preserve binding and put real image only in the isolated read-only review',async()=>{
  const f=setup();const observed=await f.view.execute('show_document_target',{address:'A1',scopeId:'evil'});assert.equal(observed.target,'A1');assert.equal(f.calls[0].args.scopeId,'s');assert.equal(f.calls[0].args.focus,true);
  const reviewed=await f.view.execute('review_office_view',{criterion:'제목 표시 확인'});assert.equal(reviewed.imageViewed,true);assert.equal(reviewed.advisory,true);assert.equal(reviewed.scope,'captured_viewport_only');
  assert.equal(JSON.stringify(f.view.context()).includes(png),false);assert.equal(f.metrics.reviewCalls,1);assert.equal(f.calls.filter(c=>c.name==='view_image').length,1);
});
test('text-only models do not fetch an image or claim image inspection',async()=>{
  const f=setup({vision:false});await f.view.execute('inspect_office_view');const reviewed=await f.view.execute('review_office_view',{criterion:'UI 제목 확인'});
  assert.equal(reviewed.imageViewed,false);assert.equal(reviewed.renderingVerified,false);assert.equal(f.calls.some(c=>c.name==='view_image'),false);
});
test('changed document invalidates screenshot evidence before another review call',async()=>{
  const f=setup();await f.view.execute('inspect_office_view');f.change();assert.equal(f.view.context().current,false);
  assert.equal((await f.view.execute('review_office_view',{criterion:'확인'})).error,'view_expired');assert.equal(f.metrics.reviewCalls,undefined);
});
test('pixel corruption and cancellation prevent an accepted visual review',async()=>{
  const f=setup({call:async name=>name==='view_observe'?{id:'abcdef0123456789',observedAt:Date.now(),elements:[],binding:{scopeId:'s',fingerprint:'f'},imageStatus:'captured',imageSha256:sha}:{data:png,sha256:'changed'}});
  await f.view.execute('inspect_office_view');assert.equal((await f.view.execute('review_office_view',{criterion:'확인'})).error,'view_image_invalid');assert.equal(f.view.context().review,null);
  f.controller.abort();await assert.rejects(f.view.execute('inspect_office_view'),/cancelled/);
});
test('window inspection failures return once without looping or replacing the last observation',async()=>{
  let count=0;const f=setup({call:async()=>{count++;return{error:'view_window_unavailable'};}});
  assert.equal((await f.view.execute('inspect_office_view')).error,'view_window_unavailable');assert.equal(count,1);assert.equal(f.view.context(),null);
});

const mouseObservation=()=>({id:'abcdef0123456789',observedAt:Date.now(),elements:[{id:'ui-1',name:'Layout',enabled:true,runtimeId:[1,2],bounds:[1,2,3,4]}],binding:{scopeId:'s',fingerprint:'f'},imageStatus:'unavailable'});
test('mouse click uses exact observed target and approval; next action requires fresh observation',async()=>{
  const approvals=[],f=setup({approve:async p=>{approvals.push(p);return{approved:true};},call:async name=>name==='view_observe'?mouseObservation():{outcome:'dispatched',documentUnchanged:true,view:mouseObservation()}});
  await f.view.execute('inspect_office_view');
  const done=await f.view.execute('act_office_view',{viewId:'abcdef0123456789',targetId:'ui-1',action:'click',x:999});
  assert.equal(done.outcome,'dispatched');assert.equal(done.applicationVerified,false);assert.equal(approvals[0].target,'Layout');
  const call=f.calls.find(c=>c.name==='view_act');assert.equal(call.args.x,undefined);assert.equal(call.args.approved,true);
  assert.equal((await f.view.execute('act_office_view',{viewId:'abcdef0123456789',targetId:'ui-1',action:'click'})).error,'view_expired');
  assert.equal(f.calls.filter(c=>c.name==='view_act').length,1);
});
test('lost input response reads receipt once and never resends mouse action',async()=>{
  const f=setup({call:async name=>{if(name==='view_observe')return mouseObservation();if(name==='view_act')throw new Error('lost');return{outcome:'uncertain'};}});
  await f.view.execute('inspect_office_view');const action={viewId:'abcdef0123456789',targetId:'ui-1',action:'hover'};
  assert.equal((await f.view.execute('act_office_view',action)).error,'view_action_uncertain');
  await f.view.execute('inspect_office_view');assert.equal((await f.view.execute('act_office_view',action)).error,'view_action_uncertain');
  assert.equal(f.calls.filter(c=>c.name==='view_act').length,1);assert.equal(f.calls.filter(c=>c.name==='view_receipt').length,1);assert.throws(()=>f.view.assertSettled(),/view_action_uncertain/);
});
test('mouse inputs reject invented targets, unsupported actions, declined and stale approvals',async()=>{
  const f=setup({approve:async()=>({approved:false}),call:async()=>mouseObservation()});await f.view.execute('inspect_office_view');
  const action={viewId:'abcdef0123456789',targetId:'ui-1',action:'click'};
  assert.equal((await f.view.execute('act_office_view',{...action,targetId:'invented'})).error,'view_target_changed');
  assert.equal((await f.view.execute('act_office_view',{...action,action:'type'})).error,'tool_arguments_invalid');
  assert.equal((await f.view.execute('act_office_view',action)).error,'view_action_declined');
  const g=setup({approve:async()=>{g.change();return{approved:true};},call:async()=>mouseObservation()});await g.view.execute('inspect_office_view');
  assert.equal((await g.view.execute('act_office_view',action)).error,'view_expired');assert.equal(g.calls.some(c=>c.name==='view_act'),false);
});

test('a bridge timeout result reconciles the native receipt without another dispatch',async()=>{
  const f=setup({call:async name=>name==='view_observe'?mouseObservation():name==='view_act'?{error:'office_timeout'}:{outcome:'dispatched',documentUnchanged:true,view:mouseObservation()}});
  await f.view.execute('inspect_office_view');const result=await f.view.execute('act_office_view',{viewId:'abcdef0123456789',targetId:'ui-1',action:'hover'});
  assert.equal(result.outcome,'dispatched');assert.equal(f.calls.filter(c=>c.name==='view_act').length,1);assert.equal(f.calls.filter(c=>c.name==='view_receipt').length,1);
});

const verdict=()=>({content:JSON.stringify({status:'complete',checks:[{requirement:'제목 표시',status:'met',evidence_ids:[1]}],next_step:''})});
test('review reobserves native state and rejects a changed viewport after the model responds',async()=>{
  let reads=0;const f=setup({vision:false,call:async()=>({...mouseObservation(),elements:[{name:++reads===1?'원래 제목':'사용자가 수정한 제목'}]})});
  await f.view.execute('inspect_office_view');
  const result=await f.view.execute('review_office_view',{criterion:'제목 표시'});
  assert.equal(result.error,'view_changed_during_review');assert.equal(reads,2);
  assert.equal(f.view.context().review,null);assert.equal(f.view.context().elements[0].name,'사용자가 수정한 제목');
});
test('review cannot survive a failed native revalidation or mutate retained evidence through context',async()=>{
  let reads=0;const f=setup({vision:false,call:async()=>++reads===1?mouseObservation():{error:'view_source_changed'}});
  await f.view.execute('inspect_office_view');const external=f.view.context();external.binding.expectedFingerprint='evil';external.elements[0].name='evil';
  assert.equal(f.view.context().elements[0].name,'Layout');assert.equal(f.view.context().current,true);
  assert.equal((await f.view.execute('review_office_view',{criterion:'확인'})).error,'view_source_changed');
  assert.equal(f.view.context().current,false);assert.equal(f.view.context().review,null);
});
test('review context retrieves relevant later UIA elements and marks omitted coverage',async()=>{
  const elements=Array.from({length:80},(_,i)=>({id:`ui-${i}`,name:i===79?'분기 실적 요약':'일반 메뉴 '+i,focused:i===1,bounds:[i,1,2,3]}));
  const f=setup({vision:false,call:async()=>({...mouseObservation(),elements}),complete:async messages=>{
    const payload=JSON.parse(messages[1].content),e=payload.evidence[0].result;
    assert.ok(e.elements.some(e=>e.id==='ui-79'));assert.ok(e.elements.some(e=>e.id==='ui-1'));
    assert.ok(e.elements.length<=30);assert.equal(e.uiElementsOmitted,true);return verdict();
  }});
  await f.view.execute('inspect_office_view');assert.equal((await f.view.execute('review_office_view',{criterion:'분기 실적 요약 표시'})).status,'complete');
});
test('a noncooperative model times out and late output cannot publish a review',async()=>{
  let resolve;const f=setup({vision:false,reviewTimeoutMs:10,complete:()=>new Promise(r=>{resolve=r;})});
  await f.view.execute('inspect_office_view');const result=await f.view.execute('review_office_view',{criterion:'확인'});
  assert.equal(result.error,'view_review_failed');assert.equal(result.reason,'model_timeout');
  resolve(verdict());await new Promise(r=>setImmediate(r));assert.equal(f.view.context().review,null);
});
test('independent view criteria use bounded read-only subagents and one native revalidation',async()=>{
  let active=0,peak=0,calls=0;
  const f=setup({vision:false,complete:async(_messages,tools)=>{assert.deepEqual(tools,[]);calls++;peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,5));active--;return verdict();}});
  await f.view.execute('inspect_office_view');const result=await f.view.execute('review_office_view',{criteria:['제목 표시','필수 입력 항목','합계 표시']});
  assert.equal(result.status,'complete');assert.equal(result.reviews.length,3);assert.equal(peak,2);assert.equal(calls,3);
  assert.equal(f.calls.filter(c=>c.name==='view_observe').length,2);assert.equal(f.metrics.subagentCalls,3);assert.equal(f.metrics.reviewCalls,3);
});
test('review preserves safe throttling facts and does not retry successful branches',async()=>{
  let fail=true,calls=0;const f=setup({vision:false,complete:async messages=>{
    calls++;if(JSON.parse(messages[1].content).goal==='합계'&&fail)throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:4500});return verdict();
  }});
  await f.view.execute('inspect_office_view');const args={criteria:['제목','합계']},failed=await f.view.execute('review_office_view',args);
  assert.equal(failed.error,'view_review_failed');assert.equal(failed.status,429);assert.equal(failed.retryAfterMs,4500);assert.equal(f.view.context().review,null);
  fail=false;assert.equal((await f.view.execute('review_office_view',args)).status,'complete');assert.equal(calls,3);
});
test('provider change and cancellation fence all subagent results',async()=>{
  let model='first';const f=setup({vision:false,status:()=>({vision:false,provider:'aipro',model}),complete:async()=>{model='other';return verdict();}});
  await f.view.execute('inspect_office_view');assert.ok((await f.view.execute('review_office_view',{criterion:'제목'})).error);assert.equal(f.view.context().review,null);
  let started;const ready=new Promise(r=>{started=r;});const g=setup({vision:false,complete:()=>{started();return new Promise(()=>{});}});
  await g.view.execute('inspect_office_view');const pending=g.view.execute('review_office_view',{criteria:['제목','합계']});await ready;g.controller.abort();
  await assert.rejects(pending,/cancelled/);assert.equal(g.view.context().review,null);
});
test('invalid timestamp or criteria never dispatch a model review',async()=>{
  for(const observedAt of [NaN,Infinity,Date.now()+60000,Date.now()-130000]){
    const f=setup({call:async()=>({...mouseObservation(),observedAt})});assert.equal((await f.view.execute('inspect_office_view')).error,'view_response_invalid');
  }
  const f=setup();await f.view.execute('inspect_office_view');
  for(const args of [{criteria:[]},{criteria:['같음','같음']},{criterion:'a',criteria:['b']},{criteria:['a','b','c','d']}])assert.equal((await f.view.execute('review_office_view',args)).error,'tool_arguments_invalid');
  assert.equal(f.metrics.reviewCalls,undefined);
});

test('first-call verification metadata changes do not invalidate the selected model',async()=>{
  let verified=false;const f=setup({vision:false,status:()=>({provider:'aipro',model:'baseline',vision:false,verified}),complete:async()=>{verified=true;return verdict();}});
  await f.view.execute('inspect_office_view');assert.equal((await f.view.execute('review_office_view',{criterion:'제목'})).status,'complete');
});
test('ChatGPT reviews run serially while vision branches share one image fetch',async()=>{
  let active=0,peak=0;const f=setup({status:()=>({provider:'chatgpt',model:'vision',vision:true}),complete:async messages=>{
    peak=Math.max(peak,++active);assert.ok(messages[1].content.some(p=>p.type==='image_url'));await new Promise(r=>setImmediate(r));active--;return verdict();
  }});
  await f.view.execute('inspect_office_view');const result=await f.view.execute('review_office_view',{criteria:['제목','레이아웃','합계']});
  assert.equal(result.status,'complete');assert.equal(peak,1);assert.equal(f.calls.filter(c=>c.name==='view_image').length,1);
  const exposed=f.view.context();exposed.review.reviews[0].status='blocked';assert.equal(f.view.context().review.reviews[0].status,'complete');
});
test('changed image pixels reject stale vision findings even with identical UIA labels',async()=>{
  let reads=0;const f=setup({call:async name=>name==='view_image'?{id:'abcdef0123456789',data:png,sha256:sha}:{...mouseObservation(),imageStatus:'captured',imageSha256:++reads===1?sha:'changed-pixels',imageWidth:1,imageHeight:1}});
  await f.view.execute('inspect_office_view');assert.equal((await f.view.execute('review_office_view',{criterion:'시각 확인'})).error,'view_changed_during_review');assert.equal(f.view.context().review,null);
});
test('a blocked child remains advisory and prevents aggregate completion',async()=>{
  const f=setup({vision:false,complete:async messages=>JSON.parse(messages[1].content).goal==='수신자'?{content:JSON.stringify({status:'blocked',checks:[{requirement:'수신자 확인',status:'unknown',evidence_ids:[]}],next_step:'수신자를 알려주세요.'})}:verdict()});
  await f.view.execute('inspect_office_view');const result=await f.view.execute('review_office_view',{criteria:['제목','수신자']});
  assert.equal(result.status,'blocked');assert.equal(result.next_step,'수신자를 알려주세요.');assert.equal(result.advisory,true);assert.equal(result.checks.length,2);
});

test('permanent provider failures retain the safe reason for the recovery owner',async()=>{
  const f=setup({vision:false,complete:async()=>{throw Object.assign(new Error('unauthorized'),{status:401,body:'secret response'});}});
  await f.view.execute('inspect_office_view');const result=await f.view.execute('review_office_view',{criterion:'제목'});
  assert.equal(result.reason,'unauthorized');assert.equal(result.status,401);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(f.view.context().review,null);
});
