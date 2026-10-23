import test from 'node:test';import assert from 'node:assert/strict';
import {detachedQuestions} from '../ui/decided-questions.mjs';
test('answered questions missing from the transcript are listed once',()=>{
 const task={questionHistory:[{id:'a',text:'경로?',answer:{text:'src'}},{id:'b',text:'범위?',answer:{text:'전체'}}],messages:[{role:'assistant',questionId:'b'},{role:'user',content:'전체'}]};
 assert.deepEqual(detachedQuestions(task).map(q=>q.id),['a']);
});
// A silent-command question that resolved by itself (output, finished, restart) has no answer; listing it crashed
// the conversation screen on q.answer.text.
test('questions resolved without an answer are not listed',()=>{
 const task={questionHistory:[{id:'idle',text:'명령이 조용합니다',processIdle:{id:'p'},resolvedBy:'output'}],messages:[]};
 assert.deepEqual(detachedQuestions(task),[]);
 assert.deepEqual(detachedQuestions(null),[]);
});
