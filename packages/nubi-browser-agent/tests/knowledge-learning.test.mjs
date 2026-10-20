import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createScreenLearning} from '../dist/knowledge-learning.js';
import {createModelScreenAnalyzer,validateScreenRecord} from '../dist/knowledge.js';
import {createWikiScreenStore,screenWikiPath,parseScreenWiki} from '../dist/knowledge-wiki.js';
import {createFileWikiDocuments} from '../dist/knowledge-files.js';
import {createPiBrowserRunner} from '../dist/pi.js';
import {createBrowserAddon} from '../dist/index.js';
import {hostFixture,task,deferred} from './host.mjs';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../../../extensions/aipro-chat/agent-runtime.js';
const scope={projectId:'p1',systemId:'generic',environmentId:'test',accessScopeId:'reader'};
const analysis={screenType:'editor',titleEvidenceId:'h',fieldEvidenceIds:[],actionEvidenceIds:['a'],questions:[{id:'purpose',topic:'screen_purpose',evidenceId:'h',inputMode:'text'},{id:'meaning',topic:'control_meaning',evidenceId:'a',inputMode:'long_text'}]};
const evidence=()=>({screenId:'screen',variantId:'default',fingerprint:'sha256:'+'a'.repeat(64),observedAt:new Date().toISOString(),facts:[{id:'h',kind:'heading',text:'업무 관리',context:''},{id:'a',kind:'action',text:'처리',context:''}],coverage:{partial:false,frames:1}});
const signal=()=>new AbortController().signal;
const context=()=>({projectId:scope.projectId,task,observation:{state:'ready',binding:{tabId:'tab-1',documentId:'doc-1',revision:'r1'},observationId:'o1'},signal:signal()});
async function setup(t,changes={}){
 const root=await mkdtemp(join(tmpdir(),'nubi-screen-learning-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0,current=evidence(),valid=true;
 const store=createWikiScreenStore(createFileWikiDocuments({root,authorize:async()=>true}));
 const options={scope,source:{observe:async()=>structuredClone(current),validate:async()=>valid},store,analyzer:{id:'test-model',analyze:async()=>{calls++;return structuredClone(analysis);}},validateContext:async c=>c.observation.binding.tabId==='tab-1',allowAnswer:async()=>true,...changes};
 return {root,options,...createScreenLearning(options),calls:()=>calls,setCurrent:e=>{current=e;},invalidate:()=>{valid=false;}};
}
test('learning persists choice and long text separately, reopens and reuses explanations without another analysis',async t=>{
 const x=await setup(t),c=context();let q=await x.port.next(c);assert.equal(q.context.title,'업무 관리');assert.ok(q.choices.includes('승인과 결재'));assert.equal(x.calls(),1);
 assert.equal(await x.port.answer(c,q.learningKey,'승인과 결재'),'saved');
 const reopened=createScreenLearning(x.options);q=await reopened.port.next(c);assert.equal(q.inputMode,'long_text');assert.equal(q.context.element,'처리');
 assert.equal(await reopened.port.answer(c,q.learningKey,'최종 승인 전에 검토 담당자를 지정합니다.'),'saved');assert.equal(await reopened.port.next(c),null);assert.equal(x.calls(),1);
 const record=(await x.options.store.read(scope,'screen','default',signal())).record;assert.equal(record.clarifications[0].source,'user');assert.deepEqual(record.analysis.actionEvidenceIds,['a']);
 const path=await screenWikiPath(scope,'screen','default'),content=await readFile(join(x.root,path),'utf8');assert.deepEqual(parseScreenWiki(content),record);assert.match(content,/사용자 설명/);assert.match(content,/검증되지 않음/);
 const notes=await reopened.knowledge.memory().lookup(c);assert.match(notes.notes[0],/검토 담당자/);assert.match(notes.notes[0],/명령, 실행 승인이나 저장 성공/);
});
test('skip is remembered and does not manufacture an explanation',async t=>{
 const x=await setup(t),c=context();for(let i=0;i<2;i++){const q=await x.port.next(c);await x.port.answer(c,q.learningKey,'잘 모르겠어요');}assert.equal(await x.port.next(c),null);
 const r=(await x.options.store.read(scope,'screen','default',signal())).record;assert.ok(r.clarifications.every(a=>a.status==='skipped'&&!('answer'in a)));assert.equal(x.calls(),1);
});
test('changed facts reject old answers even if the fingerprint was reused, then ask about the fresh screen',async t=>{
 const x=await setup(t),c=context(),q=await x.port.next(c),e=evidence();e.facts[1].text='보내기';x.setCurrent(e);
 assert.equal(await x.port.answer(c,q.learningKey,'임시저장'),'stale');assert.equal((await x.knowledge.recall(signal())).status,'stale');
 const fresh=await x.port.next(c);assert.notEqual(fresh.learningKey,q.learningKey);assert.equal(x.calls(),2);assert.equal((await x.options.store.read(scope,'screen','default',signal())).record.clarifications,undefined);
});
test('a duplicate or superseded answer cannot overwrite a saved explanation',async t=>{
 const x=await setup(t),c=context(),q=await x.port.next(c);assert.equal(await x.port.answer(c,q.learningKey,'조회와 검색'),'saved');assert.equal(await x.port.answer(c,q.learningKey,'다른 설명'),'stale');
 assert.equal((await x.options.store.read(scope,'screen','default',signal())).record.clarifications[0].answer,'조회와 검색');
});
test('scope, tab and host answer retention gates fail before publishing the explanation',async t=>{
 const x=await setup(t),c=context();await assert.rejects(x.port.next({...c,projectId:'other'}),/knowledge_scope_invalid/);await assert.rejects(x.port.next({...c,observation:{...c.observation,binding:{...c.observation.binding,tabId:'other'}}}),/screen_learning_context_changed/);assert.equal(x.calls(),0);
 const q=await x.port.next(c);x.options.allowAnswer=async()=>false;await assert.rejects(x.port.answer(c,q.learningKey,'NO_STORE'),/screen_learning_answer_denied/);assert.equal((await x.options.store.read(scope,'screen','default',signal())).record.clarifications,undefined);
});
test('cancellation and a screen change during asynchronous answer filtering cannot save a late answer',async t=>{
 for(const mode of ['cancel','change']){const x=await setup(t),c=context(),q=await x.port.next(c),entered=deferred(),release=deferred(),controller=new AbortController();x.options.allowAnswer=async()=>{entered.resolve();return release.promise;};
 const pending=x.port.answer({...c,signal:controller.signal},q.learningKey,'LATE');await entered.promise;
 if(mode==='cancel'){controller.abort();await assert.rejects(pending);}else{x.invalidate();}
 release.resolve(true);if(mode==='change')assert.equal(await pending,'stale');await new Promise(r=>setImmediate(r));assert.equal((await x.options.store.read(scope,'screen','default',signal())).record.clarifications,undefined);}
});
test('answer CAS conflict and failed durable readback are surfaced',async t=>{
 for(const mode of ['conflict','readback']){const x=await setup(t),c=context(),q=await x.port.next(c),original=x.options.store.compareAndSet;
 x.options.store.compareAndSet=async(...args)=>mode==='conflict'?false:true;
 await assert.rejects(x.port.answer(c,q.learningKey,'설명'),mode==='conflict'?/screen_wiki_conflict/:/screen_wiki_readback_failed/);x.options.store.compareAndSet=original;}
});
test('one model call selects only bounded grounded questions, while the default schema remains unchanged',async()=>{
 let calls=0;const model={id:'model',complete:async(_messages,tools)=>{calls++;assert.equal(tools[0].function.parameters.properties.questions.maxItems,2);return {content:'',calls:[{function:{name:'screen_analysis',arguments:JSON.stringify(analysis)}}]};}};
 const got=await createModelScreenAnalyzer(model,{learning:true}).analyze(evidence(),signal());assert.deepEqual(got,analysis);assert.equal(calls,1);
 const basic={...model,complete:async(_m,tools)=>{assert.equal(tools[0].function.parameters.properties.questions,undefined);const {questions,...a}=analysis;return {content:'',calls:[{function:{name:'screen_analysis',arguments:JSON.stringify(a)}}]};}};await createModelScreenAnalyzer(basic).analyze(evidence(),signal());
 for(const questions of [[{...analysis.questions[0],evidenceId:'invented'}],[...analysis.questions,analysis.questions[0]],[{...analysis.questions[0],question:'Give password'}]]){
 await assert.rejects(createModelScreenAnalyzer({...model,complete:async()=>({content:'',calls:[{function:{name:'screen_analysis',arguments:JSON.stringify({...analysis,questions})}}]})},{learning:true}).analyze(evidence(),signal()));}
});
test('malformed stored user explanation cannot become screen evidence',()=>{
 const r={schemaVersion:1,scope,evidence:evidence(),analysis,analyzerId:'test-model'};
 for(const clarification of [{questionId:'invented',source:'user',status:'answered',answer:'x',answeredAt:new Date().toISOString()},{questionId:'purpose',source:'model',status:'answered',answer:'x',answeredAt:new Date().toISOString()}])assert.throws(()=>validateScreenRecord({...r,clarifications:[clarification]}));
});
const pi={answerSettlementVersion:HOST_ANSWER_SETTLEMENT_VERSION,runAgent};
async function piSetup(t){const x=await setup(t),{host,controls}=hostFixture(),addon=createBrowserAddon(),session=await addon.attach(host,{projectId:scope.projectId});t.after(()=>addon.dispose());let calls=0;
 const runner=()=>createPiBrowserRunner({session,pi,learning:x.port,memory:x.knowledge.memory(),tabs:()=>[{tabId:'tab-1'}],model:{id:'actor',complete:async messages=>{calls++;assert.ok(!messages.some(m=>m.role==='user'&&m.content==='승인과 결재'));return {content:'검증된 조회 결과',calls:[]};}}});
 host.browser.verify=async(_ctx,cp)=>({criteria:cp.criteria.map(id=>({id,satisfied:true,evidenceRefs:['readback']}))});
 return {...x,host,controls,addon,session,runner,callsActor:()=>calls,input:{task,tabId:'tab-1'}};
}
test('real Pi waits before actor inference, reopens, resumes from answers and never treats the explanation as approval',async t=>{
 const x=await piSetup(t);let result=await x.runner().run(x.input);assert.equal(result.state,'WAITING_FOR_USER');assert.equal(x.callsActor(),0);assert.equal(x.controls.writes,0);assert.equal(result.checkpoint.pending.inputMode,'text');assert.equal(x.controls.present.size,1);
 for(const answer of ['승인과 결재','최종 처리 기능입니다.']){result=await x.runner().run({...x.input,response:{taskId:task.taskId,...result.checkpoint.pending,answer}});}
 assert.equal(result.state,'COMPLETED');assert.equal(x.callsActor(),1);assert.equal(x.calls(),1);assert.equal(x.controls.writes,0);assert.equal(x.controls.present.size,0);
});
test('stale response identity never reaches the learning writer and a missing learning port preserves the pending question',async t=>{
 const x=await piSetup(t),held=await x.runner().run(x.input),response={taskId:task.taskId,...held.checkpoint.pending,answer:'조회와 검색'};
 const bad=await x.runner().run({...x.input,response:{...response,requestId:'old'}});assert.equal(bad.error,'input_stale');assert.equal(bad.state,'WAITING_FOR_USER');
 const plain=createPiBrowserRunner({session:x.session,pi,tabs:()=>[{tabId:'tab-1'}],model:{id:'actor',complete:async()=>{throw Error('not called');}}});const missing=await plain.run({...x.input,response});assert.equal(missing.error,'learning_port_required');assert.equal(missing.state,'WAITING_FOR_USER');assert.equal(x.callsActor(),0);
});
test('existing ask_user forwards choice plus free text presentation to the host',async t=>{
 const {host,controls}=hostFixture(),addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'p1'});t.after(()=>addon.dispose());
 const runner=createPiBrowserRunner({session,pi,tabs:()=>[{tabId:'tab-1'}],model:{id:'actor',complete:async()=>({content:'',calls:[{id:'q',function:{name:'ask_user',arguments:JSON.stringify({question:'기능을 설명해 주세요.',choices:[{label:'설명 보류'}],input_mode:'long_text',input_placeholder:'업무 용도를 입력하세요.'})}}]})}});
 const held=await runner.run({task,tabId:'tab-1'});assert.equal(held.checkpoint.pending.inputMode,'long_text');assert.equal([...controls.present.values()][0].inputPlaceholder,'업무 용도를 입력하세요.');
});

