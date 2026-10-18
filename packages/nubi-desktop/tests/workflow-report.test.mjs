import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowReport} from '../runtime/workflow-report.mjs';
const run={id:'run-1',mode:'execute',version:3,hash:'sha256:abc',trigger:{kind:'manual'},status:'partial',reason:'workflow_output_missing',cursor:'draft',workflow:{name:'변경 요청 검토',steps:[{id:'ok',kind:'human',ask:'계속?'},{id:'draft',kind:'agent',tools:['propose_new_file'],goal:'초안'}]},steps:{ok:{status:'complete',answer:'approve',receipts:['workflow-receipt:human']},draft:{status:'waiting',receipts:['proposal:one']}}};
test('report includes identity, version, hash, trigger, states, receipts, human answers and unresolved work',()=>{
 const report=workflowReport(run);for(const text of ['변경 요청 검토','run-1','3','sha256:abc','manual','ok','draft','proposal:one','approve','미해결','workflow_output_missing'])assert.ok(report.includes(text),text);
});
test('author selected tools and host added prerequisites are distinct',()=>{
 const report=workflowReport(run);assert.match(report,/작성자가 고른 도구/);assert.match(report,/호스트가 보탠 선행 도구/);
 for(const name of ['propose_new_file','inspect_path','record_change_plan','update_plan','submit_step_output'])assert.ok(report.includes(name));
});
test('report reuses credential redaction, including Korean secrets, multiline keys and Basic auth',()=>{
 for(const secret of ['password=synthetic-password','비밀번호:\nsynthetic-password','Authorization: Bearer abcdefghijklmnop','Basic dXNlcjpwYXNzd29yZA==','-----BEGIN PRIVATE KEY-----\nsynthetic-key\n-----END PRIVATE KEY-----','ghp_abcdefghijklmnopqrstuvwxyz0123']){
  const report=workflowReport({...run,workflow:{...run.workflow,name:secret},steps:{...run.steps,ok:{...run.steps.ok,answer:secret}}});
  assert.equal(report.includes('synthetic-password'),false);assert.equal(report.includes('abcdefghijklmnop'),false);assert.equal(report.includes('dXNlcjpwYXNzd29yZA=='),false);assert.equal(report.includes('synthetic-key'),false);assert.match(report,/숨김/);
 }
});
test('report cannot inject HTML, links, hidden controls or fake running status after the run ended',()=>{
 const report=workflowReport({...run,status:'cancelled',workflow:{...run.workflow,name:'<script>alert(1)</script>\u202E [외부](https://example.invalid)'},steps:{...run.steps,draft:{status:'running',receipts:[]}}});
 assert.equal(report.includes('<script>'),false);assert.equal(report.includes('\u202E'),false);assert.equal(report.includes('[외부](https://example.invalid)'),false);assert.doesNotMatch(report,/상태: 실행 중/);
 const synthetic=workflowReport({...run,mode:'dry-run'});assert.match(synthetic,/합성 시험/);assert.doesNotMatch(synthetic,/실제 실행 완료/);
});
test('historical reports use the resolved tool snapshot of that run',()=>{
 const historical={...run,workflow:{...run.workflow,steps:[{...run.workflow.steps[1],resolvedTools:['propose_new_file','update_plan','submit_step_output']}]}};
 const report=workflowReport(historical);assert.ok(report.includes('submit_step_output'));assert.equal(report.includes('inspect_path'),false);assert.equal(report.includes('record_change_plan'),false);
});
test('credentials are redacted before truncation and after hidden text is normalized',()=>{
 for(const summary of ['메'.repeat(493)+'ghp_abcdefghijklmnopqrstuvwxyz0123','pa\u200bssword=synthetic-password']){
  const report=workflowReport({...run,steps:{...run.steps,draft:{status:'complete',output:{summary}}}});
  assert.equal(report.includes('ghp_'),false);assert.equal(report.includes('synthetic-password'),false);assert.match(report,/숨김/);
 }
});
test('W9 a free text stop answer is not displayed as a cancellation choice',()=>{
 const report=workflowReport({...run,status:'complete',workflow:{name:'자유 입력',steps:[{id:'text',kind:'human',ask:'문구?'}]},steps:{text:{status:'complete',answer:'stop'}}});assert.match(report,/사람 답: stop/);assert.doesNotMatch(report,/사람 답: 중단/);
});
