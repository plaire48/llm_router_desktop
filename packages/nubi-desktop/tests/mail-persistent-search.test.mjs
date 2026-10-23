import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Store} from '../runtime/store.mjs';import {MailSearch} from '../runtime/mail-search.mjs';

test('large mailboxes search body evidence, persist privately and update only dirty sources',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-persistent-')),store=new Store(root,{mailList:true}),keys=new Map(),sources=new Map();
 const vault={get:async k=>keys.get(k),set:async(k,v)=>keys.set(k,v)};let reads=0;
 const owner={store,host:{connectionVault:vault},rows(){throw Error('whole_mailbox_read');},searchSignature:async r=>r.sourceHash,read:async id=>{reads++;return {mail:sources.get(id)};},readKnowledge:async()=>({text:''})};
 const search=new MailSearch(owner);t.after(async()=>{await search.dispose();store.close();await rm(root,{recursive:true,force:true});});
 store.set('setting:mail-search-max-count',1);
 const put=(id,text,hash)=>{sources.set(id,{subject:'Atlas',from:'pm@example.test',text,attachments:[]});store.set('mail:'+id,{id,account:'fixture',sourceHash:hash,state:'saved',listMetadata:{sourceHash:hash,subject:'Atlas',from:'pm@example.test',attachments:[]}});};
 put('one','PrivateZephyr 승인되었습니다.','h1');put('two','다른 업무입니다.','h2');
 let result;for(let i=0;i<10;i++){result=await search.search({query:'PrivateZephyr 승인'});if(!result.retrieval.incomplete)break;}
 assert.equal(result.searchMode,'fulltext');assert.deepEqual(result.results.map(r=>r.id),['one']);
 assert.equal(result.results[0].recipientRole,'bcc');
 assert.deepEqual((await search.search({query:'PrivateZephyr 승인',filters:{roles:['bcc']}})).results.map(r=>r.id),['one']);
 assert.deepEqual((await search.search({query:'PrivateZephyr 승인',filters:{roles:['unknown']}})).results.map(r=>r.id),['one']);
 const before=reads;await search.search({query:'PrivateZephyr 승인'});assert(reads-before<=1,'warm query reads only selected original');
 put('one','일정은 금요일입니다.','h3');
 for(let i=0;i<10;i++){result=await search.search({query:'PrivateZephyr'});if(!result.retrieval.incomplete)break;}
 assert.equal(result.total,0);
 await search.dispose();
 const bytes=await readFile(path.join(root,'mail-search.db'));assert(!bytes.includes(Buffer.from('PrivateZephyr')));
});
