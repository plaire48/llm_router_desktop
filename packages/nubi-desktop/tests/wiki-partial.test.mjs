import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';import {hash} from '../runtime/files.mjs';
import {RepositoryEvidenceResolver} from '../generated/openwiki.mjs';

async function prepare(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'wiki-partial-')),root=path.join(directory,'source');await mkdir(root);await writeFile(path.join(root,'app.txt'),'Synthetic source\n');
 const services=[];t.after(async()=>{for(const service of services.reverse()){service.dispose();service.store?.close();}await rm(directory,{recursive:true,force:true});});
 const open=async()=>{const service=new ProjectService({storageRoot:path.join(directory,'state')});services.push(service);await service.open(root,{initializeWiki:false});service.wikiInitEnabled=true;service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture',connectionId:'one'}),dispose(){}};return service;};
 return {root,open,service:await open()};
}
async function writePage(root,name){
 const content='# '+name+'\n',resource='repo://app.txt',evidence=await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource);
 await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});await writeFile(path.join(root,'openwiki',name+'.md'),content);
 await writeFile(path.join(root,'openwiki/.claims',name+'.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(content),claims:[{id:name,statement:'Synthetic source exists.',evidence:[{resource,version:evidence.evidence.version}]}]}));
}
for(const humanEdit of [false,true])test(`partial Wiki publishes verified pages and retains checkpoint before resume (${humanEdit?'human edit protected':'complete'})`,async t=>{
 const {root,service,open}=await prepare(t);let copy;
 service.wikiInitializer=async({root:current,onEvent})=>{copy=current;await writePage(copy,'first');await writeFile(path.join(copy,'openwiki/.run.json'),'retained checkpoint fixture');onEvent({type:'durability',pages:{'/openwiki/first.md':{state:'done'},'/openwiki/second.md':{state:'skipped',error:'network'}},heartbeatAt:Date.now(),partial:true});return {partial:true};};
 await service.initializeWiki();await service.wikiInitPromise;
 const partial=service.wikiInitialization();assert.equal(partial.state,'partial',JSON.stringify(partial));assert.equal(partial.canResume,true);
 assert.equal(await readFile(path.join(root,'openwiki/first.md'),'utf8'),'# first\n');await access(path.join(copy,'openwiki/.run.json'));
 await assert.rejects(access(path.join(root,'openwiki/second.md')));
 if(humanEdit)await writeFile(path.join(root,'openwiki/first.md'),'Human edit\n');
 service.dispose();service.store.close();const resumed=await open();let runs=0;
 resumed.wikiInitializer=async({root:current})=>{runs++;assert.equal(current,copy);await access(path.join(copy,'openwiki/.run.json'));await writePage(copy,'second');};
 await resumed.initializeWiki();await resumed.wikiInitPromise;assert.equal(runs,1);
 assert.equal(resumed.wikiInitialization().state,humanEdit?'attention':'completed',JSON.stringify(resumed.wikiInitialization()));
 assert.equal(await readFile(path.join(root,'openwiki/first.md'),'utf8'),humanEdit?'Human edit\n':'# first\n');
});

test('partial publication refuses a completed page whose Claims source changed in the retained copy',async t=>{
 const {root,service}=await prepare(t);
 service.wikiInitializer=async({root:copy,onEvent})=>{await writePage(copy,'first');await writeFile(path.join(copy,'app.txt'),'Changed after verification\n');onEvent({type:'durability',pages:{'/openwiki/first.md':{state:'done'},'/openwiki/second.md':{state:'skipped'}},partial:true});return {partial:true};};
 await service.initializeWiki();await service.wikiInitPromise;
 assert.equal(service.wikiInitialization().state,'attention');assert.equal(service.wikiInitialization().error,'write_unconfirmed');
 await assert.rejects(access(path.join(root,'openwiki/first.md')));
});

test('partial publication validates every Claim beyond the UI excerpt limit',async t=>{
 const {root,service}=await prepare(t);
 service.wikiInitializer=async({root:copy,onEvent})=>{await writePage(copy,'first');const file=path.join(copy,'openwiki/.claims/first.json');const data=JSON.parse(await readFile(file,'utf8'));data.claims=Array.from({length:25},(_,i)=>({...data.claims[0],id:'claim-'+i,evidence:data.claims[0].evidence.map(e=>({...e,...(i===24?{version:'invalid-current-version'}:{})}))}));await writeFile(file,JSON.stringify(data));onEvent({type:'durability',pages:{'/openwiki/first.md':{state:'done'}},partial:true});return {partial:true};};
 await service.initializeWiki();await service.wikiInitPromise;assert.equal(service.wikiInitialization().state,'attention');await assert.rejects(access(path.join(root,'openwiki/first.md')));
});
