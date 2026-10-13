import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';

test('cancel retains proposal evidence and source, rejects its dependent check, and cannot be applied again',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'Update first line'}),before=await service.read({taskId:task.id,path:'app.txt'});
 const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:before.hash,content:'new content\n',reason:'Requested change'});
 service.store.set('setup-action:check',{id:'check',taskId:task.id,state:'proposed',afterProposals:[proposal.id]});
 service.store.set('setup-action:other',{id:'other',taskId:task.id,state:'proposed',afterProposals:[]});
 const cancelled=await service.invoke('cancelProposal',{proposalId:proposal.id});
 assert.equal(cancelled.state,'cancelled');assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),before.content);
 assert.equal(await readFile(proposal.after,'utf8'),'new content\n');
 assert.equal(service.store.get('setup-action:check').state,'rejected');assert.equal(service.store.get('setup-action:other').state,'proposed');
 assert.deepEqual(await service.invoke('cancelProposal',{proposalId:proposal.id}),cancelled);
 await assert.rejects(service.prepareProposal({proposalId:proposal.id}),/proposal_missing/);
});
test('cancel refuses a still-running agent and preserves uncertain or applied proposals',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'Update text'});
 for(const state of ['attention','applied','conflicted','creating']){
  service.store.set('proposal:p',{id:'p',taskId:task.id,state});
  await assert.rejects(service.invoke('cancelProposal',{proposalId:'p'}),/proposal_missing/);
  assert.equal(service.store.get('proposal:p').state,state);
 }
 service.store.set('proposal:p',{id:'p',taskId:task.id,state:'proposed'});
 service.agent={taskId:task.id,running:true};
 await assert.rejects(service.invoke('cancelProposal',{proposalId:'p'}),/agent_busy/);
 assert.equal(service.store.get('proposal:p').state,'proposed');service.agent=null;
});

test('a cancelled proposal cannot be written by a delayed editor save',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'Update first line'}),before=await service.read({path:'app.txt'});
 const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:before.hash,content:'updated\n'});
 const target=service.target.bind(service);let release;service.target=()=>new Promise(resolve=>{release=async()=>resolve(await target(task.id));});
 const saving=service.saveSource({taskId:task.id,path:'app.txt',expectedHash:before.hash,content:proposal.content,proposalId:proposal.id});
 service.cancelProposal({proposalId:proposal.id});await release();
 await assert.rejects(saving,/proposal_missing/);assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),before.content);
 assert.equal(service.store.get('proposal:'+proposal.id).state,'cancelled');
});
test('approved editor save preserves readback and apply receipt',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'Update first line'}),before=await service.read({path:'app.txt'});
 const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:before.hash,content:'updated\n'});
 const saved=await service.saveSource({taskId:task.id,path:'app.txt',expectedHash:before.hash,content:proposal.content,proposalId:proposal.id});
 assert.equal(saved.hash,proposal.afterHash);assert.equal(service.newFileBusy,false);
 assert.equal((await service.confirmProposal({proposalId:proposal.id})).state,'applied');
});
