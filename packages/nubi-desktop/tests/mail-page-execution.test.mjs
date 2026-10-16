import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readMailPage} from '../electron-app/mail-page-execution.cjs';
function page(){const contents=new EventEmitter();contents.isDestroyed=()=>false;contents.executeJavaScript=()=>new Promise(()=>{});return contents;}
for(const event of ['did-start-navigation','destroyed','render-process-gone'])test(`pending mail page read ends when the old document emits ${event}`,async()=>{
 const contents=page(),pending=readMailPage(contents,'fixture');
 contents.emit(event,{},'https://portal.example.test/',false,true);
 await assert.rejects(pending,/mail_portal_login/);assert.equal(contents.eventNames().length,0);
});
test('a pending renderer inspection times out and releases listeners',async()=>{
 const contents=page();await assert.rejects(readMailPage(contents,'fixture',{timeout:10}),/mail_portal_timeout/);assert.equal(contents.eventNames().length,0);
});
test('login cancellation interrupts a pending renderer read',async()=>{
 const contents=page(),controller=new AbortController(),pending=readMailPage(contents,'fixture',{signal:controller.signal});controller.abort();
 await assert.rejects(pending,/mail_cancelled/);assert.equal(contents.eventNames().length,0);
});
test('hash and subframe navigation retain the current read and late results cannot replace it',async()=>{
 const contents=page();let complete;contents.executeJavaScript=()=>new Promise(resolve=>complete=resolve);
 const pending=readMailPage(contents,'fixture');contents.emit('did-start-navigation',{},'#part',true,true);contents.emit('did-start-navigation',{},'https://frame.example.test/',false,false);
 complete({ok:true});assert.deepEqual(await pending,{ok:true});assert.equal(contents.eventNames().length,0);
 const stale=readMailPage(contents,'fixture');contents.emit('destroyed');complete({ok:true});await assert.rejects(stale,/mail_portal_login/);
});
