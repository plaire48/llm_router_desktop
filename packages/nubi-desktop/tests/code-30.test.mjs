// The code-30 coding set (opencode benchmark item 10, 2026-10-23): thirty edit, command and conversation cases. Every
// case added for the set carries a reference fix; this test proves its hidden check fails on the corpus as shipped,
// passes after the reference fix, and that the fix keeps the corpus's own tests green inside the allowed files.
import test from 'node:test';import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {removeLater} from './helpers-cleanup.mjs';
import {loadCases} from '../eval/cases.mjs';
import {CORPORA} from '../eval/corpus.mjs';
const exec=promisify(execFile);
const here=path.dirname(new URL(import.meta.url).pathname);
const ids=JSON.parse(await readFile(path.join(here,'..','eval','code-30','synthetic-cases.json'),'utf8'));
const references=JSON.parse(await readFile(path.join(here,'..','eval','code-30','synthetic-references.json'),'utf8'));
const cases=await loadCases({ids});
const OWN_TESTS={'order-service':['--test'],'cache-retry':['--test','test/boundaries.mjs']};
// A nested node --test inherits NODE_TEST_CONTEXT and would report to this runner instead of exiting with its result.
const {NODE_TEST_CONTEXT:_context,...childEnv}=process.env;
const passes=(cwd,args)=>exec(process.execPath,args,{cwd,timeout:60000,env:childEnv}).then(()=>true,()=>false);

test('code-30 is thirty distinct valid coding cases',()=>{
 assert.equal(ids.length,30);assert.equal(new Set(ids).size,30);assert.equal(cases.length,30);
 // loadCases rejects an invalid case file.
 for(const item of cases)assert.ok(['edit','command','conversation'].includes(item.suite),item.id);
 assert.ok(cases.filter(item=>item.split==='holdout').length>=8,'a holdout share remains for comparison');
 for(const id of Object.keys(references))assert.ok(ids.includes(id),id);
});

for(const [id,reference] of Object.entries(references))test(`${id}: hidden check fails as shipped and passes after the reference fix`,async()=>{
 const item=cases.find(row=>row.id===id);
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-code30-'));removeLater(root);
 await cp(CORPORA[item.corpus].source,root,{recursive:true});
 for(const [file,content] of Object.entries(item.expect.test.files))await writeFile(path.join(root,file),content);
 const hidden=item.expect.test.command.slice(1);
 assert.equal(await passes(root,hidden),false,'the hidden check must fail before the fix');
 const changed=new Set();
 for(const edit of reference.replace||[]){
  const file=path.join(root,edit.path),text=await readFile(file,'utf8');
  assert.equal(text.split(edit.find).length-1,1,`${edit.path}: the reference text occurs once`);
  await writeFile(file,text.replace(edit.find,()=>edit.replace));changed.add(edit.path);
 }
 for(const [file,content] of Object.entries(reference.write||{})){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),content);changed.add(file);}
 for(const file of changed)assert.ok(item.expect.unchanged_except.includes(file),`${file} is an allowed change`);
 assert.equal(await passes(root,hidden),true,'the hidden check passes after the fix');
 assert.equal(await passes(root,OWN_TESTS[item.corpus]),true,'the corpus tests stay green');
});
