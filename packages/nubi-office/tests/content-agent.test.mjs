// Fault-injected protocol tests with the real Pi runtime; not Office COM or
// model accuracy evidence. Explicit test answers are never live HITL approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startContentAgent} from '../worker/content-agent.mjs';
import {AGENT_ENGINE} from '../../../extensions/aipro-chat/agent-runtime.js';
import {contentTask,contentOperation,contentReview,contentObservation,contentStepReview} from '../worker/content-schema.mjs';
import {createWorker} from '../worker/main.mjs';
import {isRetryableRead,transientRead} from '../worker/fault-policy.mjs';
import {text,call} from './harness-fixtures.mjs';

const fast={wait:async()=>{}},encoded=v=>text(JSON.stringify(v));
const finish=()=>call('finish_step',{answer:'현재 단계의 내용을 확인했습니다.'});
const task=(intent='create')=>({intent,title:'업무 보고',summary:'요청한 보고서를 작성합니다.',requirements:['요청 내용과 문서 구성을 완성한다'],save:['create','template'].includes(intent),steps:[{id:'inspect',title:'원본과 구성 확인',kind:'inspect'},{id:'write',title:'본문 작성',kind:['analyze','register'].includes(intent)?'analyze':'write'},{id:'verify',title:'요구사항 검토',kind:'verify'}]});
const goodReview={status:'complete',checks:[{requirement:0,status:'met',evidence:[1]}],feedback:''};
const goodStepReview={status:'complete',checks:[{criterion:'현재 단계의 관찰 가능한 결과',status:'met',evidence:[1]}],feedback:''};
const acceptedReview=messages=>messages[0].content.includes('ALL original')?goodReview:goodStepReview;
function fixture(host='word',items){
  let current={host,scopeId:'source',documentId:'source',name:'원본',created:false,fingerprint:'f0',offset:0,total:1,nextOffset:null,items:[{id:host==='word'?'p-1':'s-1/h-2',kind:host==='word'?'paragraph':'shape',text:'원본',editable:true}]};
  if(items){current.items=structuredClone(items);current.total=items.length;}
  const receipts=new Map(),actions=[];let writes=0,original;
  const snapshot=()=>structuredClone(current);
  function action(a){
    actions.push(structuredClone(a));
    if(a.name==='office_read')return snapshot();
    if(a.name==='show_plan')return {displayed:true};
    if(a.name==='office_receipt')return receipts.get(a.payload.operationId)||{outcome:'not_executed'};
    let result;
    if(a.name==='office_create') {current={...current,scopeId:'draft',documentId:'draft',created:true,fingerprint:'created',items:[],total:0};result={verified:true,snapshot:snapshot()};}
    else if(a.name==='office_copy'){
      if(a.payload.scopeId!==current.scopeId||a.payload.expectedFingerprint!==current.fingerprint)return{error:'source_changed'};
      original=snapshot();const copySource={scopeId:current.scopeId,fingerprint:current.fingerprint};
      current={...current,scopeId:'copy',documentId:'copy',created:false,copySource,copyReady:true,copyPath:host==='word'?'copy.docx':'copy.pptx'};
      result={verified:true,copied:true,path:host==='word'?'copy.docx':'copy.pptx',sourceScopeId:copySource.scopeId,sourceFingerprint:copySource.fingerprint,
        checks:['destination_binding','observed_content','selection_scope'].map(id=>({id,requirement:id,status:'met'})),snapshot:snapshot()};
    }else if(a.name==='office_apply'){
      assert.equal(a.payload.scopeId,current.scopeId);
      if(a.payload.expectedFingerprint!==current.fingerprint)return{error:'source_changed'};
      writes++;const op=a.payload.operation;
      if(['replace_text','fill_field'].includes(op.type)){const target=current.items.find(i=>i.id===op.targetId);target.text=op.text;if(op.type==='fill_field')target.showingPlaceholder=false;}
      else if(op.type==='append_paragraph')current.items.push({id:'p-'+(current.items.length+1),kind:'paragraph',text:op.text,style:op.style,editable:true});
      else if(op.type==='add_slide')current.items.push({id:'s-'+(current.items.length+1),kind:'slide',text:op.title,notes:op.notes,editable:true});
      current.total=current.items.length;current.fingerprint='f'+writes;
      result={verified:true,checks:[{requirement:'본문',status:'met'}],snapshot:snapshot()};
    }else if(a.name==='office_template_register'){
      assert.equal(a.payload.scopeId,current.scopeId);assert.equal(current.copyReady,true);current.copyReady=false;
      result={verified:true,saved:true,catalogued:true,id:a.payload.templateId,name:a.payload.name,path:current.copyPath,scopeId:current.scopeId,entry:{host,id:a.payload.templateId,name:a.payload.name,summary:a.payload.summary}};
    }else if(a.name==='office_save')result={verified:true,saved:true,scopeId:current.scopeId,path:current.copySource?(host==='word'?'copy.docx':'copy.pptx'):(host==='word'?'report.docx':'report.pptx')};
    else throw new Error('Unexpected host action '+a.name);
    receipts.set(a.payload.operationId,{outcome:'applied',result});return result;
  }
  return {snapshot,action,actions,get original(){return structuredClone(original);},get writes(){return writes;},change(){current.fingerprint='user-edit';}};
}
function provider({plan=task(),actor=[finish(),call('create_document'),call('apply_operation',{plan:JSON.stringify({type:'append_paragraph',text:'보고 내용',style:'Heading1'})}),finish(),finish()],review=messages=>encoded(acceptedReview(messages))}={}){
  const requests=[];let next=0;
  return {requests,status:()=>({model:'test-selected-qwen-id',provider:'aipro'}),async complete(messages,tools){requests.push({messages,tools});const system=messages[0].content;
    if(system.includes('_PLANNER.'))return encoded(typeof plan==='function'?plan():plan);
    if(system.includes('_REVIEWER.'))return review(messages);
    return typeof actor==='function'?actor(messages,tools):actor[next++]||finish();
  }};
}
async function until(run,handle,pollMs=0){
  for(let i=0;i<5000;i++){
    const s=run.status();if(s.state!=='running'){await run.promise;return run.status();}
    if(s.action){if(['request_input','request_approval'].includes(s.action.name))return s;run.respond(s.action.callId,await handle(s.action));}
    await new Promise(resolve=>pollMs?setTimeout(resolve,pollMs):setImmediate(resolve));
  }
  run.cancel();throw new Error('test_boundary_timeout');
}
function templateRun(host='word',actorPrefix=[]){
  const native=fixture(host),targetId=native.snapshot().items[0].id;
  const providers=provider({plan:task('template'),actor:[...actorPrefix,finish(),call('apply_operation',{plan:JSON.stringify({type:'replace_text',targetId,text:'입력한 내용'})}),finish(),finish()]});
  const run=startContentAgent({host,request:'이 양식으로 새 사본을 작성해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  return{native,providers,run};
}
test('template copies precede writes, retain answers, bind restricted targets and save the same copy',async()=>{
  for(const host of ['word','powerpoint']){
    const {native,providers,run}=templateRun(host,[call('ask_user',{question:'기간은 언제인가요?'})]);
    let wait=await until(run,native.action);assert.equal(wait.action.name,'request_input');run.respond(wait.action.callId,{text:'2026년 3분기'});
    wait=await until(run,native.action);assert.equal(wait.action.payload.kind,'template_copy');
    assert.equal(native.writes,0);assert.ok(wait.plan.steps.some(s=>s.kind==='copy'));assert.equal(native.actions.some(a=>a.name==='office_copy'),false);
    run.respond(wait.action.callId,{approved:true});wait=await until(run,native.action);
    assert.equal(wait.action.payload.kind,'edit');assert.equal(native.writes,0);assert.equal(native.snapshot().created,false);assert.equal(wait.templateCopy.ready,true);
    run.respond(wait.action.callId,{approved:true});wait=await until(run,native.action);
    assert.equal(wait.action.payload.kind,'save');assert.equal(native.writes,1);assert.equal(native.original.items[0].text,'원본');assert.equal(wait.artifact,undefined);
    run.respond(wait.action.callId,{approved:true});const done=await until(run,native.action);
    assert.equal(done.state,'done');assert.equal(done.id,run.id);assert.equal(done.artifact.scopeId,'copy');assert.equal(done.artifact.path,done.templateCopy.path);assert.equal(done.plan.completed,5);
    assert.equal(native.actions.filter(a=>a.name==='office_copy').length,1);assert.equal(native.actions.some(a=>a.name==='office_create'),false);
    assert.equal(native.actions.find(a=>a.name==='office_apply').payload.scopeId,'copy');
    assert.ok(providers.requests.filter(r=>r.messages[0].content.includes('_ACTOR.')).some(r=>r.messages.some(m=>m.content.includes('2026년 3분기')&&m.content.includes('copySource'))));
  }
});
test('lost copy reply reads its receipt once without copying or writing the original again',async()=>{
  const {native,run}=templateRun();let wait=await until(run,native.action);run.respond(wait.action.callId,{approved:true});
  wait=await until(run,a=>{const result=native.action(a);return a.name==='office_copy'?{error:'office_timeout'}:result;});
  assert.equal(wait.action.payload.kind,'edit');assert.equal(native.actions.filter(a=>a.name==='office_copy').length,1);
  assert.equal(native.actions.filter(a=>a.name==='office_receipt').length,1);assert.equal(wait.templateCopy.ready,true);assert.equal(native.writes,0);
  run.cancel();await run.promise;
});
test('unknown copy outcome and copy cancellation never fall back to original edits',async()=>{
  for(const mode of ['uncertain','dialog_cancel','approval_cancel']){
    const {native,run}=templateRun();const wait=await until(run,native.action);run.respond(wait.action.callId,{approved:mode!=='approval_cancel'});
    const done=await until(run,a=>a.name==='office_copy'?(mode==='dialog_cancel'?{verified:true,cancelled:true}:{error:'write_uncertain'}):a.name==='office_receipt'?{outcome:'uncertain'}:native.action(a));
    assert.equal(done.state,mode==='uncertain'?'failed':'cancelled');if(mode==='uncertain')assert.equal(done.error,'write_uncertain');assert.equal(native.writes,0);assert.equal(done.artifact,undefined);
  }
});
test('changed source and mismatched copy evidence stop before edits despite an accepting model',async()=>{
  for(const mode of ['source_change','source_id','fingerprint','original_scope','unrestricted','checks','origin','count']){
    const {native,run}=templateRun();const wait=await until(run,native.action);
    if(mode==='source_change')native.change();run.respond(wait.action.callId,{approved:true});
    const done=await until(run,a=>{
      const result=native.action(a);if(a.name!=='office_copy'||result.error)return result;
      if(mode==='source_id')result.sourceScopeId='foreign';
      if(mode==='fingerprint')result.sourceFingerprint='changed';
      if(mode==='original_scope')result.snapshot.scopeId='source';
      if(mode==='unrestricted')result.snapshot.created=true;
      if(mode==='checks')result.checks[1].status='unmet';
      if(mode==='origin')delete result.snapshot.copySource;
      if(mode==='count')result.snapshot.total++;
      return result;
    });
    assert.equal(done.state,'failed',mode);assert.ok(['source_changed','content_copy_mismatch','observation_invalid'].includes(done.error),mode+': '+done.error);
    assert.equal(native.writes,0);assert.equal(done.artifact,undefined);
  }
});
test('template plans cannot skip final saving or gain new-document operations',()=>{
  assert.throws(()=>contentTask(encoded({...task('template'),save:false})),/document_schema_invalid/);
  const copy={...fixture().snapshot(),scopeId:'copy',created:false,copySource:{scopeId:'source',fingerprint:'f0'}};
  assert.throws(()=>contentOperation('word',{type:'append_paragraph',text:'확장',style:'Normal'},copy),/out_of_scope/);
  assert.equal(isRetryableRead('office_copy'),false);
});
test('Word/PPT registration analyzes before copying and completes only with catalog persistence evidence',async()=>{
  for(const host of ['word','powerpoint']){
    const native=fixture(host),providers=provider({plan:task('register'),actor:[call('ask_user',{question:'금액의 단위는 무엇인가요?',input_mode:'text'}),finish(),finish(),finish()]});
    const run=startContentAgent({host,mode:'template-register',request:'현재 양식을 분석하고 등록해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
    const question=await until(run,native.action);assert.equal(question.action.name,'request_input');run.respond(question.action.callId,{text:'금액은 부가세 별도 천 원 단위입니다.'});
    const wait=await until(run,native.action);assert.equal(wait.action.payload.kind,'template_register');assert.equal(wait.plan.completed,3);assert.equal(native.writes,0);
    run.respond(wait.action.callId,{approved:true});const done=await until(run,native.action);
    assert.equal(done.state,'done',done.error);assert.equal(done.registeredTemplate.catalogued,true);assert.equal(done.registeredTemplate.entry.host,host);assert.equal(done.plan.completed,4);
    assert.equal(native.actions.filter(a=>a.name==='office_copy').length,1);assert.equal(native.actions.filter(a=>a.name==='office_template_register').length,1);assert.equal(native.writes,0);assert.equal(native.snapshot().copyReady,false);
    assert.equal(JSON.parse(done.registeredTemplate.usageNotes).clarifications[0].text,'금액은 부가세 별도 천 원 단위입니다.');
    assert.equal(native.actions.find(a=>a.name==='office_template_register').payload.usageNotes,done.registeredTemplate.usageNotes);
  }
});
test('registration cancellation and unknown catalog persistence never become registered success',async()=>{
  for(const mode of ['cancel','lost','unknown','wrong_host']){
    const native=fixture(),run=startContentAgent({host:'word',mode:'template-register',request:'등록',scope:native.snapshot(),providers:provider({plan:task('register'),actor:[finish(),finish(),finish()]}),resilienceOptions:fast});
    const wait=await until(run,native.action);run.respond(wait.action.callId,{approved:mode!=='cancel'});
    const done=await until(run,a=>{
      if(a.name==='office_template_register'){
        if(mode==='unknown')return{error:'write_uncertain'};
        const result=native.action(a);return mode==='lost'?{error:'office_timeout'}:{...result,entry:{...result.entry,host:'excel'}};
      }
      return native.action(a);
    });
    assert.equal(done.state,mode==='cancel'?'cancelled':mode==='lost'?'done':'failed');assert.equal(native.writes,0);
    if(mode!=='lost')assert.equal(done.registeredTemplate,undefined);
    assert.ok(native.actions.filter(a=>a.name==='office_template_register').length<=1);
  }
});
test('follow-up chat edits the same verified template copy without creating a second file',async()=>{
  const {native,run}=templateRun();
  for(const kind of ['template_copy','edit','save']){const wait=await until(run,native.action);assert.equal(wait.action.payload.kind,kind);run.respond(wait.action.callId,{approved:true});}
  const first=await until(run,native.action);assert.equal(first.state,'done');
  const scope=native.snapshot(),contentTemplate={id:'registered',host:'word',name:'보고 양식',summary:'보고 내용',usageNotes:'금액은 천 원 단위',...first.contentScope};
  const nextProvider=provider({plan:task('template'),actor:[finish(),call('apply_operation',{plan:JSON.stringify({type:'replace_text',targetId:'p-1',text:'두 번째 내용'})}),finish(),finish()]});
  const again=startContentAgent({host:'word',request:'이어서 내용 수정',scope,contentTemplate,providers:nextProvider,resilienceOptions:fast});
  for(const kind of ['edit','save']){const wait=await until(again,native.action);assert.equal(wait.action.payload.kind,kind);again.respond(wait.action.callId,{approved:true});}
  const done=await until(again,native.action);assert.equal(done.state,'done',done.error);assert.equal(native.actions.filter(a=>a.name==='office_copy').length,1);assert.equal(native.snapshot().items[0].text,'두 번째 내용');
  assert.ok(nextProvider.requests.some(r=>r.messages.some(m=>m.content.includes('금액은 천 원 단위'))));
  assert.throws(()=>startContentAgent({host:'word',request:'수정',scope,contentTemplate:{...contentTemplate,scopeId:'foreign'},providers:provider()}),/template_copy_scope_changed/);
});
test('final template save reconciles lost replies and rejects a different destination',async()=>{
  for(const mode of ['lost','wrong_path','cancel']){
    const {native,run}=templateRun();
    for(const kind of ['template_copy','edit']){const wait=await until(run,native.action);assert.equal(wait.action.payload.kind,kind);run.respond(wait.action.callId,{approved:true});}
    const wait=await until(run,native.action);assert.equal(wait.action.payload.kind,'save');run.respond(wait.action.callId,{approved:mode!=='cancel'});
    const done=await until(run,a=>{const result=native.action(a);if(a.name==='office_save')return mode==='lost'?{error:'office_timeout'}:{...result,path:'unrelated.docx'};return result;});
    assert.equal(done.state,mode==='lost'?'done':mode==='cancel'?'cancelled':'failed');
    assert.equal(native.actions.filter(a=>a.name==='office_copy').length,1);assert.equal(native.writes,1);
    assert.equal(native.actions.filter(a=>a.name==='office_save').length,mode==='cancel'?0:1);
    if(mode==='lost')assert.equal(done.artifact.path,'copy.docx');else assert.equal(done.artifact,undefined);
  }
});
test('Word and PowerPoint specialize tools, verify each receipt and save only after explicit test approval',async()=>{
  for(const host of ['word','powerpoint']){
    const native=fixture(host),op=host==='word'?{type:'append_paragraph',text:'보고 내용',style:'Heading1'}:{type:'add_slide',title:'보고 내용',bullets:['확인한 사실'],notes:'발표 설명'};
    const providers=provider({actor:[finish(),call('create_document'),call('apply_operation',{plan:JSON.stringify(op)}),finish(),finish()]});
    const run=startContentAgent({host,request:'업무 보고를 만들어줘',scope:native.snapshot(),providers,resilienceOptions:fast});
    const wait=await until(run,native.action);assert.equal(wait.action.name,'request_approval');assert.equal(wait.action.payload.kind,'save');
    assert.equal(native.writes,1);assert.equal(native.actions.some(a=>a.name==='office_save'),false);assert.equal(wait.plan.completed,3);
    assert.equal(wait.plan.total,4);assert.equal(wait.plan.steps.at(-1).kind,'save');assert.equal(wait.plan.steps.at(-1).state,'running');
    run.respond(wait.action.callId,{approved:true});const done=await until(run,native.action);
    assert.equal(done.state,'done');assert.equal(done.artifact.saved,true);assert.equal(done.engine,AGENT_ENGINE);
    assert.equal(done.plan.completed,done.plan.total);assert.equal(done.plan.currentStepId,null);
    assert.ok(providers.requests.some(r=>r.messages[0].content.includes(host==='word'?'native heading':'slide story')));
    assert.ok(providers.requests.every(r=>!r.tools.some(t=>t.function.name==='apply_changes')));
    assert.equal(native.actions.filter(a=>a.name==='office_create').length,1);
  }
});
test('lost mutation acknowledgement reconciles one receipt without repeating a write',async()=>{
  const native=fixture(),run=startContentAgent({host:'word',request:'원본을 수정해줘',scope:native.snapshot(),resilienceOptions:fast,providers:provider({plan:task('edit'),actor:[finish(),call('apply_operation',{plan:JSON.stringify({type:'replace_text',targetId:'p-1',text:'수정'})}),finish(),finish()]})});
  let wait=await until(run,native.action);assert.equal(wait.action.payload.kind,'edit');run.respond(wait.action.callId,{approved:true});
  const done=await until(run,a=>{const result=native.action(a);return a.name==='office_apply'?{error:'office_timeout'}:result;});
  assert.equal(done.state,'done');assert.equal(native.writes,1);assert.equal(native.actions.filter(a=>a.name==='office_receipt').length,1);assert.equal(done.artifact,undefined);
});
test('unknown mutation outcome stops without replay or a false completion',async()=>{
  const native=fixture(),run=startContentAgent({host:'word',request:'수정',scope:native.snapshot(),resilienceOptions:fast,providers:provider({plan:task('edit'),actor:[finish(),call('apply_operation',{plan:JSON.stringify({type:'replace_text',targetId:'p-1',text:'수정'})})]})});
  const wait=await until(run,native.action);run.respond(wait.action.callId,{approved:true});
  const done=await until(run,a=>a.name==='office_apply'?{error:'write_uncertain'}:a.name==='office_receipt'?{outcome:'uncertain'}:native.action(a));
  assert.equal(done.state,'failed');assert.equal(done.error,'write_uncertain');assert.equal(native.writes,0);
});
test('user changes while approval is open reject a stale write',async()=>{
  const native=fixture(),run=startContentAgent({host:'word',request:'수정',scope:native.snapshot(),resilienceOptions:fast,providers:provider({plan:task('edit'),actor:[finish(),call('apply_operation',{plan:JSON.stringify({type:'replace_text',targetId:'p-1',text:'수정'})})]})});
  const wait=await until(run,native.action);native.change();run.respond(wait.action.callId,{approved:true});const done=await until(run,native.action);
  assert.equal(done.error,'source_changed');assert.equal(native.writes,0);
});
test('no-progress model output pauses after three attempts and cancellation fences more calls',async()=>{
  const native=fixture(),providers=provider({actor:()=>text('완료했습니다.')});
  const run=startContentAgent({host:'word',request:'작성',scope:native.snapshot(),providers,resilienceOptions:fast});
  const wait=await until(run,native.action);assert.equal(wait.action.payload.kind,'recovery');assert.equal(wait.metrics.recoveryPauses,1);assert.equal(native.writes,0);
  const calls=providers.requests.length;run.respond(wait.action.callId,{approved:false});await run.promise;assert.equal(run.status().state,'cancelled');assert.equal(providers.requests.length,calls);
});
test('HITL answers remain in the same run and require exact receipt acknowledgement',async()=>{
  let plans=0;const native=fixture(),providers=provider({plan:()=>++plans===1?{intent:'clarify',title:'보고서',summary:'기간 확인',question:{question:'대상 기간은 언제인가요?',choices:[],input_mode:'text'}}:task('analyze'),actor:[finish(),finish(),finish()]});
  const run=startContentAgent({host:'word',request:'분석',scope:native.snapshot(),providers,resilienceOptions:fast});const wait=await until(run,native.action);
  assert.equal(wait.action.name,'request_input');assert.throws(()=>run.respond(wait.action.callId,{text:''}),/invalid_question/);
  const value={text:'지난 분기'};run.respond(wait.action.callId,value);run.respond(wait.action.callId,value);assert.throws(()=>run.respond(wait.action.callId,{text:'다른 답'}),/tool_result_conflict/);
  const done=await until(run,native.action);assert.equal(done.state,'done');assert.equal(done.id,run.id);assert.ok(providers.requests.some(r=>r.messages.some(m=>m.content.includes('지난 분기'))));assert.equal(native.writes,0);
});
test('a failed preservation check cannot be waived by an accepting LLM reviewer',async()=>{
  const native=fixture(),run=startContentAgent({host:'word',request:'작성',scope:native.snapshot(),providers:provider(),resilienceOptions:fast});
  const done=await until(run,a=>{const result=native.action(a);if(a.name==='office_apply')result.checks=[{requirement:'선택 밖 문단 보존',status:'unmet'}];return result;});
  assert.equal(done.state,'failed');assert.equal(done.error,'content_verification_failed');assert.equal(native.writes,1);assert.equal(native.actions.some(a=>a.name==='office_save'),false);
});
test('host identity is native configuration and payload cannot select another app executor',async()=>{
  const providers=provider(),worker=createWorker({...providers,dispose(){}},{host:'word'});
  assert.equal((await worker.dispatch('session')).host,'word');
  await assert.rejects(worker.dispatch('runStart',{request:'write',scope:{...fixture().snapshot(),host:'excel'},host:'excel',mode:'edit'}),/invalid_request/);
  assert.throws(()=>createWorker(providers,{host:'access'}),/unsupported_office_host/);worker.dispose();
});
test('schemas enforce selection, host tools, Office structures and complete evidence coverage',()=>{
  const scope=fixture().snapshot();
  assert.throws(()=>contentOperation('word',{type:'add_slide',title:'x',bullets:[],notes:''},scope),/unsupported_operation/);
  assert.throws(()=>contentOperation('word',{type:'append_paragraph',text:'x',style:'Normal'},scope),/out_of_scope/);
  assert.throws(()=>contentOperation('word',{type:'replace_text',targetId:'p-2',text:'x'},scope),/unsupported_target/);
  assert.throws(()=>contentOperation('word',{type:'replace_text',targetId:'p-1',text:'x\ny'},scope),/document_schema_invalid/);
  assert.throws(()=>contentOperation('word',{type:'append_table',rows:[['a'],['b','c']]},{...scope,created:true}),/document_schema_invalid/);
  assert.throws(()=>contentTask(encoded({...task('analyze'),save:true})),/document_schema_invalid/);
  assert.throws(()=>contentReview(encoded(goodReview),{...task(),requirements:['a','b']},[{id:1}],null),/goal_review_failed/);
  assert.throws(()=>contentObservation({...scope,documentId:'other'},'word','source','source'),/observation_invalid/);
  assert.equal(isRetryableRead('office_read'),true);assert.equal(isRetryableRead('office_receipt'),true);assert.equal(isRetryableRead('office_apply'),false);assert.equal(isRetryableRead('office_save'),false);assert.equal(transientRead(new Error('office_busy')),true);
});

test('a final review revision returns to a write step and keeps the same native draft',async()=>{
  let finalReviews=0;const native=fixture();
  const providers=provider({actor:[finish(),call('create_document'),call('apply_operation',{plan:JSON.stringify({type:'append_paragraph',text:'초안',style:'Normal'})}),finish(),finish(),call('apply_operation',{plan:JSON.stringify({type:'replace_text',targetId:'p-1',text:'최종 내용'})}),finish(),finish()],review:messages=>encoded(messages[0].content.includes('ALL original')&&++finalReviews===1?{status:'revise',checks:[{requirement:0,status:'unmet',evidence:[1]}],feedback:'p-1을 최종 내용으로 보완하세요.'}:acceptedReview(messages))});
  const run=startContentAgent({host:'word',request:'작성',scope:native.snapshot(),providers,resilienceOptions:fast});
  const wait=await until(run,native.action);assert.equal(wait.action.payload.kind,'save');assert.equal(native.writes,2);assert.equal(native.snapshot().items[0].text,'최종 내용');assert.equal(native.actions.filter(a=>a.name==='office_create').length,1);
  assert.equal(wait.plan.completed,4);run.respond(wait.action.callId,{approved:true});assert.equal((await until(run,native.action)).state,'done');
});
test('read-only PowerPoint analysis can report existing overflow without writing to unrelated content',async()=>{
  const native=fixture('powerpoint'),scope={...native.snapshot(),items:[{...native.snapshot().items[0],overflow:true}]};
  const run=startContentAgent({host:'powerpoint',request:'넘침을 분석해줘',scope,providers:provider({plan:task('analyze'),actor:[finish(),finish(),finish()]}),resilienceOptions:fast});
  const done=await until(run,a=>a.name==='office_read'?scope:native.action(a));assert.equal(done.state,'done');assert.equal(done.writes,0);
});

test('cancelling final save leaves a reviewed draft without reporting the save step complete',async()=>{
  const native=fixture(),run=startContentAgent({host:'word',request:'보고서 작성',scope:native.snapshot(),providers:provider(),resilienceOptions:fast});
  const wait=await until(run,native.action);assert.equal(wait.action.payload.kind,'save');
  run.respond(wait.action.callId,{approved:false});await run.promise;
  const stopped=run.status();assert.equal(stopped.state,'cancelled');assert.equal(stopped.plan.completed,3);assert.equal(stopped.plan.total,4);
  assert.equal(stopped.plan.steps.at(-1).state,'paused');assert.equal(native.actions.some(a=>a.name==='office_save'),false);assert.equal(native.writes,1);
});

test('Word business field collects a fact in the same run, then requires approval for that exact field',async()=>{
  const field={id:'cc-42',kind:'field',title:'사업부',tag:'department',controlType:1,text:'선택하세요',showingPlaceholder:true,editable:true,mapped:false,locked:false,temporary:false,nested:false};
  const native=fixture('word',[field]),providers=provider({plan:task('edit'),actor:[finish(),call('ask_user',{question:'어느 사업부인가요?',choices:[],input_mode:'text'}),call('apply_operation',{plan:JSON.stringify({type:'fill_field',targetId:'cc-42',text:'사업부 A'})}),finish(),finish()]});
  const run=startContentAgent({host:'word',request:'기존 양식의 사업부를 채워줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  const input=await until(run,native.action);assert.equal(input.action.name,'request_input');assert.equal(native.writes,0);
  run.respond(input.action.callId,{text:'사업부 A'});const approval=await until(run,native.action);
  assert.equal(approval.action.payload.target,'사업부');assert.equal(approval.action.payload.operations[0].targetId,'cc-42');assert.equal(approval.action.payload.operations[0].text,'사업부 A');assert.equal(native.writes,0);
  run.respond(approval.action.callId,{approved:true});const done=await until(run,native.action);
  assert.equal(done.state,'done');assert.equal(native.snapshot().items[0].text,'사업부 A');assert.equal(done.validation.checks[0].status,'met');
  assert.ok(providers.requests.some(r=>r.messages.some(m=>m.content.includes('사업부 A')&&m.content.includes('answers'))));
});

test('inspection uses a step outcome while only final review can satisfy all requirements',async()=>{
  const native=fixture(),providers=provider({plan:task('analyze'),actor:[finish(),finish(),finish()],review:messages=>{
    const system=messages[0].content;
    if(system.includes('ALL original'))return encoded(goodReview);
    assert.match(system,/not the finished document/);assert.match(system,/criterion:specific current-step outcome/);
    return encoded(goodStepReview);
  }});
  const run=startContentAgent({host:'word',request:'문서를 분석해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  const done=await until(run,native.action);assert.equal(done.state,'done');assert.equal(done.metrics.retries||0,0);
  assert.equal(done.review.checks[0].requirement,0);
});

test('Word schema recovery uses only its own tool guidance and keeps the same draft plan',async()=>{
  const native=fixture(),providers=provider();const complete=providers.complete;let first=true;
  providers.complete=async(...args)=>{if(first){first=false;return{content:'{',calls:[],finishReason:'length'};}return complete(...args);};
  const run=startContentAgent({host:'word',request:'보고서 작성',scope:native.snapshot(),providers,resilienceOptions:fast});
  const wait=await until(run,native.action);assert.equal(wait.action.payload.kind,'save');
  const repair=providers.requests.find(r=>r.messages.some(m=>m.content.includes('rejectedResponse')));
  assert.ok(repair);assert.ok(repair.messages.some(m=>m.content.includes('Word tools supplied')));assert.equal(JSON.stringify(repair).includes('write_document_chunk'),false);
  assert.equal(native.actions.filter(a=>a.name==='office_create').length,1);run.respond(wait.action.callId,{approved:false});await run.promise;
});

test('Word and PPT retrieve historical facts and document anchors without authorizing a write',async()=>{
  for(const host of ['word','powerpoint']){
    const native=fixture(host),providers=provider({plan:task('analyze'),actor:[call('recall_context',{query:'0000417'}),call('search_document',{query:'원본'}),finish(),finish(),finish()]});
    const history=Array.from({length:30},(_,i)=>({role:'user',content:i===2?'정산 코드 0000417을 유지하세요.':'이전 대화 '+i}));
    const run=startContentAgent({host,request:'기존 양식 내용을 분석해줘',scope:native.snapshot(),providers,history,resilienceOptions:fast});
    const done=await until(run,native.action);
    assert.equal(done.state,'done',done.error);assert.equal(done.metrics.historyContext.retrievals,1);assert.equal(done.metrics.documentSearches,1);
    assert.equal(native.writes,0);assert.equal(native.actions.some(a=>a.name==='office_apply'),false);
    const afterSearch=providers.requests.find(r=>r.messages.some(m=>m.role==='user'&&JSON.parse(m.content).lastReceipt?.kind==='document_search'));
    assert.ok(afterSearch);assert.ok(JSON.stringify(afterSearch).includes(host==='word'?'p-1':'s-1/h-2'));
    assert.ok(providers.requests.some(r=>r.messages[0].content.includes('ALL original')&&JSON.stringify(r).includes('0000417')));
  }
});

test('Word/PPT integrate isolated analysis recovery, retain successful branches and original review constraints',async()=>{
  for(const host of ['word','powerpoint']){
    const native=fixture(host),target=native.snapshot().items[0].id,tasks=['내용 확인','누락 검토'].map(goal=>({goal,itemIds:[target],role:'review',constraints:'저장하지 않는다',doneWhen:'원문 근거를 제시한다'}));
    const counts={},base=provider({plan:task('analyze'),actor:[call('analyze_document',{tasks}),call('analyze_document',{tasks}),finish(),finish(),finish()]});let reviewed=false;
    const providers={...base,async complete(messages,tools,...rest){
      if(messages[0].content.includes('_ANALYST.')){
        assert.deepEqual(tools,[]);const parent=JSON.parse(messages.at(-1).content);assert.equal(parent.kind,'parent_task_context');assert.equal(parent.request,'기존 문서를 분석해줘');assert.deepEqual(parent.requirements,task('analyze').requirements);const {goal,sources}=JSON.parse(messages[1].content);counts[goal]=(counts[goal]||0)+1;
        if(goal==='누락 검토'&&counts[goal]===1)throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:1200});
        return encoded({summary:'원문 확인',findings:[{text:'원본을 읽음',sources:[{itemId:target,field:'text',quote:sources[0].item.text}]}],missing:[]});
      }
      if(messages[0].content.includes('ALL original')){reviewed=true;const packet=JSON.parse(messages[1].content);assert.equal(packet.userRequirements.sources[1].text,'초안 분석만 요청했으며 저장하지 않는다.');assert.equal(packet.analyses.length,2);assert.equal(packet.analyses[0].findings[0].sources[0].itemId,target);}
      return base.complete(messages,tools,...rest);
    }};
    const waits=[],run=startContentAgent({host,request:'기존 문서를 분석해줘',scope:native.snapshot(),history:[{role:'user',content:'문서를 검토할 거야'},{role:'assistant',content:'알겠습니다.'},{role:'user',content:'초안 분석만 요청했으며 저장하지 않는다.'}],providers,resilienceOptions:{...fast,wait:async ms=>waits.push(ms)}});
    const done=await until(run,native.action);assert.equal(done.state,'done',done.error);assert.equal(reviewed,true);assert.deepEqual(counts,{'내용 확인':1,'누락 검토':2});assert.ok(waits.some(ms=>ms>=1200));assert.equal(native.writes,0);
    assert.equal(done.metrics.subagentCalls,3);assert.equal(done.activity.filter(e=>e.kind==='subagent'&&e.state==='done').length,2);
  }
});

test('Word/PPT summary failure retains raw requirements and the same run through tool failure recovery',async()=>{
  for(const host of ['word','powerpoint']){
    const native=fixture(host),history=Array.from({length:20},(_,i)=>({role:'user',content:`조건 ${i}: `+'초안 보존 '.repeat(260)})),base=provider({plan:task('analyze'),actor:[call('read_document',{offset:3}),call('read_document',{offset:0}),finish(),finish(),finish()]});let summaries=0,continuitySeen=false;
    const providers={...base,async complete(messages,tools,...rest){
      if(messages[0].content.startsWith('NUBI_CONTEXT_SUMMARIZER')){summaries++;return encoded({items:[]});}
      if(messages[0].content.includes('_ACTOR.')){const packet=JSON.parse(messages[1].content);assert.ok(packet.continuity);if(packet.feedback.includes('document_schema_invalid')){continuitySeen=true;assert.equal(packet.continuity.lastFailure.code,'document_schema_invalid');assert.equal(packet.continuity.verifiedWrites,0);}}
      if(messages[0].content.includes('ALL original'))assert.equal(JSON.parse(messages[1].content).userRequirements.sources.length,20);
      return base.complete(messages,tools,...rest);
    }};
    const run=startContentAgent({host,request:'원본을 분석해줘',history,scope:native.snapshot(),providers,resilienceOptions:fast});const done=await until(run,native.action);
    assert.equal(done.state,'done',done.error);assert.equal(summaries,1);assert.equal(continuitySeen,true);assert.equal(done.metrics.autoSummary.fallbacks,1);assert.equal(native.writes,0);
  }
});

test('Word/PPT repeated successful reads replan once, then pause without a nested retry or more calls after cancel',async()=>{
  for(const host of ['word','powerpoint']){
    const native=fixture(host);let calls=0;
    const providers=provider({plan:task('analyze'),actor:()=>{calls++;return call('read_document',{offset:0});}});
    const run=startContentAgent({host,request:'원본 문서를 분석해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
    try{
      const paused=await until(run,native.action);
      assert.equal(paused.action.payload.kind,'recovery');assert.equal(paused.recovery.code,'tool_loop_detected');
      assert.equal(calls,5);assert.equal(paused.metrics.toolProgress.prevented,2);assert.equal(paused.metrics.recoveryPauses,1);
      assert.equal(native.writes,0);assert.equal(native.actions.filter(a=>a.name==='office_read').length,4);
      assert.ok(providers.requests.some(r=>JSON.stringify(r.messages).includes('tool_loop_detected')));
      run.respond(paused.action.callId,{approved:false});await run.promise;
      await new Promise(resolve=>setImmediate(resolve));assert.equal(run.status().state,'cancelled');assert.equal(calls,5);
      assert.equal(run.status().activity.some(e=>e.state==='running'),false);
    }finally{run.cancel();await run.promise;}
  }
});

test('Word/PPT actors use the Pi skill tools without replacing native authoring or granting document writes',async()=>{
  for(const host of ['word','powerpoint']){
    const native=fixture(host),providers=provider({plan:task('analyze'),actor:[call('find',{pattern:'**/SKILL.md'}),call('read',{path:`skills/${host}-2016/SKILL.md`}),call('write',{path:'draft/notes.md',content:'검토한 원본의 구성'}),finish(),finish(),finish()]});
    const run=startContentAgent({host,request:'원본 문서의 구성을 검토해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
    try{
      const done=await until(run,native.action);assert.equal(done.state,'done',done.error);assert.equal(native.writes,0);
      assert.deepEqual(done.metrics.skillWorkspace.activeSkills,[host+'-2016']);assert.equal(done.metrics.skillWorkspace.writes,1);
      const actor=providers.requests.find(r=>r.messages[0].content.includes('_ACTOR.'));assert.ok(actor.tools.some(t=>t.function.name==='edit'));
      assert.equal(done.activity.some(e=>e.tool==='read'&&e.state==='done'),true);
    }finally{run.cancel();await run.promise;}
  }
});

test('Word/PPT repair failing code, consume a real WASM result and keep final native save approval',async()=>{
  for(const host of ['word','powerpoint']){
    const native=fixture(host);let n=0;
    const providers=provider({actor:messages=>{
      const packet=JSON.parse(messages[1].content),step=n++;
      if(step===0)return finish();
      if(step===1)return call('create_document');
      if(step===2)return call('write',{path:'draft/calculate.js',content:'function transform(input){return {total:input.missing.value}}'});
      if(step===3||step===5)return call('run_script',{path:'draft/calculate.js',input:'{"values":[12,30]}'});
      if(step===4){assert.equal(packet.lastReceipt.error,'script_failed');return call('edit',{path:'draft/calculate.js',edits:[{oldText:'input.missing.value',newText:'input.values.reduce((a,b)=>a+b,0)'}]});}
      if(step===6){
        assert.equal(packet.lastReceipt.output.total,42);assert.equal(packet.resources.lastScript.current,true);
        const content='확인한 합계: '+packet.lastReceipt.output.total;
        return call('apply_operation',{plan:JSON.stringify(host==='word'?{type:'append_paragraph',text:content,style:'Normal'}:{type:'add_slide',title:content,bullets:['입력값 12와 30'],notes:'계산 결과 확인'})});
      }
      return finish();
    }});
    const run=startContentAgent({host,request:'12와 30의 합계를 확인하고 문서를 작성해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
    try{
      const wait=await until(run,native.action,1);assert.equal(wait.action?.payload.kind,'save',wait.error);
      assert.equal(native.writes,1);assert.match(native.snapshot().items[0].text,/42/);
      assert.equal(wait.metrics.skillWorkspace.scriptRuns,1);assert.equal(wait.metrics.skillWorkspace.scriptFailures,1);
      assert.ok(wait.activity.some(e=>e.title==='본문 작성'&&e.state==='error'));
      assert.equal(native.actions.some(a=>a.name==='office_save'),false);
      run.respond(wait.action.callId,{approved:false});await run.promise;assert.equal(run.status().state,'cancelled');
    }finally{run.cancel();await run.promise;}
  }
});

for(const host of ['word','powerpoint'])test(`${host} local failures pause at three, retain the original cause on resume and never write`,async()=>{
  const native=fixture(host);let calls=0,resumed=false,sawOriginal=false;
  const providers=provider({plan:task('analyze'),actor:messages=>{
    calls++;
    if(resumed)sawOriginal ||= messages.some(m=>m.content?.includes('workspace_file_missing'));
    return call('read',{path:'draft/missing.txt'});
  }});
  const run=startContentAgent({host,request:'문서 자료를 확인해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const paused=await until(run,native.action);
    assert.equal(paused.action.payload.kind,'recovery');assert.equal(calls,3);
    assert.equal(paused.recovery.code,'workspace_file_missing');assert.equal(paused.metrics.retries,3);
    assert.equal(native.writes,0);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);
    resumed=true;run.respond(paused.action.callId,{approved:true});
    const pausedAgain=await until(run,native.action);
    assert.equal(pausedAgain.id,paused.id);assert.ok(sawOriginal);assert.equal(calls,6);
    assert.equal(pausedAgain.metrics.retries,6);assert.equal(pausedAgain.recovery.withoutProgress,3);assert.equal(native.writes,0);
    run.respond(pausedAgain.action.callId,{approved:false});await run.promise;
    assert.equal(run.status().state,'cancelled');assert.equal(calls,6);assert.equal(native.writes,0);
  }finally{run.cancel();await run.promise;}
});

for(const host of ['word','powerpoint'])for(const protocol of ['native','json'])for(const rejection of ['schema','unknown'])test(`${host} ${protocol} ${rejection} rejection keeps field feedback and stops before native execution`,async()=>{
  const native=fixture(host);let calls=0,sawCause=false;
  const providers=provider({plan:task('analyze'),actor:messages=>{
    calls++;
    const expected=rejection==='schema'?'tool_arguments_invalid':'tool_unavailable';
    sawCause ||= messages.some(m=>m.content?.includes(expected));
    if(protocol==='json'&&calls===1)return text('도구를 선택하겠습니다.');
    const name=rejection==='schema'?'apply_operation':'not_a_connected_tool';
    return protocol==='json'?encoded({tool:name,arguments:{plan:42}}):call(name,{plan:42});
  }});
  const run=startContentAgent({host,request:'문서 자료를 분석해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const paused=await until(run,native.action);
    assert.equal(paused.action?.payload.kind,'recovery',paused.error);assert.equal(calls,3);
    assert.equal(paused.recovery.code,rejection==='schema'?'tool_arguments_invalid':'tool_unavailable');
    assert.equal(paused.metrics.toolProtocolFailures,protocol==='json'?2:3);assert.equal(paused.metrics.retries,3);assert.ok(sawCause);
    assert.equal(native.writes,0);assert.equal(native.actions.filter(a=>['office_apply','office_create','office_save'].includes(a.name)).length,0);
    run.respond(paused.action.callId,{approved:false});await run.promise;assert.equal(run.status().state,'cancelled');assert.equal(calls,3);
  }finally{run.cancel();await run.promise;}
});

for(const host of ['word','powerpoint'])for(const protocol of ['native','json'])test(`${host} ${protocol} corrects nested operation fields and retains edit approval`,async()=>{
  const native=fixture(host),targetId=native.snapshot().items[0].id;
  let calls=0,next=0,sawFields=false;
  const actions=[finish(),call('apply_operation',{plan:JSON.stringify({type:'replace_text',targetId,text:42})}),
    call('apply_operation',{plan:JSON.stringify({type:'replace_text',targetId,text:'수정한 보고 내용'})}),finish(),finish()];
  const providers=provider({plan:task('edit'),actor:messages=>{
    calls++;
    if(protocol==='json'&&calls===1)return text('다음 도구를 선택합니다.');
    if(next===2){
      const packet=JSON.parse(messages[1].content),feedback=JSON.parse(packet.feedback);
      assert.equal(feedback.toolFailure.actionIssued,false);assert.equal(native.writes,0);
      assert.ok(feedback.toolFailure.issues.some(issue=>issue.path==='/text'&&issue.rule==='type'));
      assert.equal(feedback.toolFailure.expectedSchema.properties.text.type,'string');
      assert.equal(packet.continuity.verifiedWrites,0);sawFields=true;
    }
    const result=actions[next++]||finish();
    if(protocol==='native')return result;
    const fn=result.calls[0].function;return encoded({tool:fn.name,arguments:JSON.parse(fn.arguments)});
  }});
  const run=startContentAgent({host,request:'선택한 원본 내용을 수정해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const waiting=await until(run,native.action);
    assert.equal(waiting.action?.payload.kind,'edit',waiting.error);assert.ok(sawFields);assert.equal(native.writes,0);
    run.respond(waiting.action.callId,{approved:true});const done=await until(run,native.action);
    assert.equal(done.state,'done',done.error);assert.equal(native.writes,1);assert.equal(done.metrics.operationValidationFailures,1);
    assert.equal(native.actions.filter(a=>a.name==='office_apply').length,1);
    assert.equal(native.snapshot().items[0].text,'수정한 보고 내용');
  }finally{run.cancel();await run.promise;}
});

for(const host of ['word','powerpoint'])test(`${host} repeated nested operation errors pause without a write and cancel stays terminal`,async()=>{
  const native=fixture(host);let calls=0;
  const providers=provider({plan:task('edit'),actor:()=>++calls===1?finish():call('apply_operation',{plan:JSON.stringify({type:'replace_text',targetId:native.snapshot().items[0].id,text:42})})});
  const run=startContentAgent({host,request:'현재 내용을 수정해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const paused=await until(run,native.action);
    assert.equal(paused.action?.payload.kind,'recovery',paused.error);assert.equal(paused.recovery.withoutProgress,3);
    assert.equal(calls,4);assert.equal(native.writes,0);
    run.respond(paused.action.callId,{approved:false});await run.promise;
    assert.equal(run.status().state,'cancelled');assert.equal(calls,4);assert.equal(native.writes,0);
  }finally{run.cancel();await run.promise;}
});

test('a truncated Word source cannot pass the final review even when every scripted verdict accepts it',async()=>{
  const native=fixture('word',[{id:'p-1',kind:'paragraph',text:'보이는 앞부분',truncated:true,textLength:5000,editable:false}]);let finalCalls=0;
  const providers=provider({plan:task('analyze'),actor:[finish(),finish(),finish()],review:messages=>{
    if(messages[0].content.includes('ALL original'))finalCalls++;
    return encoded(acceptedReview(messages));
  }});
  const run=startContentAgent({host:'word',request:'문서 전체를 검토해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  const done=await until(run,native.action);
  assert.equal(done.state,'failed');assert.equal(done.error,'evidence_incomplete');assert.equal(finalCalls,0);
  assert.equal(native.writes,0);assert.equal(done.plan.steps.at(-1).state,'failed');
});
for(const host of ['word','powerpoint'])test(`${host} edits made during final AI review invalidate completion`,async()=>{
  const native=fixture(host);let changed=false;
  const providers=provider({plan:task('analyze'),actor:[finish(),finish(),finish()],review:messages=>{
    if(messages[0].content.includes('ALL original')){changed=true;native.change();}
    return encoded(acceptedReview(messages));
  }});
  const run=startContentAgent({host,request:'문서 전체를 검토해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  const done=await until(run,native.action);
  assert.ok(changed);assert.equal(done.state,'failed');assert.equal(done.error,'source_changed');
  assert.equal(native.writes,0);assert.equal(done.plan.steps.at(-1).state,'failed');
});

test('a legacy truncated Word field cannot be copied and registered as a fully analyzed template',async()=>{
  const native=fixture('word',[{id:'cc-1',kind:'field',text:'가'.repeat(4000),editable:false}]);
  const providers=provider({plan:task('register'),actor:[finish(),finish(),finish()]});
  const run=startContentAgent({host:'word',mode:'template-register',request:'현재 양식을 분석해서 등록해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  const done=await until(run,native.action);
  assert.equal(done.state,'failed');assert.equal(done.error,'evidence_incomplete');assert.equal(done.registeredTemplate,undefined);
  assert.equal(native.actions.some(a=>['office_copy','office_template_register'].includes(a.name)),false);assert.equal(native.writes,0);
});


test('dynamic Word/PPT specialists execute dependency plans then return grounded reports to the parent',async()=>{
  for(const host of ['word','powerpoint']){
    const documentSkill={id:'00000000-0000-4000-8000-000000000001',host:host,revision:1,name:'검토 규칙',instructions:'금액은 천 원 단위로 검토한다.',questions:[]},native=fixture(host),target=native.snapshot().items[0].id;
    const tasks=[['facts','사실 확인',[]],['structure','구성 검토',[]],['combine','통합 검토',['facts','structure']]].map(([id,specialty,dependsOn])=>({id,specialty,dependsOn,goal:specialty+' 결과 정리',role:'review',constraints:'원문만 인용한다',doneWhen:'근거와 누락을 분리한다',itemIds:[target]}));
    const base=provider({plan:task('analyze'),actor:[call('delegate_document_tasks',{tasks}),finish(),finish(),finish()]}),seen=[];let active=0,peak=0,parentReceived=false;
    const providers={...base,async complete(messages,tools,...rest){
      if(messages[0].content.includes('_ANALYST.')){
        assert.deepEqual(tools,[]);const data=JSON.parse(messages[1].content);seen.push(data.specialty);assert.ok(JSON.parse(messages.at(-1).content).activeSkills[0].instructions.includes(documentSkill.instructions));
        const predecessors=messages.map(m=>{try{return JSON.parse(m.content);}catch{return{};}}).find(m=>m.kind==='advisory_predecessor_reports');
        assert.equal(predecessors.dependencies.length,data.specialty==='통합 검토'?2:0);
        if(data.specialty==='통합 검토')for(const report of predecessors.dependencies){assert.equal(report.reportStatus,'complete');assert.equal(report.findings[0].sources[0].quote,'원본');}
        active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;
        return encoded({summary:data.specialty,findings:[{text:'원문 관찰',sources:[{itemId:target,field:'text',quote:'원본'}]}],missing:[]});
      }
      if(messages[0].content.includes('_ACTOR.')){
        assert.ok(tools.some(tool=>tool.function.name==='delegate_document_tasks'));
        const packet=JSON.parse(messages[1].content);if(packet.lastReceipt?.planId){parentReceived=true;assert.equal(packet.lastReceipt.results.length,3);assert.equal(packet.lastReceipt.advisory,true);}
      }
      return base.complete(messages,tools,...rest);
    }};
    const run=startContentAgent({host,documentSkill,request:'내용과 구조를 나눠 검토하고 합쳐줘',scope:native.snapshot(),providers,resilienceOptions:fast});
    const done=await until(run,a=>{assert.equal(active,0,'COM reads must wait for branch settlement');return native.action(a);});
    assert.equal(done.state,'done',done.error);assert.equal(parentReceived,true);assert.equal(peak,2);assert.deepEqual(seen,['사실 확인','구성 검토','통합 검토']);assert.equal(native.writes,0);
    assert.equal(done.delegationWorkers.nodes.length,3);assert.ok(done.delegationWorkers.nodes.every(n=>n.state==='done'));assert.equal(done.metrics.subagentCalls,3);
  }
});

test('incomplete specialist facts block successors and return to the same parent HITL',async()=>{
  const native=fixture(),tasks=[{id:'facts',specialty:'기준 확인',goal:'기준 확인',role:'analysis',constraints:'기준을 추측하지 않는다',doneWhen:'기간을 확인한다',itemIds:['p-1'],dependsOn:[]},{id:'merge',specialty:'통합',goal:'통합',role:'review',constraints:'기준 필요',doneWhen:'기준 반영',itemIds:['p-1'],dependsOn:['facts']}];
  let children=0;const base=provider({plan:task('analyze'),actor:[call('delegate_document_tasks',{tasks}),call('ask_user',{question:'기준 기간은 언제인가요?'})]});
  const providers={...base,async complete(messages,tools,...rest){if(messages[0].content.includes('_ANALYST.')){children++;return encoded({summary:'기준 기간 미확인',findings:[],missing:['기준 기간']});}return base.complete(messages,tools,...rest);}};
  const run=startContentAgent({host:'word',request:'기준에 맞게 검토해줘',scope:native.snapshot(),providers,resilienceOptions:fast}),wait=await until(run,native.action);
  assert.equal(wait.action.name,'request_input');assert.equal(children,1);assert.equal(wait.delegationWorkers.nodes[0].state,'waiting');assert.equal(wait.delegationWorkers.nodes[1].state,'blocked');assert.equal(native.writes,0);
  run.cancel();await run.promise;assert.equal(run.status().state,'cancelled');assert.equal(children,1);
});


test('dynamic delegation uses the parent Retry-After recovery and preserves completed peers',async()=>{
  const native=fixture(),tasks=['A','B','C'].map(id=>({id,specialty:id,goal:id,role:'analysis',constraints:'원문 기준',doneWhen:'근거 확인',itemIds:['p-1'],dependsOn:id==='C'?['A','B']:[]}));
  const base=provider({plan:task('analyze'),actor:[call('delegate_document_tasks',{tasks}),call('delegate_document_tasks',{tasks}),finish(),finish(),finish()]}),counts={},waits=[];
  const providers={...base,async complete(messages,tools,...rest){
    if(messages[0].content.includes('_ANALYST.')){const {goal}=JSON.parse(messages[1].content);counts[goal]=(counts[goal]||0)+1;
      if(goal==='B'&&counts[goal]===1)throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:1900});
      return encoded({summary:goal,findings:[{text:'관찰',sources:[{itemId:'p-1',field:'text',quote:'원본'}]}],missing:[]});}
    return base.complete(messages,tools,...rest);
  }};
  const run=startContentAgent({host:'word',request:'세 역할로 검토해줘',scope:native.snapshot(),providers,resilienceOptions:{...fast,wait:async ms=>waits.push(ms)}});
  const done=await until(run,native.action);assert.equal(done.state,'done',done.error);assert.deepEqual(counts,{A:1,B:2,C:1});assert.ok(waits.some(ms=>ms>=1900));assert.equal(native.writes,0);
});

test('Word context can retrieve an omitted partial specialist report after another tool replaces the receipt',async()=>{
  const native=fixture(),tasks=Array.from({length:8},(_,i)=>({id:'role'+i,specialty:'검토 '+i,goal:'검토 '+i,role:'review',constraints:'원문만 인용한다',doneWhen:'누락을 확인한다',itemIds:['p-1'],dependsOn:[]}));
  let decisions=0,children=0,retrieved=false;
  const base=provider({plan:task('analyze'),actor:messages=>{
    const packet=JSON.parse(messages[1].content);
    if(decisions++===0)return call('delegate_document_tasks',{tasks});
    if(decisions===2)return call('read_document',{offset:0});
    if(decisions===3){
      const context=packet.delegation[0];assert.equal(context.nodes.length,8);assert.ok(context.omittedTaskIds.includes('role0'));assert.ok(JSON.stringify(context).includes('예산 상한 미정'));
      return call('read_delegation_results',{planId:context.planId,taskIds:['role0']});
    }
    assert.deepEqual(packet.lastReceipt.tasks[0].task.itemIds,['p-1']);assert.deepEqual(packet.lastReceipt.tasks[0].result.missing,['예산 상한 미정']);retrieved=true;
    return call('ask_user',{question:'예산 상한은 얼마인가요?'});
  }});
  const providers={...base,async complete(messages,tools,...rest){
    if(messages[0].content.includes('_ANALYST.')){children++;const data=JSON.parse(messages[1].content);return encoded({summary:data.specialty,findings:data.specialty==='검토 0'?[]:[{text:'원문 확인',sources:[{itemId:'p-1',field:'text',quote:'원본'}]}],missing:data.specialty==='검토 0'?['예산 상한 미정']:[]});}
    return base.complete(messages,tools,...rest);
  }};
  const run=startContentAgent({host:'word',request:'역할별 검토 후 필요한 정보만 질문해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{const waiting=await until(run,native.action);assert.equal(waiting.action.name,'request_input');assert.equal(retrieved,true);assert.equal(children,8);assert.equal(native.writes,0);}finally{run.cancel();await run.promise;}
});

test('Word and PPT long native fields reach tail fragments in review without changing raw write scope',async()=>{
  const {createHash}=await import('node:crypto'),hash=s=>createHash('sha256').update(s).digest('hex');
  for(const host of ['word','powerpoint']){
    const field=host==='word'?'text':'notes',source='본문'.repeat(7000)+'검증대상 꼬리문장',item={id:host==='word'?'p-1':'s-1',kind:host==='word'?'paragraph':'slide',text:host==='word'?source.slice(0,4000):'제목',[field]:source.slice(0,4000),truncated:true,[field+'Length']:source.length,[field+'Hash']:hash(source),editable:false,...(field==='notes'?{notesTruncated:true}:{})};
    const native=fixture(host,[item]),seen=[],actions=[];
    const providers=provider({plan:task('analyze'),actor:[call('read_document_text',{itemId:item.id,field,offset:8000,maxChars:8000}),finish(),finish(),finish()]});
    const originalComplete=providers.complete;
    providers.complete=async(messages,tools)=>{
      const system=messages[0].content;
      if(system.includes('_PARTITION_REVIEWER.')){
        const payload=JSON.parse(messages[1].content),fragments=payload.batch.items.flatMap(e=>e.value.items).filter(i=>i.kind==='text_fragment'&&typeof i[field]==='string');
        seen.push(...fragments.map(i=>i[field]));const target=fragments.at(-1);
        return encoded({checks:[{requirement:0,status:'support',finding:'원문 확인',sources:[{itemId:target.id,field,quote:target[field].slice(-15)}]}]});
      }
      if(system.includes('_PARTITION_REDUCER.'))return encoded(goodReview);
      return originalComplete(messages,tools);
    };
    const run=startContentAgent({host,request:'문서 전체 꼬리문장까지 검토해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
    const done=await until(run,a=>{
      actions.push(a.name);if(a.name!=='office_read_text')return native.action(a);
      const {offset,maxChars,itemId}=a.payload,text=source.slice(offset,offset+maxChars),end=offset+text.length;
      return{host,scopeId:'source',documentId:'source',fingerprint:'f0',itemId,field,offset,text,textLength:source.length,textHash:hash(source),chunkHash:hash(text),nextOffset:end<source.length?end:null,readOnly:true};
    });
    assert.equal(done.state,'done',done.error);assert.ok(seen.some(text=>text.includes('검증대상 꼬리문장')));assert.equal(done.review.coverage.items,1);assert.ok(done.review.coverage.fragments>=2);assert.equal(native.writes,0);assert.equal(native.snapshot().items[0][field].length,4000);assert.ok(actions.includes('office_read_text'));
  }
});
test('direct result review rejects a changed selected model before accepting completion',async()=>{
  const native=fixture(),providers=provider({plan:task('analyze'),actor:[finish(),finish(),finish()],review:messages=>{if(messages[0].content.includes('ALL original'))model='other';return encoded(acceptedReview(messages));}});let model='qwen';providers.status=()=>({provider:'aipro',model});
  const run=startContentAgent({host:'word',request:'검토해줘',scope:native.snapshot(),providers,resilienceOptions:fast});const done=await until(run,native.action);assert.equal(done.state,'failed');assert.equal(done.error,'analysis_invalid');assert.equal(native.writes,0);
});
test('PPT whole-slide repair rejects native read-only targets before approval',()=>{
  const operation={type:'set_slide_content',targetId:'s-1',title:'수정',bullets:['내용'],notes:'메모'},snapshot={created:true,items:[{id:'s-1',kind:'slide',editable:false}]};
  assert.throws(()=>contentOperation('powerpoint',JSON.stringify(operation),snapshot),/out_of_scope/);
  snapshot.items[0].editable=true;assert.equal(contentOperation('powerpoint',JSON.stringify(operation),snapshot).type,'set_slide_content');
});

test('Pi actor reads tail ranges, delegates narrow roles, then waits for facts without copying the full item',async()=>{
  const {createHash}=await import('node:crypto'),hash=s=>createHash('sha256').update(s).digest('hex'),source='앞'.repeat(50000)+'말미 검토 원문'.repeat(1000);
  const native=fixture('word',[{id:'p-1',kind:'paragraph',text:source.slice(0,4000),truncated:true,textLength:source.length,textHash:hash(source),editable:false}]);
  const node={id:'tail',specialty:'말미 사실 검토',goal:'배정 구간에 기재된 사실',role:'analysis',constraints:'전체 문서로 일반화 금지',doneWhen:'원문 인용',itemIds:['p-1'],textRanges:[{itemId:'p-1',field:'text',offset:50000,length:100}],dependsOn:[]};
  let childChars=0,children=0;
  const providers=provider({plan:task('analyze'),actor:[call('read_document_text',{itemId:'p-1',field:'text',offset:50000,maxChars:100}),call('delegate_document_tasks',{tasks:[node]}),call('ask_user',{question:'이 기간을 확인해 주세요',input_mode:'text'})]});
  const base=providers.complete;providers.complete=async(messages,tools)=>{
    if(messages[0].content.includes('_ANALYST.')){children++;assert.deepEqual(tools,[]);const data=JSON.parse(messages[1].content),item=data.sources[0].item;childChars=item.text.length;assert.ok(item.id.startsWith('range-'));return encoded({summary:'해당 구간 확인',findings:[{text:'말미 내용',sources:[{itemId:item.id,field:'text',quote:item.text.slice(0,10)}]}],missing:[]});}
    return base(messages,tools);
  };
  const run=startContentAgent({host:'word',request:'긴 문서의 말미를 담당자에게 나눠 검토해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const result=await until(run,a=>{if(a.name!=='office_read_text')return native.action(a);const {offset,maxChars,itemId}=a.payload,text=source.slice(offset,offset+maxChars);return{host:'word',scopeId:'source',documentId:'source',fingerprint:'f0',itemId,field:'text',offset,text,textLength:source.length,textHash:hash(source),chunkHash:hash(text),nextOffset:offset+text.length,readOnly:true};});
    assert.equal(result.action?.name,'request_input',result.error);assert.equal(childChars,100);assert.equal(children,1);assert.equal(result.delegationWorkers.nodes[0].state,'done');assert.equal(native.writes,0);assert.equal(native.snapshot().items[0].text.length,4000);
  }finally{run.cancel();await run.promise;}
});
test('Pi actor uses compact structure navigation then asks facts without native edits',async()=>{
  const native=fixture('word',[{id:'p-1',kind:'paragraph',text:'업무 보고서',outlineLevel:1,editable:true}]);let observed=false;
  const actor=[call('inspect_document_structure',{filter:'landmarks'}),call('ask_user',{question:'보고 기간을 알려주세요.',input_mode:'text'})];let next=0;
  const providers=provider({plan:task('analyze'),actor:messages=>{if(next===1){const context=JSON.parse(messages.findLast(m=>m.role==='user').content);observed=context.lastReceipt?.kind==='document_structure'&&context.lastReceipt?.items?.some(item=>item.itemId==='p-1'&&item.pageOffset===0&&item.label==='업무 보고서');}return actor[next++];}});
  const run=startContentAgent({host:'word',request:'문서 제목과 입력 대상을 먼저 확인해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{const waiting=await until(run,native.action);assert.equal(waiting.action?.name,'request_input',waiting.error);assert.equal(native.writes,0);assert.ok(providers.requests.some(r=>r.tools?.some(t=>t.function.name==='inspect_document_structure')));assert.equal(observed,true);}
  finally{run.cancel();await run.promise;}
});

for(const host of ['word','powerpoint'])test(`${host} Pi actor continues search past eight matches with fresh native reads`,async()=>{
  const native=fixture(host,Array.from({length:20},(_,i)=>({id:'item-'+i,kind:host==='word'?'paragraph':'shape',text:'예산 계획 '+i,notes:'예산 근거 '+i,editable:false})));
  let next=0;const seen=[];let firstView;
  const providers=provider({plan:task('analyze'),actor:messages=>{
    const context=JSON.parse(messages.findLast(m=>m.role==='user').content);
    if(next++===0)return call('search_document',{query:'예산',field:'notes'});
    const receipt=context.lastReceipt;assert.equal(receipt.kind,'document_search');assert.equal(receipt.totalMatches,20);assert.equal(receipt.field,'notes');
    firstView??=receipt.viewId;assert.equal(receipt.viewId,firstView);seen.push(...receipt.matches.map(m=>m.itemId));
    if(receipt.nextCursor!==null)return call('search_document',{query:'예산',field:'notes',cursor:receipt.nextCursor,viewId:receipt.viewId});
    return call('ask_user',{question:'확인할 예산 기간을 알려주세요.',input_mode:'text'});
  }});
  const run=startContentAgent({host,request:'모든 예산 근거를 찾아줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const waiting=await until(run,native.action);assert.equal(waiting.action?.name,'request_input',waiting.error);assert.equal(seen.length,20);assert.equal(new Set(seen).size,20);assert.equal(native.writes,0);
    assert.ok(native.actions.filter(a=>a.name==='office_read').length>=4,'initial read plus fresh reads for each search page');
  }finally{run.cancel();await run.promise;}
});

for(const host of ['word','powerpoint'])test(`${host} creation without authored content must repair before save even when the model approves`,async()=>{
  const native=fixture(host);let repaired=false;
  const providers=provider({actor:messages=>{
    const ctx=JSON.parse(messages.findLast(m=>m.role==='user').content);
    if(ctx.step.id==='inspect')return finish();
    if(ctx.step.id==='write')return ctx.currentDocument.created?finish():call('create_document');
    if(ctx.step.id.startsWith('repair-')){repaired=true;return call('ask_user',{question:'보고서에 넣을 내용을 알려주세요.',input_mode:'text'});}
    return finish();
  }});
  const run=startContentAgent({host,request:'내용을 갖춘 업무 보고서를 만들어줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const waiting=await until(run,native.action);assert.equal(waiting.action?.name,'request_input');assert.equal(repaired,true);assert.equal(native.writes,0);assert.equal(waiting.plan.steps.find(s=>s.kind==='verify').state,'pending');
    assert.equal(native.actions.some(a=>a.name==='office_save'),false);
  }finally{run.cancel();await run.promise;}
});

test('unchanged empty completion pauses through existing recovery without growing repair steps',async()=>{
  const native=fixture('word'),providers=provider({actor:messages=>{
    const ctx=JSON.parse(messages.findLast(m=>m.role==='user').content);
    return ctx.step.id==='write'&&!ctx.currentDocument.created?call('create_document'):finish();
  }});
  const run=startContentAgent({host:'word',request:'업무 보고서를 작성해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const waiting=await until(run,native.action);assert.equal(waiting.action?.payload.kind,'recovery');assert.equal(waiting.metrics.deliveryFailures,3);assert.equal(waiting.plan.steps.filter(s=>s.id.startsWith('repair-delivery-')).length,1);assert.equal(native.actions.filter(a=>a.name==='office_create').length,1);assert.equal(native.actions.some(a=>a.name==='office_save'),false);
  }finally{run.cancel();await run.promise;}
  assert.equal(run.status().state,'cancelled');
});

test('empty draft repair writes into the same document then reaches independent review and save approval',async()=>{
  const native=fixture('word');let wrote=false;
  const providers=provider({actor:messages=>{
    const ctx=JSON.parse(messages.findLast(m=>m.role==='user').content);
    if(ctx.step.id==='write'&&!ctx.currentDocument.created)return call('create_document');
    if(ctx.step.id.startsWith('repair-delivery-')&&!wrote){wrote=true;return call('apply_operation',{plan:JSON.stringify({type:'append_paragraph',text:'요청한 업무 보고 내용',style:'Normal'})});}
    return finish();
  }});
  const run=startContentAgent({host:'word',request:'내용이 있는 업무 보고서를 작성해줘',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const waiting=await until(run,native.action);assert.equal(waiting.action?.payload.kind,'save');assert.equal(native.writes,1);assert.equal(native.actions.filter(a=>a.name==='office_create').length,1);assert.equal(waiting.metrics.deliveryFailures,1);assert.equal(waiting.review.status,'complete');assert.ok(providers.requests.some(r=>r.messages[0].content.includes('ALL original')));
    run.respond(waiting.action.callId,{approved:true});const done=await until(run,native.action);assert.equal(done.state,'done');assert.equal(native.actions.filter(a=>a.name==='office_save').length,1);
  }finally{run.cancel();await run.promise;}
});
