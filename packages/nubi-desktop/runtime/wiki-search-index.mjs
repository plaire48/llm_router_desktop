import {lstat,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {scopedFile,readSource,privatePath} from './files.mjs';
import {buildKnowledgeMap,queryKnowledgeMap,CATALOG_PATH} from './knowledge-map.mjs';
import {createWikiSnapshotReader,createPersistentWikiIndex,persistentWikiUnits,persistentWikiPassage,ClaimsStore,isGroundedWikiPage,toClaimsSidecarRelativePath,parseRepositoryEvidenceResource,OpenWikiIgnore} from '../generated/openwiki.mjs';

// Per-owner/root index. Only a bounded LRU keeps raw text; the complete corpus
// contributes terms and navigation metadata without an aggregate byte cutoff.
const owners=new WeakMap(),BODY_BYTES=8*1024*1024;
function remember(state,doc){
 const old=state.bodies.get(doc.path);if(old){state.bodyBytes-=old.bytes;state.bodies.delete(doc.path);}
 const bytes=Buffer.byteLength(doc.raw);if(bytes>BODY_BYTES)return;
 state.bodies.set(doc.path,{doc,bytes});state.bodyBytes+=bytes;
 while(state.bodyBytes>BODY_BYTES){const first=state.bodies.keys().next().value;state.bodyBytes-=state.bodies.get(first).bytes;state.bodies.delete(first);}
}
function forget(state,rel){state.files.delete(rel);const body=state.bodies.get(rel);if(body){state.bodyBytes-=body.bytes;state.bodies.delete(rel);}}
function retire(native){if(!native)return;native.retired=true;if(!native.users)native.reader.close();}
async function diskIndex(owner,root,state){
 if(state.persistent||!owner.storageRoot)return;
 if(state.opening)return state.opening;
 state.opening=(async()=>{
 const directory=path.join(owner.storageRoot,'wiki-search');await mkdir(directory,{recursive:true,mode:0o700});
 const namespace=root+'\n'+(owner.wikiIndexScope||'evidence');
 const filename=path.join(directory,createHash('sha256').update(namespace).digest('hex')+'.db');
 try{if((await lstat(filename)).isSymbolicLink())throw Error('path_scope');}catch(error){if(error.code!=='ENOENT')throw error;}
 try{state.persistent=await createPersistentWikiIndex({filename,namespace});}
 catch(error){if(error.message!=='index_schema_changed')throw error;for(const suffix of ['','-wal','-shm'])await rm(filename+suffix,{force:true});state.persistent=await createPersistentWikiIndex({filename,namespace});}
 })();try{await state.opening;}finally{state.opening=null;}
}
async function claimText(root,doc,entry,ignore,store,ignoreKey){
 if(!isGroundedWikiPage('/'+doc.path))return {stamp:'navigation',hash:null,text:''};
 const rel='openwiki/.claims/'+toClaimsSidecarRelativePath('/'+doc.path);
 if(ignore.ignores(rel))return {stamp:'excluded',hash:null,text:''};
 try{
  const target=await scopedFile(root,rel),stat=await lstat(target);if(!stat.isFile()||stat.size>1024*1024)throw Error('index_limit');
  const stamp=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs,ignoreKey].join(':');
  if(stamp===entry?.claimStamp&&doc.hash===entry.doc.hash)return {stamp,hash:entry.doc.claimsHash,text:entry.doc.searchHints};
  const source=await readSource(root,rel),claims=await store.loadPage('/'+doc.path);
  if((await readSource(root,rel)).hash!==source.hash)throw Error('source_stale');
  const allowed=claim=>claim.evidence?.length&&claim.evidence.every(ref=>{try{const parsed=parseRepositoryEvidenceResource(ref.resource);return !privatePath(parsed.path)&&!ignore.ignores(parsed.path);}catch{return false;}});
  return {stamp,hash:source.hash,text:claims?.pageVersion===doc.hash?claims.claims.filter(allowed).map(c=>c.statement).join('\n'):''};
 }catch{return {stamp:'unavailable',hash:null,text:''};}
}
export async function wikiSearchCorpus(owner,root,files,makeDocument){
 let roots=owners.get(owner);if(!roots){roots=new Map();owners.set(owner,roots);}
 let state=roots.get(root);
 if(!state){state={files:new Map(),bodies:new Map(),bodyBytes:0,native:null,building:Promise.resolve()};roots.set(root,state);}
 await diskIndex(owner,root,state);
 roots.delete(root);roots.set(root,state);while(roots.size>2){const oldest=roots.keys().next().value;retire(roots.get(oldest).native);roots.get(oldest).persistent?.close();roots.delete(oldest);}
 const ignore=await OpenWikiIgnore.load(root),claimsStore=new ClaimsStore(root);let ignoreKey='missing';try{ignoreKey=(await readSource(root,'.openwikiignore')).hash;}catch(error){if(error.code!=='ENOENT')throw error;}const allowed=new Set(files);for(const rel of state.files.keys())if(!allowed.has(rel))forget(state,rel);
 let bytes=0,skipped=0,reused=0,loaded=0;const documents=[];
 for(let offset=0;offset<files.length;offset+=16){
  const batch=await Promise.all(files.slice(offset,offset+16).map(async rel=>{
   try{
    const target=await scopedFile(root,rel),stat=await lstat(target);if(!stat.isFile()||stat.size>16*1024*1024)throw Error('index_limit');
    const stamp=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');let entry=state.files.get(rel)||state.persistent?.cachedFile(rel);if(entry)state.files.set(rel,entry);
    let doc=entry?.stamp===stamp?entry.doc:makeDocument(await readSource(root,rel,{maxBytes:16*1024*1024}));
    const claims=await claimText(root,doc,entry,ignore,claimsStore,ignoreKey);
    if(entry?.stamp===stamp&&entry.claimStamp===claims.stamp)reused++;
    else{
     if(typeof doc.raw!=='string')doc=state.bodies.get(rel)?.doc||makeDocument(await readSource(root,rel,{maxBytes:16*1024*1024}));
     const {raw,...metadata}=doc;metadata.claimsHash=claims.hash;metadata.searchHints=claims.text||'';entry={stamp,claimStamp:claims.stamp,doc:metadata};state.files.set(rel,entry);remember(state,doc);loaded++;
    }
    bytes+=stat.size;return entry.doc;
   }catch{forget(state,rel);skipped++;return null;}
  }));documents.push(...batch.filter(Boolean));await yieldTurn();
 }
 const pending=new Map(),unavailable=new Set();
 const readDocument=doc=>{
  if(pending.has(doc.path))return pending.get(doc.path);
  const read=(async()=>{const cached=state.bodies.get(doc.path);if(cached?.doc.hash===doc.hash){remember(state,cached.doc);return cached.doc;}
   const current=makeDocument(await readSource(root,doc.path,{maxBytes:16*1024*1024}));if(current.hash!==doc.hash)throw Error('source_stale');remember(state,current);return current;})().catch(error=>{unavailable.add(doc.path);throw error;});pending.set(doc.path,read);return read;
 };
 // Declared vocabulary is data for OpenWiki's native index, not another ranker.
 const aliases=new Map();let graphIncomplete=false;
 if(!ignore.ignores(CATALOG_PATH))try{
  const map=await buildKnowledgeMap(root,{declaredOnly:true,ignore});graphIncomplete=map.diagnostics.length>0;
  if(!map.diagnostics.some(d=>['catalog_invalid','catalog_unreadable','changed_during_scan'].includes(d.code)))
   for(const node of map.nodes.filter(node=>node.kind==='concept'))
    for(const linked of queryKnowledgeMap(map,{focusId:node.id,depth:2}).nodes.filter(row=>row.kind==='wiki'&&row.path))
     aliases.set(linked.path,[...(aliases.get(linked.path)||[]),node.label,...(node.aliases||[])]);
 }catch{graphIncomplete=true;}
 const fingerprint=JSON.stringify(documents.map(doc=>[doc.id,doc.hash,doc.claimsHash,doc.searchHints,aliases.get(doc.path)]));
 const prepare=state.building.catch(()=>{}).then(async()=>{
  if(state.native?.fingerprint===fingerprint)return state.native;
  if(owner.storageRoot){
   const index=state.persistent;
   for(const doc of documents){
    const version=createHash('sha256').update(JSON.stringify([doc.hash,doc.claimsHash,doc.searchHints,aliases.get(doc.path)])).digest('hex');
    if(index.version(doc.id)!==version)try{const body=await readDocument(doc);index.replace({id:doc.id,version,units:persistentWikiUnits({...doc,text:body.raw,aliases:aliases.get(doc.path)})});}catch{unavailable.add(doc.path);index.remove(doc.id);}
    const entry=state.files.get(doc.path);if(entry&&index.version(doc.id)===version)index.rememberFile(doc.path,doc.id,entry);
   }
   index.prune(documents.map(doc=>doc.id));
   const ids=new Set(documents.map(doc=>doc.id));
   const native={reader:{search:(query,options)=>index.search(query,{...options,strictAnchors:true,...(options.documentIds?.length===ids.size&&options.documentIds.every(id=>ids.has(id))?{documentIds:undefined}:{})}).map(hit=>({...hit,section:hit.metadata.section||'document'})),passage:persistentWikiPassage,close:()=>{}},fingerprint,users:0,retired:false};
   retire(state.native);state.native=native;return native;
  }
  const snapshots=[];
  for(const doc of documents){try{const body=await readDocument(doc);snapshots.push({id:doc.id,path:doc.path,title:doc.title,text:body.raw,searchHints:doc.searchHints,aliases:aliases.get(doc.path)});}catch{/* Report unavailable through the original reader. */}}
  const reader=await createWikiSnapshotReader(snapshots,{retainText:false}),native={reader,fingerprint,users:0,retired:false};
  retire(state.native);state.native=native;return native;
 });
 state.building=prepare.then(()=>{});
 const native=await prepare;native.users++;let released=false;
 const release=()=>{if(released)return;released=true;if(--native.users===0&&native.retired)native.reader.close();};
 return {documents,skipped,reused,loaded,bytes,state:{...state,native},native,graphIncomplete,readDocument,release,get unavailable(){return unavailable.size;}};
}

