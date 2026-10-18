import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationMarkdown,conversationFilename} from '../runtime/conversation-export.mjs';
import {fixture} from './fixtures.mjs';

test('export preserves request, chapter positions, per-run tools and answers without raw mail or secret arguments',()=>{
 const task={request:'메일 모듈 점검',createdAt:'2026-10-16T01:00:00Z',chapters:[{title:'탐색',messageIndex:1},{title:'후속',messageIndex:3}],messages:[{role:'user',content:'메일 모듈 점검'},{role:'assistant',content:'결과 요약',runId:'r'},{role:'user',content:'추가 요청'},{role:'assistant',content:'후속 답',runId:'s'}],trace:[{runId:'r',tool:'read_source',args:{path:'src/mail.mjs'},status:'done'},{runId:'r',tool:'propose_setup_action',arguments:{text:JSON.stringify({script:'npm test',token:'secret-x'})},status:'done'},{runId:'s',tool:'wiki_query',args:{query:'후속 확인',body:'RAW BODY'}}],mailReferences:[{id:'m1',title:'계약 검토',body:'원문 본문',html:'RAW HTML'}]};
 const before=JSON.stringify(task),md=conversationMarkdown(task);
 assert.match(md,/^# 메일 모듈 점검/);assert.match(md,/2026-10-16T01:00:00Z/);assert.match(md,/<details>/);assert.match(md,/read_source src\/mail.mjs/);assert.match(md,/npm test/);assert.match(md,/계약 검토.*m1/);
 for(const value of ['secret-x','원문 본문','RAW BODY','RAW HTML'])assert(!md.includes(value));
 let at=-1;for(const part of ['## 요청','## 탐색','read_source','## 답','결과 요약','추가 요청','## 후속','wiki_query','후속 답']){const next=md.indexOf(part,at+1);assert(next>at,part);at=next;}
 assert.equal((md.match(/read_source/g)||[]).length,1);assert.equal(JSON.stringify(task),before);
});
test('real saved tasks with no initial user message retain request, final chapters and unfinished trace',()=>{
 const md=conversationMarkdown({request:'첫 요청',messages:[{role:'assistant',runId:'a',content:'답변'},{role:'user',content:'후속'}],chapters:[{title:'시작',messageIndex:0},{title:'대기',messageIndex:2}],trace:[{runId:'a',tool:'read_source',status:'done'},{runId:'b',tool:'source_search',status:'running'}]});
 assert(md.indexOf('## 요청')<md.indexOf('## 시작'));assert(md.indexOf('## 시작')<md.indexOf('답변'));assert(md.indexOf('## 대기')>md.indexOf('후속'));assert.match(md,/source_search/);
});
test('credential-bearing command and query text is withheld while ordinary commands and Markdown are preserved',()=>{
 const md=conversationMarkdown({request:'인증 확인',messages:[{role:'assistant',content:'**요약**\n확인했어요.'}],trace:[{tool:'propose_setup_action',args:{script:'curl -H "Authorization: Bearer private-bearer" https://example.test'}},{tool:'read_source',args:{path:'https://u:private-pass@example.test/a?token=private-query'}},{tool:'source_search',args:{query:'api_key=private-key'}},{tool:'propose_setup_action',arguments:{text:'{invalid'}}]});
 for(const value of ['private-bearer','private-pass','private-query','private-key','{invalid'])assert(!md.includes(value));assert.match(md,/\*\*요약\*\*/);assert.match(md,/숨김/);
 assert(!/[\\/:*?"<>|\r\n]/.test(conversationFilename({request:'../bad:\n<name>',id:'a'})));assert.match(conversationFilename({request:''}),/\.md$/);
});
test('service exports an immutable task snapshot through the allowed method and rejects missing tasks',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'프로젝트 내보내기'});const before=service.task(task.id);
 const out=await service.invoke('exportConversation',{taskId:task.id});assert.match(out.filename,/\.md$/);assert.match(out.markdown,/프로젝트 내보내기/);assert.deepEqual(service.task(task.id),before);
 await assert.rejects(service.invoke('exportConversation',{taskId:'missing'}),/task_missing/);
});

test('Basic command credentials and multiline private keys are withheld in every exported field',()=>{
 const samples=['curl -u demo:demo-private-value https://example.test','curl --user="demo:long-private-value" https://example.test','-----BEGIN RSA PRIVATE KEY-----\nZmFrZS1wcml2YXRlLWtleS1ib2R5\n-----END RSA PRIVATE KEY-----'];
 for(const secret of samples){
  const task={request:secret,messages:[{role:'user',content:secret},{role:'assistant',content:'유지할 안내\n'+secret+'\n다음 단계'}],chapters:[{title:secret,messageIndex:0}],trace:[{tool:'propose_setup_action',args:{script:secret,path:secret,query:secret,title:secret}}],mailReferences:[{id:secret,title:secret}]},before=JSON.stringify(task);
  const md=conversationMarkdown(task),filename=conversationFilename(task);
  for(const value of ['demo-private-value','long-private-value','ZmFrZS1wcml2YXRlLWtleS1ib2R5']){assert(!md.includes(value));assert(!filename.includes(value));}
  assert.match(md,/유지할 안내/);assert.match(md,/다음 단계/);assert.match(md,/숨김/);assert.equal(JSON.stringify(task),before);
 }
});

test('F14 exports identify the agent suggestion while later human requests remain human',()=>{
 for(const messages of [[{role:'user',content:'제안 요청'}],[]]){
  const task={request:'제안 요청',origin:{kind:'side_task'},messages:[...messages,{role:'assistant',content:'첫 답'},{role:'user',content:'사람의 후속 요청'}]};
  const md=conversationMarkdown(task);assert.match(md,/## 요청 \(에이전트 제안\)\n\n제안 요청/);assert.match(md,/## 요청\n\n사람의 후속 요청/);
  assert.match(conversationFilename(task),/^누비-에이전트 제안-/);
 }
});

test('F15 export uses the memory secret detector in every text field without altering the record',()=>{
 for(const secret of ['DB 비밀번호는 Qwerty!234','접속키는 AKIAEXAMPLE1234567890','sk-abcdefghijklmnop1234','ghp_abcdefghijklmnop1234']){
  const task={request:secret,messages:[{role:'assistant',content:'유지할 안내\n'+secret+'\n다음 단계'}],chapters:[{title:secret,messageIndex:0}],trace:[{tool:'source_search',args:{query:secret}}],mailReferences:[{id:secret,title:secret}]},before=JSON.stringify(task);
  const md=conversationMarkdown(task),filename=conversationFilename(task);
  assert(!md.includes(secret));assert(!filename.includes(secret));assert.match(md,/숨김/);assert.match(md,/유지할 안내/);assert.match(md,/다음 단계/);assert.equal(JSON.stringify(task),before);
 }
});
