// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L1, fourth
// turn). The user asked to put the decided fee into the code. The answer only
// named the places to change. The review found the change missing and asked
// for a revision, but marked the request requirement supported: that holds the
// first request, which an earlier turn had answered. The only open checks were
// the planner's interpretation, and the host turns such a verdict into ready.
// The answer was handed over and nothing was changed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REVIEW_PROMPT,TURN_REQUIREMENT,resultReviewInput,reviewResult,reviewInputLimit} from '../runtime/result-review.mjs';
import {contextTokens} from '../../../extensions/aipro-chat/context-manager.js';

const model={id:'fixture',contextLength:32000};
const FIRST='먼저 지금 배송 정책을 짧게 설명해 줘.',TURN='그럼 회의에서 결정한 대로 추가 요금을 코드에 반영해 줘.';
const task={request:FIRST,messages:[],questionHistory:[],criteria:[],workPlan:{intent:{goal:'추가 요금 반영',constraints:[],outcomes:['코드가 5,500원을 쓴다'],workflowIds:[],skillPaths:[]}}};
const receipts={computer:{actions:[]},setupActions:[],proposals:[],processes:[],reconciliation:null};

test('the message being answered is a requirement of its own',()=>{
  const {data}=resultReviewInput({task,evidence:[],receipts,candidate:'고칠 곳은 src/shipping.mjs입니다.',model,history:[TURN]});
  assert.deepEqual(data.requirements.map(item=>item.id),['request','intent:outcome:0','turn']);
  assert.deepEqual(data.requirements.at(-1),{id:'turn',text:TURN_REQUIREMENT});assert.equal(data.currentTurn,TURN);
  assert.equal(JSON.stringify(data.requirements).includes(TURN),false,'the text of the turn is given once, in currentTurn');
  assert.equal(data.requirements[0].text,FIRST,'the request keeps the first request');
  const alone=resultReviewInput({task,evidence:[],receipts,candidate:'설명했습니다.',model,history:[]}).data;
  assert.ok(!alone.requirements.some(item=>item.id==='turn'),'a first turn has no separate requirement');
  assert.match(REVIEW_PROMPT,/requirement turn/);
  assert.ok(REVIEW_PROMPT.length<3700,String(REVIEW_PROMPT.length));
});

test('an open turn keeps a revision a revision',async()=>{
  const verdict=(turnState)=>async messages=>{const data=JSON.parse(messages[1].content);return {content:JSON.stringify({status:'revise',nextStep:'배송 계산 코드를 5,500원으로 고친다.',checks:data.requirements.map(item=>({requirementId:item.id,state:item.id==='request'?'supported':item.id==='turn'?turnState:'unknown',evidenceIds:item.id==='request'||item.id==='turn'&&turnState==='supported'?['user']:[],detail:'확인'}))}),calls:[]};};
  const open=await reviewResult({task,evidence:[],receipts,candidate:'고칠 곳은 src/shipping.mjs입니다. 아직 수정하지 않았습니다.',model,history:[TURN],signal:new AbortController().signal,invoke:verdict('unknown')});
  assert.equal(open.status,'revise');assert.equal(open.normalized,undefined);
  const done=await reviewResult({task,evidence:[],receipts,candidate:'반영했습니다.',model,history:[TURN],signal:new AbortController().signal,invoke:verdict('supported')});
  assert.equal(done.status,'ready','with the turn supported only the interpretation is open');assert.equal(done.normalized,'interpretation_only');
});

test('a follow-up review receives the earlier answer with its role, separate from current evidence',()=>{
 const conversationTask={request:'방금 확인한 두 안의 차이를 설명해 줘.',messages:[
  {id:'a1',role:'assistant',content:'A안은 월 30건, B안은 월 50건입니다. 이는 이전 자료의 설명입니다.'},
  {id:'u2',role:'user',content:'그중 B안만 한 문장으로 다시 써줘.'},
  {id:'internal',role:'user',contextOnly:true,content:'INTERNAL_REVIEW_FEEDBACK'},
 ],questionHistory:[]};
 const {data}=resultReviewInput({task:conversationTask,evidence:[],receipts,candidate:'B안은 이전 자료에서 월 50건으로 설명됐습니다.',model});
 assert.equal(data.currentTurn,'그중 B안만 한 문장으로 다시 써줘.');
 assert(data.conversation?.messages.some(row=>row.role==='assistant'&&row.content.includes('B안은 월 50건')),'the reviewer can resolve the follow-up against the answer the executor already saw');
 assert.doesNotMatch(JSON.stringify(data),/INTERNAL_REVIEW_FEEDBACK/,'internal review feedback is not a literal user instruction');
 const historical=data.evidence.find(entry=>entry.id==='conversation');
 assert.equal(historical?.tool,'conversation_reference');
 assert.match(historical.result.scope,/not.*(?:current|fresh).*evidence/i,'prior assistant text does not certify current actions or source facts');
 assert.equal(data.evidence.some(entry=>entry.tool==='read_source'),false,'the reference creates no source observation');
});

test('review conversation context is bounded, retains recent roles and reports omissions',()=>{
 const messages=Array.from({length:80},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:`Historical turn ${i}: `+'context '.repeat(400)}));
 messages.push({id:'latest',role:'user',content:'마지막 답변의 조건을 다시 설명해 줘.'});
 const {data,messages:wire}=resultReviewInput({task:{request:'Original goal',messages},evidence:[],receipts,candidate:'마지막 답변의 조건입니다.',model:{contextLength:16000,maxOutputTokens:2000}});
 assert(data.conversation?.omitted>0);
 assert(data.conversation.messages.some(row=>row.role==='assistant'&&row.content.includes('Historical turn 79')));
 assert.equal(data.currentTurn,'마지막 답변의 조건을 다시 설명해 줘.');
 assert(wire.every(row=>['system','user'].includes(row.role)),'historical roles remain reference data, not native active instructions');
});

test('optional conversation history cannot block a current answer that fits the review window',()=>{
 const args={task:{request:'Summarize the supplied text',messages:[]},evidence:[],receipts:{},candidate:'Answer '.repeat(7000),model:{contextLength:16000,maxOutputTokens:2000}};
 assert.doesNotThrow(()=>resultReviewInput(args));
 args.task.messages=[{role:'assistant',content:'Earlier answer '+'history '.repeat(600)},{role:'user',content:'Summarize again'}];
 const {data,messages}=resultReviewInput(args);
 assert.equal(data.candidate,args.candidate,'current answer is preserved verbatim');
 assert(contextTokens(messages)<=reviewInputLimit(args.model)-512);
 assert((data.omittedConversation||data.conversation?.omitted)>0,'omitting optional history is recorded');
});
