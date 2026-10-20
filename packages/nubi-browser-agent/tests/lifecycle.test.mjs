import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserAddon,browserAgentManifest} from '../dist/index.js';
import {hostFixture,ready,action,task,deferred,until} from './host.mjs';

test('AD-01: registration has no I/O; incompatible hosts cannot acquire a browser',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon();
  assert.equal(browserAgentManifest.addonApiVersion,'1.3.0');assert.equal(controls.acquires,0);
  await assert.rejects(addon.attach({...host,apiVersion:'2.0.0'},{projectId:'p'}),/host_version_incompatible/);
  await assert.rejects(addon.attach({...host,capabilities:[]},{projectId:'p'}),/host_capability_missing/);
  assert.equal(controls.acquires,0);
});
test('AD-02: concurrent duplicate attach shares one lease and rejects another project',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon();
  const [a,b]=await Promise.all([addon.attach(host,{projectId:'p'}),addon.attach(host,{projectId:'p'})]);
  assert.equal(a,b);assert.equal(controls.acquires,1);
  await assert.rejects(addon.attach(host,{projectId:'another'}),/already_attached/);
  await addon.dispose();assert.equal(controls.releases,1);
});
test('AD-03: failed catalog attachment releases its own lease',async()=>{
  const {host,controls}=hostFixture();host.browser.tools=async()=>{throw Error('catalog unavailable');};
  await assert.rejects(createBrowserAddon().attach(host,{projectId:'p'}));
  assert.equal(controls.releases,1);assert.equal(controls.leaseIds.size,0);
});
test('actions require a fresh observation and host policy; verification uses actual fixture outcome',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon(),{session,observation}=await ready(addon,host);
  assert.equal((await session.complete(task.taskId)).completed,false);
  controls.policy='deny';await assert.rejects(session.execute(task.taskId,action(session,observation)),/policy_denied/);assert.equal(controls.writes,0);
  controls.policy='allow';controls.revision='r2';await assert.rejects(session.execute(task.taskId,action(session,observation)),/binding_changed/);assert.equal(controls.writes,0);
  const fresh=await session.observe(task.taskId,'tab-1');
  const outcome=await session.execute(task.taskId,action(session,fresh));assert.equal(outcome.receipt.status,'confirmed');
  assert.equal((await session.complete(task.taskId)).completed,true);assert.equal(session.checkpoint(task.taskId).state,'COMPLETED');
  await addon.dispose();
});
test('AD-07: host grant is required; duplicated approval replies never repeat a write',async()=>{
  const {host,controls}=hostFixture();controls.policy='ask';
  const addon=createBrowserAddon(),{session,observation}=await ready(addon,host),input=action(session,observation);
  const waiting=await session.execute(task.taskId,input);assert.equal(waiting.kind,'waiting');assert.equal(controls.writes,0);
  assert.deepEqual(await session.execute(task.taskId,input),waiting);
  const request=waiting.pending;controls.grants.add(request.requestId);
  const response={taskId:task.taskId,...request};
  assert.equal((await session.respond(response)).receipt.status,'confirmed');assert.equal(controls.writes,1);
  await assert.rejects(session.respond(response),/input_stale/);assert.equal(controls.writes,1);
  assert.equal((await session.execute(task.taskId,input)).reused,true);
  await assert.rejects(session.execute(task.taskId,{...input,arguments:{value:'different'}}),/action_identity_changed/);
  assert.equal(JSON.stringify([...controls.records.values()]).includes('Issue 123'),false,'draft input values are not checkpointed');
  await addon.dispose();
});
test('login hands control to the host and strips protected page data before returning',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon();const session=await addon.attach(host,{projectId:'project-1'});await session.openTask(task);
  controls.mode='login_required';const result=await session.observe(task.taskId,'tab-1');assert.equal(result.data,undefined);
  const pending=session.checkpoint(task.taskId).pending;assert.equal(pending.kind,'login');
  await session.respond({taskId:task.taskId,...pending});assert.equal(session.checkpoint(task.taskId).state,'REVALIDATING');
  controls.mode='ready';await session.observe(task.taskId,'tab-1');assert.equal(session.checkpoint(task.taskId).state,'RUNNING');
  await addon.dispose();
});
test('AD-04/05/09: detach cancels the queue, retains uncertain writes and ignores late results',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon(),{session,observation}=await ready(addon,host);
  const late=deferred();let started=false;
  host.browser.execute=async()=>{controls.writes++;started=true;return late.promise;};
  const first=session.execute(task.taskId,action(session,observation));await until(()=>started);
  const second=session.execute(task.taskId,action(session,observation,{actionId:'action-2'}));
  const secondCheck=assert.rejects(second,/operation_cancelled/);
  await addon.detach();await secondCheck;
  assert.equal((await first).receipt.status,'unconfirmed');assert.equal(controls.writes,1);
  const after=JSON.stringify([...controls.records.values()]);late.resolve({status:'confirmed',evidenceRefs:['late:ignored']});await Promise.resolve();await Promise.resolve();
  assert.equal(JSON.stringify([...controls.records.values()]),after);
  const replacement=await addon.attach(host,{projectId:'project-1'});await replacement.openTask(task);
  assert.equal(replacement.checkpoint(task.taskId).state,'PAUSED');await replacement.resumeTask(task.taskId);const fresh=await replacement.observe(task.taskId,'tab-1');
  await assert.rejects(replacement.execute(task.taskId,action(replacement,fresh,{actionId:'new-write'})),/execution_unconfirmed/);
  await replacement.reconcile(task.taskId,'action-1');assert.equal(controls.writes,1);await addon.dispose();
});
test('AD-06: approval from an old attachment cannot act after reconnect',async()=>{
  const {host,controls}=hostFixture();controls.policy='ask';const addon=createBrowserAddon(),{session,observation}=await ready(addon,host);
  const {pending}=await session.execute(task.taskId,action(session,observation));await addon.detach();
  const next=await addon.attach(host,{projectId:'project-1'});await next.openTask(task);
  await assert.rejects(next.respond({taskId:task.taskId,...pending}),/input_stale/);
  assert.equal(controls.writes,0);await addon.dispose();
});
test('AD-08: failed flush prevents detach and retains host ownership until retry',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon(),{session}=await ready(addon,host);
  controls.failFlush=true;await assert.rejects(addon.detach(),/checkpoint_flush_failed/);
  assert.equal(session.lifecycle,'DRAINING');assert.equal(controls.releases,0);
  controls.failFlush=false;await addon.detach();assert.equal(controls.releases,1);
});
test('AD-10: cancelled tool refresh never publishes a partial catalog',async()=>{
  const {host}=hostFixture(),addon=createBrowserAddon(),{session}=await ready(addon,host);
  const late=deferred();let started=false;host.browser.tools=async()=>{started=true;return late.promise;};
  const old=session.catalog(),refresh=session.refreshCatalog();const checked=assert.rejects(refresh,/operation_cancelled/);await until(()=>started);await addon.detach();await checked;
  late.resolve([{name:'unexpected',effect:'write'}]);await Promise.resolve();assert.deepEqual(session.catalog(),old);
});
test('AD-11: unsupported checkpoint schema is refused without rewriting stored data',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'project-1'});
  const scope={projectId:'project-1',taskId:task.taskId};controls.records.set(JSON.stringify(scope),{schemaVersion:2,version:1,scope});
  const before=JSON.stringify([...controls.records]);await assert.rejects(session.openTask(task),/checkpoint_schema_incompatible/);assert.equal(JSON.stringify([...controls.records]),before);await addon.dispose();
});
test('AD-12: dispose removes only its lease and subscriptions, keeping host records and tabs',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon(),{session}=await ready(addon,host);controls.leaseIds.add('other-addon');
  let calls=0;const off=session.subscribe(()=>calls++);off();await addon.dispose();
  assert.equal(calls,0);assert.equal(controls.records.size,1);assert.equal(controls.leaseIds.has('other-addon'),true);
  assert.equal(controls.events.every(e=>!('arguments' in e)&&!('request' in e)),true);
  await assert.rejects(addon.attach(host,{projectId:'project-1'}),/addon_disposed/);
});
test('a compare-and-set conflict blocks dispatch instead of overwriting the host state',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon(),{session,observation}=await ready(addon,host);
  const scope={projectId:'project-1',taskId:task.taskId},key=JSON.stringify(scope),saved=controls.records.get(key);saved.version++;
  await assert.rejects(session.execute(task.taskId,action(session,observation)),/checkpoint_conflict/);assert.equal(controls.writes,0);
  await assert.rejects(addon.detach(),/checkpoint_conflict/);assert.equal(controls.releases,0);
});
test('cancelling an active write stops queued actions and preserves its uncertain receipt',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon(),{session,observation}=await ready(addon,host);
  const late=deferred();let started=false;host.browser.execute=async()=>{started=true;controls.writes++;return late.promise;};
  const running=session.execute(task.taskId,action(session,observation));await until(()=>started);
  const queued=session.execute(task.taskId,action(session,observation,{actionId:'queued'}));const rejected=assert.rejects(queued,/operation_cancelled/);
  const cancelled=await session.cancelTask(task.taskId);await rejected;
  assert.equal(cancelled.state,'CANCELLED');assert.equal((await running).receipt.status,'unconfirmed');assert.equal(controls.writes,1);
  await assert.rejects(session.execute(task.taskId,action(session,observation,{actionId:'later'})),/task_cancelled/);
  late.resolve({status:'confirmed',evidenceRefs:['late']});await addon.dispose();
});
test('task cancellation interrupts a slow observation without waiting for its late response',async()=>{
  const {host}=hostFixture(),addon=createBrowserAddon(),{session}=await ready(addon,host);
  const late=deferred();let started=false;host.browser.observe=async()=>{started=true;return late.promise;};
  const reading=session.observe(task.taskId,'tab-1'),checked=assert.rejects(reading,/operation_cancelled/);await until(()=>started);
  await session.cancelTask(task.taskId);await checked;assert.equal(session.checkpoint(task.taskId).state,'CANCELLED');
  late.resolve({state:'ready',binding:{tabId:'tab-1',documentId:'doc-1',revision:'r1'},observationId:'late'});await addon.dispose();
});
test('failed attach cleanup retains ownership and blocks another attachment until cleanup succeeds',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon();const release=host.browser.release,tools=host.browser.tools;
  host.browser.tools=async()=>{throw Error('catalog failed');};host.browser.release=async()=>{throw Error('release failed');};
  await assert.rejects(addon.attach(host,{projectId:'p'}),/attach_cleanup_failed/);assert.equal(controls.leaseIds.size,1);
  await assert.rejects(addon.attach(host,{projectId:'p'}),/attach_cleanup_required/);
  host.browser.release=release;await addon.detach();assert.equal(controls.leaseIds.size,0);
  host.browser.tools=tools;await addon.attach(host,{projectId:'p'});await addon.dispose();
});
test('invalid JSON arguments are rejected before dispatch',async()=>{
  const {host,controls}=hostFixture(),addon=createBrowserAddon(),{session,observation}=await ready(addon,host);
  for(const args of [3,[],{value:NaN},{value:Infinity},{value:undefined}])await assert.rejects(session.execute(task.taskId,action(session,observation,{arguments:args})),/action_invalid/);
  assert.equal(controls.writes,0);await addon.dispose();
});
