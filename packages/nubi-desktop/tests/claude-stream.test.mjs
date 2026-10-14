import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeStream,partialContent} from '../runtime/claude-stream.mjs';
test('partial public content decodes Korean, escapes and split surrogate pairs',()=>{
 const json=JSON.stringify({content:'안녕하세요.\n"누비" 😀',calls:[]});let previous='';for(let i=0;i<=json.length;i++){const text=partialContent(json.slice(0,i));assert(json.includes('content'));assert('안녕하세요.\n"누비" 😀'.startsWith(text));if(text)previous=text;}assert.equal(previous,'안녕하세요.\n"누비" 😀');
 assert.equal(partialContent('{"calls":[{"arguments":"private content"}],"content":"답변'), '답변');
 assert.equal(partialContent('{"content":"a\\ud83d'), 'a');
});
test('stream ignores private thinking, CLI text and host action JSON',()=>{const shown=[],stream=claudeStream(text=>shown.push(text));const event=data=>stream({type:'stream_event',event:data});event({type:'content_block_start',index:0,content_block:{type:'thinking'}});event({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'private'}});event({type:'content_block_start',index:1,content_block:{type:'tool_use',name:'Bash'}});event({type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"content":"command"}'}});assert.deepEqual(shown,[]);event({type:'content_block_start',index:2,content_block:{type:'tool_use',name:'StructuredOutput'}});event({type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'{"content":"안녕'}});assert.equal(shown.at(-1),'안녕');event({type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'하세요","calls":[]}'}});assert.equal(shown.at(-1),'안녕하세요');});

// Thinking goes to the reasoning view only, never to the answer (user request 2026-10-14).
test('thinking deltas reach the reasoning callback and stay out of the answer',()=>{
  const shown=[],reasoning=[];const stream=claudeStream(text=>shown.push(text),text=>reasoning.push(text));
  const send=event=>stream({type:'stream_event',event});
  send({type:'message_start'});
  send({type:'content_block_start',index:0,content_block:{type:'thinking'}});
  send({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'파일을 '}});
  send({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'먼저 읽자'}});
  send({type:'content_block_start',index:1,content_block:{type:'tool_use',name:'StructuredOutput'}});
  send({type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"content":"답"'}});
  assert.deepEqual(reasoning,['파일을 ','파일을 먼저 읽자']);assert.deepEqual(shown,['답']);
});
