import {mailTermPosition} from './mail-text.mjs';
import {createHash} from 'node:crypto';
import {threadKey} from './mail-thread.mjs';
import {mailAddresses} from './mail-presentation.mjs';
import {DESKTOP_FEATURES} from './beta-features.mjs';
import {mailAttention} from './mail-attention.mjs';
import {APPROVAL_KINDS} from './mail-file-kinds.mjs';

const normalized=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase();
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const rowFields=['id','account','searchEstimateBytes','sourceHash','subject','from','date','fetchedAt','savedAt','state','attachmentState','mailbox','folderId','protocol','recipientRole','error','attachmentFailures','attachmentProgress','summaryTiming','path'];
const rowProjection="json_remove(r.value,'$.prepared','$.listMetadata','$.text','$.html')";
// Source queue rows are read in bounded batches; prepared Wiki text is removed.
// Only allowlisted metadata is retained. Mail bodies and attachment text are not
// copied into this catalog. This is not an FTS index.
const sourceProjection=`json_object('subject',json_extract(c.value,'$.mail.subject'),'from',json_extract(c.value,'$.mail.from'),
 'to',json_extract(c.value,'$.mail.to'),'cc',json_extract(c.value,'$.mail.cc'),'bcc',json_extract(c.value,'$.mail.bcc'),
 'date',json_extract(c.value,'$.mail.date'),'messageId',json_extract(c.value,'$.mail.messageId'),
 'inReplyTo',json_extract(c.value,'$.mail.inReplyTo'),'references',json(json_extract(c.value,'$.mail.references')),
 'sender',json(json_extract(c.value,'$.mail.sender')),'receivedAddress',json_extract(c.value,'$.mail.receivedAddress'),
 'recipientAddresses',json(json_extract(c.value,'$.mail.recipientAddresses')),
 'attachments',json((SELECT json_group_array(json_object('filename',json_extract(a.value,'$.filename'),'contentType',json_extract(a.value,'$.contentType'),'contentState',json_extract(a.value,'$.contentState'))) FROM json_each(c.value,'$.mail.attachments') a)))`;

