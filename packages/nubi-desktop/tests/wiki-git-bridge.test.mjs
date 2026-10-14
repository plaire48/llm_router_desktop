import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installWikiGitBridge} from '../runtime/wiki-git-bridge.mjs';
import {createRequire} from 'node:module';
import {createConnection} from 'node:net';
const require=createRequire(import.meta.url),{ElectronHost}=require('../electron-app/native-host.cjs'),{ORIGIN}=require('../../nubi-vscode/src/ghes.cjs');
function channel(){const c=new EventEmitter();c.sent=[];c.send=(message,callback)=>{c.sent.push(message);callback?.();};return c;}
test('Git bridge carries only a root and result; cancellation and disconnect settle the pending request',async()=>{
 const c=channel(),service={};installWikiGitBridge(service,c);const work=service.syncWikiSources('/fixture');const request=c.sent[0].wikiGitRequest;assert.deepEqual(Object.keys(request).sort(),['id','root']);c.emit('message',{wikiGitReply:{id:request.id,result:{attempted:true,ok:true,head:'abc'}}});assert.equal((await work).head,'abc');
 const controller=new AbortController(),cancelled=service.syncWikiSources('/fixture',{signal:controller.signal});controller.abort();await assert.rejects(cancelled,/wiki_refresh_cancelled/);assert(c.sent.at(-1).wikiGitCancel);
 const lost=service.syncWikiSources('/fixture');c.emit('disconnect');await assert.rejects(lost,/host_disconnected/);
});
test('shared Git authentication grants a transient credential only to the exact company origin',async()=>{
 const host=new ElectronHost({keyStore:{},helperPath:'/fixture/helper.cjs',invoke:async()=>{}});
 host.account={generation:7,state:'connected',record:{},status:async()=>({connected:true}),credential:async()=>({generation:7,token:'fixture-token'})};
 await host.withGitAccess(new URL(ORIGIN+'/team/repo'),async({env})=>{
  assert(!JSON.stringify(env).includes('fixture-token'));
  const ask=prompt=>new Promise((resolve,reject)=>{const socket=createConnection(env.NUBI_GIT_SOCKET);let raw='';socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify({nonce:env.NUBI_GIT_NONCE,prompt})+'\n'));socket.on('data',chunk=>raw+=chunk);socket.on('end',()=>resolve(JSON.parse(raw).value));});
  assert.equal(await ask(`Password for 'https://x-access-token@${new URL(ORIGIN).host}/team/repo': `),'fixture-token');
  assert.equal(await ask("Password for 'https://x-access-token@elsewhere.invalid/repo': "),'');
 });
});
