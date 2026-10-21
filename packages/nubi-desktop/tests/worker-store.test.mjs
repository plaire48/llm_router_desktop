import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../runtime/store.mjs';
test('worker startup waits for previous owner release without replaying a checkpoint',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'worker-store-'));let child,store;try{
  const source=`import {Store} from ${JSON.stringify(new URL('../runtime/store.mjs',import.meta.url).href)};const s=new Store(process.argv[1]);s.set('checkpoint',{status:'waiting',receipt:'already-applied'});process.send('locked');setTimeout(()=>{s.close();process.exit(0);},300);`;
  child=fork('--eval',[source,dir],{execArgv:['--input-type=module'],stdio:['ignore','ignore','pipe','ipc']});await once(child,'message');const started=performance.now();store=new Store(dir,{ownerWaitMs:2400});assert.ok(performance.now()-started>=200);assert.deepEqual(store.get('checkpoint'),{status:'waiting',receipt:'already-applied'});
 }finally{store?.close();child?.kill();await rm(dir,{recursive:true,force:true});}
});
test('ownership wait is bounded and ordinary stores still fail immediately',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'worker-store-'));const owner=new Store(dir);try{let started=performance.now();assert.throws(()=>new Store(dir),/project_locked/);assert.ok(performance.now()-started<100);started=performance.now();assert.throws(()=>new Store(dir,{ownerWaitMs:100}),/project_locked/);assert.ok(performance.now()-started>=80);assert.ok(performance.now()-started<1000);assert.throws(()=>new Store(dir,{ownerWaitMs:-1}),/store_owner_wait/);}finally{owner.close();await rm(dir,{recursive:true,force:true});}
});
test('routine ownership waits at initialization before scheduler or project commands',async()=>{
 const source=await readFile(new URL('../runtime/service-entry.mjs',import.meta.url),'utf8');assert.match(source,/new Store\(path.join\(service.storageRoot,'routines'\),\{ownerWaitMs:2400\}\)/);
});
test('a brief lock on the shared database (closing mail list worker) waits instead of reporting project_locked',async()=>{
 // The mail list worker writes workspace.db and is terminated asynchronously; its last close may hold the file briefly.
 // Ownership stays immediate (owner.db); only the shared database open waits within busy_timeout.
 const dir=await mkdtemp(path.join(os.tmpdir(),'worker-store-'));let child,store;try{
  new Store(dir).close();
  const source=`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0);},300);`;
  child=fork('--eval',[source,path.join(dir,'workspace.db')],{execArgv:['--input-type=module'],stdio:['ignore','ignore','pipe','ipc']});await once(child,'message');
  store=new Store(dir);store.set('after','ok');assert.equal(store.get('after'),'ok');
 }finally{store?.close();child?.kill();await rm(dir,{recursive:true,force:true});}
});
