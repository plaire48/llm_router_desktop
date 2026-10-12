import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createDecisionNotices} from '../electron-app/decision-notices.cjs';
function fixture({focused=false,platform='win32'}={}){
 const created=[],events=[],calls=[];
 class Notice extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;created.push(this);}show(){calls.push('show');}close(){calls.push('close');}}
 const window={isFocused:()=>focused,isDestroyed:()=>false,isMinimized:()=>true,restore:()=>calls.push('restore'),show:()=>calls.push('window-show'),focus:()=>calls.push('focus')};
 return {created,events,calls,notices:createDecisionNotices({Notification:Notice,getWindow:()=>window,send:event=>events.push(event),platform})};
}
test('a background Windows notice opens the pending form once without private content or an answer',()=>{
 const f=fixture();assert.deepEqual(f.notices.request({id:'q1',action:'show'}),{shown:true});
 assert.deepEqual(f.notices.request({id:'q1',action:'show'}),{shown:false});assert.equal(f.created.length,1);
 assert.equal(f.created[0].options.body,'확인이 필요해요. 눌러서 답변해 주세요.');assert.equal(f.events.length,0);
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
