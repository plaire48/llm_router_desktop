import {test} from 'node:test';
import assert from 'node:assert/strict';
import {autoArchive,markUnread,markRead,setArchived} from '../runtime/conversation-archive.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const now=Date.parse('2026-10-18T12:00:00Z'),old=new Date(now-31*864e5).toISOString();
const store=()=>{const m=new Map();return {get:k=>m.get(k),set:(k,v)=>m.set(k,v),list:p=>[...m.entries()].filter(([k])=>k.startsWith(p)).map(([,v])=>v)};};
test('unread is persisted only for an unseen answer or question and opening clears it',()=>{
 const s=store();s.set('task:a',{id:'a',state:'review',messages:[{content:'keep'}]});
 markUnread(s,'a',{viewing:'b'});assert.equal(s.get('task:a').unread,true);
 markRead(s,'a');assert.equal(s.get('task:a').unread,false);
 markUnread(s,'a',{viewing:'a'});assert.equal(s.get('task:a').unread,false);
 assert.deepEqual(s.get('task:a').messages,[{content:'keep'}]);
});
test('auto archive waits for pin migration and excludes pins, busy, attention, recent, invalid dates and archived tasks',()=>{
 const s=store();
 for(const [id,state,extra] of [['old','completed',{}],['pin','review',{}],['running','running',{}],['stopping','stopping',{}],['waiting','waiting_input',{}],['paused','paused',{}],['interrupted','interrupted',{}],['failed','failed',{}],['question','review',{question:{id:'q'}}],['new','review',{updatedAt:new Date(now).toISOString()}],['invalid','review',{updatedAt:'bad',createdAt:'bad'}],['archived','review',{archivedAt:old}]])s.set('task:'+id,{id,state,updatedAt:old,...extra});
 assert.deepEqual(autoArchive(s,{days:30,now}),[]);
 s.set('setting:pinned-tasks',{ids:['pin']});
 assert.deepEqual(autoArchive(s,{days:30,now}),['old']);assert.equal(s.get('task:old').archivedAt,new Date(now).toISOString());
 for(const days of [0,-1,NaN,'30'])assert.deepEqual(autoArchive(s,{days,now}),[]);
});
test('archive keeps records and restoring renews activity so the next launch cannot immediately archive it',()=>{
 const s=store();s.set('task:a',{id:'a',state:'completed',updatedAt:old,messages:[{content:'original'}]});s.set('setting:pinned-tasks',{ids:[]});
 setArchived(s,'a',true,{now});assert.equal(s.get('task:a').archivedAt,new Date(now).toISOString());
 setArchived(s,'a',false,{now});assert.equal(s.get('task:a').archivedAt,null);assert.deepEqual(autoArchive(s,{days:30,now:now+1000}),[]);assert.equal(s.get('task:a').messages[0].content,'original');
});
test('service migrates ordered pins once, preserves them across reopen, validates scope and archives only idle conversations',async t=>{
 const {service}=await fixture(t),a=await service.createTask({request:'First pinned'}),b=await service.createTask({request:'Second pinned'}),c=await service.createTask({request:'Old idle'});
 for(const item of [a,b,c])service.store.set('task:'+item.id,{...item,state:'completed',createdAt:old,updatedAt:old});
 assert.equal(service.conversationNavigation().autoArchiveDays,30);
 const args={projectId:service.projectId,ids:[b.id,a.id,b.id],initialize:true};
 await service.invoke('setPinnedTasks',args);assert.deepEqual(service.conversationNavigation().pinnedIds,[b.id,a.id]);assert.ok(service.task(c.id).archivedAt);
 await service.invoke('setPinnedTasks',{...args,ids:[]});assert.deepEqual(service.conversationNavigation().pinnedIds,[b.id,a.id],'a stale renderer cannot reinitialize pins');
 await assert.rejects(service.invoke('setPinnedTasks',{...args,projectId:'wrong'}),/project_changed/);
 await service.invoke('setAutoArchiveDays',{days:0,projectId:service.projectId});
 for(const days of [-1,1.5,'30',Infinity])await assert.rejects(service.invoke('setAutoArchiveDays',{days}),/archive_days_invalid/);
 service.store.close();await service.open(service.root);assert.equal(service.conversationNavigation().autoArchiveDays,0);assert.deepEqual(service.conversationNavigation().pinnedIds,[b.id,a.id]);
 await service.invoke('archiveTask',{taskId:c.id,archived:false});assert.equal(service.task(c.id).archivedAt,null);
 service.store.set('task:'+c.id,{...service.task(c.id),state:'running'});await assert.rejects(service.invoke('archiveTask',{taskId:c.id,archived:true}),/agent_busy/);
 service.store.set('task:'+c.id,{...service.task(c.id),state:'review',unread:true});await service.invoke('markTaskRead',{taskId:c.id});assert.equal(service.viewingTaskId,c.id);assert.equal(service.task(c.id).unread,false);
 await service.invoke('markTaskRead',{taskId:null});assert.equal(service.viewingTaskId,null);
});
test('navigation includes old archived and pinned rows without returning their message bodies',async t=>{
 const {service}=await fixture(t);
 for(let i=0;i<70;i++)service.store.set('task:t'+i,{id:'t'+i,request:'History '+i,state:'completed',createdAt:old,archivedAt:i===0?old:null,messages:[{content:'large body'}]});
 const rows=service.conversationNavigation().tasks;assert.equal(rows.length,70);assert(rows.some(row=>row.id==='t0'&&row.archivedAt));assert(rows.every(row=>!('messages'in row)));
});
test('actual agent final answer marks an unseen task unread, and preserves host metadata during later persistence',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'Summarize the request'});
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>({content:'Here is the requested summary.',calls:[]})};
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(service.task(task.id).state,'review');assert.equal(service.task(task.id).unread,true);assert.ok(service.task(task.id).updatedAt);
 await service.markTaskRead({taskId:task.id});await service.startAgent({taskId:task.id,answer:'Summarize again'});await service.agent.promise;
 assert.equal(service.task(task.id).unread,false);
});
test('agent questions are unread until opened and cannot be archived while awaiting a reply',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'Ask me for the scope'});
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>({content:'',calls:[{id:'question',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'어느 범위를 확인할까요?'})}}]})};
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(service.task(task.id).state,'waiting_input');assert.equal(service.task(task.id).unread,true);
 assert.throws(()=>service.archiveTask({taskId:task.id,archived:true}),/agent_busy/);
 service.markTaskRead({taskId:task.id});assert.equal(service.task(task.id).unread,false);
});
test('approved pin contract uses host-only pins, protects manual archive, restores pinned archived tasks and enforces 50',async t=>{
 const {service}=await fixture(t),a=await service.createTask({request:'Pinned'}),b=await service.createTask({request:'Archived'});
 service.store.set('task:'+b.id,{...b,state:'review',archivedAt:old});
 await service.invoke('setPinnedTasks',{projectId:service.projectId,ids:[a.id,b.id],initialize:true});
 assert.deepEqual(service.store.get('setting:pinned-tasks').ids,[a.id,b.id]);
 assert.equal(service.task(b.id).archivedAt,null);
 assert.equal(service.state().tasks.find(task=>task.id===a.id).pinned,true);
 assert.throws(()=>service.archiveTask({taskId:a.id,archived:true}),/task_pinned/);
 for(let i=0;i<51;i++)service.store.set('task:pin'+i,{id:'pin'+i,request:'Pin '+i,state:'review'});
 await assert.rejects(service.invoke('setPinnedTasks',{ids:Array.from({length:51},(_,i)=>'pin'+i)}),/pin_limit/);
 assert.deepEqual(service.store.get('setting:pinned-tasks').ids,[a.id,b.id]);
});
test('opening an already initialized project archives eligible tasks without a host restart',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'Idle'});
 await service.invoke('setPinnedTasks',{ids:[],initialize:true});
 service.store.set('task:'+task.id,{...task,state:'completed',updatedAt:old});
 await service.open(service.root,{initializeWiki:false});assert.ok(service.task(task.id).archivedAt);
});
test('one-time migration keeps the newest 50 valid pins and reports overflow without deleting conversations',async t=>{
 const {service}=await fixture(t);const ids=Array.from({length:52},(_,i)=>'legacy'+i);
 for(const id of ids)service.store.set('task:'+id,{id,request:id,state:'completed',createdAt:old,messages:[{content:'preserved'}]});
 const result=service.setPinnedTasks({ids,initialize:true});assert.deepEqual(result.pinnedIds,ids.slice(0,50));assert.equal(result.unpinnedCount,2);
 assert.equal(service.store.list('task:').length,52);assert.equal(service.task(ids[51]).messages[0].content,'preserved');
 assert(result.tasks.every(task=>typeof task.pinned==='boolean'));
});

