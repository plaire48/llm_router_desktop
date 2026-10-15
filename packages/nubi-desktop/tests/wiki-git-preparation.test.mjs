import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {wikiPreparationGit,WIKI_GIT_PREPARATION_TIMEOUT} from '../runtime/wiki-git-preparation.mjs';
import {wikiInitializationError} from '../runtime/wiki-initialization-error.mjs';

test('long Wiki Git budget remains cancellable during a real child process',async()=>{
 const controller=new AbortController();let started;
 const entered=new Promise(resolve=>started=resolve),steps=[];
 const pending=wikiPreparationGit(process.cwd(),['add','--all'],{signal:controller.signal,onGitStep:value=>steps.push(value),gitRun:async(cwd,args,options)=>{
   assert.equal(options.timeout,600000);assert.equal(options.timeout,WIKI_GIT_PREPARATION_TIMEOUT);
   const child=promisify(execFile)(process.execPath,['-e','setInterval(()=>{},1000)'],options);started();return child;
 }},'index');
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await entered;controller.abort();await rejected;assert.deepEqual(steps,['index']);
});
test('cancelled preparation starts no Git process and timeout codes remain specific',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(wikiPreparationGit('.',[],{signal:controller.signal,gitRun:async()=>calls++}),{name:'AbortError'});
 assert.equal(calls,0);assert.equal(wikiInitializationError({code:'ETIMEDOUT'},'snapshot_git'),'wiki_git_timeout');
});
