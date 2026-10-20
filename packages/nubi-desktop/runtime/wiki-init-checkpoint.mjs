import {mkdir,mkdtemp,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {hash} from './files.mjs';
import {readWikiSource,removeWikiHistory,wikiSources} from './wiki-snapshot.mjs';
import {wikiPreparationGit} from './wiki-git-preparation.mjs';

const KEY='wiki-init-checkpoint';
const parent=store=>path.join(store.directory,'wiki-preparation');
const fingerprint=(head,sources)=>hash(JSON.stringify([head,sources.map(({path,hash})=>[path,hash]).sort((a,b)=>a[0].localeCompare(b[0]))]));
function location(store,record){
 if(!record||!/^run-[a-zA-Z0-9]+$/.test(record.name||''))return null;
 return path.join(parent(store),record.name);
}
export async function discardWikiInitCheckpoint(store,root){
 const record=store.get(KEY),directory=location(store,record);
 if(directory){
  // Never follow a replaced checkpoint directory into another workspace.
  try{if((await lstat(parent(store))).isSymbolicLink()||(await lstat(directory)).isSymbolicLink())throw Error('path_scope');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await removeWikiHistory(root,directory,record.head);
 }
 store.delete(KEY);
}
export async function wikiInitCheckpoint(store,root,head,sources,options={}){
 const record=store.get(KEY),directory=location(store,record),identity=fingerprint(head,sources);
 if(directory&&record.identity===identity){
  try{
   if((await lstat(parent(store))).isSymbolicLink()||(await lstat(directory)).isSymbolicLink())throw Error('path_scope');
   if(!record.ready)return {directory,resumed:false,preparationResumed:true};
   if((await wikiPreparationGit(directory,['rev-parse','HEAD'],options,'verify')).trim()!==record.snapshotHead)throw Error('source_stale');
   const canonical=await realpath(directory);
   const expected=record.copySources||sources;
   for(const source of expected){options.signal?.throwIfAborted();if((await readWikiSource(canonical,source.path)).hash!==source.hash)throw Error('source_stale');}
   if(record.copySources&&(await wikiSources(canonical,{signal:options.signal})).length!==expected.length)throw Error('source_stale');
   return {directory,resumed:true,generated:record.generated===true};
  }catch(error){
   // A slow Git probe is not evidence that saved work is invalid.
   if(options.signal?.aborted||error.killed||error.code==='ETIMEDOUT')throw error;
   /* Missing, changed, or invalid snapshots must be rebuilt from current sources. */
  }
 }
 await discardWikiInitCheckpoint(store,root);
 await mkdir(parent(store),{recursive:true,mode:0o700});
 if((await lstat(parent(store))).isSymbolicLink())throw Error('path_scope');
 const created=await mkdtemp(path.join(parent(store),'run-'));
 store.set(KEY,{name:path.basename(created),identity,head,ready:false});
 return {directory:created,resumed:false};
}
export async function markWikiInitCheckpointReady(store,directory,options={}){
 const record=store.get(KEY);if(location(store,record)!==directory)throw Error('project_changed');
 store.set(KEY,{...record,ready:true,snapshotHead:(await wikiPreparationGit(directory,['rev-parse','HEAD'],options,'verify')).trim(),copySources:(await wikiSources(directory,{signal:options.signal})).map(({path,hash})=>({path,hash}))});
}
export function markWikiInitGenerated(store,directory){
 const record=store.get(KEY);if(location(store,record)!==directory)throw Error('project_changed');
 store.set(KEY,{...record,generated:true});
}

// Persist before extending the owned source copy so a crash keeps pages for preparation resume.
export function markWikiInitCheckpointPreparing(store,directory){
 const record=store.get(KEY);if(location(store,record)!==directory)throw Error('project_changed');
 store.set(KEY,{...record,ready:false});
}
