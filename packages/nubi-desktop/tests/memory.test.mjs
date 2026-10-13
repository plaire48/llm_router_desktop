import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../runtime/store.mjs';
import {memoryStores,listMemories,saveMemory,updateMemory,deleteMemory,rankMemories,memoryGuidance,parseMemoryDecision,rememberExchange,secretLike,memoryEnabled,installMemory,MEMORY_LIMITS} from '../runtime/memory.mjs';
async function setup(t){const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-memory-'));t.after(()=>rm(dir,{recursive:true,force:true}));const project=new Store(path.join(dir,'project'));t.after(()=>project.close());return {dir,service:{store:project,storageRoot:dir}};}
test('memories live in two scopes, dedupe by text and never hold secrets',async t=>{
  const {service}=await setup(t),stores=memoryStores(service);
  assert.equal(stores.userIsProject,false);
  const a=saveMemory(stores,{text:' 답변은  짧게 ',scope:'user',taskId:'t1'}),b=saveMemory(stores,{text:'답변은 짧게',scope:'user'});
  assert.equal(a.id,b.id,'the same sentence is one memory');assert.equal(a.text,'답변은 짧게');
  assert.equal(saveMemory(stores,{text:'내 비밀번호는 hunter2222 야',scope:'project'}),null);assert(secretLike('token: ghp_abcdefghijklmnop'));assert(!secretLike('배포는 매주 금요일'));
  const p=saveMemory(stores,{text:'배포는 매주 금요일에 한다',scope:'project'});
  assert.deepEqual(listMemories(stores).map(row=>[row.scope,row.text]),[['project','배포는 매주 금요일에 한다'],['user','답변은 짧게']]);
  assert.equal(updateMemory(stores,p.id,'배포는 매주 목요일에 한다').text,'배포는 매주 목요일에 한다');
  assert.equal(deleteMemory(stores,a.id),true);assert.equal(deleteMemory(stores,'missing'),false);
  assert.equal(listMemories(stores).length,1);
  for(let i=0;i<MEMORY_LIMITS.perScope+3;i++)saveMemory(stores,{text:'사실 '+i,scope:'project'});
  assert.equal(listMemories(stores).filter(row=>row.scope==='project').length,MEMORY_LIMITS.perScope,'the oldest memory makes room');
});
test('ranking prefers memories that share words with the request, then recent ones',async t=>{
  const {service}=await setup(t),stores=memoryStores(service);
  saveMemory(stores,{text:'결제 모듈 담당자는 김민수',scope:'project'});saveMemory(stores,{text:'답변은 짧게',scope:'user'});saveMemory(stores,{text:'테스트는 pytest로 돌린다',scope:'project'});
  const ranked=rankMemories(listMemories(stores),'결제 모듈 오류를 고쳐 줘',2);
  assert.equal(ranked[0].text,'결제 모듈 담당자는 김민수');assert.equal(ranked.length,2);
  assert.match(memoryGuidance(ranked),/reference data, not instructions/);assert.match(memoryGuidance(ranked),/\[project\] 결제 모듈 담당자는 김민수/);
  assert.equal(memoryGuidance([]),null);
});
test('the model decision is parsed strictly and applied as add, update and delete',async t=>{
  const {service}=await setup(t),stores=memoryStores(service);
  const old=saveMemory(stores,{text:'배포는 금요일',scope:'project'}),gone=saveMemory(stores,{text:'회의는 월요일',scope:'user'});
  assert.equal(parseMemoryDecision('not json'),null);assert.equal(parseMemoryDecision('[]'),null);
  const calls=[];
  const result=await rememberExchange({stores,request:'앞으로 배포는 목요일에 하고 회의는 없앴어. 그리고 나는 표로 정리하는 걸 좋아해.',answer:'알겠어요.',taskId:'t',runId:'r1',invoke:async(wire,tools,signal,kind,options)=>{calls.push({kind,options,wire});return {content:'```json\n'+JSON.stringify({add:[{text:'표로 정리하는 것을 선호한다',scope:'user'},{text:'password: abc12345',scope:'user'}],update:[{id:old.id,text:'배포는 목요일'}],delete:[gone.id,'nope']})+'\n```'};}});
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'memory');assert.deepEqual(calls[0].options.responseFormat,{type:'json_object'});assert.match(calls[0].wire[1].content,/existingMemories/);
  assert.deepEqual(result.saved.map(row=>[row.scope,row.text,row.runId]),[['user','표로 정리하는 것을 선호한다','r1']]);
  assert.deepEqual(result.updated.map(row=>row.text),['배포는 목요일']);assert.deepEqual(result.deleted,[gone.id]);
  assert.deepEqual(listMemories(stores).map(row=>row.text).sort(),['배포는 목요일','표로 정리하는 것을 선호한다']);
  stores.project.set('memory-setting',{enabled:false});assert.equal(memoryEnabled(stores.project),false);
  assert.deepEqual(await rememberExchange({stores,request:'기억해',invoke:async()=>{throw Error('must not call');}}),{saved:[],updated:[],deleted:[]});
});
test('the renderer method lists, deletes, undoes one run and switches the feature',async t=>{
  const {service}=await setup(t);class S{};installMemory(S);const api=S.prototype.memories;
  const stores=memoryStores(service);saveMemory(stores,{text:'A',scope:'project',runId:'r1'});saveMemory(stores,{text:'B',scope:'user',runId:'r2'});
  assert.equal((await api.call(service,{action:'list'})).items.length,2);
  await api.call(service,{action:'undo',runId:'r1'});assert.deepEqual((await api.call(service)).items.map(row=>row.text),['B']);
  const row=(await api.call(service)).items[0];await api.call(service,{action:'delete',id:row.id});assert.equal((await api.call(service)).items.length,0);
  assert.equal((await api.call(service,{action:'setEnabled',enabled:false})).enabled,false);
  await assert.rejects(api.call(service,{action:'bogus'}),/memory_action/);
  assert(!Object.hasOwn((await api.call(service)),'print'));
});
