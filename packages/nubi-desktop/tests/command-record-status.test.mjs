import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commandRecordStatus} from '../ui/command-record-status.mjs';
test('a successful review cannot hide a failed or stopped command',()=>{
 for(const [state,label] of Object.entries({failed:'실행 실패',cancelled:'중지됨',timed_out:'시간 초과',interrupted:'중단됨',running:'실행 중'})){
  assert.equal(commandRecordStatus({state:'started'},{state,recoveryState:'review'}),label);
 }
 assert.equal(commandRecordStatus({state:'started'},{state:'completed',exitCode:1,recoveryState:'review'}),'실행 실패');
 assert.equal(commandRecordStatus({state:'started'},{state:'completed',exitCode:0,recoveryState:'diagnosing'}),'결과 확인 중');
 assert.equal(commandRecordStatus({state:'rejected'},{state:'completed',exitCode:0}),'실행하지 않음');
});
