// The project's import-graph code map in coding runs (opencode benchmark item 6, 2026-10-23). opencode itself has no
// repository map; nubi reuses its own deterministic PageRank map (code-map.mjs, the wiki planner's map) so a coding run
// starts from the files most of the project depends on. Navigation data only: paths, import counts and symbol names.
// Reused until a source file changes; skipped for very large projects, on a deadline, or on any failure.
import {createHash} from 'node:crypto';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {listFiles} from './files.mjs';
import {codeMap,codeMapContext} from './code-map.mjs';
const SOURCE=/\.(?:[cm]?[jt]sx?|py|java)$/i;
const cache=new WeakMap();
export async function codingMapContext(service,taskId,{signal,limit=30,maxBytes=6*1024,maxFiles=5000,deadlineMs=15000,compute=codeMap}={}){
 try{
  const root=await service.target(taskId);
  const {paths}=await listFiles(root);
  const files=paths.filter(rel=>SOURCE.test(rel));
  if(!files.length||files.length>maxFiles)return null;
  // Manifests name the entry points the ranking is seeded from.
  const manifests=paths.filter(rel=>/(^|\/)package\.json$/.test(rel)).slice(0,500);
  const signature=createHash('sha256');
  for(const rel of [...files,...manifests]){const info=await stat(path.join(root,rel)).catch(()=>null);signature.update(rel+'\0'+(info?info.size+':'+info.mtimeMs:'-')+'\n');}
  const key=root+'\n'+signature.digest('hex');
  let entry=cache.get(service);
  if(entry?.key!==key){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),deadlineMs);
   try{entry={key,map:await compute(root,[...files,...manifests],{signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal})};}finally{clearTimeout(timer);}
   cache.set(service,entry);
  }
  return codeMapContext(entry.map,{limit,maxBytes});
 }catch{signal?.throwIfAborted();return null;}
}
