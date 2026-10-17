// Built Electron main -> service IPC -> actual PTY/HTTP/compiler worker.
// Uses an isolated project and an explicit test approval, with no model/login.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {prepareSetupAction} from '../runtime/setup-actions.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';

const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-development-electron-'));
const root=path.join(temporary,'project'),storage=path.join(temporary,'state'),evidence=path.resolve('verification/development-execution-2026-10-16/electron');
await mkdir(root);await mkdir(storage);await mkdir(evidence,{recursive:true});
const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});
git(['init','-q']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','Fixture']);
await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki','home.md'),'# Development fixture\n');
await writeFile(path.join(root,'serve.cjs'),`#!/usr/bin/env node\nconsole.log('TTY:'+process.stdin.isTTY);const server=require('node:http').createServer((request,response)=>response.end('<title>Nubi actual preview</title><h1>Ready</h1>'));server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));`);
await writeFile(path.join(root,'package.json'),JSON.stringify({name:'nubi-isolated-development-fixture',version:'1.0.0',private:true}));
if(process.platform!=='win32'){
  await mkdir(path.join(root,'node_modules','.bin'),{recursive:true});await chmod(path.join(root,'serve.cjs'),0o755);
  await symlink('../../serve.cjs',path.join(root,'node_modules','.bin','nubi-development-fixture'));
}
await writeFile(path.join(root,'value.ts'),'export const amount: number = "wrong";\n');git(['add','.']);git(['commit','-qm','Development fixture']);
const service=new ProjectService({storageRoot:storage});
await service.open(root,{initializeWiki:false});
const task=await service.createTask({request:'개발 서버를 실행하고 실제 응답을 확인합니다.'});
const source=await service.read({taskId:task.id,path:'serve.cjs'});
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const action=await prepareSetupAction(service,task.id,{title:'미리보기 서버 실행',kind:'start',interactive:true,script:process.platform==='win32'?'& '+quote(process.execPath)+' '+quote('serve.cjs'):'npx --offline --no -- nubi-development-fixture',reason:'실제 Electron 실행 경로 확인',effects:'격리된 로컬 서버 실행',verification:'TTY와 HTTP 응답 확인',references:[{path:'serve.cjs',hash:source.hash}]},{files:new Map([['serve.cjs',{hash:source.hash}]])});
service.dispose();service.store.close();
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
let app;const errors=[],checks=[];
try{
  app=await electron.launch({executablePath:require('electron'),args:['electron-app'],timeout:30000,env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
  const page=await desktopTestWindow(app);page.on('pageerror',error=>errors.push(error.message));
  await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});
  await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert,null,{timeout:60000});
  const request=async(method,args)=>{
    const result=await page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
    assert.equal(result?.__nubiError,undefined,JSON.stringify(result));return result;
  };
  const approved=await request('decideSetupAction',{id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  const id=approved.resultProcessId;assert(id);
  let record;
  for(let i=0;i<100;i++){record=await request('poll',{id});if(record.output.includes('http://'))break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.match(record.output,/TTY:true/);assert.equal(record.executionMode,'pty');assert.equal(record.state,'running');checks.push(process.platform==='win32'?'built service spawned an actual interactive PTY':'built service spawned the actual offline npx CLI with a local fixture bin in an interactive PTY');
  const response=await request('inspectDevServer',{taskId:task.id,processId:id});
  assert.equal(response.status,200);assert.equal(response.responding,true);assert.equal(response.title,'Nubi actual preview');assert.equal(response.functionalVerified,false);checks.push('built service checked the observed local HTTP response');
  const code=await request('inspectCode',{taskId:task.id,path:'value.ts',mode:'diagnostics'});
  assert(code.diagnostics.some(diagnostic=>diagnostic.code==='TS2322'));assert.equal(code.editObservation,false);checks.push('built compiler worker reported the actual type mismatch');
  await request('decideSetupAction',{id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  assert.equal((await request('state',{taskId:task.id})).processes.length,1);checks.push('duplicate approval reused the process receipt');
  await request('stop',{id});
  for(let i=0;i<100;i++){record=await request('poll',{id});if(record.state==='cancelled')break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(record.state,'cancelled');
  await assert.rejects(()=>fetch(response.url,{signal:AbortSignal.timeout(2000)}),'the actual preview endpoint must stop responding after process cancellation');
  checks.push('the owned server was cancelled and its actual HTTP endpoint stopped responding');
  assert.equal(await readFile(path.join(root,'value.ts'),'utf8'),'export const amount: number = "wrong";\n');
  await page.screenshot({path:path.join(evidence,'workspace.png'),animations:'disabled'});
  assert.deepEqual(errors,[]);
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({kind:'electron-runtime-development-smoke',platform:process.platform,checks,errors,model:'not_run',windowsVerified:process.platform==='win32'},null,2));
  console.log(`PASS: ${checks.length} actual Electron development checks`);
}finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
