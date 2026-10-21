import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MailListIndex} from '../runtime/mail-list-index.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE records(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const put=(key,value)=>db.prepare('INSERT OR REPLACE INTO records VALUES (?,?)').run(key,JSON.stringify(value));
 for(let i=0;i<120;i++){
  const row={id:'m'+String(i).padStart(3,'0'),account:i===119?'other':'a',sourceHash:'h'+i,subject:'합성 검토',from:'sender@example.test',date:new Date(Date.UTC(2026,0,1+i)).toISOString(),state:'saved'};
  put('mail:'+row.id,row);put('mail-index:'+row.id,{version:3,row,mail:{subject:row.subject,from:row.from,to:'team@example.test',date:row.date,messageId:'<m'+i+'>',references:['<root>'],attachments:[{filename:'synthetic.pdf',text:'DO_NOT_PROJECT_ATTACHMENT'}],text:'DO_NOT_PROJECT_BODY'}});
 }
 return {db,put,index:new MailListIndex(db)};
}
test('SQLite pages metadata before allocation, preserves stable order and never returns body',t=>{
 const {index}=fixture(t);index.sync();const first=index.page({limit:20}),next=index.page({limit:20,page:2});
 assert.equal(first.total,120);assert.equal(first.items.length,20);assert.equal(first.items[0].row.id,'m119');assert.equal(next.items[0].row.id,'m099');
 assert(!JSON.stringify(first.items.map(({snippet,...item})=>item)).includes('DO_NOT_PROJECT'));assert(!JSON.stringify(first).includes('DO_NOT_PROJECT_ATTACHMENT'));assert.equal(first.items[0].mail.attachments.length,1);
 assert(index.explain().some(line=>line.includes('nubi_mail_list_date')));
});
test('dirty updates, deletions and cursor snapshots cannot return stale source hashes',t=>{
 const {index,put,db}=fixture(t);index.sync();const a=index.page({limit:10});
 put('mail:m119',{id:'m119',account:'other',date:'2027-01-01',sourceHash:'changed',subject:'changed',state:'queued'});index.sync();
 const b=index.page({limit:10,cursor:a.nextCursor});assert.equal(b.reset,true);assert.equal(b.items[0].row.sourceHash,'changed');assert.equal(b.items[0].metadataKnown,false);
 db.prepare('DELETE FROM records WHERE key=?').run('mail:m119');index.sync();assert.equal(index.page({limit:10}).total,119);
});
test('thread cards stay within account and report observed metadata, not task completion',t=>{
 const {index}=fixture(t);index.sync();const card=index.thread('m001');
 assert.equal(card.count,119);assert.equal(card.attachmentCount,119);assert.equal(card.items.length,20);assert.equal(card.hasMore,true);assert.equal(card.state,'saved');
 assert(!card.items.some(x=>x.id==='m119'));assert.deepEqual(card.participants,['sender@example.test','team@example.test']);
 assert.equal(index.thread('m119').count,1);
});
test('metadata absent is unknown and a deleted cache removes old thread evidence',t=>{
 const {index,put,db}=fixture(t);index.sync();put('mail:missing',{id:'missing',subject:'다른 합성',sourceHash:'x',account:'a'});index.sync();
 const missing=index.thread('missing');assert.equal(missing.attachmentCount,null);assert.equal(missing.incomplete,true);
 db.prepare('DELETE FROM records WHERE key=?').run('mail-index:m001');index.sync();assert.equal(index.thread('m002').count,118);
});
test('filters precede paging and pinned metadata changes invalidate cursors',t=>{
 const {index,put}=fixture(t);index.sync();put('mail-user:m001',{pinned:true,tags:['합성']});
 const r=index.page({limit:10,filters:{pinned:true}});assert.equal(r.total,1);assert.equal(r.items[0].row.id,'m001');
 assert.throws(()=>index.page({limit:100000}),/mail_input_invalid/);
 assert.throws(()=>index.page({limit:10,cursor:'garbage'}),/mail_input_invalid/);
});
test('disk status counts and latest completed timing match the existing scoped contract',t=>{
 const {index,put}=fixture(t);
 put('mail:m001',{id:'m001',account:'a',state:'attention',error:'mail_summary_failed',attachmentState:'attention',attachmentFailures:[{error:'document_read_failed'}]});
 put('mail:m002',{id:'m002',account:'a',state:'saved',savedAt:'2026-10-21',summaryTiming:{state:'completed',elapsedMs:12}});
 put('mail:m003',{id:'m003',account:'a',state:'attention',error:'mail_cancelled'});index.sync();
 const stats=index.stats({account:'a',attachmentReading:true});assert.equal(stats.received,120);assert.equal(stats.scopedSaved,117);assert.deepEqual(stats.attention,{total:1,summary:1,attachment:1});assert.equal(stats.lastTiming.elapsedMs,12);
});
test('RFC mail dates filter like Date.parse and unknown attachment coverage remains explicit',t=>{
 const {index,put}=fixture(t);put('mail:rfc',{id:'rfc',subject:'합성 날짜',date:'Wed, 21 Oct 2026 12:00:00 +0900',sourceHash:'rfc'});index.sync();
 const result=index.page({filters:{period:'custom',from:'2026-10-21',to:'2026-10-21'}});assert.equal(result.total,1);assert.equal(result.unknownMetadata,1);
 assert.equal(index.page({filters:{attachment:'with',subject:'합성 날짜'}}).unknownMetadata,1);
});
test('ingestion metadata is hash bound and never restores a previous original projection',t=>{
 const {index,put}=fixture(t);put('mail:new',{id:'new',sourceHash:'first',subject:'합성',listMetadata:{sourceHash:'first',subject:'합성',attachments:[{filename:'sample.pdf'}]}});index.sync();assert.equal(index.thread('new').attachmentCount,1);
 put('mail:new',{id:'new',sourceHash:'second',subject:'합성',listMetadata:{sourceHash:'first',subject:'합성',attachments:[{filename:'sample.pdf'}]}});index.sync();assert.equal(index.thread('new').attachmentCount,null);
});

test('a current ingestion projection never exposes a stale cached body snippet',t=>{
 const {index,put}=fixture(t);index.sync();
 put('mail:m119',{id:'m119',account:'other',sourceHash:'new',date:'2027-01-01',listMetadata:{sourceHash:'new',subject:'새 합성 메일',attachments:[]}});index.sync();
 const item=index.page({limit:1}).items[0];assert.equal(item.row.id,'m119');assert.equal(item.metadataKnown,true);assert.equal(item.snippet,'');
});
test('a mail record written again while it waits for the list is not refused (Windows startup migration)',async()=>{
 // A record write is an upsert, and SQLite lets the outer statement's conflict policy override the trigger's
 // INSERT OR IGNORE: the second write of a dirty record failed with UNIQUE on nubi_mail_list_dirty (Windows gates
 // 2026-10-21, office-reader migration re-saving every mail at startup).
 const {mkdtempSync,rmSync}=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{Store}=await import('../runtime/store.mjs');
 const dir=mkdtempSync(path.join(os.tmpdir(),'mail-list-dirty-'));
 try{
  const plain=new Store(dir);plain.set('mail:retained',{id:'retained',state:'saved'});plain.close();
  const store=new Store(dir,{mailList:true});
  try{store.set('mail:retained',{id:'retained',state:'saved',attachmentState:'queued'});store.set('mail:retained',{id:'retained',state:'saved'});
   assert.equal(store.db.prepare("SELECT count(*) n FROM nubi_mail_list_dirty WHERE id='retained'").get().n<=1,true);}
  finally{store.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
