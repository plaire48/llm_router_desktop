import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {autoApprovals,setApprovalMode} from '../runtime/approval-policy.mjs';
import {checkCodeQuality,requireCodeQuality} from '../runtime/code-quality.mjs';
import {qualityDescription,qualityLabel} from '../runtime/quality-status.mjs';

test('stale apply persists a visible recovery state, blocks automatic apply and preserves human edits',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'Change first line'}),source=await service.read({path:'app.txt',full:true});
 const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:source.content.replace('first','AI first')});
 const human=source.content.replace('last','Human last');await writeFile(path.join(root,'app.txt'),human);
 await assert.rejects(service.prepareProposal({proposalId:proposal.id}),/source_stale/);assert.equal(service.state().proposals[0].sourceChanged,true);assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),human);
 service.store.close();service.root=null;await service.open(root);assert.equal(service.state().proposals[0].sourceChanged,true);
 service.store.set('task:'+task.id,{...service.task(task.id),state:'review'});setApprovalMode(service.store,'edits');
 assert.deepEqual((await autoApprovals(service,{taskId:task.id})).proposals,[]);
 const {proposal:next,conflicted}=await service.mergeProposal({proposalId:proposal.id});assert.equal(conflicted,false);assert.notEqual(next.id,proposal.id);assert.match(next.content,/AI first/);assert.match(next.content,/Human last/);assert(!next.sourceChanged);assert.equal(next.state,'proposed');assert.equal(service.store.get('proposal:'+proposal.id).state,'superseded');assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),human);
});
test('overlapping changes retain the proposal with an explicit replan state; cancelled proposals cannot apply',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'Change first line'}),source=await service.read({path:'app.txt',full:true});
 const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:source.content.replace('first','AI first')});
 const human=source.content.replace('first','Human first');await writeFile(path.join(root,'app.txt'),human);
 assert.equal((await service.mergeProposal({proposalId:proposal.id})).conflicted,true);const current=service.store.get('proposal:'+proposal.id);assert.equal(current.sourceChanged,true);assert.equal(current.mergeConflicted,true);assert.equal(current.state,'proposed');
 service.cancelProposal({proposalId:proposal.id});await assert.rejects(service.prepareProposal({proposalId:proposal.id}),/proposal_missing/);assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),human);
});
test('restoring the original and rebasing does not supersede the reused proposal itself',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'Change first line'}),source=await service.read({path:'app.txt',full:true});
 const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:source.content.replace('first','AI first')});
 await writeFile(path.join(root,'app.txt'),'changed\n');await assert.rejects(service.prepareProposal({proposalId:proposal.id}),/source_stale/);await writeFile(path.join(root,'app.txt'),source.content);
 const {proposal:next}=await service.mergeProposal({proposalId:proposal.id});assert.equal(next.id,proposal.id);assert.equal(next.sourceChanged,false);assert.equal(service.store.get('proposal:'+proposal.id).state,'proposed');
});
test('unsupported syntax is a disclosed validation gap, not a reported code error',async()=>{
 const quality=await checkCodeQuality('index.html','','<h1>Preview</h1>');assert.equal(quality.state,'unsupported');assert.doesNotThrow(()=>requireCodeQuality(quality));assert.equal(qualityLabel(quality),'문법 검사 대상 아님');assert.match(qualityDescription(quality),/실행이나 화면 검증/);
});
