import path from 'node:path';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {chmod,lstat,rm} from 'node:fs/promises';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {createPersistentWikiIndex} from '../generated/openwiki.mjs';
import {MAIL_RECIPIENT_ROLE_SQL} from './mail-recipient-role.mjs';

// The existing vault owns the key. No body, attachment text or new plaintext
// source cache is persisted here. FTS sees keyed tokens only.
export class PersistentMailSearch {
 constructor(owner,documents){this.owner=owner;this.store=owner.store;this.documents=documents;this.closed=false;}
 async ready(){
  if(this.closed)throw Error('mail_cancelled');
  if(this.readyTask)return this.readyTask;
  this.readyTask=(async()=>{
   const vault=this.owner.host?.connectionVault;if(!vault)throw Error('mail_encryption_unavailable');
   const filename=path.join(this.store.directory,'mail-search.db');
   try{if((await lstat(filename)).isSymbolicLink())throw Error('mail_source_changed');}catch(e){if(e.code!=='ENOENT')throw e;}
   let key=await vault.get('mail-search-key');
   if(this.closed)throw Error('mail_cancelled');
   if(!key){key=randomBytes(32).toString('hex');await vault.set('mail-search-key',key);if(await vault.get('mail-search-key')!==key)throw Error('mail_encryption_unavailable');}
   if(!/^[a-f0-9]{64}$/.test(key))throw Error('mail_encryption_unavailable');
   this.key=Buffer.from(key,'hex');
   const options={filename,namespace:'personal-mail-v1',codecId:createHash('sha256').update(this.key).digest('hex'),encodeToken:token=>createHmac('sha256',this.key).update(token).digest('hex')};
   try{this.index=await createPersistentWikiIndex(options);}catch(error){if(error.message!=='index_schema_changed')throw error;for(const suffix of ['','-wal','-shm'])await rm(filename+suffix,{force:true});this.index=await createPersistentWikiIndex(options);}
   if(this.closed)throw Error('mail_cancelled');
   await chmod(filename,0o600);
   const db=this.store.db;
   db.exec(`CREATE TABLE IF NOT EXISTS mail_search_dirty(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 1,not_before INTEGER NOT NULL DEFAULT 0,error TEXT);
    CREATE TABLE IF NOT EXISTS mail_search_state(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mail_search_coverage(id TEXT PRIMARY KEY,body_truncated INTEGER NOT NULL,unread INTEGER NOT NULL);`);
   for(const action of ['INSERT','UPDATE','DELETE']){
    const row=action==='DELETE'?'OLD':'NEW';
    const id=`CASE WHEN ${row}.key GLOB 'mail:*' THEN substr(${row}.key,6) WHEN ${row}.key GLOB 'mail-user:*' THEN substr(${row}.key,11) WHEN ${row}.key GLOB 'mail-index:*' THEN substr(${row}.key,12) ELSE substr(substr(${row}.key,12),1,instr(substr(${row}.key,12),':')-1) END`;
    const relevant=action==='UPDATE'?` AND NOT(NEW.key GLOB 'mail:*' AND ${['sourceHash','manifestHash','attachmentState','path','wikiHash','contentVersion','account'].map(field=>`json_extract(OLD.value,'$.${field}') IS json_extract(NEW.value,'$.${field}')`).join(' AND ')})`:'';
    db.exec(`DROP TRIGGER IF EXISTS mail_search_dirty_${action.toLowerCase()}; CREATE TRIGGER mail_search_dirty_${action.toLowerCase()} AFTER ${action} ON records WHEN (${row}.key GLOB 'mail:*' OR ${row}.key GLOB 'attachment:*' OR ${row}.key GLOB 'mail-user:*' OR ${row}.key GLOB 'mail-index:*')${relevant} BEGIN
     UPDATE mail_search_dirty SET revision=revision+1,not_before=0,error=NULL WHERE id=${id};
     INSERT INTO mail_search_dirty(id) SELECT ${id} WHERE NOT EXISTS(SELECT 1 FROM mail_search_dirty WHERE id=${id}); END;`);
   }
   if(!db.prepare("SELECT 1 FROM mail_search_state WHERE key='seed-v1'").get()){
    db.exec("BEGIN IMMEDIATE; INSERT OR IGNORE INTO mail_search_dirty(id) SELECT substr(key,6) FROM records WHERE key GLOB 'mail:*'; INSERT INTO mail_search_state VALUES('seed-v1','done'); COMMIT;");
   }
   // A derived index removed without removing the source DB must be rebuildable.
   if(!this.index.count()&&db.prepare("SELECT 1 FROM records WHERE key GLOB 'mail:*' LIMIT 1").get())
    db.exec("INSERT OR IGNORE INTO mail_search_dirty(id) SELECT substr(key,6) FROM records WHERE key GLOB 'mail:*'");
   this.schedule();return this;
  })();
  try{return await this.readyTask;}catch(error){this.readyTask=null;throw error;}
 }
 markDirty(id){
  if(this.closed||!this.index)return;
  this.store.db.prepare('UPDATE mail_search_dirty SET revision=revision+1,not_before=0,error=NULL WHERE id=?').run(id);
  this.store.db.prepare('INSERT INTO mail_search_dirty(id) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM mail_search_dirty WHERE id=?)').run(id,id);this.schedule();
 }
 schedule(){if(this.closed||this.timer)return;this.timer=setTimeout(()=>{this.timer=null;void this.pump({max:32,budgetMs:80}).catch(()=>{}).finally(()=>{if(!this.closed&&this.store.db.isOpen&&this.store.db.prepare('SELECT 1 FROM mail_search_dirty WHERE not_before<=? LIMIT 1').get(Date.now()))this.schedule();});},25);this.timer.unref?.();}
 pump({max=8,budgetMs=60}={}){
  if(this.running)return this.running;
  this.running=(async()=>{
   const at=performance.now();let processed=0;const prepared=[];
   const batch=this.store.db.prepare('SELECT id,revision FROM mail_search_dirty WHERE not_before<=? ORDER BY rowid LIMIT ?').all(Date.now(),max);
   for(const dirty of batch){
    if(this.closed||performance.now()-at>=budgetMs)break;
    try{
     const row=this.store.get('mail:'+dirty.id);
     if(!row)prepared.push({dirty,remove:true});
     else{
      const source=await this.owner.read(dirty.id);if(this.closed)return;
      const knowledge=await this.owner.readKnowledge(row);if(this.closed)return;
      const local={tags:[],...this.store.get('mail-user:'+row.id)};
      const parts=this.documents({row,mail:source.mail,knowledge:knowledge.text,knowledgeChanged:knowledge.changed},local);
      const signature=await this.owner.searchSignature(row);if(this.closed)return;
      if(this.store.get('mail:'+row.id)?.sourceHash!==row.sourceHash)throw Error('mail_source_changed');
      const version=createHash('sha256').update(JSON.stringify([signature,local.tags])).digest('hex');
      prepared.push({dirty,row,coverage:{truncated:source.mail.truncated===true||source.mail.coverage?.complete===false||source.mail.coverage?.completeMessage===false||source.mail.coverage?.originalMimeAvailable===false,unread:(source.mail.coverage?.attachmentsRead===false?1:0)+source.mail.attachments.filter(a=>!['document_read','text_read'].includes(a.contentState)||a.coverage?.truncated||a.coverage?.complete===false).length},document:{id:row.id,version,scope:row.account||'',units:parts.map((part,i)=>({id:String(i),title:part.kind==='subject'?part.searchText:'',text:part.searchText,hints:part.text===part.searchText?'':part.text,start:part.start,end:part.start+part.text.length,metadata:{kind:part.kind,attachmentId:part.attachmentId||null}}))}});
     }
     // Acknowledge only after the complete durable index batch commits.
    }catch(error){if(this.closed)return;this.store.db.prepare('UPDATE mail_search_dirty SET not_before=?,error=? WHERE id=? AND revision=?').run(Date.now()+60000,/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_source_unavailable',dirty.id,dirty.revision);}
    processed++;await yieldTurn();
   }
   if(this.closed)return;
   this.index.transaction(()=>{for(const item of prepared){if(item.remove)this.index.remove(item.dirty.id);else this.index.replace(item.document);}});
   const bulk=this.owner.autoWiki&&Number(this.store.db.prepare('SELECT count(*) n FROM mail_list').get().n)>=10000;
   for(const {dirty,row,coverage} of prepared){if(coverage)this.store.db.prepare('INSERT INTO mail_search_coverage VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body_truncated=excluded.body_truncated,unread=excluded.unread').run(dirty.id,+coverage.truncated,coverage.unread);else this.store.db.prepare('DELETE FROM mail_search_coverage WHERE id=?').run(dirty.id);if(bulk&&row?.state==='queued'&&this.store.get('mail:'+row.id)?.sourceHash===row.sourceHash)this.store.set('mail:'+row.id,{...row,state:'indexed',organizationMode:'topic',indexedAt:new Date().toISOString()});this.store.db.prepare('DELETE FROM mail_search_dirty WHERE id=? AND revision=?').run(dirty.id,dirty.revision);}
   return processed;
  })().finally(()=>{this.running=null;});return this.running;
 }
 eligible(filters,relatedTo){
  const base=this.store.mailList.where(filters),clauses=base.sql?[base.sql.slice(7)]:[],args=[...base.args];
  if(filters.roles?.length){clauses.push(`${MAIL_RECIPIENT_ROLE_SQL} IN (${filters.roles.map(()=>'?').join(',')})`);args.push(...filters.roles);}
  if(filters.filename){clauses.push("m.known=1 AND EXISTS(SELECT 1 FROM json_each(m.metadata,'$.mail.attachments') a WHERE nubi_mail_contains(json_extract(a.value,'$.filename'),?))");args.push(filters.filename);}
  if(filters.types?.length){clauses.push(`m.known=1 AND EXISTS(SELECT 1 FROM json_each(m.metadata,'$.mail.attachments') a WHERE nubi_mail_kind(json_extract(a.value,'$.filename'),json_extract(a.value,'$.contentType')) IN (${filters.types.map(()=>'?').join(',')}))`);args.push(...filters.types);}
  if(relatedTo){const root=this.store.db.prepare('SELECT account,thread FROM mail_list WHERE id=?').get(relatedTo);if(!root)throw Error('mail_missing');clauses.push('m.account=? AND m.thread=? AND m.id!=?');args.push(root.account,root.thread,relatedTo);}
  if(!clauses.length)return undefined;
  return [...this.store.db.prepare("SELECT m.id FROM mail_list m LEFT JOIN records u ON u.key='mail-user:'||m.id WHERE "+clauses.join(' AND ')).iterate(...args)].map(row=>row.id);
 }
 async candidates(query,{filters,relatedTo}){
  await this.ready();await this.pump();if(this.closed)throw Error('mail_cancelled');
  const hits=this.index.search(query,{mode:'all',limit:512,documentIds:this.eligible(filters,relatedTo),kinds:filters.locations?.length?filters.locations:undefined}),ids=[...new Set(hits.map(hit=>hit.documentId))];
  const pending=Number(this.store.db.prepare('SELECT count(*) n FROM mail_search_dirty').get().n),failed=Number(this.store.db.prepare('SELECT count(*) n FROM mail_search_dirty WHERE error IS NOT NULL').get().n);
  this.schedule();return {rows:ids.map(id=>this.store.get('mail:'+id)).filter(Boolean),incompleteSources:Number(this.store.db.prepare('SELECT count(*) n FROM mail_search_coverage WHERE body_truncated=1 OR unread>0').get().n),collected:Number(this.store.db.prepare('SELECT count(*) n FROM mail_list').get().n),indexed:this.index.count(),pending,failed,candidateLimited:hits.length===512};
 }
 progress(){if(this.closed||!this.index)return null;return {indexed:this.index.count(),pending:Number(this.store.db.prepare('SELECT count(*) n FROM mail_search_dirty').get().n)};}
 dispose(){this.closed=true;clearTimeout(this.timer);return Promise.allSettled([this.readyTask,this.running]).then(()=>{this.index?.close();this.key?.fill(0);});}
}
