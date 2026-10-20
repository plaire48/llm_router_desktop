import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,writeFile,rm,readFile} from 'node:fs/promises';import path from 'node:path';
import {fixture} from './fixtures.mjs';
for(const [pause,resume] of [['offline','online'],['suspend','resume']])test(`Wiki ${pause}/${resume} interrupts the active inference and resumes only once`,async t=>{
 const {service,root}=await fixture(t);await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);service.wikiInitEnabled=true;
 service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture',connectionId:'one'}),dispose(){}};
 let entered;const started=new Promise(resolve=>entered=resolve);let calls=0;
 service.wikiInitializer=async({root:copy,signal})=>{
   calls++;await mkdir(path.join(copy,'openwiki'),{recursive:true});await writeFile(path.join(copy,'openwiki/first.md'),'# Retained\n');entered();
   await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 };
 await service.initializeWiki();await started;
 await service.invoke('wikiLifecycle',{event:pause});await service.wikiInitPromise;
 assert.equal(service.wikiInitialization().state,'paused');assert.equal(calls,1);
 service.wikiInitializer=async({root:copy})=>{calls++;assert.equal(await readFile(path.join(copy,'openwiki/first.md'),'utf8'),'# Retained\n');await writeFile(path.join(copy,'openwiki/second.md'),'# Remaining\n');await writeFile(path.join(copy,'openwiki/.run.json'),JSON.stringify({plan:{pages:[{path:'/openwiki/second.md',status:'complete',seedPaths:['app.txt']}]}}));};
 await service.invoke('wikiLifecycle',{event:resume});await service.wikiInitPromise;
 assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));assert.equal(calls,2);
 await service.invoke('wikiLifecycle',{event:resume});assert.equal(calls,2);
});

test('Wiki stays paused until both suspend and offline reasons clear, and rejects a previous project event',async t=>{
 const {service,root}=await fixture(t);await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);service.wikiInitEnabled=true;
 service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};
 let entered;const started=new Promise(resolve=>entered=resolve);let calls=0;
 service.wikiInitializer=async({signal})=>{calls++;entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
 await service.initializeWiki();await started;await service.wikiLifecycle({event:'suspend'});await service.wikiLifecycle({event:'offline'});
 service.wikiInitializer=async({root:copy})=>{calls++;await mkdir(path.join(copy,'openwiki'),{recursive:true});await writeFile(path.join(copy,'openwiki/home.md'),'# Recovered\n');await writeFile(path.join(copy,'openwiki/.run.json'),JSON.stringify({plan:{pages:[{path:'/openwiki/home.md',status:'complete',seedPaths:['app.txt']}]}}));};
 await service.wikiLifecycle({event:'resume'});assert.equal(calls,1);assert.equal(service.wikiInitialization().state,'paused');
 await assert.rejects(service.wikiLifecycle({event:'online',expectedRoot:root+'-previous'}),/project_changed/);assert.equal(calls,1);
 await service.wikiLifecycle({event:'online',expectedRoot:root});await service.wikiInitPromise;assert.equal(calls,2);assert.equal(service.wikiInitialization().state,'completed');
});
