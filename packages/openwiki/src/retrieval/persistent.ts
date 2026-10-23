import {DatabaseSync} from 'node:sqlite';
import {normalizeSearchText, queryTerms, searchUnits, type WikiSnapshotDocument} from './wiki.js';

/** Bounded exact source windows using the same authored-section parser. */
export function* persistentWikiUnits(document:WikiSnapshotDocument):Generator<IndexedWikiUnit>{
 const normalized=document.text.replace(/\r\n?/gu,'\n'),removed:number[]=[];
 for(const match of document.text.matchAll(/\r\n/gu))removed.push(match.index-removed.length);
 const original=(offset:number)=>{let lo=0,hi=removed.length;while(lo<hi){const mid=(lo+hi)>>>1;if(removed[mid]<offset)lo=mid+1;else hi=mid;}return offset+lo;};
 const parsed=searchUnits(normalized,'/'+document.path.replace(/^\//u,''),[],'');
 const sections=parsed.length?parsed:[{ref:'#document',title:document.title??document.path,heading:'',prose:normalized,identifiers:''}];
 for(const section of sections){
  const at=normalized.indexOf(section.prose);if(at<0)continue;
  for(let offset=0;offset<section.prose.length;offset+=15872){
   const end=Math.min(section.prose.length,offset+16384),start=original(at+offset),finish=original(at+end),anchor=section.ref.slice(section.ref.lastIndexOf('#')+1);
   yield {id:anchor+':'+offset,title:document.title??section.title,heading:section.heading,text:document.text.slice(start,finish),hints:[section.identifiers,document.searchHints,...document.aliases??[]].filter(Boolean).join(' '),start,end:finish,metadata:{section:anchor}};
   if(end===section.prose.length)break;
  }
 }
}

/** A citation is always an unchanged slice of the supplied current original. */
export function persistentWikiPassage(hit:{start:number;end:number},query:string,maximum:number,text:string){
 const end=Math.min(text.length,hit.end),terms=queryTerms(query),window=text.slice(hit.start,end),lower=window.toLocaleLowerCase();
 let best=0,score=-1;
 for(const term of terms){let at=lower.indexOf(term);let count=0;while(at>=0&&count++<40){const start=Math.max(0,at-maximum/3),context=lower.slice(start,start+maximum),found=terms.reduce((sum,t)=>sum+(context.includes(t)?1:0),0);if(found>score){score=found;best=start;}at=lower.indexOf(term,at+term.length);}}
 const start=hit.start+Math.floor(best),finish=Math.min(end,start+maximum);
 return {start,end:finish,text:text.slice(start,finish)};
}

export interface IndexedWikiUnit {
 id: string; title?: string; heading?: string; text: string; hints?: string;
 start: number; end: number; metadata?: Record<string, unknown>;
}
export interface IndexedWikiDocument {
 id: string; version: string; scope?: string; units: Iterable<IndexedWikiUnit>;
}
export interface PersistentWikiHit {
 documentId: string; version: string; unitId: string; scope: string;
 start: number; end: number; score: number; metadata: Record<string,unknown>;
}
export interface PersistentWikiIndexOptions {
 filename: string; namespace: string; encodeToken?: (token: string)=>string; codecId?: string;
}

/** Native OpenWiki FTS, with durable incremental documents and no source bodies.
 * A host may HMAC every token before persistence. Only opaque identities, offsets
 * and host-approved navigation metadata are stored alongside the FTS postings.
 */
export async function createPersistentWikiIndex(options: PersistentWikiIndexOptions) {
 const db=new DatabaseSync(options.filename);
 const encoder=options.encodeToken??((token:string)=>token),tokenCache=new Map<string,string>();
 const encode=(token:string)=>{const cached=tokenCache.get(token);if(cached!==undefined)return cached;const value=encoder(token);if(tokenCache.size>=32768)tokenCache.clear();tokenCache.set(token,value);return value;};
 const codec=options.codecId??'plain-v1';
 try {
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;');
  db.exec(`CREATE TABLE IF NOT EXISTS ow_index_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS ow_documents(id TEXT PRIMARY KEY,version TEXT NOT NULL,scope TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS ow_file_metadata(path TEXT PRIMARY KEY,document_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS ow_units(id INTEGER PRIMARY KEY,document_id TEXT NOT NULL,unit_id TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,metadata TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS ow_units_document ON ow_units(document_id);
   CREATE INDEX IF NOT EXISTS ow_documents_scope ON ow_documents(scope,id);
   CREATE VIRTUAL TABLE IF NOT EXISTS ow_terms USING fts5(title,heading,prose,hints,tokenize='unicode61',content='',contentless_delete=1);
   CREATE VIRTUAL TABLE IF NOT EXISTS ow_vocabulary USING fts5vocab(ow_terms,'row');
   CREATE TEMP TABLE IF NOT EXISTS ow_allowed(id TEXT PRIMARY KEY);`);
  const identity=JSON.stringify([4,options.namespace,codec]);
  const prior=db.prepare("SELECT value FROM ow_index_meta WHERE key='identity'").get() as {value:string}|undefined;
  if(prior&&prior.value!==identity){let old:unknown;try{old=JSON.parse(prior.value);}catch{}if(Array.isArray(old)&&old[0]!==4&&old[1]===options.namespace&&old[2]===codec)throw Error('index_schema_changed');throw Error('index_scope_changed');}
  if(!prior)db.prepare("INSERT INTO ow_index_meta VALUES('identity',?)").run(identity);
  db.exec("INSERT INTO ow_terms(ow_terms,rank) VALUES('rank','bm25(8,6,1,3)')");
  const words=(text:string)=>{const normalized=normalizeSearchText(text),mixed=normalized.replace(/([A-Za-z0-9])([가-힣])/gu,'$1 $2').replace(/([가-힣])([A-Za-z0-9])/gu,'$1 $2');return [...new Set((normalized+' '+mixed).toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[])];};
  const projection=(text:string)=>{
   const tokens:string[]=[];
   for(const word of words(text)){
    tokens.push(encode('w:'+word));
    // Korean inflection and compound words need substring candidates. Verification
    // against the original remains the host's responsibility, never this projection.
    if(/[가-힣]/u.test(word)){
     for(let i=0;i+2<=word.length;i++)tokens.push(encode('g:'+word.slice(i,i+2)));
    }else for(let end=2;end<=Math.min(word.length,32);end++)tokens.push(encode('p:'+word.slice(0,end)));
   }
   return tokens.join(' ');
  };
  const quoted=(token:string)=>'"'+encode(token).replaceAll('"','""')+'"';
  const termMatch=(word:string)=>{
   if(/[가-힣]/u.test(word)&&word.length>=2){
    const grams:string[]=[];for(let i=0;i+2<=word.length;i++)grams.push(quoted('g:'+word.slice(i,i+2)));
    return '('+quoted('w:'+word)+' OR ('+grams.join(' AND ')+'))';
   }
   return '('+quoted('w:'+word)+(word.length>=2&&word.length<=32?' OR '+quoted('p:'+word):'')+')';
  };
  const getVersion=db.prepare('SELECT version FROM ow_documents WHERE id=?');
  const remove=(id:string)=>{
   db.prepare('DELETE FROM ow_terms WHERE rowid IN (SELECT id FROM ow_units WHERE document_id=?)').run(id);
   db.prepare('DELETE FROM ow_units WHERE document_id=?').run(id);
   db.prepare('DELETE FROM ow_documents WHERE id=?').run(id);
   db.prepare('DELETE FROM ow_file_metadata WHERE document_id=?').run(id);
  };
  const insertUnit=db.prepare('INSERT INTO ow_units(document_id,unit_id,start,end,metadata) VALUES(?,?,?,?,?)');
  const insertTerms=db.prepare('INSERT INTO ow_terms(rowid,title,heading,prose,hints) VALUES(?,?,?,?,?)');
  return {
   transaction<T>(write:()=>T):T{db.exec('SAVEPOINT ow_batch');try{const result=write();db.exec('RELEASE ow_batch');return result;}catch(error){db.exec('ROLLBACK TO ow_batch; RELEASE ow_batch');throw error;}},
   version(id:string){return (getVersion.get(id) as {version:string}|undefined)?.version??null;},
   count(){return Number((db.prepare('SELECT count(*) n FROM ow_documents').get() as {n:number}).n);},
   cachedFile(path:string){const row=db.prepare('SELECT data FROM ow_file_metadata WHERE path=?').get(path) as {data:string}|undefined;return row?JSON.parse(row.data):null;},
   rememberFile(path:string,documentId:string,metadata:unknown){db.prepare('INSERT INTO ow_file_metadata VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET document_id=excluded.document_id,data=excluded.data').run(path,documentId,JSON.stringify(metadata));},
   replace(document:IndexedWikiDocument){
    if(!document.id||!document.version)throw Error('index_document_invalid');
    if((getVersion.get(document.id) as {version:string}|undefined)?.version===document.version)return false;
    db.exec('SAVEPOINT ow_replace');
    try{
     remove(document.id);
     db.prepare('INSERT INTO ow_documents VALUES(?,?,?)').run(document.id,document.version,document.scope??'');
     for(const unit of document.units){
      if(!unit.id||!Number.isSafeInteger(unit.start)||!Number.isSafeInteger(unit.end)||unit.start<0||unit.end<unit.start)throw Error('index_unit_invalid');
      const row=insertUnit.run(document.id,unit.id,unit.start,unit.end,JSON.stringify(unit.metadata??{}));
      insertTerms.run(row.lastInsertRowid,projection(unit.title??''),projection(unit.heading??''),projection(unit.text),projection(unit.hints??''));
     }
     db.exec('RELEASE ow_replace');return true;
    }catch(error){db.exec('ROLLBACK TO ow_replace; RELEASE ow_replace');throw error;}
   },
   remove(id:string){db.exec('SAVEPOINT ow_remove');try{remove(id);db.exec('RELEASE ow_remove');}catch(error){db.exec('ROLLBACK TO ow_remove; RELEASE ow_remove');throw error;}},
   prune(ids:Iterable<string>){
    db.exec('DELETE FROM ow_allowed');const put=db.prepare('INSERT OR IGNORE INTO ow_allowed VALUES(?)');for(const id of ids)put.run(id);
    const obsolete=db.prepare('SELECT id FROM ow_documents WHERE NOT EXISTS(SELECT 1 FROM ow_allowed a WHERE a.id=ow_documents.id)').iterate();
    for(const row of obsolete)remove(String(row.id));
   },
   search(query:string,{limit=20,scope,documentIds,kinds,strictAnchors=false,mode='any'}:{limit?:number;scope?:string;documentIds?:readonly string[];kinds?:readonly string[];strictAnchors?:boolean;mode?:'any'|'all'}={}):PersistentWikiHit[]{
    if(!Number.isSafeInteger(limit)||limit<1||limit>100_000||query.length>1000)throw Error('index_query_invalid');
    if(documentIds?.length===0)return [];
    const terms=[...new Set(queryTerms(query).map(word=>/[가-힣]/u.test(word)?word.replace(/(?:에서는|에서|으로|은|는|을|를|의|에|와|과)$/u,'')||word:word))];
    if(!terms.length)return [];
    const filters:string[]=[],bindings:string[]=[];
    if(scope!==undefined){filters.push('d.scope=?');bindings.push(scope);}
    const kindFilter=kinds?.length?` AND json_extract(u.metadata,'$.kind') IN (${kinds.map(()=>'?').join(',')})`:'';
    if(kindFilter){filters.push(kindFilter.slice(5));bindings.push(...kinds!);}
    if(documentIds){
     db.exec('DELETE FROM ow_allowed');const put=db.prepare('INSERT OR IGNORE INTO ow_allowed VALUES(?)');
     db.exec('SAVEPOINT ow_allowed_write');try{for(const id of documentIds)put.run(id);db.exec('RELEASE ow_allowed_write');}catch(error){db.exec('ROLLBACK TO ow_allowed_write; RELEASE ow_allowed_write');throw error;}
     filters.push('EXISTS(SELECT 1 FROM ow_allowed a WHERE a.id=d.id)');
    }
    const anchors=[...new Set((query.match(/[A-Za-z][A-Za-z0-9_]*/gu)??[]).filter(word=>word.includes('_')||/\d/u.test(word)||/[a-z][A-Z]/u.test(word)).map(word=>word.toLowerCase()))];
    if(strictAnchors&&anchors.length===1){
     const anchor=quoted('w:'+anchors[0]);
     if(!db.prepare(`SELECT 1 FROM ow_terms f JOIN ow_units u ON u.id=f.rowid JOIN ow_documents d ON d.id=u.document_id WHERE ow_terms MATCH ?${filters.length?' AND '+filters.join(' AND '):''} LIMIT 1`).get(anchor,...bindings))return [];
     filters.push('u.document_id IN (SELECT au.document_id FROM ow_units au JOIN ow_terms af ON af.rowid=au.id WHERE af.ow_terms MATCH ?)');bindings.push(anchor);
    }
    const expressions=terms.map(termMatch);
    const frequency=db.prepare('SELECT doc FROM ow_vocabulary WHERE term=?');
    const estimate=(term:string)=>{
     const keys=['w:'+term,...(/[가-힣]/u.test(term)&&term.length>=2?Array.from({length:term.length-1},(_,i)=>'g:'+term.slice(i,i+2)):term.length>=2?['p:'+term]:[])];
     const frequencies=keys.map(key=>Number((frequency.get(encode(key)) as {doc:number}|undefined)?.doc??0)).filter(Boolean);return frequencies.length?Math.max(...frequencies):0;
    };
    const estimates=terms.map(estimate);
    // A keyed projection is one opaque FTS token. Plain Unicode terms can split
    // at the field prefix or identifier punctuation, so their vocabulary lookup
    // is only a ranking hint and must never prove absence.
    if(mode==='all'&&options.encodeToken&&estimates.some(value=>value===0))return [];
    const seed=estimates.reduce((best,value,i)=>value>0&&(estimates[best]===0||value<estimates[best])?i:best,0);
    let allFilter='';
    let coverageBindings:string[]=[];
    if(mode==='all'&&expressions.length>1){
     // Seek each remaining term within this document's indexed units. Starting
     // from the rarest term avoids materializing mailbox-wide common-term sets.
     for(const [i,expression] of expressions.entries())if(i!==seed){
      allFilter+=` AND EXISTS(SELECT 1 FROM ow_units cu INDEXED BY ow_units_document CROSS JOIN ow_terms ct WHERE cu.document_id=d.id AND ct.rowid=cu.id AND ct.ow_terms MATCH ?${kinds?.length?` AND json_extract(cu.metadata,'$.kind') IN (${kinds.map(()=>'?').join(',')})`:''})`;
      coverageBindings.push(expression,...(kinds??[]));
     }
    }
    // rank/LIMIT execute in SQLite. No entire hit set is copied into JavaScript.
    const from=strictAnchors&&anchors.length===1?'ow_units u INDEXED BY ow_units_document CROSS JOIN ow_terms f JOIN ow_documents d ON d.id=u.document_id':'ow_terms f JOIN ow_units u ON u.id=f.rowid JOIN ow_documents d ON d.id=u.document_id';
    // In a selective identifier query, rank+0 prevents FTS from walking the
    // entire common-term ranking before applying the document rowid seeks.
    const rank=strictAnchors&&anchors.length===1?'f.rank+0':'f.rank';
    const sql=`SELECT u.document_id AS documentId,d.version,d.scope,u.unit_id AS unitId,u.start,u.end,u.metadata,${rank} AS score
     FROM ${from}
     WHERE f.rowid=u.id AND ow_terms MATCH ?${filters.length?' AND '+filters.join(' AND '):''}${allFilter}
     ORDER BY ${rank} LIMIT ?`;
    const rows=db.prepare(sql).all(mode==='all'?expressions[seed]:expressions.join(' OR '),...bindings,...coverageBindings,limit) as unknown as Array<Omit<PersistentWikiHit,'metadata'>&{metadata:string}>;
    return rows.map(row=>({...row,metadata:JSON.parse(row.metadata)}));
   },
   close(){if(db.isOpen){db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();}},
  };
 }catch(error){db.close();throw error;}
}
