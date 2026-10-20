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

const faults=[
  ['network',()=>new Error('network_error')],
  ['rate limit',()=>Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:10000})],
  ['server error',()=>Object.assign(new Error('server_error'),{status:503})],
  ['timeout',()=>new Error('model_timeout')],
  ['output limit',null],
];
for(const [name,fault] of faults)test(`W0 ${name}: resumes inference and publishes both pages without a retry click`,async t=>{
  const {root,service}=await workspace(t);let requests=0;const events=[];
  service.recoveryOptions={model:{retries:0,minTimeout:0,maxTimeout:0,randomize:false}};
  let clock=Date.now();service.wikiDurableClock={now:()=>clock,sleep:async ms=>{clock+=ms;}};
  service.providers.complete=async()=>{
    requests++;
    if(requests===1){if(fault)throw fault();return {content:'incomplete output',calls:[],finishReason:'length'};}
    return {content:'Synthetic page read completed.',calls:[]};
  };
  const load=async()=>({
    NubiOpenWikiModel:class{constructor({complete}){this.complete=complete;}},
    async runNativeRepositoryGeneration({root:copy,model,onEvent}){
      // Like the native runner, a failed page is skipped and later workers
      // still get a turn. The host must not poison them with the first error.
      let completed=0;
      for(const name of ['first','second']){
        onEvent?.({type:'repository_progress',stage:'generating',page:'openwiki/'+name+'.md',pageCount:2,completedPages:completed});
        try{await model.complete([{role:'user',content:'Document synthetic '+name}],[]);await page(copy,name);completed++;}
        catch(error){events.push({page:name,error:error.message});}
      }
      onEvent?.({type:'repository_progress',stage:'finalizing',pageCount:2,completedPages:completed});
      return {skipped:false};
    },
  });
  service.wikiInitializer=defaultWikiUpdater(service,{load});
  await service.initializeWiki();await service.wikiInitPromise;
  const job=service.wikiInitialization();
  assert.equal(job.state,'completed',JSON.stringify({job,events,requests}));
  assert.match(await readFile(path.join(root,'openwiki/first.md'),'utf8'),/Synthetic first/);
  assert.match(await readFile(path.join(root,'openwiki/second.md'),'utf8'),/Synthetic second/);
});

for(const [name,error,initialState] of [
  ['app restart','wiki_interrupted','running'],
  ['sleep / resume','wiki_suspended','attention'],
  ['same model reconnect','provider_changed','attention'],
])test(`W0 ${name}: re-entry resumes the owned checkpoint without a retry action`,async t=>{
  const {root,service,open}=await workspace(t);let copy;
  service.wikiInitializer=async({root:current})=>{copy=current;await page(current,'retained');throw new Error(error);};
  await service.initializeWiki();await service.wikiInitPromise;
  const interrupted=service.wikiInitialization();assert.equal(interrupted.state,'attention');assert.equal(interrupted.canResume,true);
  // Persisted fixture models the state received on re-entry. It does not
  // claim to exercise SIGKILL, powerMonitor, or a real reconnect notification.
  service.store.set('wiki-init',{...interrupted,state:initialState,error});
  service.dispose();service.store.close();
  const reopened=await open();let resumed=0;
  reopened.wikiInitializer=async({root:current})=>{
    resumed++;assert.equal(current,copy,'reuse the verified owned snapshot');
    assert.match(await readFile(path.join(current,'openwiki/retained.md'),'utf8'),/Synthetic retained/);
    await page(current,'remaining');
  };
  // Project admission is a host action, not the user-facing retry operation.
  await reopened.initializeWiki();await reopened.wikiInitPromise;
  const job=reopened.wikiInitialization();assert.equal(job.state,'completed',JSON.stringify(job));assert.equal(resumed,1);
  assert.match(await readFile(path.join(root,'openwiki/remaining.md'),'utf8'),/Synthetic remaining/);
});
