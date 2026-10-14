import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {ProjectService} from '../runtime/project-service.mjs';
const label=process.argv[2]||'candidate',temp=await mkdtemp(path.join(os.tmpdir(),'nubi-state-perf-')),root=path.join(temp,'project');await mkdir(root);
const service=new ProjectService({storageRoot:path.join(temp,'state')}),times=[];
try{
 await service.open(root,{initializeWiki:false});
 service.store.db.exec('BEGIN');
 for(let i=0;i<3000;i++)service.store.set('task:t'+i,{id:'t'+i,state:'done',request:'Synthetic task '+i,createdAt:new Date(1700000000000+i).toISOString(),messages:[{role:'assistant',text:'Synthetic long answer. '.repeat(600)}]});
 service.store.db.exec('COMMIT');
 for(let i=0;i<23;i++){const start=performance.now();const value=service.state({taskId:'t0'});if(value.tasks.length!==51)throw Error('selected old task was lost');const duration=performance.now()-start;if(i>=3)times.push(duration);}
 times.sort((a,b)=>a-b);const result={label,storedTasks:3000,displayedTasks:51,runs:times.length,medianMs:times[10],p95Ms:times[19],boundary:'Synthetic stored history, same full state API and selected-old-conversation contract; no model latency claim.'};
 await mkdir('verification/performance-2026-10-14',{recursive:true});await writeFile('verification/performance-2026-10-14/state-'+label+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{service.dispose();await rm(temp,{recursive:true,force:true});}
