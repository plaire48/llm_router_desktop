import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {windowsBashProcess} from '../runtime/windows-bash-process.mjs';
import {stopWindowsProcess} from '../runtime/windows-process-stop.mjs';

test('command helper rejects missing or altered binaries and preserves argument boundaries',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'nubi-process-')),roots=[pathToFileURL(directory+path.sep)];
 try{
  await assert.rejects(windowsBashProcess('bash',[],{roots}),/process_host_missing/);
  const bytes=Buffer.from('test-only'),sha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify({version:1,file:'Nubi.ProcessHost.exe',sha256}));
  await writeFile(path.join(directory,'Nubi.ProcessHost.exe'),bytes);
  const args=['-c','printf "%s" "한글 \\"'];
  assert.deepEqual((await windowsBashProcess('C:\\Git with spaces\\bash.exe',args,{roots})).args,['C:\\Git with spaces\\bash.exe',...args]);
  await writeFile(path.join(directory,'Nubi.ProcessHost.exe'),'changed');
  await assert.rejects(windowsBashProcess('bash',[],{roots}),/process_host_invalid/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('Windows helper preserves Unicode, empty, quote and trailing slash arguments and exit code',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const args=['한글 space','','a"b','C:\\space path\\','\\\\"'];
 const launch=await windowsBashProcess(process.execPath,['-e','console.log(JSON.stringify(process.argv.slice(1)));process.exitCode=7','--',...args]);
 await assert.rejects(promisify(execFile)(launch.executable,launch.args,{windowsHide:true}),error=>{
  assert.equal(error.code,7);assert.deepEqual(JSON.parse(error.stdout.trim()),args);return true;
 });
});

test('Windows helper retains orphan descendants and cancellation leaves an unrelated process alive',{skip:process.platform!=='win32',timeout:20000},async()=>{
 const sibling=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
// Windows Node owns ordinary children itself. Explicit detachment is needed
 // for this fixture to outlive its parent while still inheriting our outer job.
 const nested="console.log(process.pid);setInterval(()=>{},1000)";
 const script=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(nested)}],{stdio:'inherit',windowsHide:true,detached:true}).on('error',error=>console.error(error.code)).unref();`;
 const launch=await windowsBashProcess(process.execPath,['-e',script]);
 const child=spawn(launch.executable,launch.args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let active=true,stop,timer,stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
 const close=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',()=>{active=false;resolve();});});
 try{
  const pid=await new Promise((resolve,reject)=>{let output='';timer=setTimeout(()=>reject(Error(JSON.stringify({code:'child_readiness_timeout',exitCode:child.exitCode,active,stderr,output}))),5000);child.stdout.on('data',bytes=>{output+=bytes;if(output.includes('\n')){clearTimeout(timer);resolve(Number(output.trim()));}});});
  assert(Number.isInteger(pid)&&pid>0);
  await new Promise(r=>setTimeout(r,150));assert.equal(active,true,'Job must outlive its exited root');
  stop=stopWindowsProcess(child,{isActive:()=>active});
  await Promise.race([close,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('job_stop_timeout')),6000);})]);
  assert.throws(()=>process.kill(pid,0));assert.doesNotThrow(()=>process.kill(sibling.pid,0));
 }finally{clearTimeout(timer);stop?.();if(active)child.kill();sibling.kill();}
});
