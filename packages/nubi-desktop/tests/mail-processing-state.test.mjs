import test from 'node:test';
import assert from 'node:assert/strict';
import {mailProcessingState,mailStatusReadIssue} from '../ui/mail-processing-state.mjs';

test('mail details distinguish current work, queue, connection and known quantities',()=>{
 const value=mailProcessingState({connected:true,autoWiki:true,progress:{stage:'organizing',completed:7,queued:3,pendingServer:2,remaining:5,attention:1},counts:{received:12}});
 assert.equal(value.title,'메일 정리 중');assert.equal(value.connection,'POP3 연결됨');
 assert.deepEqual(value.counts.map(item=>[item.label,item.value]),[['보관된 메일',12],['정리 완료',7],['정리 대기',3],['받을 메일',2],['확인 필요',1]]);
 assert.equal(value.measurement,null);
});
test('stopped collection and disabled organization retain separate meanings',()=>{
 const status={connected:true,autoWiki:false,progress:{stage:'organizing',queued:4,attachment:{completed:1,total:3}}};
 assert.equal(mailProcessingState(status).stage,'off');assert.equal(mailProcessingState(status).measurement,null);
 assert.equal(mailProcessingState({...status,autoWiki:true,progress:{stage:'paused'}}).stage,'paused');
 assert.equal(mailProcessingState({...status,connected:false,localCount:1}).connection,'서버 연결 없음');
 assert.equal(mailProcessingState({...status,connecting:true}).stage,'connecting');
});
test('only the actual current attachment or search stage has a measured percentage',()=>{
 const base={connected:true,autoWiki:true};
 assert.deepEqual(mailProcessingState({...base,progress:{stage:'attachments',attachment:{completed:2,total:5}}}).measurement,{label:'첨부 읽기',completed:2,total:5});
 assert.deepEqual(mailProcessingState({...base,progress:{stage:'indexing',indexed:3,remaining:7}}).measurement,{label:'검색 준비',completed:3,total:10});
 for(const attachment of [{completed:8,total:5},{completed:1,total:0},{completed:-1,total:2}])assert.equal(mailProcessingState({...base,progress:{stage:'attachments',attachment}}).measurement,null);
 assert.equal(mailProcessingState({...base,progress:{stage:'checking',indexed:3,remaining:7}}).measurement,null);
});
test('status read diagnostics use fixed causes and never show raw server messages',()=>{
 assert.match(mailStatusReadIssue(Error('mail_timeout')).title,/응답이 늦/);
 assert.match(mailStatusReadIssue(Error('mail_reset_pending')).title,/초기화/);
 assert.doesNotMatch(JSON.stringify(mailStatusReadIssue(Error('PRIVATE token=SECRET'))),/PRIVATE|SECRET/);
 assert.equal(mailProcessingState(null),null);
});
test('Office progress measures the current sheet and changes its estimate identity for another sheet',()=>{
 const current={id:'attachment',filename:'예산.xlsx',office:{app:'excel',stage:'read',unit:'cells',completed:1200,total:2400,sheetIndex:2,sheetCount:3,elapsedMs:80000}};
 const state=office=>mailProcessingState({connected:true,autoWiki:true,progress:{stage:'attachments',attachment:{completed:0,total:1,current:{...current,office}}}});
 const value=state(current.office);assert.match(value.detail,/예산.xlsx.*현재 시트 2\/3/);assert.deepEqual(value.measurement,{label:'현재 시트 2/3 읽기',completed:1200,total:2400,unit:'셀',identity:'attachment:cells:2'});
 assert.notEqual(state({...current.office,sheetIndex:3}).measurement.identity,value.measurement.identity);
 const verifying=state({app:'excel',stage:'verify'});assert.match(verifying.detail,/읽기 결과 확인/);assert.equal(verifying.measurement,null,'100 percent cell extraction is not a completed attachment');
});
