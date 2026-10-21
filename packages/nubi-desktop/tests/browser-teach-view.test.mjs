import test from 'node:test';
import assert from 'node:assert/strict';
import {teachDraft,boardProjection,runMatches,reviewable} from '../ui/browser-teach-view.mjs';
const binding={projectId:'p',sessionId:'s',revision:'r'};
const card={schemaVersion:1,title:'합성 조회',inputs:[{slot:'v1',label:'검색어'}],steps:[{tool:'fill_form',fields:[{target:{role:'textbox',name:'검색어'},slot:'v1'}]},{tool:'click_element',target:{role:'button',name:'제출'}}]};
test('teach questions come from module and fixed values never enter the draft',()=>{
 const result=teachDraft(card,{'value:0':'고정값','why:1':'결과 제목을 확인한다'});
 assert.deepEqual(result.questions.map(q=>q.id),['purpose','value:0','why:1']);
 assert.equal(result.card.teach.steps[0].valueSource.kind,'literal_pending');
 assert.deepEqual(result.card.steps,card.steps);
});
test('number board uses matching structural boxes, scales and clips, never guesses missing geometry',()=>{
 const observation={observationId:'o',binding:{tabId:'t',documentId:'d'},data:{candidates:[{targetId:'a',name:'검색',box:{x:100,y:50,width:200,height:40}},{targetId:'b',name:'미측정'},{targetId:'c',box:{x:NaN,y:0,width:3,height:3}}]}};
 const capture={observationId:'o',tabId:'t',documentId:'d',width:800,height:400,viewport:{x:0,y:0,width:400,height:200}};
 const rows=boardProjection(observation,capture);assert.equal(rows.length,3);assert.deepEqual(rows[0].rect,{left:25,top:25,width:50,height:20});assert.equal(rows[1].rect,null);assert.equal(rows[2].rect,null);
 assert.deepEqual(boardProjection(observation,{...capture,observationId:'other'}),[]);
 assert.deepEqual(boardProjection(observation,{...capture,documentId:'other'}),[]);
});
test('results require same session and edited draft, success receipt and inspected captures',()=>{
 const run={binding,draftKey:'draft',receiptId:'receipt',success:true,captures:[{id:'c'}]};
 assert(runMatches(run,binding,'draft'));assert(!runMatches(run,binding,'changed'));assert(!runMatches(run,{...binding,sessionId:'new'},'draft'));
 assert(!reviewable(run,binding,'draft',[]));assert(reviewable(run,binding,'draft',['c']));assert(!reviewable({...run,receiptId:''},binding,'draft',['c']));assert(!reviewable({...run,captures:[]},binding,'draft',[]));
});
test('recording questions ask purpose after stopping and default every value to ask',()=>{
 const result=teachDraft(card);
 assert.equal(result.questions[0].kind,'purpose');
 assert.deepEqual(result.questions.find(q=>q.kind==='value').choices,['실행 때 묻기','고정값','메일에서','위키에서']);
 assert.equal(result.card.teach.steps[0].valueSource.kind,'ask');
});
test('unnamed input labels change metadata only and keep recorded steps and known labels',()=>{
 const source={...card,inputs:[{slot:'v1',label:'입력값'},{slot:'v2',label:'기존 이름'}]};
 const result=teachDraft(source,{purpose:'합성 자료 조회'},{v1:'조회 기간',v2:'바꾸지 않음',foreign:'없는 칸'});
 assert.equal(result.card.inputs[0].label,'조회 기간');assert.equal(result.card.inputs[1].label,'기존 이름');
 assert.equal(result.card.inputs.length,2);assert.equal(source.inputs[0].label,'입력값');
 assert.equal(JSON.stringify(result.card.steps),JSON.stringify(source.steps));
 assert.match(result.questions.find(q=>q.kind==='value').prompt,/조회 기간/);
 assert.equal(result.card.teach.steps[0].valueSource.label,'조회 기간');
 assert.equal(teachDraft(source,{}, {v1:'  '}).card.inputs[0].label,'입력값');
});
