// User decision of 2026-09-30: when a folder cannot open because Git is missing or the folder is not a
// repository, the host prepares the fix, shows the exact command and runs it after one approval. When it
// fails, the model proposes another command for approval. The project then opens and prepares its environment.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {git} from '../runtime/files.mjs';
import {gitInstallPlan,gitCandidates,findGit,runSetupCommand,initializeRepository,suggestionPlan,SETUP_IDENTITY} from '../runtime/project-setup.mjs';

async function place(t){
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-setup-')));
  // The user's global Git settings must not decide the identity of a test commit.
  const saved={GIT_CONFIG_GLOBAL:process.env.GIT_CONFIG_GLOBAL,GIT_CONFIG_NOSYSTEM:process.env.GIT_CONFIG_NOSYSTEM};
  await writeFile(path.join(directory,'gitconfig'),'');process.env.GIT_CONFIG_GLOBAL=path.join(directory,'gitconfig');process.env.GIT_CONFIG_NOSYSTEM='1';
  const service=new ProjectService({storageRoot:path.join(directory,'state')});
  t.after(async()=>{try{service.dispose();}catch{/* Never opened. */}service.store?.close();for(const [key,value] of Object.entries(saved))value===undefined?delete process.env[key]:process.env[key]=value;await rm(directory,{recursive:true,force:true});});
  const folder=path.join(directory,'plain');await mkdir(folder);await writeFile(path.join(folder,'README.md'),'# Plain\n');
  return {directory,service,folder};
}

test('Windows installs Git for the current user, without administrator rights',()=>{
  const plan=gitInstallPlan('win32');
  assert.equal(plan.profile,'powershell');assert.match(plan.command,/^winget install --id Git\.Git -e --source winget --scope user /);
  assert.match(plan.effects,/관리자 권한은 쓰지 않습니다/);
  assert.equal(gitInstallPlan('darwin').command,'xcode-select --install');
  assert.equal(gitInstallPlan('linux').command,null,'no prepared command: the user installs it');
  assert.ok(gitCandidates({LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local',ProgramFiles:'C:\\Program Files'},'win32').includes('C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd\\git.exe'));
});

test('a Git installed while the app runs is found and added to its PATH',async()=>{
  const env={PATH:'C:\\Windows',LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local'},installed='C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd\\git.exe';
  const run=async file=>{if(file===installed)return {stdout:'git version 2.53.0.windows.1\n'};throw Object.assign(new Error('missing'),{code:'ENOENT'});};
  const found=await findGit({env,platform:'win32',run,exists:async file=>file===installed});
  assert.deepEqual(found,{available:true,version:'git version 2.53.0.windows.1',added:'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd'});
  assert.equal(env.PATH,'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd;C:\\Windows');
  assert.deepEqual(await findGit({env:{PATH:''},platform:'win32',run,exists:async()=>false}),{available:false,version:null,added:null});
});

test('a setup command reports its exit and output, never throwing on failure',async()=>{
  const plan={kind:'install_git',profile:'powershell',command:'winget install --id Git.Git'};
  const calls=[];const ok=await runSetupCommand(plan,{run:async(file,args)=>{calls.push([file,args]);return {stdout:'installed',stderr:''};}});
  assert.deepEqual(ok,{exitCode:0,output:'installed'});assert.deepEqual(calls[0],['powershell.exe',['-NoProfile','-NonInteractive','-Command','winget install --id Git.Git']]);
  const failed=await runSetupCommand(plan,{run:async()=>{throw Object.assign(new Error('exit 1'),{code:1,stdout:'',stderr:'No package found'});}});
  assert.deepEqual(failed,{exitCode:1,error:'setup_failed',output:'No package found'});
  const missing=await runSetupCommand(plan,{run:async()=>{throw Object.assign(new Error('spawn'),{code:'ENOENT'});}});
  assert.equal(missing.error,'shell_unavailable');
  await assert.rejects(runSetupCommand({kind:'init_repository',profile:'git',command:'git init'}),/setup_plan_invalid/);
});

test('a new repository gets an empty first commit, written by the user when Git knows them',async t=>{
  const {folder}=await place(t);
  assert.deepEqual(await initializeRepository(folder),{identity:false});
  assert.equal((await git(folder,['log','-1','--format=%an <%ae>|%s'])).trim(),`${SETUP_IDENTITY.name} <${SETUP_IDENTITY.email}>|누비 Workspace 시작`);
  assert.equal((await git(folder,['status','--porcelain'])).trim(),'?? README.md','no file is committed');
  const other=path.join(path.dirname(folder),'known');await mkdir(other);await git(other,['init','-q']);
  await git(other,['config','user.name','Kim']);await git(other,['config','user.email','kim@example.invalid']);
  assert.deepEqual(await initializeRepository(other),{identity:true});
  assert.equal((await git(other,['log','-1','--format=%an'])).trim(),'Kim');
});

// Folders outside a repository open as they are (user decision 2026-10-01). The approved setup of 2026-09-30 is no
// longer reached from 프로젝트 열기; its helpers above stay tested, and nothing waits to be set up.
test('a folder outside a repository opens without a setup, and nothing waits to be set up',async t=>{
  const {service,folder}=await place(t);
  const opened=await service.open(folder);assert.equal(opened.name,'plain');assert.equal(opened.branch,'Git 없음');
  assert.equal(await service.invoke('setupStatus'),null,'nothing waits after the folder opened');
  await assert.rejects(service.invoke('setupRetry'),{message:'setup_plan_changed'},'nothing to retry');
});

test('a model suggestion is JSON with an explanation; an empty command means the user installs it',()=>{
  const plan=suggestionPlan('```json\n{"explanation":"설명","command":"winget install Git.Git","needsAdmin":true}\n```','win32');
  assert.deepEqual({...plan},{kind:'install_git',profile:'powershell',source:'model',command:'winget install Git.Git',effects:'설명',needsAdmin:true});
  assert.equal(suggestionPlan('{"explanation":"안전한 방법이 없습니다.","command":""}','win32').command,null);
  assert.throws(()=>suggestionPlan('not json'),/setup_suggestion_invalid/);
  assert.throws(()=>suggestionPlan('{"explanation":"","command":"x"}'),/setup_suggestion_invalid/);
});

