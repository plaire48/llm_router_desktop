import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {gitBashProfile,applyGitBashEnvironment} from '../runtime/git-bash-profile.mjs';
import {windowsBashProcess} from '../runtime/windows-bash-process.mjs';
import {stopWindowsProcess} from '../runtime/windows-process-stop.mjs';

test('real Windows Git Bash closes its owned pipes after immediate and delayed stop', {skip:process.platform!=='win32',timeout:180000}, async t=>{
 const profile=await gitBashProfile();assert.ok(profile,'Git for Windows native shell must be installed');
 assert.match(profile.executable,/[/\\]usr[/\\]bin[/\\]bash\.exe$/i);t.diagnostic(JSON.stringify({executable:profile.executable,root:profile.gitBashRoot}));
 for(const delay of [0,1,30,0,1,30,0,1,30,0,1,30]){
  const env={...process.env};applyGitBashEnvironment(env,profile.gitBashRoot);
  const launch=await windowsBashProcess(profile.executable,[...profile.args,'sleep 30']);
  const child=spawn(launch.executable,launch.args,{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();let active=true,attempts=0,stopFault=false,timer,stop;
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',()=>{active=false;clearTimeout(timer);resolve();});timer=setTimeout(()=>reject(Error(JSON.stringify({delay,attempts,stopFault,exitCode:child.exitCode}))),10000);});
  if(delay)await new Promise(r=>setTimeout(r,delay));
  stop=stopWindowsProcess(child,{isActive:()=>active,onAttempt:value=>attempts=value,onUnconfirmed:()=>stopFault=true});
  try{await closed;}finally{clearTimeout(timer);stop();if(active&&child.exitCode===null)child.kill();}
  assert.equal(active,false);assert(attempts>0);
 }
});
