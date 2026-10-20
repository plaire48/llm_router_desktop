import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {docxFromBlocks,FORMS} from './helpers-docx-fixture.mjs';

// Document forms plan Task C: a plan fills slots from the person's words and materials with evidence, asks for what
// no material supports in one card, and writes the sheet again with the answers. The model is a fixture.
const PERIOD='2026. 10. 21. ~ 2026. 10. 22.';
function fixtureModel(calls){
  return {status:()=>({connected:true,model:'fixture'}),dispose(){},async complete(messages){
    const system=messages[0].content,payload=JSON.parse(messages[1].content);calls.push(system.slice(0,24));
    if(system.startsWith('NUBI_WORD_FORM_CELLS')){
      const answer=payload.sources.find(source=>source.id.startsWith('answer-'));
      const cells=[{slot:'s1',value:'김민수',source:'request',quote:'김민수'},{slot:'s2',value:'영업팀',source:'request',quote:'영업팀'},{slot:'s3',value:'부산',source:'request',quote:'부산 거래처'}];
      if(answer)cells.push({slot:'s4',value:PERIOD,source:answer.id,quote:PERIOD});
      return {content:JSON.stringify({cells,rows:[],missing:answer?[]:[{slot:'s4',question:'출장 기간은 언제인가요?'}]})};
    }
    if(system.startsWith('NUBI_WORD_FORM_SECTION')){
      const wiki=payload.sources.find(source=>source.text.includes('해운대'));
      return {content:JSON.stringify(payload.section.id==='sec-1'?{paragraphs:['해운대 거래처 방문'],sources:[wiki.id]}:{paragraphs:['없음'],sources:['request']})};
    }
    throw Error('unexpected_prompt');
  }};
}
async function registered(f){
  await mkdir(path.join(f.root,'서식'),{recursive:true});
  await writeFile(path.join(f.root,'서식','출장.docx'),await docxFromBlocks(FORMS.trip));
  return f.service.invoke('documentForm',{action:'register',projectId:f.service.projectId,source:'서식/출장.docx',name:'출장 보고'});
}

test('a plan fills from the request and materials with evidence, asks the open slot in one card, and finishes with the answer',async t=>{
  const f=await fixture(t),s=f.service,calls=[];s.providers=fixtureModel(calls);
  const form=await registered(f);assert.equal(form.preview.summary,'칸 4개, 표 행 1개, 목차 2개');
  assert.deepEqual((await s.invoke('documentForm',{action:'list',projectId:s.projectId})).forms.map(x=>x.name),['출장 보고']);
  const questions=await s.invoke('documentForm',{action:'questions',projectId:s.projectId,name:'출장 보고'});assert.equal(questions.questions.length,4);
  const first=await s.invoke('documentForm',{action:'plan',projectId:s.projectId,name:'출장 보고',request:'김민수 영업팀 부산 거래처 방문 출장 보고서를 써 주세요.',
    sources:{passages:[{kind:'wiki',ref:'거래처/부산',text:'부산 거래처는 해운대에 있다.'}]}});
  assert.equal(first.state,'asking');assert.match(first.planId,/^form-plan:/);
  assert.deepEqual(first.questions,[{slot:'s4',label:'출장 기간',question:'출장 기간은 언제인가요?',kind:'period'}]);
  assert.deepEqual(first.sheet.cells.map(cell=>[cell.slot,cell.label,cell.value,cell.source.kind,cell.source.quote]),[['s1','출장자','김민수','request','김민수'],['s2','소속','영업팀','request','영업팀'],['s3','출장지','부산','request','부산 거래처']]);
  assert.deepEqual(first.sheet.missing,[{slot:'s4',label:'출장 기간',question:'출장 기간은 언제인가요?'}]);
  assert.deepEqual(await s.invoke('documentForm',{action:'status',projectId:s.projectId,planId:first.planId}),first);
  // An empty answer resumes the fill, which asks once more; the real answer ends it.
  const again=await s.invoke('documentForm',{action:'answer',projectId:s.projectId,planId:first.planId,answers:{}});
  assert.equal(again.state,'asking');assert.deepEqual(again.questions.map(q=>q.slot),['s4']);
  const done=await s.invoke('documentForm',{action:'answer',projectId:s.projectId,planId:first.planId,answers:{s4:PERIOD}});
  assert.equal(done.state,'ready');assert.deepEqual(done.questions,[]);assert.deepEqual(done.answered,['s4']);
  const period=done.sheet.cells.find(cell=>cell.slot==='s4');assert.deepEqual([period.value,period.source.kind,period.source.id],[PERIOD,'answer','answer-1']);
  assert.deepEqual(done.sheet.sections.map(section=>[section.section,section.title,section.paragraphs,section.sources[0].kind,section.sources[0].ref]),[['sec-1','1. 출장 목적',['해운대 거래처 방문'],'wiki','거래처/부산'],['sec-3','3. 결과 및 향후 계획',['없음'],'request',undefined]]);
  assert.ok(done.evidence.some(item=>item.target==='sec-1'&&item.kind==='wiki'));
  assert.deepEqual(calls,['NUBI_WORD_FORM_CELLS. Fi','NUBI_WORD_FORM_CELLS. Fi','NUBI_WORD_FORM_CELLS. Fi','NUBI_WORD_FORM_SECTION. ','NUBI_WORD_FORM_SECTION. '],'cells once, the answer, cells again, then each section');
  await assert.rejects(s.invoke('documentForm',{action:'answer',projectId:s.projectId,planId:done.planId,answers:{s4:'x'}}),/form_plan_not_asking/);
  assert.deepEqual(await s.invoke('documentForm',{action:'cancel',projectId:s.projectId,planId:done.planId}),{cancelled:true});
  await assert.rejects(s.invoke('documentForm',{action:'status',projectId:s.projectId,planId:done.planId}),/form_plan_missing/);
});

