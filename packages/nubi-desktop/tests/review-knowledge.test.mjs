import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contextTokens} from '../../../extensions/aipro-chat/context-manager.js';
import {REVIEW_PROMPT,CLAIM_REVIEW_GUIDANCE,resultReviewInput,reviewInputLimit,reviewResult} from '../runtime/result-review.mjs';
import {TEMPORAL_GUIDANCE} from '../runtime/knowledge-guidance.mjs';
const model={id:'fixture',contextLength:32000};
const task={request:'메일에서 확인되는 승인 조건만 알려 줘.',messages:[],criteria:[],questionHistory:[]};
const receipts={proposals:[],processes:[],setupActions:[],computer:{actions:[]}};
const evidence=[{tool:'read_personal_mail',result:{content:'보안 검토를 통과할 때만 배포를 승인합니다.'}}];

test('knowledge review preserves entailment guidance through a format repair without adding an unconditional review',async()=>{
  let calls=0;
  const result=await reviewResult({task,receipts,evidence,model,candidate:'보안 검토는 유일한 승인 조건입니다.',signal:new AbortController().signal,invoke:async messages=>{
    calls++;
    assert.ok(messages[0].content.startsWith(REVIEW_PROMPT));
    assert.ok(messages[0].content.includes(CLAIM_REVIEW_GUIDANCE));
    assert.ok(messages[0].content.includes(TEMPORAL_GUIDANCE));
    const data=JSON.parse(messages[1].content);
    assert.equal(data.evidence.find(row=>row.id==='tool:0').result.content,evidence[0].result.content);
    if(calls===1)return {content:'invalid JSON',calls:[]};
    return {content:JSON.stringify({status:'revise',checks:[{requirementId:'request',state:'unknown',evidenceIds:['tool:0'],detail:'필요조건을 유일한 조건으로 확장했습니다.'}],nextStep:'원문이 밝힌 필요조건으로 한정해 답변하세요.'}),calls:[]};
  }});
  assert.equal(calls,2);assert.equal(result.status,'revise');
  assert.equal(result.checks[0].state,'unknown');
  assert.equal(resultReviewInput({task,receipts,evidence:[],model,candidate:'안녕하세요.'}).messages[0].content,REVIEW_PROMPT);
});

test('knowledge guidance shares the actual evidence context budget',()=>{
  const many=Array.from({length:128},(_,i)=>({tool:'read_personal_mail',result:{id:i,content:'보안 검토를 통과할 때만 배포를 승인합니다.\n'.repeat(180)}}));
  const {messages,data}=resultReviewInput({task,receipts,evidence:many,model,candidate:'제공된 메일의 조건을 확인했습니다.'});
  assert.ok(messages[0].content.includes(CLAIM_REVIEW_GUIDANCE));
    assert.ok(messages[0].content.includes(TEMPORAL_GUIDANCE));
  assert.ok(contextTokens(messages)<=reviewInputLimit(model)-512);
  assert.ok(data.omittedEvidence>0);
  assert.ok(data.evidence.some(row=>row.id==='host'));
  assert.ok(data.evidence.some(row=>row.id==='user'));
});
