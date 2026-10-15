import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {notifyDeliveredAnswer} from '../runtime/answer-notification.mjs';
import {createAnswerNotices} from '../electron-app/answer-notices.cjs';
import {openAnswerNotice} from '../ui/open-answer-notice.mjs';
const task=()=>({id:'t',request:'메일 요약',state:'review',responseTiming:{runId:'r',state:'completed'},messages:[{role:'assistant',runId:'r',content:'PRIVATE_ANSWER'}]});
const notice={projectId:'p',taskId:'t',runId:'r',projectName:'업무',taskTitle:'메일 요약'};
test('only a delivered current-run answer notifies; no question, approval, error or stale draft',async()=>{
 const sent=[],service={projectId:'p',root:'/project',state:()=>({}),notifyAnswer:value=>sent.push(value)};
 notifyDeliveredAnswer(service,task(),'r');assert.equal(sent.length,1);assert.equal(sent[0].taskTitle,'메일 요약');assert(!JSON.stringify(sent).includes('PRIVATE_ANSWER'));
 for(const state of ['running','waiting_input','cancelled','paused'])notifyDeliveredAnswer(service,{...task(),state},'r');
 for(const patch of [{error:'failed'},{question:{id:'q'}},{messages:[]},{messages:[{role:'assistant',runId:'old',content:'OLD'}]},{messages:[{role:'assistant',runId:'r',questionId:'q',content:'QUESTION'}]}])notifyDeliveredAnswer(service,{...task(),...patch},'r');
 for(const key of ['setupActions','proposals','commandRepairs']){service.state=()=>({[key]:[{id:'action',taskId:'t',state:'proposed'}]});notifyDeliveredAnswer(service,task(),'r');}
 assert.equal(sent.length,1);
 service.state=()=>({});service.notifyAnswer=()=>{throw Error('os_unavailable');};assert.doesNotThrow(()=>notifyDeliveredAnswer(service,task(),'r'));
 service.notifyAnswer=()=>Promise.reject(Error('ipc_closed'));notifyDeliveredAnswer(service,task(),'r');await new Promise(r=>setImmediate(r));
});
function native(platform='win32'){
 const created=[],events=[],calls=[];
 class Notice extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;created.push(this);}show(){calls.push('show');}close(){calls.push('close');}}
 const window={isDestroyed:()=>false,isMinimized:()=>true,restore:()=>calls.push('restore'),show:()=>calls.push('window-show'),focus:()=>calls.push('focus')};
 return {created,events,calls,notices:createAnswerNotices({Notification:Notice,getWindow:()=>window,send:e=>events.push(e),platform})};
}
test('Windows notifies once per run and click restores the owning conversation',()=>{
 const f=native();assert.deepEqual(f.notices.show(notice),{shown:true});assert.deepEqual(f.notices.show(notice),{shown:false});
 assert.equal(f.created[0].options.title,'업무 — 답변 완료');assert.equal(f.created[0].options.body,'메일 요약\n답변이 도착했어요. 눌러서 확인하세요.');
 assert.equal(f.events.length,0);f.created[0].emit('click');f.created[0].emit('click');
 assert.deepEqual(f.events,[{type:'answer_open',projectId:'p',taskId:'t',runId:'r'}]);
 assert.deepEqual(f.calls,['show','restore','window-show','focus']);
 assert.deepEqual(f.notices.show({...notice,runId:'r2'}),{shown:true});
 f.notices.clear();f.created[1].emit('click');assert.equal(f.events.length,1);
 assert.deepEqual(f.notices.show(notice),{shown:false});
});
test('native references are bounded; invalid targets and non-Windows hosts do not notify',()=>{
 const f=native();for(let i=0;i<23;i++)f.notices.show({...notice,runId:'run-'+i});
 f.created[0].emit('click');assert.equal(f.events.length,0);
 assert.deepEqual(f.notices.show({...notice,projectId:'../../other'}),{shown:false});
 assert.deepEqual(native('darwin').notices.show(notice),{shown:false});
});
test('click routing uses saved conversation and project guards, never executes actions',async()=>{
 let project='other';const calls=[];
 const ports={currentProjectId:()=>project,switchProject:async id=>{calls.push('switch');project=id;},readTask:async id=>{calls.push('read');return {id};},present:request=>calls.push(request)};
 const event={...notice,type:'answer_open'};assert.equal(await openAnswerNotice(event,ports),true);
 assert.deepEqual(calls,['switch','read',{target:'answer',projectId:'p',task:{id:'t'}}]);
 calls.length=0;await openAnswerNotice(event,ports);assert.equal(calls[0],'read');
 project='other';await assert.rejects(openAnswerNotice(event,{...ports,switchProject:async()=>{throw Error('editor_dirty');}}),/editor_dirty/);
 project='p';assert.equal(await openAnswerNotice(event,{...ports,readTask:async()=>{project='changed';return {id:'t'};}}),false);
 assert.equal(await openAnswerNotice({...event,type:'decision_open'},ports),false);
});

test('personal conversations preserve their separate route outside the project catalog',async()=>{
 const f=native();f.notices.show({...notice,workspaceKind:'conversation'});f.created[0].emit('click');
 assert.equal(f.events[0].workspaceKind,'conversation');let project='other',route;
 await openAnswerNotice(f.events[0],{currentProjectId:()=>project,switchProject:async(id,kind)=>{route=kind;project=id;},readTask:async id=>({id}),present:()=>{}});
 assert.equal(route,'conversation');
});
