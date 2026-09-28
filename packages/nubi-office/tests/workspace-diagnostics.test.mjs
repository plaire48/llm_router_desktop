import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
const setup=()=>{const controller=new AbortController(),metrics={},activity=createActivityLog();return{controller,metrics,activity,workspace:createSkillWorkspace({host:'excel',signal:controller.signal,activity,metrics})};};
test('script write reports syntax failure without pretending the committed draft was rejected',async()=>{
  const {workspace,metrics}=setup(),path='draft/calc.js',content='function transform(input) {\n return ( ;\n}';
  const result=await workspace.execute('write',{path,content});
  assert.equal(result.error,undefined);assert.equal(result.committed,true);
  assert.equal(result.diagnostics.status,'invalid');assert.equal(result.diagnostics.code,'script_syntax_error');
  assert.equal(result.diagnostics.executed,false);assert.equal(result.diagnostics.sha256,result.sha256);
  assert.equal(result.diagnostics.line,2);
  assert.equal((await workspace.execute('read',{path})).content,content);
  assert.equal(metrics.skillWorkspace.scriptRuns,0);
  assert.equal(workspace.context().diagnostics[0].status,'invalid');
  const fixed=await workspace.execute('edit',{path,edits:[{oldText:'return ( ;',newText:'return input.a+input.b;'}]});
  assert.equal(fixed.diagnostics.status,'valid');assert.equal(fixed.diagnostics.current,true);
  assert.equal(workspace.context().diagnostics[0].status,'valid');
  assert.equal((await workspace.execute('run_script',{path,input:'{"a":12,"b":30}'})).output,42);
});
test('diagnostics compile without running top-level code or checking business correctness',async()=>{
  const {workspace,metrics}=setup();
  for(const content of ['while(true){}','throw new Error("must not execute")','function transform(){return missing.value}','Promise.resolve().then(()=>{while(true){}})']){
    const result=await workspace.execute('write',{path:'draft/check.js',content});
    assert.equal(result.diagnostics.status,'valid');assert.equal(result.diagnostics.executed,false);
  }
  assert.equal(metrics.skillWorkspace.scriptRuns,0);assert.equal(workspace.context().lastScript,null);
});
test('JSON syntax diagnostics preserve invalid drafts, unsupported languages remain unverified',async()=>{
  const {workspace}=setup();
  const invalid=await workspace.execute('write',{path:'draft/data.json',content:'{"secret": "never echo",}'});
  assert.equal(invalid.diagnostics.status,'invalid');assert.equal(invalid.diagnostics.code,'json_syntax_error');
  assert.equal(JSON.stringify(invalid.diagnostics).includes('never echo'),false);
  const fixed=await workspace.execute('edit',{path:'draft/data.json',edits:[{oldText:',}',newText:'}'}]});
  assert.equal(fixed.diagnostics.status,'valid');
  const python=await workspace.execute('write',{path:'draft/calc.py',content:'def invalid('});
  assert.equal(python.diagnostics.status,'unsupported');assert.equal(python.diagnostics.executed,false);
});
test('changed bound drafts invalidate diagnostic evidence across context reconstruction',async()=>{
  const {workspace}=setup();let value='{}';
  workspace.bindDraft('draft/data.json',{read:()=>value,write:text=>{value=text;}});
  const checked=await workspace.execute('write',{path:'draft/data.json',content:'{"total":42}'});
  assert.equal(checked.diagnostics.current,true);value='{"total":';
  const context=JSON.parse(JSON.stringify(workspace.context()));
  assert.equal(context.diagnostics[0].current,false);assert.equal(context.diagnostics[0].sha256,checked.sha256);
});

test('late syntax diagnostics cannot replace the diagnostic for a newer committed edit',async()=>{
  const {workspace}=setup(),path='draft/race.js';
  const pending=workspace.execute('write',{path,content:'function transform( {'});
  for(let i=0;workspace.context().diagnostics[0]?.status!=='pending'&&i<100;i++)await new Promise(setImmediate);
  assert.equal(workspace.context().diagnostics[0]?.status,'pending');
  const next=await workspace.execute('write',{path,content:'function transform(){return 42}'}),old=await pending;
  assert.equal(next.diagnostics.status,'valid');assert.equal(old.diagnostics.current,false);
  assert.equal(workspace.context().diagnostics[0].sha256,next.sha256);
  assert.equal(workspace.context().diagnostics[0].status,'valid');
});
test('oversized JavaScript remains an unverified draft and cancellation never starts execution',async()=>{
  const {workspace,controller,metrics}=setup();
  const large=await workspace.execute('write',{path:'draft/large.js',content:'//'+ 'x'.repeat(32000)});
  assert.equal(large.committed,true);assert.equal(large.diagnostics.status,'unavailable');
  assert.equal(large.diagnostics.code,'script_code_invalid');
  const pending=workspace.execute('write',{path:'draft/cancel.js',content:'while(true){}'});
  for(let i=0;!workspace.context().diagnostics.some(d=>d.path==='draft/cancel.js'&&d.status==='pending')&&i<100;i++)await new Promise(setImmediate);
  const stopped=assert.rejects(pending,/cancelled/);controller.abort();await stopped;
  assert.equal(metrics.skillWorkspace.scriptRuns,0);assert.equal(workspace.context().lastScript,null);
  assert.equal(workspace.context().diagnostics.find(d=>d.path==='draft/cancel.js').status,'cancelled');
});