export function supportsDiskMailList({query='',sort='newest',relatedTo,filters={}}={}){
 // Preserve existing full-text ranking and locale-aware column sorting until
 // their disk search implementation is approved. Never narrow a body query.
 return !query.trim()&&!relatedTo&&['newest','oldest'].includes(sort)&&!(filters.roles?.length)&&!(filters.types?.length)&&!filters.filename;
}
export class MailListIndex {
 constructor(db){
  this.db=db;
  db.function('nubi_mail_kind',(name,type)=>{const text=String(name||'')+' '+String(type||'');return /\.pdf\b|application\/pdf/i.test(text)?'pdf':/\.(doc|docx|docm|dot|dotx|dotm)\b|word/i.test(text)?'word':/\.(xls|xlsx|xlsm|xlt|xltx|xltm)\b|excel|spreadsheet/i.test(text)?'excel':/\.(ppt|pptx|pptm|pps|ppsx|ppsm|pot|potx|potm)\b|presentation|powerpoint/i.test(text)?'powerpoint':'other';});
  db.function('nubi_mail_term',(text,term)=>mailTermPosition(String(text||'').toLocaleLowerCase(),term)>=0?1:0);
  db.function('nubi_mail_contains',(a,b)=>normalized(a).includes(normalized(b))?1:0);
  db.function('nubi_mail_sender',(a,b)=>{const s=normalized(b);return s.startsWith('@')?+mailAddresses(a).some(x=>normalized(x).endsWith(s)):+normalized(a).includes(s);});
  db.exec("CREATE INDEX IF NOT EXISTS nubi_mail_record_state ON records(coalesce(json_extract(value,'$.state'),'')) WHERE key GLOB 'mail:*'; CREATE INDEX IF NOT EXISTS nubi_mail_record_attachment ON records(coalesce(json_extract(value,'$.attachmentState'),'')) WHERE key GLOB 'mail:*'");
  db.exec(`CREATE TABLE IF NOT EXISTS mail_list(id TEXT PRIMARY KEY,account TEXT NOT NULL,thread TEXT NOT NULL,stamp REAL NOT NULL,state TEXT,mailbox TEXT,protocol TEXT,folder TEXT,known INTEGER NOT NULL,metadata TEXT NOT NULL, flags TEXT NOT NULL DEFAULT '{}', updatedAt TEXT, date REAL GENERATED ALWAYS AS (stamp) VIRTUAL, "from" TEXT GENERATED ALWAYS AS (json_extract(metadata,'$.mail.from')) STORED, subject TEXT GENERATED ALWAYS AS (json_extract(metadata,'$.mail.subject')) STORED, attachmentCount INTEGER GENERATED ALWAYS AS (CASE WHEN known=1 THEN json_array_length(metadata,'$.mail.attachments') END) STORED);
   CREATE TABLE IF NOT EXISTS nubi_mail_list_dirty(id TEXT PRIMARY KEY);
   CREATE TABLE IF NOT EXISTS nubi_mail_list_meta(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL);
   INSERT OR IGNORE INTO nubi_mail_list_meta VALUES(1,0);
   DROP TABLE IF EXISTS nubi_mail_list;`);
  if(!db.prepare('PRAGMA table_xinfo(mail_list)').all().some(column=>column.name==='recipient'))db.exec("ALTER TABLE mail_list ADD COLUMN recipient TEXT GENERATED ALWAYS AS (json_extract(metadata,'$.mail.to')) VIRTUAL");
  for(const action of ['INSERT','UPDATE','DELETE']){
   const value=action==='DELETE'?'OLD':'NEW';
   // A record write is an upsert, and SQLite lets the firing statement's conflict policy override a trigger's
   // INSERT OR IGNORE: the second write of a record already waiting here failed with UNIQUE (Windows startup migration,
   // 2026-10-21). The trigger inserts only a missing id, and is recreated so databases with the old one are fixed.
   const name=`nubi_mail_list_${action.toLowerCase()}`;
   db.exec(`BEGIN IMMEDIATE; DROP TRIGGER IF EXISTS ${name}; CREATE TRIGGER ${name} AFTER ${action} ON records
    WHEN ${value}.key GLOB 'mail:*' OR ${value}.key GLOB 'mail-index:*' OR ${value}.key GLOB 'mail-user:*' OR ${value}.key GLOB 'mail-identit*'
    BEGIN
     UPDATE nubi_mail_list_meta SET revision=revision+1 WHERE id=1;
     INSERT INTO nubi_mail_list_dirty SELECT substr(${value}.key,6) WHERE ${value}.key GLOB 'mail:*' AND NOT EXISTS (SELECT 1 FROM nubi_mail_list_dirty WHERE id=substr(${value}.key,6));
     INSERT INTO nubi_mail_list_dirty SELECT substr(${value}.key,12) WHERE ${value}.key GLOB 'mail-index:*' AND NOT EXISTS (SELECT 1 FROM nubi_mail_list_dirty WHERE id=substr(${value}.key,12));
    END; COMMIT;`);
  }
  if(!db.prepare('SELECT 1 FROM nubi_mail_list_meta WHERE id=3').get()){
   db.exec("BEGIN IMMEDIATE; INSERT OR IGNORE INTO nubi_mail_list_dirty SELECT substr(key,6) FROM records WHERE key GLOB 'mail:*'; INSERT INTO nubi_mail_list_meta VALUES(3,0); COMMIT;");
  }
  this.readDirty=db.prepare(`SELECT d.id,${rowProjection} AS row,
   CASE WHEN json_extract(c.value,'$.version')=3 AND json_type(c.value,'$.mail.attachments')='array' AND json_extract(c.value,'$.row.sourceHash')=json_extract(r.value,'$.sourceHash') THEN ${sourceProjection} WHEN json_type(r.value,'$.listMetadata.attachments')='array' AND json_extract(r.value,'$.listMetadata.sourceHash')=json_extract(r.value,'$.sourceHash') THEN json_extract(r.value,'$.listMetadata') ELSE NULL END AS mail,
   r.key AS present FROM nubi_mail_list_dirty d LEFT JOIN records r ON r.key='mail:'||d.id LEFT JOIN records c ON c.key='mail-index:'||d.id LIMIT 256`);
  this.readOne=db.prepare(this.readDirty.sourceSQL.replace('LIMIT 256','WHERE d.id=?'));
  this.deleteItem=db.prepare('DELETE FROM mail_list WHERE id=?');
  this.clearDirty=db.prepare('DELETE FROM nubi_mail_list_dirty WHERE id=?');
  this.upsert=db.prepare(`INSERT INTO mail_list(id,account,thread,stamp,state,mailbox,protocol,folder,known,metadata,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET account=excluded.account,thread=excluded.thread,stamp=excluded.stamp,state=excluded.state,mailbox=excluded.mailbox,protocol=excluded.protocol,folder=excluded.folder,known=excluded.known,metadata=excluded.metadata,updatedAt=excluded.updatedAt`);
  if(!db.prepare('SELECT 1 FROM nubi_mail_list_dirty LIMIT 1').get())this.ensureIndexes();
 }
 syncKey(key){
  const id=key.startsWith('mail-index:')?key.slice(11):key.startsWith('mail:')?key.slice(5):null;
  if(id!==null){const item=this.readOne.get(id);if(item)this.project(item);}
  if(key.startsWith('mail-user:'))this.db.prepare("UPDATE mail_list SET flags=coalesce((SELECT value FROM records WHERE key=?),'{}') WHERE id=?").run(key,key.slice(10));
 }
 project(item){

    if(!item.present)this.deleteItem.run(item.id);
    else{
     const original=JSON.parse(item.row),row=Object.fromEntries(rowFields.filter(k=>original[k]!==undefined).map(k=>[k,original[k]])),known=!!item.mail,mail=known?JSON.parse(item.mail):{subject:row.subject,from:row.from,date:row.date,attachments:[]};
     row.id=item.id;mail.subject??=row.subject||'';mail.from??=row.from||'';mail.date??=row.date;mail.attachments||=[];
     const key=threadKey(mail)||'single:'+item.id,dateValue=Date.parse(mail.date),stamp=Number.isFinite(dateValue)?dateValue:Date.parse(row.fetchedAt)||0;
     const value={row,mail,metadataKnown:known,dateStamp:Number.isFinite(Date.parse(row.date))?Date.parse(row.date)/1000:null,fetchedStamp:Number.isFinite(Date.parse(row.fetchedAt))?Date.parse(row.fetchedAt)/1000:null};
     this.upsert.run(item.id,row.account||'',key,stamp,row.state||'',row.mailbox||'inbox',row.protocol||'',String(row.folderId??''),+known,JSON.stringify(value));
    }
    this.clearDirty.run(item.id);
 }
 syncBatch(){
  // The same transaction consumes a dirty mark and its observed record. A
  // concurrent ingest cannot lose an update between projection and deletion.
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const rows=this.readDirty.all();
   for(const item of rows)this.project(item);
   this.db.exec('COMMIT');return rows.length;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 readSnapshot(read){
  this.db.exec('BEGIN');
  try{
   if(this.db.prepare('SELECT 1 FROM nubi_mail_list_dirty LIMIT 1').get()){this.db.exec('ROLLBACK');return {retry:true};}
   const value=read();this.db.exec('COMMIT');return {value};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 ensureIndexes(){
  if(this.indexesReady)return;
  this.db.exec(`   CREATE INDEX IF NOT EXISTS nubi_mail_list_date ON mail_list(stamp DESC,id);   CREATE INDEX IF NOT EXISTS nubi_mail_list_known ON mail_list(known);   CREATE INDEX IF NOT EXISTS nubi_mail_list_protocol ON mail_list(protocol);   CREATE INDEX IF NOT EXISTS nubi_mail_list_saved ON mail_list(json_extract(metadata,'$.row.savedAt') DESC) WHERE state='saved';   CREATE INDEX IF NOT EXISTS nubi_mail_list_state ON mail_list(state);   CREATE INDEX IF NOT EXISTS nubi_mail_list_mailbox ON mail_list(mailbox,stamp DESC,id);   CREATE INDEX IF NOT EXISTS nubi_mail_list_thread ON mail_list(account,thread,stamp DESC,id); CREATE INDEX IF NOT EXISTS nubi_mail_list_attachment_state ON mail_list(json_extract(metadata,'$.row.attachmentState')); CREATE INDEX IF NOT EXISTS nubi_mail_list_search_v2 ON mail_list(subject,"from",recipient,stamp,id); CREATE INDEX IF NOT EXISTS nubi_mail_list_sender ON mail_list(json_extract(metadata,'$.mail.from')); CREATE INDEX IF NOT EXISTS nubi_mail_list_timing ON mail_list(json_extract(metadata,'$.row.savedAt') DESC) WHERE state='saved' AND json_extract(metadata,'$.row.summaryTiming.state')='completed';`);
  this.indexesReady=true;
 }
 sync(){while(this.syncBatch()){}this.ensureIndexes(); }
 where(filters={}){
  const clauses=[],args=[];const add=(sql,...values)=>{clauses.push(sql);args.push(...values);};
  if(filters.subject)add("nubi_mail_contains(json_extract(m.metadata,'$.mail.subject'),?)",filters.subject);
  if(filters.mailbox==='mail')add(`m.mailbox NOT IN (${APPROVAL_KINDS.map(()=>'?').join(',')})`,...APPROVAL_KINDS);
  else if(filters.mailbox?.startsWith('local:'))add("m.protocol='local' AND m.mailbox=?",filters.mailbox.slice(6));
  else if(filters.mailbox?.startsWith('folder:'))add('m.folder=?',filters.mailbox.slice(7));
  else if(filters.mailbox&&filters.mailbox!=='all')add('m.mailbox=?',filters.mailbox);
  if(filters.period&&filters.period!=='all'){
   const field=filters.dateField==='fetchedAt'?'fetchedAt':'date',date=`json_extract(m.metadata,'$.${field==='date'?'dateStamp':'fetchedStamp'}')`;
   if(filters.period==='unknown')add(`${date} IS NULL`);
   else{
    let from,to;
    if(['7','30'].includes(filters.period)){from=new Date();from.setHours(0,0,0,0);from.setDate(from.getDate()-Number(filters.period)+1);}
    else{if(filters.from)from=new Date(filters.from+'T00:00:00');if(filters.to){to=new Date(filters.to+'T00:00:00');to.setDate(to.getDate()+1);}}
    add(`${date} IS NOT NULL`);if(from)add(`${date}>=?`,from.getTime()/1000);if(to)add(`${date}<?`,to.getTime()/1000);
   }
  }
  if(filters.senders?.length)add('('+filters.senders.map(()=>"nubi_mail_sender(json_extract(m.metadata,'$.mail.from'),?)").join(' OR ')+')',...filters.senders);
  if(filters.states?.length)add(`(CASE WHEN m.state='attention' OR ${DESKTOP_FEATURES.mailAttachmentReading?"json_extract(m.metadata,'$.row.attachmentState')='attention'":'0'} THEN 'attention' WHEN m.state='saved' THEN 'saved' ELSE 'queued' END) IN (${filters.states.map(()=>'?').join(',')})`,...filters.states);
  if(filters.attachment&&filters.attachment!=='all')add(`json_extract(m.metadata,'$.metadataKnown')=1 AND json_array_length(m.metadata,'$.mail.attachments')${filters.attachment==='with'?'>':'='}0`);
  if(filters.pinned)add("json_extract(u.value,'$.pinned')=1");
  if(filters.confirmed&&filters.confirmed!=='all')add("coalesce(json_extract(u.value,'$.confirmed'),0)=?",+(filters.confirmed==='yes'));
  if(filters.tags?.length)add(`EXISTS(SELECT 1 FROM json_each(u.value,'$.tags') WHERE value IN (${filters.tags.map(()=>'?').join(',')}))`,...filters.tags);
  return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
 }
 page({limit=50,page,cursor,sort='newest',filters={},query='',relatedTo}={}){
  const sorts=['newest','oldest','relevance','subject-asc','subject-desc','sender-asc','sender-desc','role-asc','role-desc'];
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||page!==undefined&&(!Number.isSafeInteger(page)||page<1)||!sorts.includes(sort)||typeof query!=='string'||query.length>500)throw Error('mail_input_invalid');
  const base=this.where(filters),args=[...base.args],clauses=base.sql?[base.sql.slice(7)]:[];
  const literal=value=>'%'+value.replace(/[\\%_]/g,'\\$&')+'%';
  const searchFields=filters.locations?.length?['m.subject','m."from"']:['m.subject','m."from"','m.recipient'];
  for(const term of query.trim().split(/\s+/).filter(Boolean)){
   clauses.push('('+searchFields.map(field=>`${field} LIKE ? ESCAPE '\\'`).join(' OR ')+')');args.push(...searchFields.map(()=>literal(term)));
   if(/^[a-z0-9]{1,3}$/i.test(term)){clauses.push('('+searchFields.map(field=>`nubi_mail_term(${field},?)`).join(' OR ')+')');args.push(...searchFields.map(()=>term.toLowerCase()));}
  }
  // Explicit body/attachment/knowledge location requests cannot become broader searches.
  if(query&&filters.locations?.length&&!filters.locations.includes('subject'))clauses.push('0');
  if(filters.filename){clauses.push("m.known=1 AND EXISTS(SELECT 1 FROM json_each(m.metadata,'$.mail.attachments') a WHERE nubi_mail_contains(json_extract(a.value,'$.filename'),?))");args.push(filters.filename);}
  if(filters.types?.length){clauses.push("m.known=1 AND EXISTS(SELECT 1 FROM json_each(m.metadata,'$.mail.attachments') a WHERE nubi_mail_kind(json_extract(a.value,'$.filename'),json_extract(a.value,'$.contentType')) IN ("+filters.types.map(()=>'?').join(',')+"))");args.push(...filters.types);}
  if(filters.roles?.length){clauses.push("coalesce(json_extract(m.metadata,'$.row.recipientRole'),'unknown') IN ("+filters.roles.map(()=>'?').join(',')+")");args.push(...filters.roles);}
  if(relatedTo){const root=this.db.prepare('SELECT account,thread FROM mail_list WHERE id=?').get(relatedTo);if(!root)throw Error('mail_missing');clauses.push('m.account=? AND m.thread=? AND m.id!=?');args.push(root.account,root.thread,relatedTo);}
  const sql=clauses.length?' WHERE '+clauses.join(' AND '):'',join=" FROM mail_list m"+(query?" INDEXED BY nubi_mail_list_search_v2":"")+" LEFT JOIN records u ON u.key='mail-user:'||m.id";
  const revision=this.db.prepare('SELECT revision FROM nubi_mail_list_meta WHERE id=1').get().revision,hash=fingerprint([revision,filters,sort,query,relatedTo,limit]);
  const field=sort.startsWith('subject-')?"coalesce(m.subject,'')":sort.startsWith('sender-')?"coalesce(m.\"from\",'')":sort.startsWith('role-')?"coalesce(json_extract(m.metadata,'$.row.recipientRole'),'unknown')":'m.stamp';
  const direction=sort==='oldest'||sort.endsWith('-asc')?'ASC':'DESC',op=direction==='ASC'?'>':'<',order=field+' '+direction+',m.id ASC';
  let position=null,offset=0,reset=false;
  if(cursor){try{const value=JSON.parse(Buffer.from(cursor,'base64url'));if(value.kind!=='keyset'||!Number.isSafeInteger(value.offset)||value.offset<0||value.after&&(!['string','number'].includes(typeof value.after.value)||typeof value.after.id!=='string'))throw Error();if(value.fingerprint===hash){position=value.after;offset=value.offset;}else reset=true;}catch{throw Error('mail_input_invalid');}}
  const countFrom=/\bu\./.test(sql)?join:' FROM mail_list m'+(query?' INDEXED BY nubi_mail_list_search_v2':''),total=this.db.prepare('SELECT count(*) AS n'+countFrom+sql).get(...args).n,totalPages=Math.ceil(total/limit);
  // Numbered jumps retain the existing UI. Sequential navigation uses only a
  // keyset predicate. A direct jump locates one anchor in SQL, never full rows.
  if(page!==undefined&&!cursor&&!reset){offset=(Math.min(page,Math.max(1,totalPages))-1)*limit;if(offset)position=this.db.prepare('SELECT m.id,'+field+' AS value'+join+sql+' ORDER BY '+order+' LIMIT 1 OFFSET ?').get(...args,offset-1);}
  const seek=position?`${field} ${op} ? OR (${field} = ? AND m.id > ?)`:'',where=sql+(seek?(sql?' AND (':' WHERE (')+seek+')':'');
  // Sort IDs in the covering metadata index, then fetch only the visible rows.
  // Selecting metadata before LIMIT forced table and local-state reads for every match.
  const selectionJoin=/\bu\./.test(where)?join:countFrom;
  const records=this.db.prepare('WITH selected AS MATERIALIZED (SELECT m.id,'+field+' AS value'+selectionJoin+where+' ORDER BY '+order+' LIMIT ?) SELECT m.metadata,u.value AS local,s.id,s.value FROM selected s JOIN mail_list m ON m.id=s.id LEFT JOIN records u ON u.key=\'mail-user:\'||s.id ORDER BY s.value '+direction+',s.id ASC').all(...args,...(position?[position.value,position.value,position.id]:[]),limit);
  const items=records.map(item=>({...JSON.parse(item.metadata),snippet:'',local:{pinned:false,tags:[],confirmed:false,...JSON.parse(item.local||'{}')}}));
  const next=records.length&&offset+records.length<total?encode({kind:'keyset',after:{id:records.at(-1).id,value:records.at(-1).value},offset:offset+records.length,fingerprint:hash}):null;
  return {items,total,totalPages,page:total?Math.floor(offset/limit)+1:0,offset,currentCursor:encode({kind:'keyset',after:position,offset,fingerprint:hash}),nextCursor:next,reset,revision,unknownMetadata:this.db.prepare('SELECT count(*) AS n FROM mail_list WHERE known=0').get().n,collected:this.db.prepare('SELECT count(*) AS n FROM mail_list').get().n};
 }
 thread(id,{limit=20,offset=0}={}){
  if(typeof id!=='string'||!id||id.length>256||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw Error('mail_input_invalid');
  const root=this.db.prepare('SELECT account,thread FROM mail_list WHERE id=?').get(id);if(!root)throw Error('mail_missing');
  const bindings=[root.account,root.thread],scope=' FROM mail_list WHERE account=? AND thread=?';
  const stats=this.db.prepare(`SELECT count(*) count,min(coalesce(json_extract(metadata,'$.dateStamp'),json_extract(metadata,'$.fetchedStamp'))*1000) firstStamp,max(coalesce(json_extract(metadata,'$.dateStamp'),json_extract(metadata,'$.fetchedStamp'))*1000) lastStamp,sum(json_array_length(metadata,'$.mail.attachments')) attachmentCount,sum(json_extract(metadata,'$.metadataKnown')=0) unknown`+scope).get(...bindings);
  const latest=this.db.prepare('SELECT state'+scope+' ORDER BY stamp DESC,id LIMIT 1').get(...bindings);
  const items=this.db.prepare('SELECT id,metadata'+scope+' ORDER BY stamp DESC,id LIMIT ? OFFSET ?').all(...bindings,limit,offset).map(x=>{const {row,mail,metadataKnown}=JSON.parse(x.metadata);return {id:x.id,sourceHash:row.sourceHash,subject:mail.subject,from:mail.from,date:mail.date,attachmentCount:metadataKnown?mail.attachments.length:null};});
  const people=this.db.prepare(`SELECT DISTINCT j.value person FROM mail_list m,json_each(json_array(json_extract(m.metadata,'$.mail.from'),json_extract(m.metadata,'$.mail.to'),json_extract(m.metadata,'$.mail.cc'))) j WHERE m.account=? AND m.thread=? AND j.value IS NOT NULL ORDER BY person LIMIT 51`).all(...bindings);
  const participants=[...new Set(people.flatMap(x=>mailAddresses(x.person).length?mailAddresses(x.person):[x.person]))];
  return {id,thread:root.thread,count:stats.count,firstAt:stats.firstStamp!==null?new Date(stats.firstStamp).toISOString():null,lastAt:stats.lastStamp!==null?new Date(stats.lastStamp).toISOString():null,attachmentCount:stats.unknown?null:stats.attachmentCount,incomplete:stats.unknown>0,participants:participants.slice(0,50),participantsTruncated:people.length>50||participants.length>50,state:latest.state,grouping:root.thread.startsWith('subject:')?'subject':'headers',items,offset,hasMore:offset+items.length<stats.count};
 }
 searchBudget({maxCount=20000,maxBytes=200*1024*1024,metadataOnly=false}={}){
  const count=this.db.prepare('SELECT count(*) n FROM mail_list').get().n;
  if(count>=maxCount)return {allowed:false,count,estimatedBytes:null,maxCount,maxBytes};
  const estimatedBytes=this.db.prepare(metadataOnly?"SELECT coalesce(sum(max(16384,coalesce(json_extract(metadata,'$.row.searchEstimateBytes'),0))),0) n FROM mail_list":"SELECT coalesce(sum(max(16384,coalesce(json_extract(m.metadata,'$.row.searchEstimateBytes'),0),6*coalesce(length(c.value),0))),0) n FROM mail_list m LEFT JOIN records c ON c.key='mail-index:'||m.id").get().n;
  return {allowed:estimatedBytes<maxBytes,count,estimatedBytes,maxCount,maxBytes};
 }
 facets(){
  const senders=this.db.prepare("SELECT DISTINCT json_extract(metadata,'$.mail.from') sender FROM mail_list ORDER BY sender LIMIT 501").all();
  const tags=this.db.prepare("SELECT DISTINCT j.value tag FROM records r,json_each(r.value,'$.tags') j WHERE r.key GLOB 'mail-user:*' ORDER BY tag LIMIT 501").all();
  return {senders:senders.slice(0,500).flatMap(({sender})=>mailAddresses(sender).map(address=>({address:address.toLocaleLowerCase(),label:sender}))),tags:tags.slice(0,500).map(x=>x.tag),hasMore:senders.length>500||tags.length>500};
 }
 stats({account,attachmentReading=false}={}){
  const db=this.db,count=(where='',args=[])=>db.prepare('SELECT count(*) AS n FROM mail_list'+where).get(...args).n;
  const scope=account?"(account=? OR protocol='local')":'1',bindings=account?[account]:[];
  const attention={summary:0,attachment:0,total:0};
  const candidates=db.prepare("SELECT metadata FROM mail_list WHERE "+scope+" AND (state='attention'"+(attachmentReading?" OR json_extract(metadata,'$.row.attachmentState')='attention'":"")+")").iterate(...bindings);
  for(const item of candidates){const {row}=JSON.parse(item.metadata);const issue=mailAttention([row],{attachmentReading}).items[0];if(issue){attention.total++;if(issue.summary)attention.summary++;if(issue.attachmentFailures.length)attention.attachment++;}}
  const last=db.prepare("SELECT json_extract(metadata,'$.row.savedAt') at FROM mail_list INDEXED BY nubi_mail_list_saved WHERE state='saved' AND "+scope+" ORDER BY json_extract(metadata,'$.row.savedAt') DESC LIMIT 1").get(...bindings);
  const timing=db.prepare("SELECT json_extract(metadata,'$.row.summaryTiming') timing FROM mail_list INDEXED BY nubi_mail_list_timing WHERE state='saved' AND "+scope+" AND json_extract(metadata,'$.row.summaryTiming.state')='completed' ORDER BY json_extract(metadata,'$.row.savedAt') DESC LIMIT 1").get(...bindings);
  const attachment=attachmentReading?db.prepare("SELECT json_extract(metadata,'$.row.attachmentProgress') progress FROM mail_list WHERE "+scope+" AND json_extract(metadata,'$.row.attachmentState')='reading' LIMIT 1").get(...bindings):null;
  return {received:count(),indexed:count(" WHERE state='indexed'"),saved:count(" WHERE state='saved'"),queued:count(" WHERE state='queued'"),localCount:count(" WHERE protocol='local'"),
   localKinds:db.prepare("SELECT DISTINCT mailbox FROM mail_list WHERE protocol='local'").all().map(x=>x.mailbox),attention,
   scopedSaved:count(" WHERE "+scope+" AND state='saved'",bindings),scopedQueued:count(" WHERE "+scope+" AND state IN ('queued','summarizing')"+(attachmentReading?" AND coalesce(json_extract(metadata,'$.row.attachmentState'),'')!='attention'":""),bindings),
   lastAppliedAt:last?.at||null,lastTiming:timing?.timing?JSON.parse(timing.timing):null,attachment:attachment?.progress?JSON.parse(attachment.progress):null};
 }
 explain(){return this.db.prepare('EXPLAIN QUERY PLAN SELECT metadata FROM mail_list ORDER BY stamp DESC,id LIMIT 30').all().map(x=>x.detail);}
}
