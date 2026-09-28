// Real managed CPython and PyPI wheels. No live model or Office COM evidence.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPythonRuntime} from '../worker/python-runtime.mjs';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
const root=await mkdtemp(path.join(tmpdir(),'nubi-python-real-'));
// Test entry point only. Production runtime has no environment/path override.
const uv=process.env.NUBI_TEST_UV||path.resolve(`dist/runtime/uv/${process.arch}/uv.exe`),options={root,uv},approvals=[];
const approve=async p=>{approvals.push(p.kind);return{approved:true};};
const checks={hosts:[],installation:false,failedCodeRepair:false,sourceDrift:false,timeout:false,cancellation:false,finiteOutput:false,credentialsExcluded:false,windowsJobLimits:false};
try{
  for(const host of ['excel','word','powerpoint']){
    const workspace=createSkillWorkspace({host,signal:new AbortController().signal,activity:createActivityLog(),metrics:{},approve,pythonOptions:options});
    await workspace.execute('read',{path:`skills/${host}-2016/SKILL.md`});
    const prepared=await workspace.execute('prepare_python',{requirementsPath:`skills/${host}-2016/references/python-requirements.json`});assert.equal(prepared.ready,true,JSON.stringify(prepared));checks.installation=true;
    await workspace.execute('write',{path:'draft/input.json',content:JSON.stringify({title:'수능 0001',rows:[{amount:12},{amount:30}]})});
    const report=await workspace.execute('run_script',{path:`skills/${host}-2016/scripts/report.py`,inputPath:'draft/input.json'});
    assert.equal(report.executed,true,JSON.stringify(report));assert.equal(report.engine,'local-cpython');assert.deepEqual(report.output,{title:'수능 0001 보고서',rows:[{amount:12},{amount:30}],total:42});
    assert.equal(JSON.parse((await workspace.execute('read',{path:report.resultPath})).content).total,42);assert.equal(workspace.context().lastScript.current,true);
    checks.hosts.push(host);
  }
  assert.equal(approvals.filter(v=>v==='python_install').length,1);assert.equal(approvals.filter(v=>v==='python_execute').length,3);
  const runtime=createPythonRuntime({...options,approve});await runtime.prepare(['jinja2==3.1.6']);
  const failed=await runtime.run({code:'def transform(input):\n    return input["missing"]',input:{}});assert.equal(failed.errorName,'KeyError');assert.equal(failed.line,2);
  assert.equal((await runtime.run({code:'def transform(input):\n    return input["amount"]',input:{amount:42}})).output,42);checks.failedCodeRepair=true;
  assert.equal((await runtime.run({code:'def transform(input):\n    return float("nan")',input:null})).error,'python_script_failed');checks.finiteOutput=true;
  const secretKey='NUBI_PYTHON_TEST_SECRET';process.env[secretKey]='not-for-child';
  try{assert.equal((await runtime.run({code:'import os\ndef transform(input):\n    return os.environ.get("NUBI_PYTHON_TEST_SECRET")',input:null})).output,null);checks.credentialsExcluded=true;}finally{delete process.env[secretKey];}
  const limit=createPythonRuntime({...options,approve,executionMs:300});await limit.prepare(['jinja2==3.1.6']);
  await assert.rejects(limit.run({code:'def transform(input):\n    while True: pass',input:null}),/python_timeout/);checks.timeout=true;
  const controller=new AbortController(),cancelled=createPythonRuntime({...options,approve,signal:controller.signal});await cancelled.prepare(['jinja2==3.1.6']);
  const pending=cancelled.run({code:'def transform(input):\n    while True: pass',input:null}),rejected=assert.rejects(pending,/cancelled/);setTimeout(()=>controller.abort(),300);await rejected;checks.cancellation=true;
  let mutate=false,workspace;
  workspace=createSkillWorkspace({host:'excel',signal:new AbortController().signal,activity:createActivityLog(),metrics:{},pythonOptions:options,approve:async p=>{if(mutate&&p.kind==='python_execute')await workspace.execute('write',{path:'draft/source.json',content:'{"amount":43}'});return{approved:true};}});
  await workspace.execute('prepare_python',{requirements:['jinja2==3.1.6']});await workspace.execute('write',{path:'draft/calc.py',content:'def transform(input): return input["amount"]'});await workspace.execute('write',{path:'draft/source.json',content:'{"amount":42}'});mutate=true;
  assert.equal((await workspace.execute('run_script',{path:'draft/calc.py',inputPath:'draft/source.json'})).error,'script_source_changed');assert.equal(workspace.context().lastScript,null);checks.sourceDrift=true;
  if(process.platform==='win32'){
    const child=await runtime.run({code:'import subprocess,sys\ndef transform(input):\n    try:\n        subprocess.run([sys.executable,"-c","pass"],check=True)\n        return "unexpected child"\n    except (OSError,subprocess.SubprocessError):\n        return "blocked"',input:null});assert.equal(child.output,'blocked',JSON.stringify(child));
    const allocation=await runtime.run({code:'def transform(input):\n    try:\n        data=bytearray(700*1024*1024)\n        return "unexpected allocation"\n    except MemoryError:\n        return "bounded"',input:null});assert.equal(allocation.output,'bounded',JSON.stringify(allocation));checks.windowsJobLimits=true;
  }
  await mkdir('verification',{recursive:true});await writeFile('verification/python-integration.json',JSON.stringify({checkedAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,uv:'0.12.18',python:'3.12',checks,approvals,liveModel:false,officeCOM:false},null,2)+'\n');
  console.log('PASS: actual Python installation, Jinja2 reports in three Office workspaces, error repair, source drift, timeout, cancellation and environment isolation.',checks);
}finally{await rm(root,{recursive:true,force:true});}
