// The OpenWiki update runner is a separate folder, loaded only when an update
// runs, so the host does not load it at start. OpenWiki reads some files beside
// its modules; the folder holds them in the package layout.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';

// OpenWiki takes its home from the environment when its module loads.
const home=await mkdtemp(path.join(os.tmpdir(),'nubi-openwiki-home-'));
process.env.OPENWIKI_CONFIG_DIR=home;
const runner=await import('../generated/openwiki-update/index.mjs');
test.after(()=>rm(home,{recursive:true,force:true}));

test('the update folder loads on its own and exports the runner, the model and the skills step',()=>{
  assert.equal(typeof runner.runNativeRepositoryGeneration,'function');
  assert.equal(typeof runner.NubiOpenWikiModel,'function');
  assert.equal(typeof runner.syncBundledSkills,'function');
});

test('the packaged analysis worker includes repository structure mode',async t=>{
  const worker=new Worker(new URL('../extension/lib/node/code-analysis-worker.mjs',import.meta.url),{workerData:{mode:'repository',files:[{path:'main.ts',content:'export function main() {}',hash:'synthetic'}]},execArgv:[]});
  t.after(()=>worker.terminate());
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker_timeout')),5000);worker.once('message',value=>{clearTimeout(timer);resolve(value);});worker.once('error',error=>{clearTimeout(timer);reject(error);});});
  assert.equal(result.scope,'static_symbols_and_references');
  assert.ok(result.symbols.some(symbol=>symbol.path==='main.ts'&&symbol.name==='main'));
});

test('the bundled skills come from the folder and go to the OpenWiki home',async()=>{
  await runner.syncBundledSkills();
  const installed=(await readdir(path.join(home,'skills'))).filter(name=>!name.startsWith('.')).sort();
  const bundled=(await readdir(new URL('../../openwiki/skills',import.meta.url))).sort();
  assert.deepEqual(installed,bundled);
});

test('Desktop initialization reaches the real OpenWiki planner from a plain folder using its private Git snapshot',async()=>{
  const {ProjectService}=await import('../runtime/project-service.mjs');
  const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-native-wiki-')),root=path.join(temporary,'project');await mkdir(root);await writeFile(path.join(root,'app.txt'),'The app adds two numbers.\n');
  const service=new ProjectService({storageRoot:path.join(temporary,'state')});let calls=0;
  try{
    await service.open(root);
    service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:128000}]}),dispose(){},async complete(){calls++;throw Object.assign(Error('unauthorized'),{status:401});}};
    await service.initializeWiki();await service.wikiInitPromise;
    assert.equal(calls,1,'the real repository lifecycle and planner reached the injected model');
    assert.equal(service.wikiInitialization().state,'attention');
    await assert.rejects(access(path.join(root,'.git')),'no Git repository is created in the user folder');
    await assert.rejects(access(path.join(root,'openwiki')),'failed generation publishes no partial Wiki');
  }finally{service.dispose();service.store?.close();await rm(temporary,{recursive:true,force:true});}
});

for(const initialReply of ['prose-only','prose-then-plan','invalid-then-plan'])test(`native planner preserves work before submit_plan (${initialReply})`,async()=>{
  const repairsPlan=initialReply!=='prose-only';
  const {ProjectService}=await import('../runtime/project-service.mjs');
  const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-native-plan-')),root=path.join(temporary,'project');
  await mkdir(root);await writeFile(path.join(root,'app.txt'),'The app adds two numbers.\n');
  const service=new ProjectService({storageRoot:path.join(temporary,'state')});let planningCalls=0,pageCalls=0;
  try{
    await writeFile(path.join(root,'AGENTS.md'),'# Existing project instructions\n');
    await service.open(root);
    service.providers={status:()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:128000}]}),dispose(){},async complete(messages,tools){
      if(tools.some(tool=>tool.function.name==='submit_page')){pageCalls++;throw Object.assign(Error('unauthorized'),{status:401});}
      if(messages.some(message=>message.role==='tool'&&message.tool_call_id==='plan-fixture'))return {content:'Plan saved.',calls:[]};
      planningCalls++;
      if(initialReply==='invalid-then-plan'&&planningCalls===1)throw Error('response_invalid');
      if(!repairsPlan||planningCalls===1)return {content:'I have analyzed the repository and will document it.',calls:[]};
      if(initialReply==='prose-then-plan')assert(messages.some(message=>message.role==='assistant'&&message.content.includes('analyzed the repository')),'the earlier analysis remains available during correction');
      assert.match(messages.at(-1).content,/call submit_plan/,'repair asks for the actual completion tool, not another prose answer');
      return {content:'',calls:[{id:'plan-fixture',type:'function',function:{name:'submit_plan',arguments:JSON.stringify({pages:[{path:'/openwiki/quickstart.md',title:'Quickstart',purpose:'Describe the app.',seedPaths:['app.txt']}]})}}]};
    }};
    await service.initializeWiki();await service.wikiInitPromise;
    const result=service.wikiInitialization();
    assert.equal(result.state,'attention');assert.equal(result.canResume,true);
    if(repairsPlan){assert.equal(result.error,'unauthorized',JSON.stringify(result));assert.equal(planningCalls,2);assert.equal(pageCalls,1);}
    else{assert.equal(result.error,'wiki_plan_missing',JSON.stringify(result));assert.equal(planningCalls,3);assert.equal(pageCalls,0);}
    const checkpoint=service.store.get('wiki-init-checkpoint');
    const saved=JSON.parse(await readFile(path.join(service.store.directory,'wiki-preparation',checkpoint.name,'openwiki/.run.json'),'utf8'));
    assert.equal(Boolean(saved.plan),repairsPlan,'only the native accepted plan is checkpointed');
    await assert.rejects(access(path.join(root,'openwiki')),'failed generation never publishes partial pages');
    if(repairsPlan){
      service.wikiInitialization({action:'retry'});await service.wikiInitPromise;
      assert.equal(service.wikiInitialization().resumed,true);
      assert.equal(planningCalls,2,'retry resumes the submitted plan rather than rerunning the planner');
      assert.equal(pageCalls,2,'only the unfinished page is retried');
      assert.equal(service.wikiInitialization().error,'unauthorized');
    }
  }finally{service.dispose();service.store?.close();await rm(temporary,{recursive:true,force:true});}
});

