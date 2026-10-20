import test from 'node:test';
import assert from 'node:assert/strict';
import {draftPlan,questionsFor,applyAnswers,annotationBoard} from '../dist/teach.js';

// Browser teach plan T4: a readable draft, few questions, answers as metadata, a numbered board.
const card={schemaVersion:1,id:'demo',version:1,status:'draft',title:'견적서 제출',wikiRef:{id:'w',version:1,hash:'a'.repeat(64)},inputs:[{slot:'v1',label:'Full Name'},{slot:'v2',label:'Choose',kind:'choice'}],
  steps:[{tool:'click_element',target:{role:'link',name:'FP 산정',kind:'control',tag:'a'}},{tool:'fill_form',fields:[{target:{role:'textbox',name:'Full Name',kind:'field',tag:'input',type:'text'},slot:'v1'}]},{tool:'select_option',target:{role:'combobox',name:'Choose',kind:'control',tag:'select'},slot:'v2'},{tool:'press_key',target:{role:'textbox',name:'',kind:'field',tag:'input',context:[{role:'group',name:'Number'}]},args:{key:'Tab'}},{tool:'click_element',target:{role:'button',name:'Submit',kind:'control',tag:'button'}}]};

test('the draft reads each step in Korean, guesses reasons, marks guarded steps and asks only the necessary questions',()=>{
  const plan=draftPlan(card,{request:'FP 산정 메뉴에서 견적서를 제출한다'});
  assert.deepEqual(plan.steps.map(s=>s.summary),['‘FP 산정’ 링크로 이동한다','‘Full Name’ 칸에 값을 입력한다','‘Choose’에서 항목을 고른다','‘Number’에서 Tab 키를 누른다','‘Submit’ 버튼을 누른다']);
  assert.deepEqual(plan.steps.map(s=>s.guard),[false,false,false,false,true]);
  assert.deepEqual(plan.questions.map(q=>q.id),['value:1','value:2','why:4'],'purpose given, two values, one guarded click');
  assert.equal(draftPlan(card).questions.some(q=>q.id==='purpose'),false,'a titled card needs no purpose question');
  assert.equal(draftPlan({...card,title:''}).questions[0].id,'purpose','without a title or request the purpose is asked first');
  assert.ok(plan.questions.length<=5);
});

test('answers become teach metadata and never touch the steps or carry a literal value',()=>{
  const plan=draftPlan(card,{request:'제출'});
  const taught=applyAnswers(card,plan,{'value:1':{kind:'mail',field:'from'},'value:2':'고정값','why:4':'견적을 접수한다. 접수 번호가 보이면 성공'});
  assert.deepEqual(taught.steps,card.steps,'steps unchanged');
  assert.deepEqual(taught.teach.steps['1'].valueSource,{kind:'mail',field:'from'});
  assert.deepEqual(taught.teach.steps['2'].valueSource,{kind:'literal_pending'});
  assert.equal(taught.teach.steps['4'].reason,'견적을 접수한다. 접수 번호가 보이면 성공');
  assert.deepEqual(taught.teach.steps['4'].assert,{text:'견적을 접수한다. 접수 번호가 보이면 성공'});
  assert.equal(JSON.stringify(taught).includes('"value"'),false,'no literal value is stored');
  assert.equal(questionsFor({...plan,purpose:''})[0].kind,'purpose');
});

test('the annotation board numbers visible structural candidates with their boxes',()=>{
  const observation={state:'ready',binding:{tabId:'t',documentId:'d',revision:'1'},observationId:'o',data:{mode:'structure',candidates:[{targetId:'a',tag:'a',name:'FP 산정',visible:true,box:{x:10,y:20,width:80,height:20}},{targetId:'b',tag:'input',editable:true,name:'',context:'Number',visible:true},{targetId:'c',tag:'button',name:'hidden',visible:false}]}};
  const board=annotationBoard(observation);
  assert.deepEqual(board.map(r=>[r.number,r.targetId,r.role,r.name,r.kind,r.context]),[[1,'a','link','FP 산정','control',''],[2,'b','textbox','','field','Number']]);
  assert.deepEqual(board[0].box,{x:10,y:20,width:80,height:20});
});
