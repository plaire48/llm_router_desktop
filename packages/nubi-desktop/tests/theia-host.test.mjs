import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import {configureSystemTrust} from '../runtime/worker-environment.mjs';
const require=createRequire(import.meta.url),{TheiaHost,SECRET_SERVICE,remote}=require('../extension/src/node/theia-host.cjs');
const {ORIGIN,CLIENT_ID,SECRET_KEY}=require('../../nubi-vscode/src/ghes.cjs');
const helperPath=fileURLToPath(new URL('../extension/src/node/git-askpass.cjs',import.meta.url));
const exec=promisify(execFile);
function fixture(options={}){
 const calls=[],token='fixture-only-ghes-token',record=JSON.stringify({host:ORIGIN,clientId:CLIENT_ID,token});
 const host=new TheiaHost({helperPath,invoke:async(method,args)=>{calls.push({method,args});return {connected:true};},keyStore:{getPassword:async(service,key)=>{calls.push({service,key});return record;},setPassword:async()=>{},deletePassword:async()=>{}},fetcher:async()=>Response.json({id:1,login:'fixture-user',name:'Fixture User'}),...options});
 return {host,calls,token};
}
test('Windows trust extends existing roots while other platforms keep their defaults',()=>{
 let applied;const api={getCACertificates:kind=>kind==='default'?['bundled','extra']:['company','bundled'],setDefaultCACertificates:value=>applied=value};
 configureSystemTrust({platform:'win32',api});assert.deepEqual(applied,['bundled','extra','company']);
 applied=null;configureSystemTrust({platform:'darwin',api});assert.equal(applied,null);
 assert.throws(()=>configureSystemTrust({platform:'win32',api:{}}),/system_ca_unavailable/);
});
test('Theia account uses its own native key store and never returns credentials to the renderer',async()=>{
 const {host,calls,token}=fixture();try{const state=await host.accountAction('status');assert.equal(state.connected,true);assert.equal(calls[0].service,SECRET_SERVICE);assert.equal(calls[0].key,SECRET_KEY);assert(!JSON.stringify(state).includes(token));await host.connectMarketplace();assert.equal(calls.at(-1).args.token,token);await host.accountAction('logout');assert.equal(calls.at(-1).method,'disconnectSkillMarketplace');}finally{host.dispose();}
});
test('HTTPS and SSH remotes are preserved, passwords and ambiguous paths are refused',()=>{
 for(const value of ['https://code.sdsdev.co.kr/team/repo.git','ssh://git@host/team/repo.git','git@host:team/repo.git'])assert(remote(value).pathname.endsWith('repo.git'));
 for(const value of ['https://user:password@host/repo.git','file:///tmp/repo','--upload-pack=evil','https://host/repo.git?token=hidden','https://host/repo.git\n'])assert.throws(()=>remote(value),/remote_invalid/);
});
test('Git askpass returns a token only for the current company origin and nonce, then destroys its channel',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'nubi-clone-test-'));let probe,spawned;
 const {host,token}=fixture({spawnProcess:(file,args,options)=>{
  spawned={file,args,options};const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('exit',1);
  setImmediate(async()=>{try{
   const ask=async(prompt,env=options.env)=>(await exec(process.execPath,[helperPath,prompt],{env})).stdout.trim();
   probe={username:await ask("Username for 'https://code.sdsdev.co.kr': "),password:await ask("Password for 'https://x-access-token@code.sdsdev.co.kr': "),foreign:await ask("Password for 'https://evil.example': "),wrongNonce:await ask("Password for 'https://code.sdsdev.co.kr': ",{...options.env,NUBI_GIT_NONCE:'wrong'})};child.emit('exit',0);
  }catch(error){child.emit('error',error);}});return child;
 }});
 try{const result=await host.clone({url:ORIGIN+'/team/repo.git',parent});assert.equal(result.cloned,true);assert.deepEqual(probe,{username:'x-access-token',password:token,foreign:'',wrongNonce:''});assert(!JSON.stringify(spawned).includes(token));assert(spawned.args.includes('http.sslVerify=true'));assert(!spawned.options.env.GIT_SSL_NO_VERIFY);await assert.rejects(access(spawned.options.env.NUBI_GIT_SOCKET));await assert.rejects(host.clone({url:ORIGIN+'/team/repo.git',parent}),/clone_target_exists/);}finally{host.dispose();await rm(parent,{recursive:true,force:true});}
});