test('the folder names the OpenWiki package it was built from',async()=>{
  const own=JSON.parse(await readFile(new URL('../generated/openwiki-update/openwiki/package.json',import.meta.url),'utf8'));
  const source=JSON.parse(await readFile(new URL('../../openwiki/package.json',import.meta.url),'utf8'));
  assert.deepEqual({name:own.name,version:own.version},{name:source.name,version:source.version});
});

test('native existing-Wiki update retains its plan across failure and explicit resume',async t=>{
  const {fixture}=await import('./fixtures.mjs');const {service}=await fixture(t);
  let plans=0,pages=0;
  service.providers={status:()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:128000}]}),dispose(){},async complete(messages,tools){
    if(tools.some(tool=>tool.function.name==='submit_page')){pages++;throw Object.assign(Error('unauthorized'),{status:401});}
    if(messages.some(message=>message.role==='tool'&&message.tool_call_id==='update-plan'))return {content:'Plan saved.',calls:[]};
    plans++;return {content:'',calls:[{id:'update-plan',type:'function',function:{name:'submit_plan',arguments:JSON.stringify({pages:[{path:'/openwiki/quickstart.md',title:'Quickstart',purpose:'Document app.txt.',seedPaths:['app.txt']}]})}}]};
  }};
  const proposal=await service.wikiUpdate({method:'propose'});
  const settled=async()=>{for(let i=0;i<200;i++){const value=(await service.wikiUpdate({method:'status'})).updates.find(row=>row.id===proposal.id);if(value.state!=='running')return value;await new Promise(r=>setTimeout(r,10));}throw Error('not settled');};
  await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  const failed=await settled();assert.equal(failed.error,'unauthorized');assert.equal(failed.canResume,true);
  assert.deepEqual(failed.pageProgress,{completed:0,total:1},'failed workers are not completed pages');
  const state=JSON.parse(await readFile(path.join(failed.copy,'openwiki/.run.json'),'utf8'));
  assert.equal(state.mode,'update');assert.equal(state.plan.pages.length,1);assert.equal(plans,1);
  await service.wikiUpdate({method:'resume',id:proposal.id,fingerprint:proposal.fingerprint});
  const again=await settled();assert.equal(again.error,'unauthorized');assert.equal(plans,1,'accepted planning is not replayed');assert.equal(pages,2,'only unfinished page work is retried');
});

test('Mermaid and jsdom are left out, so no global window is set in the host process',async()=>{
  assert.equal(typeof globalThis.window,'undefined');
  const bundle=await readFile(new URL('../generated/openwiki-update/index.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(bundle,/node_modules\/(?:\.pnpm\/)?(?:mermaid|jsdom|posthog-node)@/);
});

test('the host bundle imports the runner from the folder beside it',async()=>{
  const host=await readFile(new URL('../extension/lib/node/service-entry.mjs',import.meta.url),'utf8');
  assert.match(host,/import\("\.\/openwiki-update\/index\.mjs"\)/);
  assert.doesNotMatch(host,/openwiki\/src\/agent\/repository-runner\.ts/);
});