// Hidden revisions are filtered before limiting. Chunk headers help ranking;
// only a selected chunk's original bytes are sent to the model.
export function selectWikiCandidates(rows,key,limit=Infinity){
 const selected=[],counts=new Map();for(const row of rows){const page=key(row),count=counts.get(page)||0;if(count>=2)continue;counts.set(page,count+1);selected.push(row);if(selected.length>=limit)break;}return selected;
}
export function rankWikiChunks(state,documents,query,limit=24){
 const byId=new Map(documents.map(doc=>[doc.id,doc])),reader=state.native.reader;
 const cap=limit===Infinity?5000:Math.max(100,limit*8),hits=reader.search(query,{documentIds:[...byId.keys()],limit:cap});
 const selected=selectWikiCandidates(hits,hit=>hit.documentId,limit);
 return {chunks:selected.map((hit,index)=>({nativeHit:hit,pageId:hit.documentId,header:byId.get(hit.documentId).path+' > '+hit.section,score:1/(index+1),claimMatch:hit.matchedInHints})),matched:hits.length,candidateLimited:hits.length===cap||hits.length>selected.length};
}
export function rankWikiDocuments(state,documents,query,limit=48){
 const byId=new Map(documents.map(doc=>[doc.id,doc])),ranked=rankWikiChunks(state,documents,query,Infinity),seen=new Set(),rows=[];
 for(const chunk of ranked.chunks)if(!seen.has(chunk.pageId)){seen.add(chunk.pageId);rows.push({...byId.get(chunk.pageId),claimMatch:chunk.claimMatch});}
 return {documents:rows.slice(0,limit),matched:rows.length,candidateLimited:ranked.candidateLimited||rows.length>limit};
}

// Adapt only identity and UTF-16 ranges. OpenWiki owns parsing, ranking and reads.
export async function createNativeWikiQuestionSearch(documents){
 const reader=await createWikiSnapshotReader(documents);
 const search=(query,allowed)=>reader.search(query,{documentIds:allowed.map(doc=>doc.id),limit:20}).map(hit=>{const section=reader.read(hit.documentId,hit.section),context=reader.context(hit.documentId,section.start,section.end);return {documentId:hit.documentId,start:section.start,end:section.end,contextRanges:context.ranges,contextTruncated:context.truncated};});
 search.context=(document,start,end)=>reader.context(document.id,start,end);
 search.close=()=>reader.close();return search;
}

export function disposeWikiSearch(owner){const roots=owners.get(owner);if(!roots)return;for(const state of roots.values()){retire(state.native);state.persistent?.close();}roots.clear();owners.delete(owner);}
