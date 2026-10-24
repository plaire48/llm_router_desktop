import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../runtime/store.mjs';
import {memoryStores,listMemories,saveMemory,updateMemory,deleteMemory,rankMemories,memoryGuidance,parseMemoryDecision,rememberExchange,secretLike,memoryEnabled,installMemory,MEMORY_LIMITS,closeUserMemoryStore,memoryReference,validateMemoryReferences} from '../runtime/memory.mjs';
async function setup(t){const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-memory-'));const project=new Store(path.join(dir,'project'));t.after(async()=>{project.close();closeUserMemoryStore(dir);await rm(dir,{recursive:true,force:true,maxRetries:5});});return {dir,service:{store:project,storageRoot:dir}};}
test('memories live in two scopes, dedupe by text and never hold secrets',async t=>{
  const {service}=await setup(t),stores=memoryStores(service);
  assert.equal(stores.userIsProject,false);
  const a=saveMemory(stores,{text:' 답변은  짧게 ',scope:'user',taskId:'t1'}),b=saveMemory(stores,{text:'답변은 짧게',scope:'user'});
  assert.equal(a.id,b.id,'the same sentence is one memory');assert.equal(a.text,'답변은 짧게');
  assert.equal(saveMemory(stores,{text:'내 비밀번호는 hunter2222 야',scope:'project'}),null);assert(secretLike('token: ghp_abcdefghijklmnop'));assert(!secretLike('배포는 매주 금요일'));
  const p=saveMemory(stores,{text:'배포는 매주 금요일에 한다',scope:'project'});
  assert.deepEqual(listMemories(stores).map(row=>[row.scope,row.text]).sort(),[['project','배포는 매주 금요일에 한다'],['user','답변은 짧게']]);
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

test('F15 memory and export share Korean access-key and provider-key detection',()=>{
 for(const value of ['DB 비밀번호는 Qwerty!234','접속키는 '+'AKIA'+'X'.repeat(16),'sk-'+'x'.repeat(24),'ghp_'+'x'.repeat(32)])assert.equal(secretLike(value),true);
 assert.equal(secretLike('결과 보고서를 작성합니다'),false);
});

test('a pending extraction cannot overwrite a manual edit or save after being disabled',async t=>{
 const {service}=await setup(t),stores=memoryStores(service),old=saveMemory(stores,{text:'배포는 금요일',scope:'project'});let release;
 const pending=rememberExchange({stores,request:'배포는 목요일',runId:'race',invoke:()=>new Promise(resolve=>{release=()=>resolve({content:JSON.stringify({add:[{text:'추가 사실'}],update:[{id:old.id,text:'배포는 목요일'}],delete:[]})});})});
 updateMemory(stores,old.id,'사용자가 직접 정한 배포는 수요일');release();await pending;
 assert.equal(listMemories(stores).find(row=>row.id===old.id).text,'사용자가 직접 정한 배포는 수요일');assert.equal(listMemories(stores).length,1);
 let finish;const disabled=rememberExchange({stores,request:'새로운 선호',invoke:()=>new Promise(resolve=>{finish=()=>resolve({content:'{"add":[{"text":"저장하면 안 되는 선호"}]}'});})});
 stores.project.set('memory-setting',{enabled:false});finish();await disabled;assert.equal(listMemories(stores).length,1);
});

test('extraction receives the bounded full user request and no assistant facts',async t=>{
 const {service}=await setup(t),stores=memoryStores(service),request='설명 '.repeat(120)+'앞으로 답변은 한국어로 해 주세요.';
 await rememberExchange({stores,request,answer:'Assistant-only invented preference',invoke:async wire=>{
  const input=JSON.parse(wire[1].content);assert.equal(input.person,request);assert.equal(Object.hasOwn(input,'assistantAnswer'),false);return {content:'{}'};
 }});
 assert.equal(saveMemory(stores,{text:'평범한 설명 '.repeat(80)+' 비밀번호는 hunter2222'}),null,'check secrets before any truncation');
});

test('the model cannot update or delete memory IDs omitted from its candidate set',async t=>{
 const {service}=await setup(t),stores=memoryStores(service);for(let i=0;i<70;i++)saveMemory(stores,{text:'서로 다른 사실 '+i});let unobserved;
 await rememberExchange({stores,request:'사실을 확인합니다',invoke:async wire=>{
  const shown=new Set(JSON.parse(wire[1].content).existingMemories.map(row=>row.id));unobserved=listMemories(stores).find(row=>!shown.has(row.id));assert(unobserved);
  return {content:JSON.stringify({update:[{id:unobserved.id,text:'덮어쓰면 안 됨'}],delete:[unobserved.id]})};
 }});assert.equal(listMemories(stores).find(row=>row.id===unobserved.id).text,unobserved.text);
});

test('manual memory changes survive undo of an older extraction',async t=>{
 const {service}=await setup(t);class S{};installMemory(S);const api=S.prototype.memories,stores=memoryStores(service),row=saveMemory(stores,{text:'자동 저장한 선호',runId:'old-run'});
 updateMemory(stores,row.id,'직접 수정한 최신 선호');await api.call(service,{action:'undo',runId:'old-run'});
 assert.equal(listMemories(stores).find(item=>item.id===row.id).text,'직접 수정한 최신 선호');
});

test('the management API pages, searches and edits with a stale-version check',async t=>{
 const {service}=await setup(t);class S{};installMemory(S);const api=S.prototype.memories,stores=memoryStores(service);
 for(let i=0;i<23;i++)saveMemory(stores,{text:'페이지 확인 '+i});
 const first=await api.call(service,{action:'list',page:1,pageSize:10});assert.equal(first.items.length,10);assert.equal(first.total,23);assert.equal(first.pages,3);
 const last=await api.call(service,{action:'list',page:3,pageSize:10});assert.equal(last.items.length,3);assert(!first.items.some(row=>last.items.some(item=>item.id===row.id)));
 const row=last.items[0],edited=await api.call(service,{action:'update',id:row.id,sourceHash:row.sourceHash,text:'사용자가 고친 기억',page:3});
 assert.equal((await api.call(service,{action:'list',query:'사용자가 고친',page:1})).total,1);
 await assert.rejects(api.call(service,{action:'update',id:row.id,sourceHash:row.sourceHash,text:'오래된 폼'}),/memory_changed/);
 await assert.rejects(api.call(service,{action:'delete',id:row.id,sourceHash:row.sourceHash}),/memory_changed/);assert.equal(edited.total,23);
  for(const item of last.items)await api.call(service,{action:'delete',id:item.id});
  const clamped=await api.call(service,{action:'list',page:3});assert.equal(clamped.total,20);assert.equal(clamped.pages,2);assert.equal(clamped.page,2);assert.equal(clamped.items.length,10);
});

test('settings without a project list the existing user-scope memories',async t=>{
 const {dir,service}=await setup(t);saveMemory(memoryStores(service),{text:'모든 프로젝트에서 쓰는 선호',scope:'user'});
 class S{};installMemory(S);const data=await S.prototype.memories.call({storageRoot:dir},{action:'list',page:1});
 assert.equal(data.items.length,1);assert.equal(data.items[0].scope,'user');
});

test('undo restores updates, deletes and capacity eviction together, without crossing a later edit',async t=>{
 const {service}=await setup(t);class S{};installMemory(S);const api=S.prototype.memories,stores=memoryStores(service);
 for(let i=0;i<MEMORY_LIMITS.perScope;i++)saveMemory(stores,{text:'보존할 사실 '+i});
 const before=listMemories(stores),old=before[0],gone=before[1];
 await rememberExchange({stores,request:'선호를 변경합니다',taskId:'task',runId:'undo-complete',invoke:async()=>({content:JSON.stringify({add:[{text:'새로 저장한 사실'}],update:[{id:old.id,text:'자동으로 바뀐 사실'}],delete:[gone.id]})})});
 const changed=listMemories(stores).find(row=>row.id===old.id);assert(changed);
 await api.call(service,{action:'update',id:old.id,sourceHash:memoryReference(changed).sourceHash,text:'사용자가 나중에 수정한 사실'});
 const current=listMemories(stores);await assert.rejects(api.call(service,{action:'undo',runId:'undo-complete',taskId:'task'}),/memory_changed/);assert.deepEqual(listMemories(stores),current,'undo is all or nothing');
 // A separate untouched run exercises the complete restoration, including an evicted row.
 const stores2={...stores,project:stores.user,user:stores.user,userIsProject:true};
 for(let i=0;i<MEMORY_LIMITS.perScope;i++)saveMemory(stores2,{text:'다른 보존 사실 '+i});
 const original=listMemories(stores2),legacy=original[0];delete legacy.scope;stores2.project.set('memory:'+legacy.id,legacy);
 await rememberExchange({stores:stores2,request:'선호 변경',taskId:'task2',runId:'undo-second',invoke:async()=>({content:JSON.stringify({add:[{text:'추가된 사실'}],update:[{id:original[0].id,text:'수정된 사실'}],delete:[original[1].id]})})});
 await api.call({store:stores2.project},{action:'undo',runId:'undo-second',taskId:'task2'});
 assert.deepEqual(listMemories(stores2).map(row=>[row.id,row.text]).sort(),original.map(row=>[row.id,row.text]).sort());
});

test('raw model secrets are rejected before truncation and reference lookups stay in scope',async t=>{
 const {service}=await setup(t),stores=memoryStores(service);
 const secret='일반적인 설명 '.repeat(80)+' password: superSecret123';
 assert.equal(parseMemoryDecision(JSON.stringify({add:[{text:secret}],update:[{id:'known',text:secret}]})).add.length,0);
 assert.equal(parseMemoryDecision(JSON.stringify({update:[{id:'known',text:secret}]})).update.length,0);
 const row=saveMemory(stores,{text:'현재 프로젝트 기억'}),ref=memoryReference(row);
 assert.throws(()=>validateMemoryReferences({storageRoot:service.storageRoot},[ref]),/memory_missing/);
 assert.equal(validateMemoryReferences(service,[{...ref,text:'변조된 클라이언트 입력'}])[0].text,row.text);
 class S{};installMemory(S);await assert.rejects(S.prototype.memories.call(service,{action:'update',id:row.id,text:'비정상',scope:'unknown'}),/memory_scope/);
});

test('switching memory off then back on still invalidates a pending extraction',async t=>{
 const {service}=await setup(t),stores=memoryStores(service);class S{};installMemory(S);let release;
 const pending=rememberExchange({stores,request:'오래된 추출 요청',invoke:()=>new Promise(resolve=>{release=()=>resolve({content:'{"add":[{"text":"취소한 자동 저장"}]}'});})});
 await S.prototype.memories.call(service,{action:'setEnabled',enabled:false});await S.prototype.memories.call(service,{action:'setEnabled',enabled:true});release();assert.equal((await pending).saved.length,0);
});

test('a single-store scope fallback never claims a duplicate as a new automatic save',async t=>{
 const {service}=await setup(t),stores={project:service.store,user:service.store,userIsProject:true},row=saveMemory(stores,{text:'이미 저장한 선호',scope:'user'});
 const result=await rememberExchange({stores,request:'이미 저장한 선호',runId:'duplicate',invoke:async()=>({content:'{"add":[{"text":"이미 저장한 선호","scope":"user"}]}'} )});
 assert.equal(result.saved.length,0);assert.equal(listMemories(stores).length,1);assert.equal(listMemories(stores)[0].id,row.id);assert.equal(service.store.get('memory-run:duplicate'),null);
});
