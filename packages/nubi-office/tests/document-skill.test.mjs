import test from 'node:test';
import assert from 'node:assert/strict';
import {documentSkill} from '../worker/document-skill.mjs';
import {startSkillIntake} from '../worker/skill-intake.mjs';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {catalogMutation} from '../src/template-catalog.js';
import {createWorker} from '../worker/main.mjs';
import {workbook,contract,text} from './harness-fixtures.mjs';

const skill=host=>({id:'00000000-0000-4000-8000-000000000001',host,revision:1,name:'업무 보고서',instructions:'요약, 실적, 다음 계획 순서로 작성. 금액은 천 원.',questions:[{question:'보고 대상은 누구인가요?',input_mode:'text',choices:[{label:'팀장'},{label:'임원'}]},{question:'실적과 다음 계획을 알려주세요.',input_mode:'long_text',choices:[]}]});
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(host='excel',extra={}){
  const starts=[];let delegated=0;
  const run=startSkillIntake({host,request:'보고서 작성',history:[{role:'user',content:'원본 조건'}],documentSkill:skill(host),...extra},options=>{
    starts.push(options);return{promise:Promise.resolve(),status:()=>({state:'done',writes:0,activity:[],action:null}),respond(){delegated++;},cancel(){}};
  });
  return{run,starts,get delegated(){return delegated;}};
}
test('registered writing skills reject other hosts, permissions and invalid forms',()=>{
  for(const change of [{host:'word'},{instructions:''},{tools:['apply']},{revision:0},{questions:[{...skill('excel').questions[0],choices:[{label:'only one'}]}]}])assert.throws(()=>documentSkill({...skill('excel'),...change},'excel'),/document_skill_invalid/);
  const original=skill('word'),validated=documentSkill(original,'word');validated.questions[0].choices[0].label='changed';assert.equal(original.questions[0].choices[0].label,'팀장');
});
test('selected skills hand off requirements without forcing a questionnaire on any host',async()=>{
  for(const host of ['excel','word','powerpoint']){
    const f=fixture(host,{request:'팀장에게 실적 000417과 다음 계획을 보고해줘'}),id=f.run.id;
    assert.equal(f.run.status().action,null);await f.run.promise;
    assert.equal(f.starts.length,1);assert.equal(f.run.status().id,id);assert.equal(f.run.status().state,'done');
    assert.deepEqual(f.starts[0].documentSkill.questions,skill(host).questions);assert.deepEqual(f.starts[0].documentSkillAnswers,[]);
    assert.deepEqual(f.starts[0].history,[{role:'user',content:'원본 조건'}]);
    assert.equal(f.starts[0].continuousInput,true);assert.equal(f.starts[0].history[0].content,'원본 조건');
  }
});
test('legacy answers remain previous explicit facts, invalidate on revision change and never become inferred current answers',async()=>{
  const f=fixture();await f.run.promise;
  const input={...f.run.status().skillInput,answers:[{question:skill('excel').questions[0].question,text:'외부 감사 담당자'}]};
  const reused=fixture('excel',{skillInput:input,request:'이번 보고 대상은 팀장이야'});await reused.run.promise;
  assert.deepEqual(reused.starts[0].documentSkillAnswers,input.answers);
  assert.equal(reused.starts[0].request,'이번 보고 대상은 팀장이야');
  assert.deepEqual(reused.starts[0].history,[{role:'user',content:'원본 조건'}]);
  const changed=fixture('excel',{documentSkill:{...skill('excel'),revision:2},skillInput:input});await changed.run.promise;
  assert.deepEqual(changed.starts[0].documentSkillAnswers,[]);
});
test('cancellation before handoff never starts the document agent',async()=>{
  const f=fixture();f.run.cancel();await f.run.promise;
  assert.equal(f.run.status().state,'cancelled');assert.equal(f.starts.length,0);
  assert.throws(()=>f.run.respond('late',{text:'late'}),/stale_tool_result/);
});
test('registered skill becomes a read-only SKILL.md through existing Pi tools',async()=>{
  const controller=new AbortController(),metrics={},workspace=createSkillWorkspace({host:'word',documentSkill:skill('word'),signal:controller.signal,metrics,activity:createActivityLog()});
  const path='skills/document-'+skill('word').id+'/SKILL.md';assert.ok(workspace.context().files.some(f=>f.path===path));
  const read=await workspace.execute('read',{path});assert.match(read.content,/실적/);assert.match(read.content,/name: document-/);assert.ok(workspace.context().activeSkills.includes('document-'+skill('word').id));
  assert.equal((await workspace.execute('write',{path,content:'changed'})).error,'workspace_read_only');
});
test('lost registration reply reconciles the receipt without repeating the save',async()=>{
  const calls=[];const result=await catalogMutation('document_skill_save',{skill:skill('excel')},{call:async method=>{calls.push(method);if(method==='document_skill_save')throw new Error('office_timeout');return{outcome:'applied',result:skill('excel')};}});
  assert.deepEqual(result,skill('excel'));assert.deepEqual(calls,['document_skill_save','template_catalog_receipt']);
});


