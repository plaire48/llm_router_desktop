import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewResult,resultReviewInput} from '../runtime/result-review.mjs';

function input(){
 const before='2026-10-18T01:00:00Z',applied='2026-10-18T01:01:00Z',checked='2026-10-18T01:02:00Z';
 return {task:{id:'t',request:'수정하고 테스트',criteria:[],messages:[],changePlan:{createdAt:before,targets:[{path:'app.mjs'}],checks:[{requirementId:'r',method:'test',description:'변경 회귀 확인'}]}},
 receipts:{proposals:[{taskId:'t',path:'app.mjs',state:'applied',createdAt:before,appliedAt:applied}],setupActions:[{taskId:'t',kind:'verify',state:'started',resultProcessId:'p'}],processes:[{id:'p',taskId:'t',script:'npm test',profile:'bash',cwd:'/fixture',startedAt:checked,state:'completed',execution:'started',exitCode:0,output:'1 passed'}]},
 candidate:'수정 후 회귀 검사를 통과했습니다.',evidence:[],model:{id:'fixture',contextLength:32000},signal:new AbortController().signal,
 invoke:async messages=>({calls:[],content:JSON.stringify({status:'ready',nextStep:'',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'supported',evidenceIds:['host'],detail:'실행 확인'}))})})};
}
test('the existing gate rejects unsupported completion and retains an actual post-edit verification',async()=>{
 const x=input();assert.equal((await reviewResult(x)).status,'ready');
 for(const mutate of [x=>x.receipts.processes=[],x=>x.receipts.processes[0].exitCode=1,x=>x.receipts.processes[0].startedAt='2026-10-18T00:00:00Z',x=>x.receipts.setupActions[0].kind='build',x=>x.receipts.processes[0].output='',x=>x.receipts.processes[0].execution='unknown']){
  const sample=input();mutate(sample);assert.equal((await reviewResult(sample)).status,'revise');
 }
});
test('read-only work is not given an after-edit completion gate',()=>{
 const x=input();x.receipts.proposals=[];
 assert.equal(resultReviewInput(x).data.developmentChecks,undefined);
 assert(!resultReviewInput(x).data.requirements.some(r=>r.id==='host:development'));
});
