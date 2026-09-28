import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {runDocumentScript} from '../worker/script-runtime.mjs';
import fc from 'fast-check';
import {characterPage} from '../worker/workspace-read.mjs';

function fixture(){
  const controller=new AbortController(),metrics={};
  return{controller,metrics,workspace:createSkillWorkspace({host:'excel',signal:controller.signal,activity:createActivityLog(),metrics})};
}
async function readAll(workspace,path,options={}){
  let page=await workspace.execute('read',{path,...options}),text='',pages=0;
  const sha256=page.sha256;
  for(;;){
    assert.equal(page.error,undefined);assert.equal(page.sha256,sha256);
    assert.ok(Buffer.byteLength(page.content)<=12000);text+=page.content;pages++;
    if(!page.truncated)return{text,pages};
    assert.equal(page.readMode,'characters');assert.ok(pages<30);
    page=await workspace.execute('read',{path,charOffset:page.nextCharOffset,expectedSha256:sha256});
  }
}
test('large real calculation results remain exactly retrievable after context renewal',async()=>{
  const {workspace}=fixture();
  await workspace.execute('write',{path:'draft/calc.js',content:'function transform(){return Array.from({length:500},(_,i)=>({row:i,text:"성적표 📘",score:80}))}'});
  const result=await workspace.execute('run_script',{path:'draft/calc.js',input:'null'});
  assert.equal(result.executed,true);
  const pointer=JSON.parse(JSON.stringify(workspace.context())).lastScript;
  const read=await readAll(workspace,pointer.resultPath);
  assert.ok(read.pages>1);assert.deepEqual(JSON.parse(read.text),result.output);
});
test('chained calculation keeps input and output separate and binds the fresh receipt',async()=>{
  const {workspace}=fixture();
  await workspace.execute('write',{path:'draft/calc.js',content:'function transform(input){return {total:input.total+1}}'});
  let result=await workspace.execute('run_script',{path:'draft/calc.js',input:'{"total":40}'});
  for(let i=42;i<=46;i++){
    const inputPath=result.resultPath,before=(await workspace.execute('read',{path:inputPath})).content;
    result=await workspace.execute('run_script',{path:'draft/calc.js',inputPath});
    assert.equal(result.output.total,i);assert.notEqual(result.resultPath,inputPath);
    assert.equal((await workspace.execute('read',{path:inputPath})).content,before);
    assert.equal(workspace.context().lastScript.current,true);
  }
  assert.equal(workspace.context().files.filter(f=>f.path.startsWith('draft/')&&f.path.endsWith('.json')).length,2);
});
test('async jobs queued by an output getter are rejected without replacing the previous result',async()=>{
  const {workspace}=fixture();
  await workspace.execute('write',{path:'draft/calc.js',content:'function transform(){return 21}'});
  const before=await workspace.execute('run_script',{path:'draft/calc.js',input:'null'});
  await workspace.execute('write',{path:'draft/calc.js',content:'function transform(){return {get total(){Promise.resolve().then(()=>{});return 42}}}'});
  const result=await workspace.execute('run_script',{path:'draft/calc.js',input:'null'});
  assert.equal(result.error,'script_async_unsupported');
  assert.equal((await workspace.execute('read',{path:before.resultPath})).content,'21');
});
test('character continuation is Unicode exact and refuses changed or missing source versions',async()=>{
  const {workspace}=fixture(),path='draft/long.txt',content='📘성적\r\n'.repeat(4000);
  await workspace.execute('write',{path,content});
  const read=await readAll(workspace,path,{charOffset:0});assert.equal(read.text,content);
  const first=await workspace.execute('read',{path,charOffset:0});
  assert.equal((await workspace.execute('read',{path,charOffset:first.nextCharOffset})).error,'tool_arguments_invalid');
  await workspace.execute('write',{path,content:content+'changed'});
  assert.equal((await workspace.execute('read',{path,charOffset:first.nextCharOffset,expectedSha256:first.sha256})).error,'workspace_source_changed');
});
test('cancelled in-flight workspace execution preserves its previous accepted result',async()=>{
  const {workspace,controller,metrics}=fixture();
  await workspace.execute('write',{path:'draft/calc.js',content:'function transform(){return 42}'});
  await workspace.execute('run_script',{path:'draft/calc.js',input:'null'});
  await workspace.execute('write',{path:'draft/calc.js',content:'function transform(){while(true){}}'});
  const before=workspace.context(),pending=workspace.execute('run_script',{path:'draft/calc.js',input:'null'});
  const rejected=assert.rejects(pending,/cancelled/);controller.abort();await rejected;
  assert.deepEqual(workspace.context(),before);assert.equal(metrics.skillWorkspace.scriptRuns,1);
});
test('serializer cannot silently drop invalid data after prototype or JSON tampering',async()=>{
  for(const code of [
    'JSON.stringify=()=>"42";function transform(){return {amount:Infinity}}',
    'Array.prototype.toJSON=()=>42;function transform(){return [undefined]}',
    'Object.prototype.toJSON=()=>42;function transform(){return {amount:NaN}}'
  ])assert.equal((await runDocumentScript({code,input:null})).error,'script_output_invalid');
});
test('character pages preserve generated Unicode without gaps, replacement characters or byte overflow',()=>{
  fc.assert(fc.property(fc.array(fc.constantFrom('가','A','📘','𐐀','\r','\n','e\u0301','"','\\'),{maxLength:2000}),fc.integer({min:1,max:4000}),(parts,charLimit)=>{
    const text=parts.join('');let charOffset=0,actual='';
    for(;;){const page=characterPage(text,{charOffset,charLimit});assert.ok(Buffer.byteLength(page.content)<=12000);actual+=page.content;
      if(!page.truncated)break;assert.ok(page.nextCharOffset>charOffset);charOffset=page.nextCharOffset;}
    assert.equal(actual,text);
  }),{seed:2392302,numRuns:100});
});
test('character read arguments reject invalid boundaries and mixed paging modes',async()=>{
  const {workspace}=fixture();await workspace.execute('write',{path:'draft/note.txt',content:'text'});
  for(const args of [{charOffset:-1},{charOffset:0.1},{charOffset:'0'},{charLimit:0},{charLimit:null},{charOffset:0,limit:20},{charOffset:10,expectedSha256:'0'.repeat(64)},{charOffset:0,expectedSha256:'bad'}]){
    assert.ok((await workspace.execute('read',{path:'draft/note.txt',...args})).error,JSON.stringify(args));
  }
  const empty=await workspace.execute('write',{path:'draft/empty.txt',content:''});assert.equal(empty.error,undefined);
  const read=await workspace.execute('read',{path:'draft/empty.txt',charOffset:0});assert.equal(read.content,'');assert.equal(read.truncated,false);
});
test('a line read racing with a draft change rejects rather than labeling mixed data with a fresh hash',async()=>{
  const {workspace}=fixture(),path='draft/race.txt';let source='before';
  workspace.bindDraft(path,{read:()=>source,write:value=>{source=value;}});
  const pending=workspace.execute('read',{path});
  source='after';
  assert.equal((await pending).error,'workspace_source_changed');
  assert.equal((await workspace.execute('read',{path})).content,'after');
});
test('long-line fallback from a later line has an exact character cursor and stable observation progress',async()=>{
  const {workspace}=fixture(),path='draft/mixed.txt',prefix='머리말 📘\r\n',tail='성적📘'.repeat(6000);
  await workspace.execute('write',{path,content:prefix+tail});
  const page=await workspace.execute('read',{path,offset:2});
  assert.equal(page.readMode,'characters');assert.equal(page.charOffset,Array.from(prefix).length);
  assert.ok(tail.startsWith(page.content));
  const before=workspace.progress();await workspace.execute('read',{path,offset:2});assert.deepEqual(workspace.progress(),before);
});