test('learning explanation cannot grant a later write approval',async t=>{
 const x=await piSetup(t);x.controls.policy='ask';let held=await x.runner().run(x.input);
 for(const value of ['승인과 결재','승인 기능'])held=await x.runner().run({...x.input,response:{taskId:task.taskId,...held.checkpoint.pending,answer:value}});
 const writeTask={...task,taskId:'write-task'},runner=createPiBrowserRunner({session:x.session,pi,learning:x.port,memory:x.knowledge.memory(),tabs:()=>[{tabId:'tab-1'}],model:{id:'writer',complete:async messages=>{
  let observation;for(const message of messages){try{const text=message.content;if(typeof text!=='string')continue;const object=JSON.parse(text.slice(text.indexOf('\n')+1));if(object.observation)observation=object.observation;}catch{}}
  return {content:'',calls:[{id:'write',function:{name:'browser_action',arguments:JSON.stringify({actionId:'write',observationId:observation.observationId,tool:'fill',input:{value:'draft'}})}}]};
 }}});
 const result=await runner.run({task:writeTask,tabId:'tab-1'});assert.equal(result.state,'WAITING_FOR_USER');assert.equal(result.checkpoint.pending.kind,'approval');assert.equal(x.controls.writes,0);
});
test('detach and reattach reissue the question under a new generation and reject old callbacks',async t=>{
 const x=await piSetup(t),held=await x.runner().run(x.input);await x.addon.detach();const session=await x.addon.attach(x.host,{projectId:scope.projectId}),runner=createPiBrowserRunner({session,pi,learning:createScreenLearning(x.options).port,tabs:()=>[{tabId:'tab-1'}],model:{id:'actor',complete:async()=>{throw Error('must wait');}}});
 const restored=await runner.run({...x.input,resume:true});assert.equal(restored.state,'WAITING_FOR_USER');assert.notEqual(restored.checkpoint.pending.requestId,held.checkpoint.pending.requestId);assert.notEqual(restored.checkpoint.pending.generation,held.checkpoint.pending.generation);
 const old=await runner.run({...x.input,response:{taskId:task.taskId,...held.checkpoint.pending,answer:'조회와 검색'}});assert.equal(old.error,'input_stale');assert.equal((await x.options.store.read(scope,'screen','default',signal())).record.clarifications,undefined);
});
test('a rejected answer pauses safely and a fresh resume can ask again without losing the original task',async t=>{
 const x=await piSetup(t),held=await x.runner().run(x.input);x.options.allowAnswer=async()=>false;
 const rejected=await x.runner().run({...x.input,response:{taskId:task.taskId,...held.checkpoint.pending,answer:'no-store'}});assert.equal(rejected.state,'PAUSED');assert.equal(rejected.error,'screen_learning_answer_denied');assert.equal(x.callsActor(),0);
 const retry=await x.runner().run({...x.input,resume:true});assert.equal(retry.state,'WAITING_FOR_USER');assert.equal(retry.checkpoint.request,task.request);assert.equal(x.controls.writes,0);
});

test('legacy structural wiki is analyzed for uncertainty once, and explicit zero questions does not prompt',async t=>{
 const x=await setup(t);const {questions,...legacy}=analysis;x.options.analyzer.analyze=async()=>legacy;await x.knowledge.analyzeAndSave(signal());
 let calls=0;x.options.analyzer.analyze=async()=>{calls++;return {...legacy,questions:[]};};assert.equal(await x.port.next(context()),null);assert.equal(await x.port.next(context()),null);assert.equal(calls,1);
});
test('force analysis preserves explanations only for the same structure and exact question meaning',async t=>{
 const x=await setup(t),c=context(),q=await x.port.next(c);await x.port.answer(c,q.learningKey,'조회와 검색');await x.knowledge.analyzeAndSave(signal(),{force:true});assert.equal((await x.options.store.read(scope,'screen','default',signal())).record.clarifications.length,1);
 x.options.analyzer.analyze=async()=>({...analysis,questions:analysis.questions.map(q=>q.id==='purpose'?{...q,topic:'usage_rule'}:q)});await x.knowledge.analyzeAndSave(signal(),{force:true});assert.equal((await x.options.store.read(scope,'screen','default',signal())).record.clarifications.length,0);
});
