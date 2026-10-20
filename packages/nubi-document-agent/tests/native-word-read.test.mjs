import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/index.js';
import {nativeFixture} from './native-word-host.mjs';
import {createHost,task,deferred,until} from './host.mjs';

function readerFixture(){
  assert.equal(typeof api.createNativeWordReadPort,'function','Native Word read adapter is not implemented');
  const h=nativeFixture();return {...h,reader:api.createNativeWordReadPort(h.bridge)};
}
async function acquired(h){const signal=new AbortController().signal;const binding=await h.reader.acquire(h.scope,h.connection.targetRef,signal);return {ctx:{...binding,scope:h.scope},signal};}

test('native Office reads are normalized into stable paragraph and format-run snapshots',async()=>{
  const h=readerFixture(),{ctx,signal}=await acquired(h);const snapshot=await h.reader.read(ctx,signal);
  assert.equal(snapshot.binding.documentId,'meeting-document');assert.match(snapshot.binding.revision,/^[a-f0-9]{64}$/);
  assert.deepEqual(snapshot.blocks.map(x=>x.runs.map(r=>r.text)),[['제목'],['회의는 ','3월 12일','입니다.']]);
  assert.equal(snapshot.blocks[0].runs[0].style.fontSize,16);assert.equal(snapshot.blocks[1].runs[1].style.bold,true);
  assert.equal(snapshot.blocks[1].runs[0].style.bold,false);assert.equal(snapshot.blocks[1].style.spacingAfter,6);
  assert.ok(h.c.calls.every(x=>['inspect_office','inspect_office_members'].includes(x.name)));
  const again=await h.reader.read(ctx,signal);assert.equal(again.binding.revision,snapshot.binding.revision);
  await h.reader.release(ctx);assert.equal(h.c.released,1);
});
test('member signatures come from the native response rather than a hardcoded support list',async()=>{
  const h=readerFixture(),{ctx,signal}=await acquired(h);const info=await h.reader.inspectMembers(ctx,{target:'document',query:'Range'},signal);
  assert.equal(info.status,'available');assert.equal(info.source,'live_office_type_info');
  assert.deepEqual(info.members[0].parameters,['Start','End']);assert.equal(info.members[0].action,'call');
  await h.reader.release(ctx);
});
test('unavailable type metadata is distinguished from a successfully read document',async()=>{
  const h=readerFixture();h.c.metadataAvailable=false;const {ctx,signal}=await acquired(h);
  assert.equal((await h.reader.inspectMembers(ctx,{target:'document',query:'Range'},signal)).status,'unavailable');
  assert.equal((await h.reader.read(ctx,signal)).blocks[0].runs[0].text,'제목');
  const evidence=h.reader.evidence(ctx);assert.equal(evidence.environment,'fixture');assert.equal(evidence.consistency,'two_pass_match');
  assert.equal(evidence.memberMetadata,'unavailable');await h.reader.release(ctx);
});
test('a document change between read passes is rejected instead of producing a mixed snapshot',async()=>{
  const h=readerFixture(),{ctx,signal}=await acquired(h);h.c.afterInspection=n=>{if(n===1)h.c.text='제목\r회의는 3월 19일입니다.\r';};
  await assert.rejects(h.reader.read(ctx,signal),{code:'native_source_changed'});await h.reader.release(ctx);
});
test('a truncated native scalar is never accepted as complete text',async()=>{
  const h=readerFixture();h.c.truncated=true;const {ctx,signal}=await acquired(h);
  await assert.rejects(h.reader.read(ctx,signal),{code:'native_text_incomplete'});await h.reader.release(ctx);
});
test('invalid native coordinates are rejected',async()=>{
  const h=readerFixture();h.c.badLength=true;const {ctx,signal}=await acquired(h);
  await assert.rejects(h.reader.read(ctx,signal),{code:'native_range_mismatch'});await h.reader.release(ctx);
});
test('oversized or wrong-story bindings stop before native calls and release the connection',async()=>{
  for(const changed of [{end:1000},{storyType:2}]){
    const h=readerFixture();Object.assign(h.connection.range,changed);
    await assert.rejects(h.reader.acquire(h.scope,h.connection.targetRef,new AbortController().signal),{code:'native_scope_unsupported'});
    assert.equal(h.c.calls.length,0);assert.equal(h.c.released,1);
  }
});
test('cross-project contexts cannot use an acquired native lease',async()=>{
  const h=readerFixture(),{ctx,signal}=await acquired(h);
  await assert.rejects(h.reader.read({...ctx,scope:{...h.scope,projectId:'another-project'}},signal),{code:'native_lease_invalid'});
  assert.equal(h.c.calls.length,0);await h.reader.release(ctx);
});
test('release fences a pending read and discards late native results',async()=>{
  const h=readerFixture(),{ctx,signal}=await acquired(h);h.c.gate=deferred();const running=h.reader.read(ctx,signal);
  const stopped=assert.rejects(running,{code:'operation_cancelled'});
  await until(()=>h.c.calls.length===1);await h.reader.release(ctx);h.c.gate.resolve();await stopped;
  await assert.rejects(h.reader.read(ctx,signal),{code:'native_lease_invalid'});assert.equal(h.c.released,1);
});
test('missing native getters are reported without fabricating text or style values',async()=>{
  const h=readerFixture();h.c.unknownMember=true;const {ctx,signal}=await acquired(h);
  await assert.rejects(h.reader.read(ctx,signal),{code:'native_read_failed'});await h.reader.release(ctx);
});
test('release returns the exact acquired resource to its owning bridge',async()=>{
  const h=readerFixture();let released;
  h.bridge.release=async connection=>{released=connection;};
  const {ctx}=await acquired(h);await h.reader.release(ctx);
  assert.equal(released,h.connection);
});
test('a failed reread clears the previous successful observation evidence',async()=>{
  const h=readerFixture(),{ctx,signal}=await acquired(h);await h.reader.read(ctx,signal);
  h.c.truncated=true;await assert.rejects(h.reader.read(ctx,signal),{code:'native_text_incomplete'});
  assert.equal(h.reader.evidence(ctx).consistency,'not_checked');
  assert.equal(h.reader.evidence(ctx).paragraphs,0);await h.reader.release(ctx);
});
test('a bounded nonzero Word selection with supplementary characters reads across native batches',async()=>{
  const h=readerFixture();h.c.text='앞부분'+('문서😀'.repeat(100))+'\r';
  h.connection.range={start:3,end:h.c.text.length,storyType:1};
  const {ctx,signal}=await acquired(h);const snapshot=await h.reader.read(ctx,signal);
  assert.equal(snapshot.blocks.flatMap(b=>b.runs.map(r=>r.text)).join(''),h.c.text.slice(3,-1));
  assert.ok(h.c.calls.filter(x=>x.name==='inspect_office').length>10);
  assert.ok(h.c.calls.filter(x=>x.name==='inspect_office').every(x=>x.input.steps.length<=256));
  await h.reader.release(ctx);
});
test('the native read adapter feeds the existing GenOffice proposal flow without native writes',async()=>{
  const h=readerFixture(),memory=createHost();
  const unavailable=async()=>{assert.fail('Native writes are unavailable in this read-only slice');};
  const host={...memory.host,document:{acquire:h.reader.acquire,read:h.reader.read,release:h.reader.release,apply:unavailable,reconcile:unavailable}};
  const session=await api.createDocumentAddon().attach(host,{projectId:h.scope.projectId});
  const pending=await session.prepare(task);
  assert.equal(pending.state,'WAITING_APPROVAL');assert.equal(pending.proposal.patch.runId,'p2:r2');
  assert.equal(pending.proposal.patch.oldText,'3월 12일');assert.equal(pending.before.blocks[1].runs[1].style.bold,true);
  assert.equal(h.c.text,'제목\r회의는 3월 12일입니다.\r');assert.equal(h.c.released,1);
  assert.ok(h.c.calls.every(x=>['inspect_office','inspect_office_members'].includes(x.name)));
  await session.detach();
});
test('embedded structures are rejected even when the selected text contains no boundary marker',async()=>{
  for(const member of ['Fields','InlineShapes','ContentControls','Tables']){
    const h=readerFixture();h.c.collectionCounts[member]=1;const {ctx,signal}=await acquired(h);
    await assert.rejects(h.reader.read(ctx,signal),{code:'native_scope_unsupported'},member);
    assert.equal(h.reader.evidence(ctx).consistency,'not_checked');await h.reader.release(ctx);
  }
});
