import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

test('activity notifications coalesce bursts, deliver the trailing update and stop on disposal',async()=>{
 const {createActivityNotifier}=await import('../runtime/activity-notifier.mjs'),events=[];
 const notify=createActivityNotifier(value=>events.push(value),{intervalMs:15});
 notify({projectId:'first',content:'never sent'});notify({projectId:'first'});notify({projectId:'first'});notify({projectId:'second'});
 assert.deepEqual(events,[{projectId:'first'},{projectId:'second'}]);
 await new Promise(resolve=>setTimeout(resolve,35));assert.deepEqual(events,[{projectId:'first'},{projectId:'second'},{projectId:'first'}]);
 notify({projectId:'first'});notify({projectId:'first'});notify.dispose();const count=events.length;
 await new Promise(resolve=>setTimeout(resolve,35));notify({projectId:'first'});assert.equal(events.length,count);
});

test('persisted actions invalidate the current project before the operation finishes, without sending content',async t=>{
 const {service}=await fixture(t),events=[];
 service.notifyActivity=value=>events.push(value);
 const task=await service.createTask({request:'private request'});
 assert(events.length>0,'creating a task immediately invalidates its view');
 events.length=0;
 service.store.set('proposal:probe',{id:'probe',taskId:task.id,state:'creating',content:'private file'});
 assert.deepEqual(events,[{projectId:service.projectId}]);
 events.length=0;service.store.set('secret:probe',{token:'private'});assert.deepEqual(events,[]);
 service.store.delete('proposal:probe');assert.deepEqual(events,[{projectId:service.projectId}],'removing an action also invalidates the view');
 service.notifyActivity=()=>{throw Error('disconnected renderer');};
 assert.doesNotThrow(()=>service.store.set('proposal:probe',{id:'probe',state:'attention'}));
 assert.equal(service.store.get('proposal:probe').state,'attention');
});

test('actor text invalidates the view while the provider promise is still pending',async t=>{
 const {service}=await fixture(t),events=[];let release,stream;
 service.notifyStream=value=>events.push(value);
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},
  complete:async(_wire,_tools,_signal,onText)=>{stream=onText;await new Promise(resolve=>{release=resolve;});return {content:'실제 응답',calls:[]};}};
 const task=await service.createTask({request:'안녕'});
 await service.startAgent({taskId:task.id});
 try{
  for(let n=0;!stream&&n<200;n++)await new Promise(resolve=>setTimeout(resolve,10));
  assert(stream);events.length=0;stream('지금 작성하는 내용');
  assert.equal(service.displayTask(service.task(task.id)).streamingAnswer,'지금 작성하는 내용');
  assert.deepEqual(events,[{projectId:service.projectId}],'streaming triggers an immediate read, without private text on the event bus');
  assert.equal(service.agent.running,true);
 }finally{release?.();await service.agent.promise;}
});
