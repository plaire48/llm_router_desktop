import test from 'node:test';
import assert from 'node:assert/strict';
import {teachDraft,boardProjection,runMatches,reviewable} from '../ui/browser-teach-view.mjs';
const binding={projectId:'p',sessionId:'s',revision:'r'};
const card={schemaVersion:1,title:'합성 조회',inputs:[{slot:'v1',label:'검색어'}],steps:[{tool:'fill_form',fields:[{target:{role:'textbox',name:'검색어'},slot:'v1'}]},{tool:'click_element',target:{role:'button',name:'제출'}}]};
test('teach questions come from module and fixed values never enter the draft',()=>{
 const result=teachDraft(card,{'value:0':'고정값','why:1':'결과 제목을 확인한다'});
 assert.deepEqual(result.questions.map(q=>q.id),['value:0','why:1']);
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
