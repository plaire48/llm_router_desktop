import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {humanDecisions} from '../ui/human-decisions.mjs';
import {createDecisionNotices,decisionNoticeContent} from '../electron-app/decision-notices.cjs';
function fixture({focused=false,platform='win32'}={}){
 const created=[],events=[],calls=[];
 class Notice extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;created.push(this);}show(){calls.push('show');}close(){calls.push('close');}}
 const window={isFocused:()=>focused,isDestroyed:()=>false,isMinimized:()=>true,restore:()=>calls.push('restore'),show:()=>calls.push('window-show'),focus:()=>calls.push('focus')};
 return {created,events,calls,notices:createDecisionNotices({Notification:Notice,getWindow:()=>window,send:event=>events.push(event),platform})};
}
test('a background Windows notice opens the pending form once without answering',()=>{
 const f=fixture();assert.deepEqual(f.notices.request({id:'q1',action:'show'}),{shown:true});
 assert.deepEqual(f.notices.request({id:'q1',action:'show'}),{shown:false});assert.equal(f.created.length,1);
 assert.equal(f.created[0].options.body,'대화에 추가 질문이 도착했어요.');assert.equal(f.events.length,0);
 f.created[0].emit('click');assert.deepEqual(f.events,[{type:'decision_open',id:'q1'}]);assert.deepEqual(f.calls,['show','restore','window-show','focus']);
 f.notices.request({id:'q1',action:'clear'});f.created[0].emit('click');assert.equal(f.events.length,1,'stale notification cannot open a cleared question');
});
test('Windows gets an OS toast even in the foreground; other platforms keep the question entry',()=>{
 const f=fixture({focused:true});assert.deepEqual(f.notices.request({id:'q',action:'show'}),{shown:true});
 const mac=fixture({platform:'darwin'});assert.deepEqual(mac.notices.request({id:'q',action:'show'}),{shown:false});
});
test('native notice references are bounded and disposal invalidates clicks',()=>{
 const f=fixture();for(let i=0;i<23;i++)f.notices.request({id:'q'+i,action:'show'});
 f.created[0].emit('click');assert.equal(f.events.length,0);f.notices.clear();f.created.at(-1).emit('click');assert.equal(f.events.length,0);
 assert.throws(()=>f.notices.request({id:'q',action:'answer'}),/decision_notice_invalid/);
});

test('Windows question notification identifies the project, conversation and actual question',()=>{
 const f=fixture();const [decision]=humanDecisions({projectId:'p',tasks:[{id:'t',request:'주간 보고서 작성',state:'waiting_input',question:{id:'q',text:'어느 기간의 메일을 포함할까요?',options:[{id:'week',label:'이번 주'}]}}]});
 f.notices.request({...decision,projectName:'운영 프로젝트',action:'show'});
 assert.equal(f.created[0].options.title,'운영 프로젝트 — 답변 요청');
 assert.equal(f.created[0].options.body,'주간 보고서 작성\n어느 기간의 메일을 포함할까요?');
 f.created[0].emit('click');assert.deepEqual(f.events,[{type:'decision_open',id:decision.id}]);
});
test('approval previews identify the proposed work without transmitting executable scripts',()=>{
 const state={projectId:'background',tasks:[{id:'t',state:'review',request:'빌드 오류 수정'}],setupActions:[{id:'s',taskId:'t',state:'proposed',title:'프로젝트 의존성 설치',script:'PRIVATE_SCRIPT'}]};
 let [decision]=humanDecisions(state);assert.equal(decision.projectId,'background');
 assert.deepEqual(decisionNoticeContent({...decision,projectName:'백그라운드 프로젝트'}),{title:'백그라운드 프로젝트 — 실행 승인 요청',body:'빌드 오류 수정\n프로젝트 의존성 설치'});
 assert(!JSON.stringify(decision).includes('PRIVATE_SCRIPT'));
 state.proposals=[{id:'file',taskId:'t',state:'proposed',path:'src/main.js',after:'PRIVATE_FILE'}];
 [decision]=humanDecisions(state);assert.match(decisionNoticeContent(decision).body,/src\/main.js 변경 내용을 검토/);assert(!JSON.stringify(decision).includes('PRIVATE_FILE'));
});
test('notification previews flatten control characters and bound long text',()=>{
 const content=decisionNoticeContent({kind:'question',projectName:'p'.repeat(200),taskTitle:'t'.repeat(500),summary:'\x1b[31m예시\u202e\n'+ '가'.repeat(1000)});
 assert(Array.from(content.title).length<60);const lines=content.body.split('\n');assert.equal(lines.length,2);assert.equal(Array.from(lines[0]).length,55);assert.equal(Array.from(lines[1]).length,160);assert(!/[\x1b\u202e]/.test(content.body));
});

test('a Windows question notification carries the choices and a reply box, and answers come back as events',()=>{
 const f=fixture();
 assert.deepEqual(f.notices.request({id:'q2',action:'show',kind:'question',summary:'어떤 값으로 바꿀까요?',choices:['둘','셋'],allowText:true,placeholder:'답변 입력'}),{shown:true});
 const notice=f.created.at(-1);
 assert.deepEqual(notice.options.actions,[{type:'button',text:'둘'},{type:'button',text:'셋'}]);assert.equal(notice.options.hasReply,true);assert.equal(notice.options.replyPlaceholder,'답변 입력');
 notice.emit('action',{},1);assert.deepEqual(f.events,[{type:'decision_answer',id:'q2',choice:'셋'}]);
 notice.emit('action',{},0);assert.equal(f.events.length,1,'a notification answers once');
 assert.deepEqual(f.notices.request({id:'q3',action:'show',kind:'question',summary:'이름은?',allowText:true}),{shown:true});
 const typed=f.created.at(-1);assert.equal(typed.options.actions,undefined);
 typed.emit('reply',{},'  누비  ');assert.deepEqual(f.events.at(-1),{type:'decision_answer',id:'q3',text:'누비'});
 assert.deepEqual(f.notices.request({id:'q4',action:'show',kind:'command',summary:'npm test'}),{shown:true});
 assert.equal(f.created.at(-1).options.hasReply,undefined,'approvals open the form instead of taking a reply');
});

test('a question with several possible answers opens the app instead of answering from the notification',()=>{
 const f=fixture();
 assert.deepEqual(f.notices.request({id:'q5',action:'show',kind:'question',summary:'어느 파일을 고칠까요?',openLabel:'열어서 답하기',choices:['a','b'],allowText:true}),{shown:true});
 const notice=f.created.at(-1);
 assert.deepEqual(notice.options.actions,[{type:'button',text:'열어서 답하기'}]);assert.equal(notice.options.hasReply,undefined);
 notice.emit('action',{},0);assert.deepEqual(f.events.at(-1),{type:'decision_open',id:'q5'});assert.ok(f.calls.includes('focus'));
});
