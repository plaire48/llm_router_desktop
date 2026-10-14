import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';
import {ProjectService} from '../runtime/project-service.mjs';
import {git,readSource} from '../runtime/files.mjs';
import {retrieveWikiEvidence} from '../generated/openwiki.mjs';
const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-bench-'))),root=path.join(directory,'repo'),out=path.resolve('verification/openwiki-quality-2026-10-15');let service;
try{
 await mkdir(path.join(root,'openwiki'),{recursive:true});await git(root,['init','-q']);await git(root,['config','user.email','fixture@example.invalid']);await git(root,['config','user.name','Fixture']);
 const names=[];for(let i=0;i<1200;i++){const name='openwiki/'+String(i).padStart(4,'0')+'.md';names.push(name);await writeFile(path.join(root,name),i===1199?'# Quartz incident\n\nQUARTZ_813 requires a lease reset.\n':'# Onboarding\n\nParking and workstation information.\n'.repeat(10));}
 await git(root,['add','.']);await git(root,['commit','-qm','Pin retrieval measurement']);
 service=new ProjectService({storageRoot:path.join(directory,'state')});await service.open(root);
 const started=performance.now(),old=[];for(const name of names.slice(0,400)){const f=await readSource(root,name);old.push({id:f.path.slice(0,-3),title:'Onboarding',raw:f.content});}
 const before=retrieveWikiEvidence(old,'QUARTZ_813');const baseline={elapsedMs:performance.now()-started,scanned:old.length,hit:before.results.some(r=>r.provenance.path===names.at(-1))};
 const times=[];let cold,warm;for(let i=0;i<6;i++){const start=performance.now(),result=await service.wikiQuery({query:'QUARTZ_813'});const row={elapsedMs:performance.now()-start,scanned:result.scanned,hit:result.results.some(r=>r.path===names.at(-1)),index:result.retrieval.index};if(!i)cold=row;else{times.push(row.elapsedMs);warm=row;}}
 times.sort((a,b)=>a-b);const report={scope:'1200 synthetic pages on this Mac; old first-400 lexical path compared with new complete query path. Not model or Windows latency.',baseline,cold,warm:{...warm,p50Ms:times[2],p95Ms:times.at(-1)}};
 await mkdir(out,{recursive:true});await writeFile(path.join(out,'retrieval-performance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{service?.dispose();service?.store?.close();await rm(directory,{recursive:true,force:true});}
