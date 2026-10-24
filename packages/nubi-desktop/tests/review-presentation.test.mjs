import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPresentation} from '../ui/review-presentation.mjs';
test('a missing verification names the actual gap without a generic warning',()=>{
 const view=reviewPresentation({state:'ready',checks:[{state:'supported',detail:'빌드 통과'},{state:'unknown',detail:'Windows에서 설치 후 재실행은 확인하지 못했어요.'}]});
 assert.equal(view.heading,'Windows에서 설치 후 재실행은 확인하지 못했어요.');assert.equal(view.tone,'neutral');assert.equal(view.supported,false);
});
test('a next step alone is concrete information, not a failed check',()=>{
 const view=reviewPresentation({state:'ready',nextStep:'설치판에서 메일 연결을 확인해 주세요.',checks:[{state:'supported',detail:'로컬 검사 통과'}]});
 assert.equal(view.heading,'설치판에서 메일 연결을 확인해 주세요.');assert.equal(view.tone,'neutral');assert.equal(view.supported,false,'the suggestion does not certify completion');
});
test('approval waiting stays distinct from unknown verification and a review error',()=>{
 assert.equal(reviewPresentation({state:'ready',checks:[{state:'pending',detail:'명령 실행 승인 대기'}]}).heading,'명령 실행 승인 대기');
 assert.equal(reviewPresentation({state:'failed',reason:'model_timeout'}).tone,'warning');
 assert.equal(reviewPresentation({state:'running'},true).heading,'답변과 근거를 대조하고 있어요');
});
test('only recorded supported checks fold into the evidence summary',()=>{
 assert.equal(reviewPresentation({state:'ready',checks:[{state:'supported',detail:'실제 실행 통과'}]}).supported,true);
 for(const review of [{state:'ready',checks:[]},{state:'ready',checks:[{state:'supported'}],omittedHandoffs:1},{state:'cancelled',checks:[{state:'supported'}]}])assert.equal(reviewPresentation(review).supported,false);
});
test('a normal answer with no formal review checks does not gain an empty warning or a success badge',()=>{
 const view=reviewPresentation({state:'ready',checks:[]});assert.equal(view.visible,false);assert.equal(view.supported,false);
 for(const review of [{state:'ready',checks:[{state:'unknown',detail:'설치 후 재실행 미확인'}]},{state:'ready',checks:[],omittedHandoffs:1},{state:'failed',checks:[]}])assert.equal(reviewPresentation(review).visible,true);
});

test('an extra planner check does not become the headline of an otherwise supported user answer',()=>{
 const view=reviewPresentation({state:'ready',checks:[
  {requirementId:'request',state:'supported',detail:'요청한 인계 담당자는 원문에 있습니다.'},
  {requirementId:'intent:outcome:1',state:'unknown',detail:'요청하지 않은 운영 서버 담당자는 확인하지 않았습니다.'},
 ]});
 assert.equal(view.heading,'확인한 근거 1개');
 assert.equal(view.supported,true);
 assert.equal(view.advisoryChecks.length,1,'the extra check stays available as advisory detail');
 const gap=reviewPresentation({state:'ready',checks:[{requirementId:'turn',state:'unknown',detail:'요청한 인계 문서가 빠졌습니다.'}]});
 assert.equal(gap.heading,'요청한 인계 문서가 빠졌습니다.');assert.equal(gap.supported,false);
});

test('a host-confirmed planner-only follow-up stays with its advisory details',()=>{
 const view=reviewPresentation({state:'ready',normalized:'interpretation_only',nextStep:'추가로 운영 서버 담당자도 조사하세요.',checks:[
  {requirementId:'request',state:'supported',detail:'요청한 인계 담당자는 원문에 있습니다.'},
  {requirementId:'intent:outcome:1',state:'unknown',detail:'운영 서버 담당자는 요청 범위 밖입니다.'},
 ]});
 assert.equal(view.heading,'확인한 근거 1개');assert.equal(view.nextStep,'');
 assert.equal(view.advisoryNextStep,'추가로 운영 서버 담당자도 조사하세요.');
 assert.equal(view.supported,true);
});
