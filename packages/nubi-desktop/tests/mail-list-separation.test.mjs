import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Store} from '../runtime/store.mjs';import {MailListService} from '../runtime/mail-list-service.mjs';
async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'mail-list-separate-')),store=new Store(directory,{mailList:true}),owner={store,rows(){throw Error('whole_collection_forbidden');},read(){throw Error('original_read_forbidden');}};const list=new MailListService(owner);t.after(async()=>{await list.dispose();store.close();await rm(directory,{recursive:true,force:true});});return {store,list};}
test('collection writes metadata atomically and list/search never reads a body',async t=>{const {store,list}=await fixture(t);store.set('mail:a',{id:'a',sourceHash:'ha',subject:'합성 계약 검토',from:'review@example.test',date:'2026-10-21',listMetadata:{sourceHash:'ha',subject:'합성 계약 검토',from:'review@example.test',attachments:[]}});store.set('mail-index:a',{version:3,row:{sourceHash:'ha'},mail:{subject:'합성 계약 검토',from:'review@example.test',text:'BODY_ONLY_SENTINEL',attachments:[]}});
 assert.equal(store.db.prepare('SELECT count(*) n FROM mail_list').get().n,1);
 const page=await list.search({});assert.equal(page.results.length,1);assert(!JSON.stringify(page).includes('BODY_ONLY_SENTINEL'));
 assert.equal((await list.search({query:'계약 review'})).total,1);assert.equal((await list.search({query:'BODY_ONLY_SENTINEL'})).total,0);assert.equal((await list.search({query:'계약'})).searchNotice,'본문 검색은 준비 중');
 store.delete('mail:a');assert.equal(store.db.prepare('SELECT count(*) n FROM mail_list').get().n,0);
});
test('keyset pages handle equal timestamps and reject a cursor from another query',async t=>{const {store,list}=await fixture(t);for(let i=0;i<125;i++)store.set('mail:'+String(i).padStart(3,'0'),{id:String(i).padStart(3,'0'),sourceHash:'h'+i,subject:'합성 '+i,date:'2026-10-21'});
 // IDs in the storage keys are the source IDs.
 const seen=new Set();let cursor;do{const p=await list.search({limit:50,cursor});for(const r of p.results){assert(!seen.has(r.id));seen.add(r.id);}cursor=p.nextCursor;}while(cursor);assert.equal(seen.size,125);
 const first=await list.search({limit:50});assert.equal(JSON.parse(Buffer.from(first.nextCursor,'base64url')).kind,'keyset');assert.equal((await list.search({query:'다른',cursor:first.nextCursor})).reset,true);
});
test('metadata projection failure rolls the source write back in the same transaction',async t=>{const {store}=await fixture(t);const sync=store.mailList.syncKey.bind(store.mailList);store.mailList.syncKey=key=>{sync(key);throw Error('injected_projection_failure');};assert.throws(()=>store.set('mail:rollback',{id:'rollback',subject:'합성'}),/injected/);assert.equal(store.get('mail:rollback'),null);assert.equal(store.db.prepare('SELECT count(*) n FROM mail_list').get().n,0);store.mailList.syncKey=sync;});
test('LIKE wildcard characters are literals and unsupported body locations never broaden scope',async t=>{const {store,list}=await fixture(t);store.set('mail:a',{id:'a',subject:'합성 100%_완료',from:'a@example.test'});store.set('mail:b',{id:'b',subject:'합성 100xx완료',from:'b@example.test'});assert.equal((await list.search({query:'100%_'})).total,1);assert.equal((await list.search({query:'합성',filters:{locations:['body']}})).total,0);store.set('mail-user:a',{pinned:true,tags:['합성']});assert.equal(JSON.parse(store.db.prepare("SELECT flags FROM mail_list WHERE id='a'").get().flags).pinned,true);});
test('small real stores read bodies lazily without writing a plaintext search cache',async t=>{
 const {store,list}=await fixture(t);let reads=0;
 const owner={store,rows:()=>store.list('mail:'),searchSignature:async row=>row.sourceHash,read:async()=>{reads++;return {mail:{subject:'합성',from:'a@example.test',text:'본문만존재',attachments:[]}};},readKnowledge:async()=>({text:'수정한위키'})};
 store.set('mail:a',{id:'a',subject:'합성',sourceHash:'h'});
 await list.search({});await list.facets();assert.equal(reads,0);
 const {MailSearch}=await import('../runtime/mail-search.mjs'),search=new MailSearch(owner);t.after(()=>search.dispose());
 assert.equal((await search.search({query:'본문만존재'})).total,1);assert.equal((await search.search({query:'수정한위키'})).total,1);
 assert.equal(store.get('mail-index:a'),null);
 store.set('setting:mail-search-max-count',1);
 assert.equal((await search.search({query:'본문만존재'})).searchMode,'metadata');assert.equal(reads,1);
});
test('large estimated index skips body reads and metadata includes recipients',async t=>{
 const {store,list}=await fixture(t);store.set('mail:a',{id:'a',sourceHash:'h',searchEstimateBytes:220*1024*1024,listMetadata:{sourceHash:'h',subject:'합성',from:'a@example.test',to:'recipient@example.test',attachments:[]}});
 assert.equal((await list.search({query:'recipient@example.test'})).total,1);
 const {MailSearch}=await import('../runtime/mail-search.mjs'),search=new MailSearch({store,rows(){throw Error('no bodies');}});t.after(()=>search.dispose());
 assert.equal((await search.search({query:'본문'})).searchMode,'metadata');
});
test('a source larger than its estimate falls back without a persistent body cache',async t=>{
 const {store}=await fixture(t);store.set('mail:a',{id:'a',subject:'합성',sourceHash:'h'});store.set('setting:mail-search-max-bytes',32768);
 const {MailSearch}=await import('../runtime/mail-search.mjs');const search=new MailSearch({store,searchSignature:async()=> 'h',read:async()=>({mail:{subject:'합성',text:'본문'.repeat(4000),attachments:[]}}),readKnowledge:async()=>({text:''})});t.after(()=>search.dispose());
 const packet=await search.search({query:'본문'});assert.equal(packet.searchMode,'metadata');assert.equal(packet.bodySearchAvailable,false);assert.equal(search.memoryCache.size,0);assert.equal(store.get('mail-index:a'),null);
});
test('metadata search keeps explicit subject scope and short Latin word boundaries',async t=>{
 const {store,list}=await fixture(t);store.set('mail:a',{id:'a',sourceHash:'h',listMetadata:{sourceHash:'h',subject:'Mail notice',from:'sender@example.test',to:'onlyrecipient@example.test',attachments:[]}});
 assert.equal((await list.search({query:'onlyrecipient'})).total,1);assert.equal((await list.search({query:'onlyrecipient',filters:{locations:['subject']}})).total,0);assert.equal((await list.search({query:'AI'})).total,0);
 store.set('mail:b',{id:'b',subject:'AI 업무'});assert.equal((await list.search({query:'AI'})).total,1);
});
