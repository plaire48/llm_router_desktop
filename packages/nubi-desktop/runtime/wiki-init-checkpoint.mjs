import {mkdir,mkdtemp,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {git,hash} from './files.mjs';
import {readWikiSource,removeWikiHistory} from './wiki-snapshot.mjs';

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
export async function wikiInitCheckpoint(store,root,head,sources){
 const record=store.get(KEY),directory=location(store,record),identity=fingerprint(head,sources);
 if(directory&&record.ready&&record.identity===identity){
  try{
   if((await lstat(parent(store))).isSymbolicLink()||(await lstat(directory)).isSymbolicLink())throw Error('path_scope');
   if((await git(directory,['rev-parse','HEAD'])).trim()!==record.snapshotHead)throw Error('source_stale');
   const canonical=await realpath(directory);
   for(const source of sources)if((await readWikiSource(canonical,source.path)).hash!==source.hash)throw Error('source_stale');
   return {directory,resumed:true};
  }catch{/* Missing, changed, or invalid snapshots must be rebuilt from current sources. */}
 }
 await discardWikiInitCheckpoint(store,root);
 await mkdir(parent(store),{recursive:true,mode:0o700});
 if((await lstat(parent(store))).isSymbolicLink())throw Error('path_scope');
 const created=await mkdtemp(path.join(parent(store),'run-'));
 store.set(KEY,{name:path.basename(created),identity,head,ready:false});
 return {directory:created,resumed:false};
}
export async function markWikiInitCheckpointReady(store,directory){
 const record=store.get(KEY);if(location(store,record)!==directory)throw Error('project_changed');
 store.set(KEY,{...record,ready:true,snapshotHead:(await git(directory,['rev-parse','HEAD'])).trim()});
}
