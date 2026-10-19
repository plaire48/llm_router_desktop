import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerminalProjection} from '../ui/terminal-output-projection.mjs';
import {terminalTextChunks} from '../ui/terminal-output-projection.mjs';
import {terminalReadableText} from '../runtime/terminal-readable-text.mjs';
test('appended terminal output reparses incomplete line and preserves every escape-prefix contract',()=>{
 const project=createTerminalProjection();const raw='앞\r\n\u001b[31m오류\u001b[0m\n\u001b]8;;https://example.invalid\u001b\\문서\nA😀\b✓\n끝';
 for(let i=0;i<=raw.length;i++)assert.equal(project(raw.slice(0,i)),terminalReadableText(raw.slice(0,i)),String(i));
 assert.equal(project('완전히 새 출력\n끝'),'완전히 새 출력\n끝');assert.equal(project(''),'');
});
test('streaming projection reuses complete lines while edits invalidate retained prefixes',()=>{
 const parsed=[],project=createTerminalProjection(text=>{parsed.push(text.length);return terminalReadableText(text);});
 const prefix='완료\n'.repeat(5000);assert.equal(project(prefix),prefix);parsed.length=0;
 assert.equal(project(prefix+'다음\n'),prefix+'다음\n');assert.ok(Math.max(...parsed)<20,'only the appended complete line is parsed');
 assert.equal(project('수정\n'+prefix),'수정\n'+prefix);
});
test('output chunks preserve selection and copy text including blank lines and the unfinished final line',()=>{
 const raw=Array.from({length:5000},(_,i)=>i%7===0?'':String(i)).join('\n')+'\n끝';const chunks=terminalTextChunks(raw);
 assert.equal(chunks.join(''),raw);assert.ok(chunks.length>=100);assert.ok(chunks.every(chunk=>(chunk.match(/\n/g)||[]).length<=50));assert.deepEqual(terminalTextChunks(''),[]);
});