test('a refused sheet goes back with the reason, and the guards hold',async t=>{
  const f=await fixture(t),s=f.service;await registered(f);
  let attempts=0;const feedbacks=[];
  s.providers={status:()=>({connected:true,model:'fixture'}),dispose(){},async complete(messages){
    const system=messages[0].content,payload=JSON.parse(messages[1].content);
    if(system.startsWith('NUBI_WORD_FORM_CELLS')){attempts++;if(payload.feedback)feedbacks.push(payload.feedback);
      // The first sheet quotes words the person never said; the second is right.
      const quote=attempts===1?'박철수':'김민수';
      return {content:JSON.stringify({cells:[{slot:'s1',value:quote,source:'request',quote},{slot:'s2',value:'영업팀',source:'request',quote:'영업팀'},{slot:'s3',value:'부산',source:'request',quote:'부산'},{slot:'s4',value:PERIOD,source:'request',quote:PERIOD}],rows:[],missing:[]})};}
    return {content:JSON.stringify({paragraphs:['거래처 방문'],sources:['request']})};
  }};
  const plan=await s.invoke('documentForm',{action:'plan',projectId:s.projectId,name:'출장 보고',request:`김민수 영업팀 부산 출장 ${PERIOD}`});
  assert.equal(plan.state,'ready');assert.equal(attempts,2);assert.match(feedbacks[0],/s1 quote is not in request/);
  assert.equal(plan.sheet.cells[0].value,'김민수');
  await assert.rejects(s.invoke('documentForm',{action:'plan',projectId:s.projectId,name:'없는 양식',request:'x'}),/form_missing/);
  await assert.rejects(s.invoke('documentForm',{action:'plan',projectId:s.projectId,name:'출장 보고',request:''}),/form_request_required/);
  await assert.rejects(s.invoke('documentForm',{action:'plan',projectId:'other',name:'출장 보고',request:'x'}),/project_changed/);
  await assert.rejects(s.invoke('documentForm',{action:'nope',projectId:s.projectId}),/document_form_action_invalid/);
  s.providers={status:()=>({connected:false}),dispose(){},complete:async()=>{throw Error('unexpected');}};
  await assert.rejects(s.invoke('documentForm',{action:'plan',projectId:s.projectId,name:'출장 보고',request:'x'}),/provider_missing/);
});
