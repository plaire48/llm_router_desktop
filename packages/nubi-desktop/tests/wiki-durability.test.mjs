import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {defaultWikiUpdater} from '../runtime/wiki-update.mjs';

// RED contract: use the actual Desktop initialization/transport/checkpoint
// boundary. Only the remote provider and native page worker are synthetic.
// These are recovery checks, not real-model or native Electron acceptance.
async function workspace(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-durable-'));
  const root=path.join(directory,'source');await mkdir(root);
  await writeFile(path.join(root,'app.txt'),'Synthetic source for durability checks.\n');
  for(let i=1;i<11;i++)await writeFile(path.join(root,'synthetic-'+i+'.txt'),'Synthetic source '+i+'\n');
  const services=[];
  t.after(async()=>{for(const service of services.reverse()){service.dispose();service.store?.close();}await rm(directory,{recursive:true,force:true});});
  const open=async()=>{
    const service=new ProjectService({storageRoot:path.join(directory,'state')});services.push(service);
    await service.open(root,{initializeWiki:false});
    service.wikiInitEnabled=true;
    service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture',connectionId:'fixture-connection'}),dispose(){}};
    return service;
  };
  return {root,open,service:await open()};
}

async function page(root,name){
  await mkdir(path.join(root,'openwiki'),{recursive:true});
  await writeFile(path.join(root,'openwiki',name+'.md'),'# Synthetic '+name+'\n');
}

test('provider-thrown output_limit receives the one host continuation',async t=>{
 const {service,root}=await workspace(t);let calls=0;
 service.providers.complete=async()=>{calls++;if(calls===1)throw Error('output_limit');return {content:'Complete shortened result.',calls:[]};};
 service.wikiInitializer=defaultWikiUpdater(service,{load:async()=>({NubiOpenWikiModel:class{constructor({complete}){this.complete=complete;}},async runNativeRepositoryGeneration({root:copy,model,durability}){return durability.runPage({path:'/openwiki/large.md'},async()=>{await model.complete([{role:'user',content:'Document a synthetic source.'}],[]);await page(copy,'large');return {skipped:false};});}})});
 await service.initializeWiki();await service.wikiInitPromise;
 assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));assert.equal(calls,2);assert.match(await readFile(path.join(root,'openwiki/large.md'),'utf8'),/Synthetic/);
});

test('two provider output_limit rejections produce a host split proposal after exactly one continuation',async t=>{
 const {service}=await workspace(t);let calls=0,decision;
 const receipt={role:'tool',tool_call_id:'accepted-source-read',content:'Accepted source receipt'};
 service.providers.complete=async messages=>{calls++;assert(messages.some(message=>message.tool_call_id===receipt.tool_call_id&&message.content===receipt.content),'accepted receipts survive inference repair');throw Error('output_limit');};
 const page={id:'large',path:'/openwiki/large.md',title:'Large',purpose:'Synthetic bounded documentation',seedPaths:['app.txt'],relatedPages:[],instructions:[],status:'skipped'};
 service.wikiInitializer=defaultWikiUpdater(service,{load:async()=>({NubiOpenWikiModel:class{constructor({complete}){this.complete=complete;}},async runNativeRepositoryGeneration({model,durability}){try{await durability.runPage(page,()=>model.complete([{role:'user',content:'Document synthetic source.'},receipt],[]));}catch(error){decision=await durability.onFailure({runId:'synthetic',page,error});}return {partial:true};}})});
 await service.initializeWiki();await service.wikiInitPromise;
 assert.equal(calls,2);assert.equal(decision.continued,true);assert.equal(decision.split.length,2);assert.deepEqual(decision.split.map(page=>page.path),['/openwiki/large-part-1.md','/openwiki/large-part-2.md']);assert.equal(service.wikiInitialization().state,'partial');
});

test('W0 native durability accepts the next host scope round with the original deadline',async t=>{
 const {service,root}=await workspace(t);let calls=0;const deadlines=[];
 const updater=defaultWikiUpdater(service,{load:async()=>({NubiOpenWikiModel:class{},async runNativeRepositoryGeneration({durability}){
   deadlines.push(durability.deadlineAt);await durability.journal({runId:'round-'+(++calls),phase:'ready',pages:[]});return {skipped:false};
 }})});
 await updater({root,updateId:'owned-rounds',mode:'init',scope:{round:1}});
 await updater({root,updateId:'owned-rounds',mode:'update',scope:{round:2}});
 assert.equal(calls,2);assert.equal(deadlines[0],deadlines[1]);
});
