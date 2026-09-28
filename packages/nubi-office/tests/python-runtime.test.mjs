import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPythonRuntime,pythonRequirements,pythonEnvironment,pythonProcess} from '../worker/python-runtime.mjs';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
async function fixture(t,options={}){
  const root=await mkdtemp(path.join(tmpdir(),'nubi-python-unit-')),uv=path.join(root,'uv');await writeFile(uv,'fixture');t.after(()=>rm(root,{recursive:true,force:true}));
  const calls=[],approvals=[];
  const processRun=async(binary,args,config)=>{
    calls.push({binary,args,config});
    if(args[0]==='venv'){const bin=path.join(args.at(-1),process.platform==='win32'?'Scripts':'bin');await mkdir(bin,{recursive:true});await writeFile(path.join(bin,process.platform==='win32'?'python.exe':'python'),'fixture');}
    if(args[1]==='compile')await writeFile(args[args.indexOf('--output-file')+1],'pkg==1.0 --hash=sha256:fixture');
    if(args.includes('-c'))return{code:0,stdout:config.input?JSON.stringify({outputJson:'42'}):JSON.stringify({version:[3,12],isolated:true})};
    return{code:0,stdout:''};
  };
  const approve=async p=>{approvals.push(p);return{approved:true};};
  return{root,uv,calls,approvals,options:{root,uv,processRun,approve,...options}};
}
test('Python requirements reject executable dependency sources, ranges and ambiguous duplicates',()=>{
  assert.deepEqual(pythonRequirements(['Jinja2==3.1.6','foo_bar==1.0']),['foo-bar==1.0','jinja2==3.1.6']);
  for(const value of [['--index-url=x'],['https://evil/package.whl'],['a>=1'],['a==1','A==2'],['x==1\n--extra-index-url=evil'],Array(13).fill('x==1'),{}])assert.throws(()=>pythonRequirements(value),/python_requirements_invalid/);
  const env=pythonEnvironment('/app',{PATH:'os',AIPRO_ACCESS_TOKEN:'secret',OPENAI_API_KEY:'secret',NODE_OPTIONS:'injected',UV_INDEX_URL:'evil',PYTHONPATH:'evil'});
  assert.equal(env.PATH,'os');for(const key of ['AIPRO_ACCESS_TOKEN','OPENAI_API_KEY','NODE_OPTIONS','UV_INDEX_URL','PYTHONPATH'])assert.equal(env[key],undefined);
});
test('install approval precedes all subprocesses; ready lock is reused and exact code needs fresh approval',async t=>{
  const f=await fixture(t),runtime=createPythonRuntime(f.options);
  const ready=await runtime.prepare(['Jinja2==3.1.6']);assert.equal(ready.ready,true);assert.equal(f.approvals[0].kind,'python_install');
  assert.ok(f.calls.find(c=>c.args.includes('--require-hashes')));assert.ok(f.calls.find(c=>c.args.includes('--only-binary')));
  const count=f.calls.length;await runtime.prepare(['jinja2==3.1.6']);assert.equal(f.calls.length,count);assert.equal(f.approvals.length,1);
  const result=await runtime.run({code:'def transform(input): return 42',input:{a:12,b:30}});assert.equal(result.output,42);
  assert.equal(f.approvals[1].kind,'python_execute');assert.equal(f.approvals[1].code,'def transform(input): return 42');assert.match(f.approvals[1].inputSha256,/^[a-f0-9]{64}$/);
  await runtime.run({code:'def transform(input): return 42',input:null});assert.equal(f.approvals.length,3);
  const metadata=path.join(f.root,'environments',ready.id,'requirements.lock');await writeFile(metadata,'changed');
  await assert.rejects(runtime.run({code:'def transform(input): return 42',input:null}),/python_environment_changed/);assert.equal(f.calls.length,count+2);
});
test('rejected setup and cancelled approval do not start an interpreter',async t=>{
  const f=await fixture(t,{approve:async()=>({approved:false})}),runtime=createPythonRuntime(f.options);
  await assert.rejects(runtime.prepare([]),/python_approval_denied/);assert.equal(f.calls.length,0);
  const controller=new AbortController();const cancelled=createPythonRuntime({...f.options,signal:controller.signal,approve:async()=>{controller.abort();return{approved:true};}});
  await assert.rejects(cancelled.prepare([]),/cancelled/);assert.equal(f.calls.length,0);
});
test('shared skill tool returns setup failure once and does not retry or fake progress',async t=>{
  let approvals=0;const f=await fixture(t),controller=new AbortController();
  const workspace=createSkillWorkspace({host:'excel',signal:controller.signal,activity:createActivityLog(),metrics:{},pythonOptions:f.options,approve:async()=>{approvals++;return{approved:false};}});
  const before=workspace.progress(),result=await workspace.execute('prepare_python',{requirements:[]});
  assert.equal(result.error,'python_approval_denied');assert.equal(approvals,1);assert.equal(f.calls.length,0);assert.deepEqual(workspace.progress(),before);
});
test('changed skill input during approval prevents execution and preserves prior results',async t=>{
  const f=await fixture(t);let mutate=false,workspace;
  workspace=createSkillWorkspace({host:'word',signal:new AbortController().signal,activity:createActivityLog(),metrics:{},pythonOptions:f.options,approve:async p=>{
    if(mutate&&p.kind==='python_execute')await workspace.execute('write',{path:'draft/input.json',content:'{"amount":43}'});return{approved:true};
  }});
  await workspace.execute('prepare_python',{requirements:[]});await workspace.execute('write',{path:'draft/run.py',content:'def transform(input): return 42'});await workspace.execute('write',{path:'draft/input.json',content:'{"amount":42}'});
  const first=await workspace.execute('run_script',{path:'draft/run.py',inputPath:'draft/input.json'});assert.equal(first.output,42);
  const count=f.calls.length;mutate=true;
  const rejected=await workspace.execute('run_script',{path:'draft/run.py',inputPath:'draft/input.json'});assert.equal(rejected.error,'script_source_changed');assert.equal(f.calls.length,count);
  assert.equal((await workspace.execute('read',{path:first.resultPath})).content,'42');assert.equal(workspace.context().lastScript.current,false);
});
test('real process runner bounds output, enforces deadline and cancels without late success',async()=>{
  const opts={env:pythonEnvironment(tmpdir()),cwd:tmpdir(),timeoutMs:5000};
  const utf8=await pythonProcess(process.execPath,['-e','process.stdout.write("한글 0001")'],opts);assert.equal(utf8.stdout,'한글 0001');
  await assert.rejects(pythonProcess(process.execPath,['-e','setInterval(()=>{},100)'],{...opts,timeoutMs:80}),/python_timeout/);
  await assert.rejects(pythonProcess(process.execPath,['-e','process.stdout.write("a".repeat(200000))'],{...opts,maxBytes:100}),/python_output_limit/);
  const controller=new AbortController(),pending=pythonProcess(process.execPath,['-e','setInterval(()=>{},100)'],{...opts,signal:controller.signal});const rejected=assert.rejects(pending,/cancelled/);setTimeout(()=>controller.abort(),80);await rejected;
});
