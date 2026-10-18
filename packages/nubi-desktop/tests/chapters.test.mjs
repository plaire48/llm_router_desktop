import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addChapter,CHAPTER_LIMIT,CHAPTER_RUN_LIMIT} from '../runtime/chapters.mjs';
const task=()=>({id:'t1',messages:[{role:'user',content:'요청'},{role:'assistant',content:'답'}],chapters:[]});
test('a chapter records the host position, never a model-chosen one',()=>{
  const t=task();const row=addChapter(t,{title:'탐색',summary:'메일 모듈 구조 확인',runId:'r1',messageIndex:99});
  assert.equal(row.messageIndex,2);assert.equal(t.chapters.length,1);assert.match(row.at,/^\d{4}-/);
});
test('title and summary are bounded; the first request cannot be a chapter',()=>{
  assert.throws(()=>addChapter({id:'t',messages:[],chapters:[]},{title:'x',runId:'r'}),/chapter_invalid/);
  assert.throws(()=>addChapter(task(),{title:'a'.repeat(41),runId:'r'}),/chapter_invalid/);
  assert.throws(()=>addChapter(task(),{title:'ok',summary:'s'.repeat(201),runId:'r'}),/chapter_invalid/);
});
test('one run adds at most CHAPTER_RUN_LIMIT chapters; other runs keep theirs',()=>{
  const t=task();for(let i=0;i<CHAPTER_RUN_LIMIT;i++)addChapter(t,{title:'단계 '+i,runId:'r1'});
  assert.throws(()=>addChapter(t,{title:'넘침',runId:'r1'}),/chapter_limit/);
  addChapter(t,{title:'다음 실행',runId:'r2'});assert.equal(t.chapters.length,CHAPTER_RUN_LIMIT+1);
});
test('a conversation keeps at most CHAPTER_LIMIT chapters in total',()=>{
  const t=task();for(let i=0;i<CHAPTER_LIMIT;i++)addChapter(t,{title:'단계 '+i,runId:'r'+Math.floor(i/CHAPTER_RUN_LIMIT)});
  assert.throws(()=>addChapter(t,{title:'넘침',runId:'r99'}),/chapter_limit/);
});

import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
test('the agent persists a host-bound chapter while preserving previous conversation records',async t=>{
 const {service}=await fixture(t);const original=[{id:'previous-answer',role:'assistant',content:'이전 확인 결과',runId:'previous'}];
 const task=await service.createTask({request:'다음 단계로 이어서 확인해 주세요.'});
 service.store.set('task:'+task.id,{...service.task(task.id),messages:original,chapters:[{id:'old',title:'이전 단계',runId:'previous',messageIndex:0}]});
 let step=0,advertised=false;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},complete:async(messages,tools)=>{
  advertised ||= tools.some(row=>row.function.name==='mark_chapter');
  if(step++===0)return {content:'',calls:[{id:'chapter-call',type:'function',function:{name:'mark_chapter',arguments:JSON.stringify({title:'자료 탐색',summary:'현재 내용을 확인합니다.'})}},{id:'read-call',type:'function',function:{name:'read_source',arguments:'{"path":"app.txt"}'}}]};
  return {content:'확인한 기록을 유지합니다.',calls:[]};
 }};
 await service.startAgent({taskId:task.id});await service.agent.promise;
 const saved=service.task(task.id);assert.equal(advertised,true);assert.equal(saved.chapters.length,2,JSON.stringify(saved.trace));
 assert.equal(saved.chapters[0].id,'old');assert.equal(saved.chapters[1].messageIndex,1);assert.notEqual(saved.chapters[1].runId,'previous');
 assert.deepEqual(saved.messages[0],original[0]);assert(saved.trace.some(row=>row.tool==='read_source'&&row.status==='done'));
});

test('F12 chapter labels reject invisible-only titles and remove controls',()=>{
 const task={messages:[{role:'user',content:'request'}]};
 for(const title of ['\u200b\u200d\ufeff','\u0007\u001b\u009f',' \u202e \u2066 '])assert.throws(()=>addChapter(task,{title,runId:'r'}),/chapter_invalid/);
 const chapter=addChapter(task,{title:'\u0007작업 \u200b  정리\u202e',summary:'  주요\n내용\u009f ',runId:'r'});
 assert.equal(chapter.title,'작업 정리');assert.equal(chapter.summary,'주요 내용');
});

test('F12 a supplied invisible-only chapter summary is invalid but omitted summary stays optional',()=>{
 const t=task();assert.throws(()=>addChapter(t,{title:'요약',summary:'\u200b\u0007',runId:'r'}),/chapter_invalid/);
 assert.equal(addChapter(t,{title:'요약',runId:'r'}).summary,'');
});
