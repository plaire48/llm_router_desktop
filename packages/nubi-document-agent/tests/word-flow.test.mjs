import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/index.js';
import {createHost,task,fixture,copy,deferred,until} from './host.mjs';

async function setup(options){
  assert.equal(typeof api.createDocumentAddon,'function','Document addon API is not implemented');
  const h=createHost(options),addon=api.createDocumentAddon();
  const session=await addon.attach(h.host,{projectId:'project-1'});
  return {...h,addon,session};
}
test('prepare runs the real agent loop and produces an approval without changing the document',async()=>{
  const {session,c}=await setup();const result=await session.prepare(task);
  assert.equal(result.state,'WAITING_APPROVAL');assert.equal(result.proposal.patch.oldText,'3월 12일');
  assert.deepEqual(c.snapshot,fixture.snapshot);assert.equal(c.writes,0);assert.equal(c.modelCalls,3);
  assert.equal(c.prompts[0].fingerprint,result.proposal.fingerprint);assert.equal(c.leases.size,0);
});
test('approved edit preserves non-target runs and all formatting with no save claim',async()=>{
  const {session,c,grant}=await setup();const pending=await session.prepare(task);grant(pending);
  const result=await session.apply(task.taskId,pending.proposal.approvalId);
  assert.equal(result.state,'COMPLETED');assert.equal(result.saved,false);assert.equal(result.verification,'verified');assert.equal(c.writes,1);
  assert.equal(c.snapshot.blocks[1].runs[0].text,'개최일은 3월 19일입니다. ');
  assert.deepEqual(c.snapshot.blocks[0],fixture.snapshot.blocks[0]);assert.deepEqual(c.snapshot.blocks[1].runs[1],fixture.snapshot.blocks[1].runs[1]);
  assert.deepEqual(c.snapshot.blocks[1].runs[0].style,fixture.snapshot.blocks[1].runs[0].style);
  assert.deepEqual(c.snapshot.blocks[1].style,fixture.snapshot.blocks[1].style);
});
test('an unapproved or stale approval cannot issue a write',async()=>{
  const {session,c}=await setup();const pending=await session.prepare(task);
  await assert.rejects(session.apply(task.taskId,'unrelated'),{code:'approval_mismatch'});
  await assert.rejects(session.apply(task.taskId,pending.proposal.approvalId),{code:'approval_required'});assert.equal(c.writes,0);
});
test('user edits after proposal cause a conflict without overwriting them',async()=>{
  const {session,c,grant}=await setup();const pending=await session.prepare(task);grant(pending);
  c.snapshot.blocks[1].runs[0].text='사용자가 변경한 문장';c.snapshot.binding.revision='user-r2';
  const result=await session.apply(task.taskId,pending.proposal.approvalId);
  assert.equal(result.state,'CONFLICT');assert.equal(c.writes,0);assert.equal(c.snapshot.blocks[1].runs[0].text,'사용자가 변경한 문장');
});
test('atomic native preconditions reject edits made between reread and dispatch',async()=>{
  const {session,c,grant}=await setup();const pending=await session.prepare(task);grant(pending);c.mutateBeforeApply=true;
  const result=await session.apply(task.taskId,pending.proposal.approvalId);assert.equal(result.state,'CONFLICT');assert.equal(c.writes,0);
});
test('readback detects unrelated formatting loss instead of claiming completion',async()=>{
  const {session,c,grant}=await setup();const pending=await session.prepare(task);grant(pending);c.corruptReadback=true;
  const result=await session.apply(task.taskId,pending.proposal.approvalId);
  assert.equal(result.state,'VERIFICATION_FAILED');assert.equal(result.verification,'failed');assert.equal(c.writes,1);
});
test('lost write response is reconciled by receipt and readback without replay',async()=>{
  const {session,c,grant}=await setup();const pending=await session.prepare(task);grant(pending);c.lostResponse=true;
  const uncertain=await session.apply(task.taskId,pending.proposal.approvalId);assert.equal(uncertain.state,'UNCONFIRMED');
  const duplicate=await session.apply(task.taskId,pending.proposal.approvalId);assert.equal(duplicate.state,'UNCONFIRMED');assert.equal(c.writes,1);
  const verified=await session.reconcile(task.taskId);assert.equal(verified.state,'COMPLETED');assert.equal(c.writes,1);
});
test('a completed task stays idempotent after detach and reattach',async()=>{
  const h=await setup();const pending=await h.session.prepare(task);h.grant(pending);await h.session.apply(task.taskId,pending.proposal.approvalId);
  await h.session.detach();const next=await h.addon.attach(h.host,{projectId:'project-1'});
  assert.equal((await next.prepare(task)).state,'COMPLETED');assert.equal(h.c.writes,1);assert.equal(h.c.modelCalls,3);
});
test('changed task input cannot reuse a stored task identity',async()=>{
  const {session}=await setup();await session.prepare(task);
  await assert.rejects(session.prepare({...task,request:'Change something else'}),{code:'task_conflict'});
});
test('model prose without an observed change proposal is incomplete',async()=>{
  const {session,c}=await setup();c.claimOnly=true;
  const result=await session.prepare(task);assert.equal(result.state,'INCOMPLETE');assert.equal(c.writes,0);assert.equal(c.prompts.length,0);
});
test('storage failure before dispatch prevents native mutation',async()=>{
  const {session,c,grant}=await setup();const pending=await session.prepare(task);grant(pending);c.failStore=true;
  await assert.rejects(session.apply(task.taskId,pending.proposal.approvalId),{code:'store_unavailable'});assert.equal(c.writes,0);
});
test('detach aborts a waiting model and prevents late proposals',async()=>{
  const {session,c}=await setup();c.modelGate=deferred();const running=session.prepare(task);
  await until(()=>c.modelCalls===1);await session.detach();c.modelGate.resolve();
  const result=await running;assert.equal(result.state,'PAUSED');assert.equal(c.prompts.length,0);assert.equal(c.leases.size,0);
  await assert.rejects(session.prepare(task),{code:'session_detached'});
});
test('cancel during a pending write preserves uncertainty and never replays it',async()=>{
  const {session,c,grant}=await setup();const pending=await session.prepare(task);grant(pending);c.applyGate=deferred();
  const writing=session.apply(task.taskId,pending.proposal.approvalId);await until(()=>c.records.values().next().value?.state==='APPLYING');
  await session.cancel(task.taskId);c.applyGate.resolve();const result=await writing;
  assert.equal(result.state,'UNCONFIRMED');assert.equal((await session.reconcile(task.taskId)).state,'UNCONFIRMED');assert.equal(c.writes,0);
});
test('a paragraph boundary or a style boundary is not accepted as a single-run replacement',async()=>{
  const {session,c}=await setup();c.snapshot.blocks[1].runs[0].text='개최일은 3월 ';c.snapshot.blocks[1].runs[1].text='12일입니다.';
  const result=await session.prepare(task);assert.equal(result.state,'INCOMPLETE');assert.equal(c.writes,0);assert.equal(c.prompts.length,0);
});
test('reattach requires a fresh approval in the new connection generation',async()=>{
  const {session,addon,host,c,grant}=await setup();const old=await session.prepare(task);grant(old);await session.detach();
  const next=await addon.attach(host,{projectId:'project-1'});
  await assert.rejects(next.apply(task.taskId,old.proposal.approvalId),{code:'approval_stale'});
  const fresh=await next.resume(task.taskId);assert.notEqual(fresh.proposal.approvalId,old.proposal.approvalId);
  grant(fresh);assert.equal((await next.apply(task.taskId,fresh.proposal.approvalId)).state,'COMPLETED');assert.equal(c.writes,1);
});
test('suspend stops new work until explicit resume and preserves the paused request',async()=>{
  const {session,c}=await setup();c.modelGate=deferred();const running=session.prepare(task);await until(()=>c.modelCalls===1);
  await session.suspend();assert.equal((await running).state,'PAUSED');
  await assert.rejects(session.prepare({...task,taskId:'task-2'}),{code:'session_suspended'});
  c.modelGate.resolve();c.modelGate=null;const next=await session.resume(task.taskId);assert.equal(next.state,'WAITING_APPROVAL');
});
test('concurrent apply requests cannot issue the same write twice',async()=>{
  const {session,addon,host,c,grant}=await setup();const pending=await session.prepare(task);grant(pending);
  const results=await Promise.allSettled([session.apply(task.taskId,pending.proposal.approvalId),session.apply(task.taskId,pending.proposal.approvalId)]);
  assert.equal(c.writes,1);assert.ok(results.some(x=>x.status==='rejected'&&x.reason.code==='task_busy'));
});
test('detach during approval presentation cannot leave a late actionable prompt',async()=>{
  const {session,c}=await setup();c.presentGate=deferred();const running=session.prepare(task);
  await until(()=>c.records.values().next().value?.state==='WAITING_APPROVAL');await session.detach();
  c.presentGate.resolve();assert.equal((await running).state,'PAUSED');await new Promise(r=>setImmediate(r));assert.equal(c.visiblePrompts.size,0);
});
test('a mutated returned proposal cannot change the stored approved operation',async()=>{
  const {session,c,grant}=await setup();const pending=await session.prepare(task);grant(pending);
  pending.proposal.patch.newText='unapproved replacement';pending.before.blocks[0].runs[0].text='changed';
  assert.equal((await session.apply(task.taskId,pending.proposal.approvalId)).state,'COMPLETED');
  assert.equal(c.snapshot.blocks[1].runs[0].text,'개최일은 3월 19일입니다. ');
});
test('unsupported host versions and malformed stored checkpoints never reach Office',async()=>{
  const {addon,host,c,session}=await setup();
  await assert.rejects(addon.attach({...host,apiVersion:'2.0.0'},{projectId:'project-1'}),{code:'host_incompatible'});
  await session.prepare(task);c.records.values().next().value.schemaVersion=99;
  await assert.rejects(session.apply(task.taskId,'any'),{code:'checkpoint_schema_incompatible'});assert.equal(c.writes,0);
});
