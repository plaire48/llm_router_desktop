import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {findClaudeBinary,claudeSearchDirectories,claudeLaunch} from '../runtime/claude-discovery.mjs';

function filesystem(files,denied=[]){
 const get=file=>{if(denied.includes(file))throw Object.assign(Error(),{code:'EACCES'});if(!Object.hasOwn(files,file))throw Object.assign(Error(),{code:'ENOENT'});return files[file];};
 return {access:async file=>{get(file);},stat:async file=>({isFile:()=>get(file)!==null}),readFile:async file=>get(file)};
}
const home='C:\\Users\\홍 길동',prefix=home+'\\AppData\\Roaming\\npm',root=prefix+'\\node_modules\\@anthropic-ai\\claude-code';
test('Windows official npm binary is found with stale PATH and a Korean home',async()=>{
 const binary=root+'\\bin\\claude.exe';
 const fs=filesystem({[root+'\\package.json']:JSON.stringify({name:'@anthropic-ai/claude-code',bin:{claude:'bin/claude.exe'}}),[binary]:'MZ'});
 assert.equal(await findClaudeBinary({platform:'win32',home,environment:{Path:'C:\\Windows\\System32'},registeredPath:'',fs}),binary);
});
test('native, registered custom PATH and WinGet links are supported',async()=>{
 for(const binary of [home+'\\.local\\bin\\claude.exe','D:\\Tools\\Claude\\claude.exe',home+'\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe']){
  assert.equal(await findClaudeBinary({platform:'win32',home,environment:{},registeredPath:'D:\\Tools\\Claude',fs:filesystem({[binary]:'MZ'})}),binary);
 }
 const dirs=claudeSearchDirectories({platform:'win32',home,environment:{Path:'"D:\\Tools";.;d:\\tools',USERPROFILE:home},registeredPath:'%USERPROFILE%\\.local\\bin'});
 assert.equal(dirs.filter(d=>d.toLowerCase()==='d:\\tools').length,1);assert(!dirs.includes('.'));assert(dirs.includes(home+'\\.local\\bin'));
});
test('legacy npm JavaScript entry uses argv without a shell or JSON interpolation',async()=>{
 const binary=root+'\\cli.js',fs=filesystem({[root+'\\package.json']:JSON.stringify({name:'@anthropic-ai/claude-code',bin:{claude:'cli.js'}}),[binary]:'#!/usr/bin/env node'});
 assert.equal(await findClaudeBinary({platform:'win32',home,environment:{},registeredPath:'',fs}),binary);
 const args=['--json-schema','{"text":"%PATH% & echo unsafe | >"}'];
 assert.deepEqual(claudeLaunch(binary,args,{executable:'C:\\Nubi\\Nubi Workspace.exe',electron:true}),{command:'C:\\Nubi\\Nubi Workspace.exe',args:[binary,...args],environment:{ELECTRON_RUN_AS_NODE:'1'}});
});
test('invalid npm identity, traversal and denied executables never become an installation success',async()=>{
 for(const metadata of [{name:'other',bin:{claude:'cli.js'}},{name:'@anthropic-ai/claude-code',bin:{claude:'../../unsafe.exe'}}]){
  await assert.rejects(findClaudeBinary({platform:'win32',home,environment:{},registeredPath:'',fs:filesystem({[root+'\\package.json']:JSON.stringify(metadata)})}),/claude_cli_missing/);
 }
 await assert.rejects(findClaudeBinary({platform:'win32',home,environment:{},registeredPath:'',fs:filesystem({},[home+'\\.local\\bin\\claude.exe'])}),/claude_cli_unavailable/);
});