test('F2 completed command histories archive while only active action states block',async t=>{
 const {service}=await fixture(t);service.store.set('setting:pinned-tasks',{ids:[]});
 for(const [prefix,state,blocked] of [['setup-action:','started',false],['proposal:','superseded',false],['process:','timed_out',false],['process:','interrupted',false],['process:','running',true],['setup-action:','starting',true],['command-repair:','proposed',true],['proposal:','creating',true]]){
  const task=await service.createTask({request:prefix+state});service.store.set('task:'+task.id,{...task,state:'review',updatedAt:new Date(Date.now()-31*864e5).toISOString()});service.store.set(prefix+task.id,{id:task.id,taskId:task.id,state});service.runAutoArchive();assert.equal(!!service.task(task.id).archivedAt,!blocked,prefix+state);
 }
});

test('read marks leave updatedAt alone so an old conversation does not jump to today',()=>{
 const m=new Map(),s={get:k=>m.get(k),set:(k,v)=>m.set(k,v),list:p=>[...m.values()]};const old='2026-09-01T00:00:00.000Z';
 s.set('task:a',{id:'a',state:'completed',updatedAt:old});
 markUnread(s,'a',{viewing:'b'});assert.equal(s.get('task:a').unread,true);assert.equal(s.get('task:a').updatedAt,old);
 markRead(s,'a');assert.equal(s.get('task:a').unread,false);assert.equal(s.get('task:a').updatedAt,old);
});
