import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {PersonalMail} from './helpers-personal-mail.mjs';
test('status and vault migration use indexed rollups and point lookups without materializing a mailbox',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-status-scale-')),mail=new PersonalMail({storageRoot:root},{personalRoot:path.join(root,'mail')});mail.autoWiki=false;
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 mail.rows=()=>{throw Error('whole_mailbox_materialized');};
 for(let i=0;i<2;i++)mail.store.set('mail:'+i,{id:String(i),protocol:'local',state:'indexed',sourceHash:'h'+i,subject:'목록'+i});
 const status=mail.status();assert.equal(status.counts.received,2);assert.equal(status.localCount,2);assert.equal(status.messages.length,2);await mail.ensureRaw();await mail.rawMigration;assert.equal(mail.rawVault.progress.state,'completed');
});