test('selected rule and historical explicit answers are pinned outside summarized conversation windows',()=>{
  const selected=skill('word'),prior=[{question:selected.questions[0].question,text:'부서 000417'}];
  const workspace=createSkillWorkspace({host:'word',documentSkill:selected,documentSkillAnswers:prior,signal:new AbortController().signal,metrics:{},activity:createActivityLog()});
  for(const context of [workspace.skillContext(),workspace.context().registeredSkills]){
    const rule=context.active.find(x=>x.id===selected.id);
    assert.equal(rule.source,'selected-writing-rule');assert.match(rule.instructions,/요약, 실적, 다음 계획/);
    assert.deepEqual(rule.requiredInputs,selected.questions);assert.deepEqual(rule.previousAnswers,prior);
    assert.match(context.guidance,/MUST ask/);assert.match(context.guidance,/not a fixed questionnaire/);
  }
  workspace.skillContext().active[0].requiredInputs[0].question='mutated';
  assert.equal(workspace.skillContext().active[0].requiredInputs[0].question,selected.questions[0].question);
});

test('worker reads the document before a model-chosen missing-fact question and preserves receipts and cancellation',async()=>{
  for(const host of ['excel','word','powerpoint']){
    const book=workbook(),scope=host==='excel'?book.snapshot():{host,scopeId:'source',documentId:'source',name:'보고서',created:false,fingerprint:'f0',offset:0,total:1,nextOffset:null,items:[{id:host==='word'?'p-1':'s-1/h-1',kind:host==='word'?'paragraph':'shape',text:'보고 대상: 팀장',editable:true}]};
    let calls=0;
    const worker=createWorker({status:()=>({model:'selected-qwen'}),dispose(){},complete:async messages=>{
      calls++;const wire=JSON.stringify(messages);assert.match(wire,/selected-writing-rule/);assert.match(wire,/not a fixed questionnaire/);
      if(calls===1)return text(JSON.stringify(host==='excel'?contract([],{intent:'clarify',questions:['보고 기간은 언제인가요?']}):{intent:'clarify',title:'보고서',summary:'기간 확인',question:{question:'보고 기간은 언제인가요?',choices:[],input_mode:'text'}}));
      assert.match(wire,/2026년 3분기/);
      return new Promise(()=>{}); // cancellation must stop an in-flight planner
    }},{host});
    const payload={requestId:'skill-request-00001',request:'현재 보고서를 완성해줘',mode:'edit',scope,documentSkill:skill(host)};
    const first=await worker.dispatch('runStart',payload),duplicate=await worker.dispatch('runStart',payload);
    assert.equal(first.id,duplicate.id);
    const until=async predicate=>{for(let i=0;i<200;i++){const current=await worker.dispatch('runStatus',{id:first.id});if(predicate(current))return current;if(['read_selection','office_read'].includes(current.action?.name))await worker.dispatch('toolResult',{id:first.id,callId:current.action.callId,result:scope});await tick();}assert.fail('worker boundary timeout');};
    let current=await until(s=>s.action);assert.notEqual(current.action.name,'request_input');assert.equal(calls,0);
    assert.equal(current.action.name,host==='excel'?'read_selection':'office_read');
    await worker.dispatch('toolResult',{id:first.id,callId:current.action.callId,result:scope});
    current=await until(s=>s.action?.name==='request_input');assert.equal(current.action.payload.text,'보고 기간은 언제인가요?');assert.equal(current.id,first.id);
    const reply={id:first.id,callId:current.action.callId,result:{text:'2026년 3분기'}};
    await worker.dispatch('toolResult',reply);await worker.dispatch('toolResult',reply);
    await assert.rejects(worker.dispatch('toolResult',{...reply,result:{text:'다른 답'}}),/tool_result_conflict/);
    await until(()=>calls===2);
    await worker.dispatch('runCancel',{id:first.id});await tick();
    assert.equal((await worker.dispatch('runStatus',{id:first.id})).state,'cancelled');
    await assert.rejects(worker.dispatch('toolResult',{id:first.id,callId:'late',result:{text:'늦은 답'}}),/stale_tool_result/);
    worker.dispose();
  }
});
