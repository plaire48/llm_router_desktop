import {wikiChunks} from './wiki-chunks.mjs';
import {lstat} from 'node:fs/promises';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import MiniSearch from 'minisearch';
import {scopedFile,readSource,privatePath,hash} from './files.mjs';
import {ClaimsStore,isGroundedWikiPage,toClaimsSidecarRelativePath,parseRepositoryEvidenceResource,OpenWikiIgnore} from '../generated/openwiki.mjs';

// Per-owner/root index. Only a bounded LRU keeps raw text; the complete corpus
// contributes terms and navigation metadata without an aggregate byte cutoff.
const owners=new WeakMap(),BODY_BYTES=8*1024*1024;
const terms=text=>String(text).normalize('NFKC').replace(/([a-z\d])([A-Z])/gu,'$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.map(word=>/^[가-힣]{3,}$/u.test(word)?word.replace(/(?:에서는|에서|으로|은|는|을|를|의|에|와|과)$/u,''):word)||[];
function remember(state,doc){
 const old=state.bodies.get(doc.path);if(old){state.bodyBytes-=old.bytes;state.bodies.delete(doc.path);}
 const bytes=Buffer.byteLength(doc.raw);if(bytes>BODY_BYTES)return;
 state.bodies.set(doc.path,{doc,bytes});state.bodyBytes+=bytes;
 while(state.bodyBytes>BODY_BYTES){const first=state.bodies.keys().next().value;state.bodyBytes-=state.bodies.get(first).bytes;state.bodies.delete(first);}
}
function discardDocument(state,id){for(const chunkId of state.byPage.get(id)||[]){state.index.discard(chunkId);state.chunks.delete(chunkId);}state.byPage.delete(id);state.hashes.delete(id);}
function forget(state,rel){const entry=state.files.get(rel);if(entry)discardDocument(state,entry.doc.id);state.files.delete(rel);const body=state.bodies.get(rel);if(body){state.bodyBytes-=body.bytes;state.bodies.delete(rel);}}
async function claimText(root,doc,entry,ignore,store,ignoreKey){
 if(!isGroundedWikiPage('/'+doc.path))return {stamp:'navigation',hash:null,text:''};
 const rel='openwiki/.claims/'+toClaimsSidecarRelativePath('/'+doc.path);
 if(ignore.ignores(rel))return {stamp:'excluded',hash:null,text:''};
 try{
  const target=await scopedFile(root,rel),stat=await lstat(target);if(!stat.isFile()||stat.size>1024*1024)throw Error('index_limit');
  const stamp=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs,ignoreKey].join(':');
  if(stamp===entry?.claimStamp&&doc.hash===entry.doc.hash)return {stamp,hash:entry.doc.claimsHash};
  const source=await readSource(root,rel),claims=await store.loadPage('/'+doc.path);
  if((await readSource(root,rel)).hash!==source.hash)throw Error('source_stale');
  const allowed=claim=>claim.evidence?.length&&claim.evidence.every(ref=>{try{const parsed=parseRepositoryEvidenceResource(ref.resource);return !privatePath(parsed.path)&&!ignore.ignores(parsed.path);}catch{return false;}});
  return {stamp,hash:source.hash,text:claims?.pageVersion===doc.hash?claims.claims.filter(allowed).map(c=>c.statement).join('\n'):''};
 }catch{return {stamp:'unavailable',hash:null,text:''};}
}
export async function wikiSearchCorpus(owner,root,files,makeDocument){
 let roots=owners.get(owner);if(!roots){roots=new Map();owners.set(owner,roots);}
 let state=roots.get(root);
 if(!state){state={files:new Map(),hashes:new Map(),bodies:new Map(),bodyBytes:0,chunks:new Map(),byPage:new Map(),index:new MiniSearch({fields:['title','path','header','text','claims'],tokenize:terms})};roots.set(root,state);}
 roots.delete(root);roots.set(root,state);while(roots.size>2)roots.delete(roots.keys().next().value);
 const ignore=await OpenWikiIgnore.load(root),claimsStore=new ClaimsStore(root);let ignoreKey='missing';try{ignoreKey=(await readSource(root,'.openwikiignore')).hash;}catch(error){if(error.code!=='ENOENT')throw error;}const allowed=new Set(files);for(const rel of state.files.keys())if(!allowed.has(rel))forget(state,rel);
 let bytes=0,skipped=0,reused=0,loaded=0;const documents=[];
 for(let offset=0;offset<files.length;offset+=16){
  const batch=await Promise.all(files.slice(offset,offset+16).map(async rel=>{
   try{
    const target=await scopedFile(root,rel),stat=await lstat(target);if(!stat.isFile()||stat.size>1024*1024)throw Error('index_limit');
    const stamp=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');let entry=state.files.get(rel);
    let doc=entry?.stamp===stamp?entry.doc:makeDocument(await readSource(root,rel));
    const claims=await claimText(root,doc,entry,ignore,claimsStore,ignoreKey),fingerprint=doc.hash+'\0'+(claims.hash||'')+'\0'+ignoreKey;
    if(entry?.stamp===stamp&&entry.claimStamp===claims.stamp)reused++;
    else{
     if(typeof doc.raw!=='string')doc=state.bodies.get(rel)?.doc||makeDocument(await readSource(root,rel));
     if(state.hashes.get(doc.id)!==fingerprint){
      discardDocument(state,doc.id);const chunks=wikiChunks(doc);state.byPage.set(doc.id,chunks.map(c=>c.id));
      for(const [i,chunk] of chunks.entries()){const {text,...meta}=chunk;state.chunks.set(chunk.id,{...meta,pageId:doc.id});state.index.add({...chunk,title:doc.title,claims:i===0?claims.text||'':''});}
      state.hashes.set(doc.id,fingerprint);
     }
     const {raw,...metadata}=doc;metadata.claimsHash=claims.hash;entry={stamp,claimStamp:claims.stamp,doc:metadata};state.files.set(rel,entry);remember(state,doc);loaded++;
    }
    bytes+=stat.size;return entry.doc;
   }catch{forget(state,rel);skipped++;return null;}
  }));documents.push(...batch.filter(Boolean));await yieldTurn();
 }
 const pending=new Map(),unavailable=new Set();
 const readDocument=doc=>{
  if(pending.has(doc.path))return pending.get(doc.path);
  const read=(async()=>{const cached=state.bodies.get(doc.path);if(cached?.doc.hash===doc.hash){remember(state,cached.doc);return cached.doc;}
   const current=makeDocument(await readSource(root,doc.path));if(current.hash!==doc.hash)throw Error('source_stale');remember(state,current);return current;})().catch(error=>{unavailable.add(doc.path);throw error;});pending.set(doc.path,read);return read;
 };
 return {documents,skipped,reused,loaded,bytes,state,readDocument,get unavailable(){return unavailable.size;}};
}

