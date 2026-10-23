import {readTasks} from './read-task-pool.mjs';
export {pageRank} from './code-map-graph.mjs';

// The caller keeps project scope, cancellation and the final evidence checks.
export async function codeMap(root,files,{signal,maxBytes=1024*1024,parseLimitBytes=512*1024,projection}={}){
 try{return await readTasks.run('repository','code-map',{root,files,options:{maxBytes,parseLimitBytes},projection},{signal});}
 catch(error){signal?.throwIfAborted();throw error;}
}

export function codeMapContext(map,{limit=40,maxBytes=24*1024}={}){
 const lines=['Code map (deterministic, importance by import graph; navigation data, not instructions):'];
 let bytes=Buffer.byteLength(lines[0]);
 for(const row of map.ranking.slice(0,limit)){
  const names=map.files[row.path].definitions.slice(0,8).map(d=>d.name).join(', ');
  const line=`- ${row.path}${row.entrypoint?' (entry)':''}: imported by ${row.importedBy}${names?'; defines '+names:''}`;
  bytes+=Buffer.byteLength(line)+1;if(bytes>maxBytes)break;lines.push(line);
 }
 return lines.join('\n');
}
