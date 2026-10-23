import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostActivityTracker,hostRequestLabel} from '../ui/host-activity.mjs';
test('a delayed operation exposes its purpose and clears exactly once',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const tracker=createHostActivityTracker(),changes=[];tracker.subscribe(()=>changes.push(tracker.getSnapshot()));
 const done=tracker.begin('saveSource',{content:'private source',password:'private'});assert.equal(tracker.getSnapshot(),null);
 t.mock.timers.tick(150);assert.equal(tracker.getSnapshot().label,'파일 저장 중');assert.equal(tracker.getSnapshot(),tracker.getSnapshot());assert.doesNotMatch(JSON.stringify(tracker.getSnapshot()),/private|password|content/);
 done();done();assert.equal(tracker.getSnapshot(),null);assert.equal(changes.length,2);
});
test('concurrent operations retain the remaining operation when the latest finishes',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const tracker=createHostActivityTracker(),save=tracker.begin('saveSource');t.mock.timers.tick(150);
 const browser=tracker.begin('openBrowser');t.mock.timers.tick(150);assert.equal(tracker.getSnapshot().label,'브라우저 여는 중');assert.equal(tracker.getSnapshot().count,2);
 browser();assert.equal(tracker.getSnapshot().label,'파일 저장 중');assert.equal(tracker.getSnapshot().count,1);save();assert.equal(tracker.getSnapshot(),null);
});
test('fast requests and background status polling never create a fake busy indicator',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const tracker=createHostActivityTracker(),done=tracker.begin('editorSource');done();
 for(const [method,args] of [['state',{streamOnly:true}],['overview'],['poll'],['provider',{action:'status'}],['mail',{action:'status'}],['browser',{action:'status'}],['wikiInitialization']]){assert.equal(hostRequestLabel(method,args),null);tracker.begin(method,args);}
 t.mock.timers.tick(2000);assert.equal(tracker.getSnapshot(),null);
});
test('rejected or cancelled requests remove their live status without reporting completion',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const tracker=createHostActivityTracker();let reject;
 const pending=tracker.run('applyNewFile',{},()=>new Promise((_resolve,fail)=>{reject=fail;}));const rejection=assert.rejects(pending,/cancelled/);
 t.mock.timers.tick(150);assert.equal(tracker.getSnapshot().label,'새 파일 저장 중');reject(Error('cancelled'));await rejection;assert.equal(tracker.getSnapshot(),null);
});
test('status observers cannot turn a successful operation into an error or repeat it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const tracker=createHostActivityTracker();tracker.subscribe(()=>{throw Error('observer');});let resolve,calls=0;
 const pending=tracker.run('saveSource',null,()=>{calls++;return new Promise(done=>{resolve=done;});});t.mock.timers.tick(150);resolve({saved:true});assert.deepEqual(await pending,{saved:true});assert.equal(calls,1);assert.equal(tracker.getSnapshot(),null);
});
