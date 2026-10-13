import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewResult} from '../runtime/result-review.mjs';
const input=()=>({task:{request:'인사해 줘'},candidate:'안녕하세요.',evidence:[],receipts:{},model:{contextLength:32000},signal:new AbortController().signal});
const valid={status:'ready',checks:[{requirementId:'request',state:'supported',evidenceIds:['user'],detail:'인사 요청에 답함'}],nextStep:''};
test('one complete JSON fence is accepted without an extra model call',async()=>{
 let calls=0;const result=await reviewResult({...input(),invoke:async()=>{calls++;return {content:'```json\n'+JSON.stringify(valid)+'\n```',calls:[]};}});
 assert.equal(result.status,'ready');assert.equal(calls,1);
});
test('a rejected response uses the existing structured repair before rerunning the actor',async()=>{
 let calls=0;const result=await reviewResult({...input(),invoke:async(_messages,tools)=>{calls++;if(calls===1)throw Error('response_invalid');assert.equal(tools[0].function.name,'report_desktop_review');return {content:'',calls:[{function:{name:'report_desktop_review',arguments:JSON.stringify(valid)}}]};}});
 assert.equal(result.status,'ready');assert.equal(calls,2);
});
test('ambiguous prose, invalid evidence and truncated review remain failures with safe diagnostics',async()=>{
 for(const [response,reason] of [[{content:'Here is JSON '+JSON.stringify(valid)},'review_json_invalid'],[{content:JSON.stringify({...valid,checks:[{...valid.checks[0],evidenceIds:['invented']}]})},'review_schema_invalid'],[{content:JSON.stringify(valid),finishReason:'length'},'review_output_limit']]){
  let calls=0;await assert.rejects(reviewResult({...input(),invoke:async()=>{calls++;return response;}}),e=>e.message==='goal_review_failed'&&e.reviewReason===reason);assert.equal(calls,2);
 }
});
test('authentication and cancellation never become format retries',async()=>{
 let calls=0;await assert.rejects(reviewResult({...input(),invoke:async()=>{calls++;throw Error('unauthorized');}}),/unauthorized/);assert.equal(calls,1);
 const controller=new AbortController();await assert.rejects(reviewResult({...input(),signal:controller.signal,invoke:async()=>{controller.abort();throw Error('response_invalid');}}),/cancelled/);
});
