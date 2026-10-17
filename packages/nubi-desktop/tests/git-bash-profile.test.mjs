import test from 'node:test';
import assert from 'node:assert/strict';
import {gitBashProfile,applyGitBashEnvironment} from '../runtime/git-bash-profile.mjs';
test('Git Bash owns the real shell and preserves a child-only Git environment',async()=>{
 const root='C:\\Program Files\\Git',seen=[];
 const profile=await gitBashProfile({env:{ProgramFiles:'C:\\Program Files'},exists:async file=>seen.push(file)});
 assert.equal(profile.executable,root+'\\usr\\bin\\bash.exe');
 assert.deepEqual(seen,[profile.executable,root+'\\cmd\\git.exe']);
 const parent={Path:'C:\\Windows',HOME:'C:\\Users\\person',PLINK_PROTOCOL:'custom'},child={...parent};
 applyGitBashEnvironment(child,profile.gitBashRoot);
 assert.equal(child.PATH,root+'\\cmd;'+root+'\\mingw64\\bin;'+root+'\\usr\\bin;C:\\Windows');
 assert.equal(child.MSYSTEM,'MINGW64');assert.equal(child.HOME,parent.HOME);assert.equal(child.PLINK_PROTOCOL,'custom');
 assert.equal(child.Path,undefined);assert.equal(parent.Path,'C:\\Windows');assert.equal(parent.PATH,undefined);
});
test('missing native Git Bash is not invented and custom profiles keep their environment',async()=>{
 assert.equal(await gitBashProfile({env:{},exists:async()=>{throw Error('missing');}}),null);
 const env={Path:'existing'};applyGitBashEnvironment(env,undefined);assert.deepEqual(env,{Path:'existing'});
});

test('explicit Git launch wrappers resolve only within their own installation',async()=>{
 const root='D:\\tools\\Git';
 const exists=async file=>{if(![root+'\\usr\\bin\\bash.exe',root+'\\cmd\\git.exe'].includes(file))throw Error('missing');};
 for(const executable of [root+'\\bin\\bash.exe',root+'\\usr\\bin\\bash.exe','D:/tools/Git/bin/bash.exe']){const p=await gitBashProfile({executable,exists});assert.equal(p.executable,root+'\\usr\\bin\\bash.exe');assert.equal(p.gitBashRoot,root);}
 assert.equal(await gitBashProfile({executable:'D:\\custom\\bash.exe',exists}),null);
 assert.equal(await gitBashProfile({executable:'D:\\other\\bin\\bash.exe',exists}),null);
});
