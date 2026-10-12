import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewResult} from '../runtime/result-review.mjs';

const input=()=>({
  task:{request:'메일에서 새 담당자와 인계 문서를 알려 줘.',messages:[],criteria:[],questionHistory:[],
    workPlan:{intent:{outcomes:['새 담당자 확인','인계 문서 확인']}}},
  evidence:[{tool:'read_personal_mail',result:{mail:{text:'새 담당자는 이하린입니다.'}}}],
  receipts:{},candidate:'새 담당자는 이하린입니다. 읽은 메일에는 인계 문서가 없습니다.',
  model:{id:'fixture',contextLength:32000},signal:new AbortController().signal,
});
function verdict(messages,{request='supported',status='revise'}={}){
  const data=JSON.parse(messages[1].content);
  return {content:JSON.stringify({status,nextStep:status==='revise'?'같은 필터에서 인계로 넓혀 검색하세요.':'',
    checks:data.requirements.map(row=>({requirementId:row.id,
      state:row.id==='request'?request:row.id==='intent:outcome:1'?'unknown':'supported',
      evidenceIds:['tool:0'],detail:row.id==='intent:outcome:1'?'인계 문서가 담긴 메일을 더 확인해야 합니다.':'담당자는 원문에 있습니다.'}))}),calls:[]};
}

test('an unresolved explicit subtask is rechecked before normalizing planner-only failures',async()=>{
  let calls=0;
  const result=await reviewResult({...input(),invoke:async messages=>{
    calls++;
    if(calls===1)return verdict(messages);
    assert.match(messages[0].content,/coverage/i);
    assert.equal(JSON.parse(messages[1].content).requirements[0].text,input().task.request);
    return verdict(messages,{request:'unknown'});
  }});
  assert.equal(calls,2,'do not silently discard a concrete review follow-up');
  assert.equal(result.status,'revise');
  assert.equal(result.checks.find(c=>c.requirementId==='request').state,'unknown');
});

test('a confirmed extra planner demand still cannot block the actual user answer',async()=>{
  let calls=0;const args=input();args.task.request='메일에 적힌 새 담당자를 알려 줘.';
  args.task.workPlan.intent.outcomes[1]='실제 운영 시스템 담당자도 확인';
  const result=await reviewResult({...args,invoke:async messages=>{
    calls++;return verdict(messages,{status:calls===1?'revise':'ready'});
  }});
  assert.equal(calls,2);
  assert.equal(result.status,'ready');
  assert.equal(result.checks.find(c=>c.requirementId==='intent:outcome:1').state,'unknown');
});

test('invalid review JSON still gets only one format retry',async()=>{
  let calls=0;
  await assert.rejects(()=>reviewResult({...input(),invoke:async()=>{
    calls++;return {content:'invalid',calls:[]};
  }}),/goal_review_failed/);
  assert.equal(calls,2);
});
