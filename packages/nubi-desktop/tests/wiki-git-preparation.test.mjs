import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {wikiPreparationGit,WIKI_GIT_PREPARATION_TIMEOUT} from '../runtime/wiki-git-preparation.mjs';
import {wikiInitializationError} from '../runtime/wiki-initialization-error.mjs';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {snapshotFolderHistory} from '../runtime/wiki-folder-history.mjs';
import {git,hash} from '../runtime/files.mjs';

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

test('owned snapshot copies never race automatic maintenance even with a low inherited GC threshold',async t=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'wiki-history-maintenance-'));
 removeLater(temp);
 const storage=path.join(temp,'state'),history=path.join(storage,'wiki-folder-history'),copy=path.join(temp,'copy'),trace=path.join(temp,'trace.jsonl');
 await mkdir(history,{recursive:true});await git(history,['init','-q']);await git(history,['config','gc.auto','1']);
 const sources=Array.from({length:8000},(_,i)=>{const content='Synthetic source '+i+'\n';return {path:'source-'+i+'.txt',content,hash:hash(content)};});
 await snapshotFolderHistory(storage,sources,copy,{gitRun:(root,args,options)=>git(root,args,{...options,env:{...options.env,GIT_TRACE2_EVENT:trace}})});
 const children=(await readFile(trace,'utf8')).split('\n').filter(Boolean).map(row=>JSON.parse(row)).filter(row=>row.event==='child_start');
 assert.deepEqual(children.filter(row=>row.argv.includes('maintenance')||row.argv.includes('gc')).map(row=>row.argv),[], 'no detached object rewriting while copying .git');
 assert.equal((await git(copy,['fsck','--full','--no-dangling'])).trim(),'');
 assert.equal((await git(copy,['show','HEAD:source-7999.txt'])).trim(),'Synthetic source 7999');
 assert.equal((await git(copy,['config','--get','gc.auto'])).trim(),'0','the owned copy stays protected for later generation');
 assert.equal((await git(copy,['config','--get','maintenance.auto'])).trim(),'false');
});
