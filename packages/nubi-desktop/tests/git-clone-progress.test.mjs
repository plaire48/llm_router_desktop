import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),{createCloneProgress}=require('../electron-app/git-clone-progress.cjs'),{ElectronHost}=require('../electron-app/native-host.cjs');
test('CR and split chunks yield only numeric progress and safe transfer metrics',()=>{
 const events=[],p=createCloneProgress(e=>events.push(e));
 p.write(Buffer.from("Cloning into 'private'...\nremote: private message secret\nReceiving obj"));
 p.write(Buffer.from('ects:  42% (42/100), 1.23 MiB | 4.56 MiB/s\rResolving deltas: 100% (3/3), done.\nUpdating files: 80% (8/10)'));p.end();
 assert.deepEqual(events,[{stage:'receiving',percent:42,current:42,total:100,transferred:'1.23 MiB',speed:'4.56 MiB/s'},{stage:'resolving',percent:100,current:3,total:3},{stage:'checkout',percent:80,current:8,total:10}]);
 assert(!JSON.stringify(events).includes('private'));
});
test('invalid values and duplicate progress never create false completion',()=>{
 const events=[],p=createCloneProgress(e=>events.push(e));for(const line of ['Receiving objects: 999% (2/1)','Receiving objects: 50% (2/0)','Receiving objects: 50% (999999999999999999/999999999999999999)','Receiving objects: 50% (1/2)','Receiving objects: 50% (1/2)'])p.write(Buffer.from(line+'\r'));p.end();assert.equal(events.length,1);assert.equal(events[0].percent,50);
});
for(const exitCode of [0,1])test(`clone reports progress and opens only after successful close (${exitCode})`,async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-clone-test-')),events=[];let child;
 const host=new ElectronHost({keyStore:{},helperPath:'/unused',invoke:async()=>{},spawnProcess:(_exe,args,options)=>{
  assert(args.includes('--progress'));assert.equal(options.env.LC_ALL,'C');
  child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  setImmediate(()=>{child.stderr.write('Receiving objects: 100% (2/2)\r');child.emit('exit',exitCode);assert(!events.some(e=>e.stage==='opening'));child.emit('close',exitCode);});return child;
 }});
 host.withGitAccess=async(_address,operation)=>operation({env:{},credential:null});
 try{const promise=host.clone({url:'https://example.test/repo.git',parent:directory},e=>events.push(e));if(exitCode)await assert.rejects(promise,/clone_failed/);else assert.equal((await promise).cloned,true);assert.equal(events[0].stage,'connecting');assert.equal(events[1].percent,100);assert.equal(events.some(e=>e.stage==='opening'),exitCode===0);assert.equal(host.children.size,0);}finally{await rm(directory,{recursive:true,force:true});}
});
test('real Git transfer emits readable progress without stderr forwarding',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-real-clone-'));const git=(...args)=>execFileSync('git',args,{cwd:directory,stdio:'pipe'});
 try{git('init','-q');await writeFile(path.join(directory,'sample.txt'),'sample\n'.repeat(2000));git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');const events=[],parser=createCloneProgress(e=>events.push(e));await new Promise((resolve,reject)=>{const child=spawn('git',['clone','--no-local','--progress',directory,path.join(directory,'copy')],{env:{...process.env,LC_ALL:'C'},stdio:['ignore','ignore','pipe']});child.stderr.on('data',parser.write);child.on('error',reject);child.on('close',code=>{parser.end();code===0?resolve():reject(Error('clone failed'));});});assert(events.some(e=>e.stage==='receiving'&&e.percent===100));}finally{await rm(directory,{recursive:true,force:true});}
});
