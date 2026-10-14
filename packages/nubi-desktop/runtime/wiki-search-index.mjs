import {lstat} from 'node:fs/promises';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import MiniSearch from 'minisearch';
import {scopedFile,readSource} from './files.mjs';

// Per-service caches cannot mix project or account evidence. No index is persisted.
const owners=new WeakMap(),MAX_BYTES=64*1024*1024;
const terms=text=>String(text).normalize('NFKC').replace(/([a-z\d])([A-Z])/gu,'$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.map(word=>/^[가-힣]{3,}$/u.test(word)?word.replace(/(?:에서는|에서|으로|은|는|을|를|의|에|와|과)$/u,''):word)||[];
export async function wikiSearchCorpus(owner,root,files,makeDocument){
  let roots=owners.get(owner);if(!roots){roots=new Map();owners.set(owner,roots);}
  let state=roots.get(root);
  if(!state){state={files:new Map(),hashes:new Map(),index:new MiniSearch({fields:['title','path','raw'],tokenize:terms})};roots.set(root,state);}
  // Keep at most two project snapshots per service.
  roots.delete(root);roots.set(root,state);while(roots.size>2)roots.delete(roots.keys().next().value);
  const allowed=new Set(files),documents=[];let bytes=0,skipped=0,reused=0,loaded=0;
  for(const rel of state.files.keys())if(!allowed.has(rel))state.files.delete(rel);
  for(const [i,rel] of files.entries()){
    if(i%32===0)await yieldTurn();
    try{
      // Scope is rechecked even for cache hits, including parent symlink changes.
      const target=await scopedFile(root,rel),stat=await lstat(target);
      if(!stat.isFile()||stat.size>1024*1024||bytes+stat.size>MAX_BYTES)throw Error('index_limit');
      const stamp=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
      let entry=state.files.get(rel);
      if(entry?.stamp===stamp)reused++;
      else{entry={stamp,doc:makeDocument(await readSource(root,rel))};state.files.set(rel,entry);loaded++;}
      bytes+=stat.size;documents.push(entry.doc);
    }catch{state.files.delete(rel);skipped++;}
  }
  return {documents,skipped,reused,loaded,bytes,state};
}

// Rank the complete admitted corpus before expensive structural excerpt retrieval.
// Content hashes drive replacement; ignored, deleted and old revisions are removed.
export function rankWikiDocuments(state,documents,query,limit=48){
  const byId=new Map(documents.map(doc=>[doc.id,doc]));
  for(const id of state.hashes.keys())if(!byId.has(id)){state.index.discard(id);state.hashes.delete(id);}
  for(const doc of documents){
    if(state.hashes.get(doc.id)===doc.hash)continue;
    if(state.hashes.has(doc.id))state.index.discard(doc.id);
    state.index.add(doc);state.hashes.set(doc.id,doc.hash);
  }
  const hits=state.index.search(query,{boost:{title:3,path:2},prefix:term=>term.length>=3,fuzzy:false});
  return {documents:hits.slice(0,limit).map(hit=>byId.get(hit.id)),matched: hits.length,candidateLimited:hits.length>limit};
}
