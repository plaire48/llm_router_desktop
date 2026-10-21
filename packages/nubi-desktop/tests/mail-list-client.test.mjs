import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../runtime/store.mjs';import {MailSearch} from '../runtime/mail-search.mjs';
test('production SQLite worker serves a bounded list without owner.rows/read and closes explicitly',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-list-'));const store=new Store(root);
 const search=new MailSearch({store,rows(){throw Error('full_collection_forbidden');},read(){throw Error('body_read_forbidden');}});
 t.after(async()=>{await search.dispose();store.close();await rm(root,{recursive:true,force:true});});
 for(let i=0;i<105;i++)store.set('mail:'+i,{id:String(i),sourceHash:'h'+i,subject:'합성 '+i,date:new Date(Date.UTC(2026,0,1+i)).toISOString()});
 const first=await search.search({limit:20});assert.equal(first.total,105);assert.equal(first.results.length,20);assert.equal(first.results[0].id,'104');assert.equal(first.results[0].attachmentCount,null);assert.equal(first.retrieval.incomplete,true);
 const second=await search.search({limit:20,cursor:first.nextCursor});assert.equal(second.results[0].id,'84');
 store.set('mail:104',{id:'104',sourceHash:'new-hash',subject:'합성 104',date:'2027-01-01'});
 assert.equal((await search.search({limit:20,cursor:first.nextCursor})).reset,true);
});
test('a concurrent source commit cannot mix a new revision with an old listing snapshot',async t=>{
 const {DatabaseSync}=await import('node:sqlite');const {MailListIndex}=await import('../runtime/mail-list-index.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-snapshot-')),store=new Store(root),reader=new DatabaseSync(path.join(root,'workspace.db'));
 t.after(async()=>{reader.close();store.close();await rm(root,{recursive:true,force:true});});
 store.set('mail:a',{id:'a',sourceHash:'before',date:'2026-10-21'});store.set('mail:b',{id:'b',sourceHash:'b',date:'2026-10-20'});
 const index=new MailListIndex(reader);index.sync();
 const snapshot=index.readSnapshot(()=>{store.set('mail:a',{id:'a',sourceHash:'after',date:'2026-10-21'});return index.page({limit:1});});
 assert.equal(snapshot.value.items[0].row.sourceHash,'before');assert.equal(index.readSnapshot(()=>assert.fail('dirty snapshots must retry')).retry,true);
 index.sync();const next=index.readSnapshot(()=>index.page({limit:1,cursor:snapshot.value.nextCursor})).value;
 assert.equal(next.reset,true);assert.equal(next.items[0].row.sourceHash,'after');
});