// Hidden revisions are filtered before limiting. Chunk headers help ranking;
// only a selected chunk's original bytes are sent to the model.
export function selectWikiCandidates(rows,key,limit=Infinity){
 const selected=[],counts=new Map();for(const row of rows){const page=key(row),count=counts.get(page)||0;if(count>=2)continue;counts.set(page,count+1);selected.push(row);if(selected.length>=limit)break;}return selected;
}
export function rankWikiChunks(state,documents,query,limit=24){
 const byId=new Map(documents.map(doc=>[doc.id,doc]));
 const hits=state.index.search(query,{boost:{header:4,title:3,path:2,text:1,claims:.5},prefix:term=>term.length>=3,fuzzy:false}).filter(hit=>byId.has(state.chunks.get(hit.id)?.pageId));
 const selected=selectWikiCandidates(hits,hit=>state.chunks.get(hit.id).pageId,limit);return {chunks:selected.map(hit=>({...state.chunks.get(hit.id),score:hit.score,claimMatch:Object.values(hit.match||{}).some(fields=>fields.includes('claims'))})),matched:hits.length,candidateLimited:hits.length>selected.length};
}
export function rankWikiDocuments(state,documents,query,limit=48){
 const byId=new Map(documents.map(doc=>[doc.id,doc])),ranked=rankWikiChunks(state,documents,query,Infinity),seen=new Set(),rows=[];
 for(const chunk of ranked.chunks)if(!seen.has(chunk.pageId)){seen.add(chunk.pageId);rows.push({...byId.get(chunk.pageId),claimMatch:chunk.claimMatch});}
 return {documents:rows.slice(0,limit),matched:rows.length,candidateLimited:rows.length>limit};
}
