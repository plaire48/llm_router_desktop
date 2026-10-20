import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {createProviders} from '../../nubi-office/worker/providers.mjs';
import {defaultWikiUpdater} from '../runtime/wiki-update.mjs';
async function setup(t){const f=await fixture(t),requests=[];const p=createProviders({startLogin:async()=>({result:Promise.resolve({token:'synthetic',models:[{id:'model-a',label:'A',contextLength:131072,maxOutputTokens:4096},{id:'model-b',label:'B',contextLength:131072,maxOutputTokens:24000}]}),cancel(){}}),fetchImpl:async(_,init)=>{requests.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:'synthetic answer'},finish_reason:'stop'}]});}});await p.login('aipro');await new Promise(r=>setImmediate(r));p.model('model-a');p.reasoning('low');f.service.providers=p;return {...f,p,requests};}
test('wiki generation defaults and actual values come from connected capabilities without inventing a strongest model',async t=>{const {service}=await setup(t);const result=await service.invoke('wikiGeneration');assert.equal(result.settings.model,'auto');assert.equal(result.settings.effort,'auto');assert.equal(result.settings.concurrency,3);assert.equal(result.applied.model,'model-a');assert.equal(result.applied.effort,'low');assert.equal(result.applied.maxToolCalls,8);assert(!JSON.stringify(result).includes('synthetic'));});
test('generation settings persist separately from conversation model and reject unsupported explicit values without overwriting',async t=>{const {service,p}=await setup(t);const value={provider:'aipro',model:'model-b',effort:'auto',concurrency:4,maxToolCalls:16,pageMaxTokens:16384};const saved=await service.invoke('wikiGeneration',{action:'set',value});assert.equal(saved.applied.model,'model-b');assert.equal(saved.applied.pageMaxTokens,16384);assert.equal(p.status().model,'model-a');for(const change of [{effort:'high'},{concurrency:5},{maxToolCalls:17},{model:'missing'}])await assert.rejects(service.invoke('wikiGeneration',{action:'set',value:{...value,...change}}));assert.equal((await service.invoke('wikiGeneration')).settings.concurrency,4);});
test('native wiki adapter forwards concurrency and purpose-bound model while leaving ordinary calls unchanged',async t=>{
 const {service,root,requests,p}=await setup(t);service.store.set('setting:wiki-generation',{provider:'aipro',model:'model-b',effort:'auto',concurrency:3,maxToolCalls:16,pageMaxTokens:16384});let observed;
 const load=async()=>({NubiOpenWikiModel:(await import('../generated/openwiki.mjs')).NubiOpenWikiModel,async runNativeRepositoryGeneration(options){observed=options;await options.model.invoke('Read synthetic sources');return {skipped:false};}});
 await defaultWikiUpdater(service,{load})({root,signal:new AbortController().signal,updateId:'w3-native',onEvent(){}});
 assert.equal(observed.pageConcurrency,3);assert.equal(observed.modelId,'model-b');assert.equal(requests[0].model,'model-b');assert.equal(p.status().model,'model-a');
 await p.complete([{role:'user',content:'ordinary'}],[],new AbortController().signal);assert.equal(requests.at(-1).model,'model-a');
});

test('initialization records the configured wiki model before scanning instead of binding the conversation model',async t=>{
 const {service,root,p}=await setup(t);const {rm}=await import('node:fs/promises');const path=await import('node:path');
 await rm(path.join(root,'openwiki'),{recursive:true,force:true});service.store.set('wiki-init',null);service.wikiInitEnabled=true;
 await service.invoke('wikiGeneration',{action:'set',value:{provider:'aipro',model:'model-b',effort:'auto',concurrency:3}});
 service.wikiSourceLister=async()=>{throw Error('synthetic listing failure');};await service.initializeWiki();await service.wikiInitPromise;
 const job=service.wikiInitialization();assert.equal(job.model,'model-b');assert.equal(job.provider,'aipro');assert.equal(job.connectionId,p.status().providers.find(x=>x.id==='aipro').connectionId);assert.equal(p.status().model,'model-a');
});
test('changing wiki settings during a wiki run is refused without changing next-run settings',async t=>{const {service}=await setup(t);service.wikiUpdateRun={id:'running'};try{await assert.rejects(service.invoke('wikiGeneration',{action:'set',value:{concurrency:4}}),/wiki_busy/);assert.equal(service.store.get('setting:wiki-generation'),null);}finally{service.wikiUpdateRun=null;}});


test('ChatGPT wiki settings retain wished tokens and expose server default as the applied cap',async t=>{
 const {service}=await fixture(t),p=createProviders({startLogin:async()=>({result:Promise.resolve({token:'synthetic',models:[{id:'synthetic-api',maxOutputTokens:24576}]}),cancel(){}}),chatGPTLogin:async()=>({result:Promise.resolve({token:'synthetic',expiresAt:Date.now()+3600000}),cancel(){}}),chatGPTModels:()=>({payload:{modelList:[{name:'synthetic-chat',supported_reasoning_levels:['low']}]}})});t.after(()=>p.dispose());await p.login('chatgpt');await new Promise(r=>setImmediate(r));service.providers=p;
 const view=await service.invoke('wikiGeneration',{action:'set',value:{provider:'chatgpt',model:'synthetic-chat',pageMaxTokens:16384}});
 assert.equal(view.settings.pageMaxTokens,16384);assert.equal(view.applied.pageMaxTokens,null);assert.equal(view.models[0].pageOutputConfigurable,false);await p.login('aipro');await new Promise(r=>setImmediate(r));const restored=await service.invoke('wikiGeneration',{action:'set',value:{...view.settings,provider:'aipro',model:'synthetic-api'}});assert.equal(restored.settings.pageMaxTokens,16384);assert.equal(restored.applied.pageMaxTokens,16384);assert.equal(restored.models.find(m=>m.provider==='aipro').pageOutputConfigurable,true);
});
