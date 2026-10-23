import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceObservations,replaceObserved,preserveSourceFormat} from '../runtime/source-edits.mjs';
import {hash} from '../runtime/files.mjs';
const source=content=>({path:'src/app.ts',content,hash:hash(content),lines:content.split('\n').length});
function edit(file,oldText,newText,range=[1,file.lines]){const observations=new SourceObservations();observations.observe({...file,start:range[0],end:range[1]});return replaceObserved(file,file.hash,[{oldText,newText}],observations,{matching:'opencode'});}
test('original OpenCode whitespace matching handles observed Windows CRLF and retains line endings',()=>{
 const file=source('\uFEFFexport function value() {\r\n    return 1;\r\n}\r\nexport const keep=7;\r\n');
 assert.equal(edit(file,'export function value() {\n  return 1;\n}','export function value() {\n    return 2;\n}'),'\uFEFFexport function value() {\r\n    return 2;\r\n}\r\nexport const keep=7;\r\n');
});
test('fallback matching cannot choose between two whitespace variants or edit unread lines',()=>{
 const repeated=source('function a() {\n return 1;\n}\nfunction a() {\n    return 1;\n}\n');
 assert.throws(()=>edit(repeated,'function a() {\n  return 1;\n}','function a() {\n return 2;\n}'),/edit_text_ambiguous/);
 const file=source('export function a() {\n    return 1;\n}\n');assert.throws(()=>edit(file,'export function a() {\n return 1;\n}','export function a() {\n return 2;\n}',[1,1]),/source_read_required/);
});
test('semantic anchor guessing is rejected and the previous exact mode remains exact',()=>{
 const file=source('function a() {\n const token="current";\n return 1;\n}\n');
 assert.throws(()=>edit(file,'function a() {\n const token="old";\n return 1;\n}','function a() {\n return 2;\n}'),/edit_text_missing/);
 const observations=new SourceObservations();observations.observe({...file,start:1,end:file.lines});assert.throws(()=>replaceObserved(file,file.hash,[{oldText:'function a() {\n  const token="current";\n  return 1;\n}',newText:'updated'}],observations),/edit_text_missing/);
});
test('fallback matching does not erase meaningful whitespace inside string literals',()=>{
 const file=source('export const label = "a  b";\n');
 assert.throws(()=>edit(file,'export const label = "a b";','export const label = "new";'),/edit_text_missing/);
});
test('whole-file model drafts retain the observed BOM and Windows line endings',()=>{
 const before='\uFEFFexport const value=1;\r\n';
 assert.equal(preserveSourceFormat(before,'export const value=2;\n'),'\uFEFFexport const value=2;\r\n');
 assert.equal(preserveSourceFormat(before,'export const value=2;\r\n',{lineEndings:'lf'}),'\uFEFFexport const value=2;\n');
 assert.equal(preserveSourceFormat('const value=1;\n','const value=2;\n'),'const value=2;\n');
});
