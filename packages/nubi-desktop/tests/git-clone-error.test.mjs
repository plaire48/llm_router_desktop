import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm,writeFile,readdir,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {gitCloneError} from '../ui/git-clone-error.mjs';
const require=createRequire(import.meta.url),{cloneErrorCode,createCloneErrorCapture,safeCloneFailure}=require('../electron-app/git-clone-error.cjs'),{ElectronHost,remote}=require('../electron-app/native-host.cjs');
test('Git failures distinguish gateway, authentication, TLS, filesystem and transport causes',()=>{
 for(const [text,code] of [["fatal: unable to access 'https://private/token': The requested URL returned error: 502",'clone_gateway'],['The requested URL returned error: 503','clone_server'],['The requested URL returned error: 407','clone_proxy'],['Authentication failed','clone_auth'],['repository not found','clone_repository_unavailable'],['schannel: SEC_E_UNTRUSTED_ROOT','clone_tls'],['Could not resolve host: private','clone_dns'],['Failed to connect','clone_network'],['Filename too long','clone_path_long'],['No space left on device','clone_disk_full'],['Permission denied (publickey).','clone_ssh_key'],['Host key verification failed.','clone_ssh_host'],['early EOF','clone_transfer'],['Clone succeeded, but checkout failed.','clone_checkout']])assert.equal(cloneErrorCode(text),code,text);
 assert.equal(cloneErrorCode('',{code:'ENOENT'}),'clone_git_missing');assert.equal(cloneErrorCode('',{code:'EPERM'}),'clone_git_blocked');
});
test('diagnostics retain a split HTTP status without remote output, URLs or credentials',()=>{
 const capture=createCloneErrorCapture();capture.write(Buffer.from("fatal: unable to access 'https://private.example/secret?token=private': The requested URL returned er"));capture.write(Buffer.from('ror: 502\n'));capture.write(Buffer.from('x'.repeat(100000)));const code=capture.finish();assert.equal(code,'clone_gateway');assert.equal(capture.httpStatus,502);
 const safe=safeCloneFailure({code,stage:'connecting',exitCode:128,httpStatus:502,stderr:'secret',url:'private',token:'secret'});assert.deepEqual(Object.keys(safe).sort(),['code','exitCode','httpStatus','retained','stage']);const view=gitCloneError(Object.assign(Error(code),{cloneFailure:safe}));assert.match(view.title,/502/);assert.match(view.diagnostic,/128/);assert(!JSON.stringify(view).includes('private'));assert(!JSON.stringify(view).includes('secret'));
});
for(const partial of [false,true])test(`failed HTTP clone preserves partial files and allows clean retry when empty (${partial})`,async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-clone-errors-'));let attempts=0;
 const host=new ElectronHost({keyStore:{},helperPath:'/unused',invoke:async()=>{},spawnProcess:(_exe,args)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();attempts++;
  setImmediate(async()=>{if(partial)await writeFile(path.join(args.at(-1),'keep.txt'),'keep');child.stderr.write("fatal: unable to access 'https://private.example/secret': The requested URL returned error: 502\n");child.emit('close',128,null);});return child;
 }});host.withGitAccess=async(_address,operation)=>operation({env:{},credential:null});
 try{await assert.rejects(host.clone({url:'https://example.test/repo.git',parent:directory}),error=>{assert.equal(error.message,'clone_gateway');assert.equal(error.cloneFailure.httpStatus,502);assert.equal(error.cloneFailure.retained,partial);return true;});
  assert.deepEqual(await readdir(directory),partial?['repo']:[]);
  await assert.rejects(host.clone({url:'https://example.test/repo.git',parent:directory}),partial?/clone_target_exists/:/clone_gateway/);assert.equal(attempts,partial?1:2);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('existing folders are never removed and company URL usernames do not override the app identity',async()=>{
 assert.equal(remote('https://employee@code.sdsdev.co.kr/team/repo.git').href,'https://code.sdsdev.co.kr/team/repo.git');
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-clone-existing-'));await mkdir(path.join(directory,'repo'));
 const host=new ElectronHost({keyStore:{},invoke:async()=>{},spawnProcess:()=>assert.fail('must not launch')});try{await assert.rejects(host.clone({url:'https://example.test/repo',parent:directory}),/clone_target_exists/);assert.deepEqual(await readdir(directory),['repo']);}finally{await rm(directory,{recursive:true,force:true});}
});
