import test from 'node:test';import assert from 'node:assert/strict';
import {replaceObserved,SourceObservations} from '../runtime/source-edits.mjs';
import {hash} from '../runtime/files.mjs';
// Edit matching adopted from opencode (MIT, packages/core/src/tool/plugin/edit.ts): exact, then typographic punctuation and
// spaces normalized, then line by line ignoring trailing whitespace, all on the LF view so CRLF files keep their endings.
const file=(content,path='src/a.js')=>({path,content,hash:hash(content),lines:content.split('\n').length});
function edit(content,edits){const f=file(content),seen=new SourceObservations();seen.observe({...f,start:1,end:f.lines});return replaceObserved(f,f.hash,edits,seen);}
test('a CRLF file matches LF text and keeps its CRLF endings',()=>{
 assert.equal(edit('a\r\nb\r\nc\r\n',[{oldText:'b\nc\n',newText:'B\nC\nD\n'}]),'a\r\nB\r\nC\r\nD\r\n');
});
test('typographic quotes, dashes and special spaces match their plain forms',()=>{
 assert.equal(edit('const s = “hi” – ok;\n',[{oldText:'const s = "hi" - ok;',newText:'const s = "bye";'}]),'const s = "bye";\n');
});
test('trailing whitespace on the source lines does not block a match',()=>{
 assert.equal(edit('x = 1;   \ny = 2;\t\nz = 3;\n',[{oldText:'x = 1;\ny = 2;\n',newText:'x = 10;\ny = 20;\n'}]),'x = 10;\ny = 20;\nz = 3;\n');
});
test('replaceAll changes every occurrence; without it an ambiguous match reports the count and lines',()=>{
 assert.equal(edit('a();\nb();\na();\n',[{oldText:'a();',newText:'c();',replaceAll:true}]),'c();\nb();\nc();\n');
 assert.throws(()=>edit('a();\nb();\na();\n',[{oldText:'a();',newText:'c();'}]),error=>error.message==='edit_text_ambiguous'&&error.details.matches===2&&JSON.stringify(error.details.lines)==='[1,3]');
});
test('a missing text reports the closest line of the read range',()=>{
 assert.throws(()=>edit('function total(items) {\n  return items.length;\n}\n',[{oldText:'  return item.length;',newText:'  return 0;'}]),error=>error.message==='edit_text_missing'&&error.details.closest.line===2&&error.details.closest.text==='  return items.length;');
});
test('the read-range and stale-hash guards still apply to tolerant matches',()=>{
 const f=file('a\r\nb\r\nc\r\n'),seen=new SourceObservations();seen.observe({...f,start:1,end:1});
 assert.throws(()=>replaceObserved(f,f.hash,[{oldText:'c\n',newText:'C\n'}],seen),/source_read_required/);
 assert.throws(()=>replaceObserved(f,'stale',[{oldText:'a\n',newText:'A\n'}],seen),/source_stale/);
});
test('argument normalization keeps replaceAll and its snake_case alias',async()=>{
 const {normalizeProposalArgs}=await import('../runtime/proposal-args.mjs');
 const out=normalizeProposalArgs('propose_patch',{path:'a.js',expectedHash:'h',edits:[{oldText:'a',newText:'b',replaceAll:true},{old_text:'c',new_text:'d',replace_all:true}]});
 assert.deepEqual(out.edits.map(edit=>edit.replaceAll),[true,true]);
});
