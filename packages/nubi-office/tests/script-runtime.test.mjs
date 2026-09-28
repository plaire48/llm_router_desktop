import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {runDocumentScript,SCRIPT_LIMITS} from '../worker/script-runtime.mjs';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {createToolProgressGuard} from '../worker/tool-progress.mjs';
const run=(code,input=null,signal)=>runDocumentScript({code,input,signal});
const fixture=()=>{const controller=new AbortController(),activity=createActivityLog(),metrics={},workspace=createSkillWorkspace({host:'excel',signal:controller.signal,activity,metrics});return{controller,activity,metrics,workspace};};
const calculate='function transform(input){return {code:input.code,total:input.scores.reduce((a,b)=>a+b,0),average:input.scores.reduce((a,b)=>a+b,0)/input.scores.length}}';

test('real WASM computes document data and preserves Korean text and zero-prefixed identifiers',async()=>{
  const result=await run(calculate,{code:'0000417 홍길동',scores:[91,87,95]});
  assert.deepEqual(result.output,{code:'0000417 홍길동',total:273,average:91});
  assert.equal(result.outputJson,'{"code":"0000417 홍길동","total":273,"average":91}');
});
test('WASM code has no host globals, module access, Office or constructor escape to Node',async()=>{
  const result=await run('function transform(){return [typeof process,typeof require,typeof fetch,typeof Buffer,typeof XMLHttpRequest,typeof Office,Function("return typeof process")()]}');
  assert.deepEqual(result.output,Array(7).fill('undefined'));
  assert.equal((await run('function transform(){return require("node:fs").readFileSync("/etc/passwd")}')).error,'script_failed');
  assert.ok((await run('import fs from "node:fs"; function transform(){return fs}')).error);
});
test('WASM globals never carry over to the next script execution',async()=>{
  assert.equal((await run('globalThis.secret="only this run";function transform(){return secret}')).output,'only this run');
  assert.equal((await run('function transform(){return typeof secret}')).output,'undefined');
});
test('invalid script entry, syntax, unsupported async and non-JSON values return actionable failure',async()=>{
  assert.equal((await run('const value=42;')).error,'script_entry_missing');
  assert.equal((await run('function transform( {')).error,'script_syntax_error');
  for(const body of ['undefined','NaN','Infinity','{amount:Infinity}','{missing:undefined}','(()=>42)','42n','Promise.resolve(42)','new Date()']){
    const result=await run(`function transform(){return ${body}}`);
    assert.ok(['script_output_invalid','script_async_unsupported'].includes(result.error),body+': '+JSON.stringify(result));
  }
  assert.equal((await run('function transform(){const v={};v.self=v;return v}')).error,'script_output_invalid');
});
test('infinite code and excess allocation are bounded; later healthy scripts still execute',async()=>{
  assert.equal((await run('function transform(){while(true){}}')).error,'script_timeout');
  const memory=await run('function transform(){return "x".repeat(100000000)}');
  assert.equal(memory.error,'script_memory_limit');
  assert.equal((await run('function transform(){return 42}')).output,42);
});
test('input, code and output limits reject rather than silently truncate',async()=>{
  await assert.rejects(run('function transform(){return 1}',{value:Infinity}),/script_input_invalid/);
  await assert.rejects(run('function transform(){return 1}','x'.repeat(SCRIPT_LIMITS.inputChars)),/script_input_limit/);
  await assert.rejects(run(' '.repeat(SCRIPT_LIMITS.codeChars+1)),/script_code_invalid/);
  assert.equal((await run('function transform(){return "x".repeat(24001)}')).error,'script_output_limit');
});
test('cancellation terminates the active worker and cannot return a late successful result',async()=>{
  const controller=new AbortController(),pending=run('function transform(){while(true){}}',null,controller.signal);
  const rejected=assert.rejects(pending,/cancelled/);setTimeout(()=>controller.abort(),20);await rejected;
  await assert.rejects(run('function transform(){return 1}',null,controller.signal),/cancelled/);
  assert.equal((await run('function transform(){return 2}')).output,2);
});
test('generated integer calculations agree with an independent host oracle',async()=>{
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({min:-1000,max:1000}),{minLength:1,maxLength:40}),async scores=>{
    const result=await run(calculate,{code:'0001',scores});assert.equal(result.output.total,scores.reduce((a,b)=>a+b,0));assert.equal(result.output.code,'0001');
  }),{numRuns:20,seed:2392301});
});
test('workspace executes exact JSON resources and keeps a source-bound result across context renewal',async()=>{
  const f=fixture();await f.workspace.execute('write',{path:'draft/calculate.js',content:calculate});
  await f.workspace.execute('write',{path:'draft/input.json',content:JSON.stringify({code:'001',scores:[80,100]})});
  const result=await f.workspace.execute('run_script',{path:'draft/calculate.js',inputPath:'draft/input.json'});
  assert.deepEqual(result.output,{code:'001',total:180,average:90});assert.equal(result.executed,true);
  assert.equal(result.scope,'run_memory_only');assert.equal(f.workspace.context().lastScript.outputSha256,result.outputSha256);
  assert.equal(JSON.parse((await f.workspace.execute('read',{path:result.resultPath})).content).average,90);
  assert.equal(f.metrics.skillWorkspace.scriptRuns,1);
  assert.ok(f.activity.snapshot().some(e=>e.tool==='run_script'&&e.state==='done'));
  assert.equal(f.workspace.context().lastScript.current,true);
  await f.workspace.execute('edit',{path:result.resultPath,edits:[{oldText:'180',newText:'999'}]});
  assert.equal(f.workspace.context().lastScript.current,false);
});
test('failed calculations preserve the accepted result and bound Office draft; edit and rerun recover',async()=>{
  const f=fixture();let sheet='{"name":"원본"}',writes=0;
  f.workspace.bindDraft('draft/sheet.json',{read:()=>sheet,write:v=>{sheet=v;writes++;}});
  await f.workspace.execute('write',{path:'draft/calculate.js',content:'function transform(input){return input.amount*2}'});
  const good=await f.workspace.execute('run_script',{path:'draft/calculate.js',input:'{"amount":21}'});
  await f.workspace.execute('edit',{path:'draft/calculate.js',edits:[{oldText:'input.amount*2',newText:'input.missing.value'}]});
  const failed=await f.workspace.execute('run_script',{path:'draft/calculate.js',input:'{"amount":21}'});
  assert.equal(failed.error,'script_failed');assert.equal(failed.errorName,'TypeError');
  assert.equal((await f.workspace.execute('read',{path:good.resultPath})).content,'42');
  await f.workspace.execute('edit',{path:'draft/calculate.js',edits:[{oldText:'input.missing.value',newText:'input.amount*3'}]});
  const fixed=await f.workspace.execute('run_script',{path:'draft/calculate.js',input:'{"amount":21}'});
  assert.equal(fixed.output,63);assert.notEqual(fixed.codeSha256,good.codeSha256);assert.equal(writes,0);assert.equal(sheet,'{"name":"원본"}');
});
test('script input boundaries and changed source reject ambiguous or stale execution',async()=>{
  const f=fixture();await f.workspace.execute('write',{path:'draft/calculate.js',content:'function transform(){return 1}'});
  for(const args of [{path:'../external.js',input:'null'},{path:'draft/code.py',input:'null'},{path:'draft/calculate.js',input:'null',inputPath:'draft/input.json'},{path:'draft/calculate.js',inputPath:'/etc/passwd'},{path:'draft/calculate.js',input:'{"x":1e400}'}]){
    assert.ok((await f.workspace.execute('run_script',args)).error);
  }
  const pending=f.workspace.execute('run_script',{path:'draft/calculate.js',input:'null'});
  await f.workspace.execute('edit',{path:'draft/calculate.js',edits:[{oldText:'return 1',newText:'return 2'}]});
  assert.equal((await pending).error,'script_source_changed');assert.equal(f.workspace.context().lastScript,null);
});
test('unchanged successful script repetition replans once then pauses without more execution',async()=>{
  const f=fixture();let pauses=0;const guard=createToolProgressGuard({signal:f.controller.signal,activity:f.activity,metrics:f.metrics,getProgress:f.workspace.progress,onStall:async()=>{pauses++;}});
  await f.workspace.execute('write',{path:'draft/calculate.js',content:'function transform(){return 42}'});
  for(let i=0;i<5;i++)await guard.run('run_script',{path:'draft/calculate.js',input:i%2?' null ':'null'},()=>f.workspace.execute('run_script',{path:'draft/calculate.js',input:'null'}));
  assert.equal(pauses,1);assert.equal(f.metrics.skillWorkspace.scriptRuns,3);
});
