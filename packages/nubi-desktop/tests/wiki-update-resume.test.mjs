import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,access,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {git} from '../runtime/files.mjs';

async function settle(service,id){
  for(let i=0;i<300;i++){
    const item=(await service.wikiUpdate({method:'status'})).updates.find(item=>item.id===id);
    if(item.state!=='running')return item;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error('update did not settle');
}
async function start(service){const p=await service.wikiUpdate({method:'propose'});await service.wikiUpdate({method:'run',id:p.id,fingerprint:p.fingerprint});return p;}
const resume=(service,p)=>service.wikiUpdate({method:'resume',id:p.id,fingerprint:p.fingerprint});
const exists=p=>access(p).then(()=>true,()=>false);

for(const folder of [false,true])test(`5 of 11 pages survive failure/reopen and only 6 remaining pages run (${folder?'folder':'Git'})`,async t=>{
  const {service,root,directory}=await fixture(t);
  if(folder)await rm(path.join(root,'.git'),{recursive:true,force:true});
  const before=await readFile(path.join(root,'openwiki/home.md'),'utf8');
  let firstCopy,calls=0;const written=[];
  const runner=async({root:copy,onEvent})=>{
    calls++;if(!firstCopy)firstCopy=copy;else assert.equal(copy,firstCopy);
    let done=0;try{done=JSON.parse(await readFile(path.join(copy,'openwiki/.run.json'),'utf8')).completed;}catch{}
    for(let i=done;i<11;i++){
      if(calls===1&&i===5){onEvent({type:'progress',stage:'generating',index:6,total:11});throw Error('model_timeout');}
      written.push(i);await writeFile(path.join(copy,`openwiki/page-${i}.md`),`# Page ${i}\n`);
      await writeFile(path.join(copy,'openwiki/.run.json'),JSON.stringify({completed:i+1}));
    }
    await rm(path.join(copy,'openwiki/.run.json'));return {skipped:false};
  };
  service.wikiUpdater=runner;const p=await start(service);const failed=await settle(service,p.id);
  assert.equal(failed.canResume,true);assert.equal(failed.error,'timeout');assert.equal(calls,1);
  assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),before);
  // A killed host may leave a running record. Merely opening/status must not run the model or delete it.
  service.store.set('wiki-update:'+p.id,{...service.store.get('wiki-update:'+p.id),state:'running'});
  service.dispose();service.store.close();
  const reopened=new ProjectService({storageRoot:path.join(directory,'state')});
  t.after(()=>{reopened.dispose();reopened.store?.close();});
  await reopened.open(root,{initializeWiki:false});reopened.wikiUpdater=runner;
  const orphan=(await reopened.wikiUpdate({method:'status'})).updates.find(item=>item.id===p.id);
  assert.equal(orphan.error,'wiki_update_interrupted');assert.equal(orphan.canResume,true);assert.equal(calls,1);
  assert.equal(await exists(firstCopy),true);
  await resume(reopened,p);const ready=await settle(reopened,p.id);
  assert.equal(ready.state,'ready',JSON.stringify(ready));assert.equal(ready.resumed,true);
  assert.deepEqual(written,Array.from({length:11},(_,i)=>i),'completed pages never run twice');
  assert.equal(await exists(path.join(root,'openwiki/page-0.md')),false,'approval is still required');
  await reopened.wikiUpdate({method:'apply',id:p.id,fingerprint:ready.fingerprint});
  assert.equal(await readFile(path.join(root,'openwiki/page-10.md'),'utf8'),'# Page 10\n');
  assert.equal(await exists(firstCopy),false);
});

for(const change of ['source','head','wiki','copy','missing'])test(`resume refuses ${change} drift without destroying retained pages`,async t=>{
  const {service,root}=await fixture(t);let calls=0;
  service.wikiUpdater=async({root:copy})=>{calls++;await writeFile(path.join(copy,'openwiki/saved.md'),'# Saved\n');throw Error('model_timeout');};
  const p=await start(service),failed=await settle(service,p.id);
  if(change==='source')await writeFile(path.join(root,'app.txt'),'new original');
  if(change==='head')await git(root,['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','--allow-empty','-qm','new head']);
  if(change==='wiki')await writeFile(path.join(root,'openwiki/home.md'),'human edit');
  if(change==='copy')await writeFile(path.join(failed.copy,'app.txt'),'tampered copy');
  if(change==='missing')await rm(failed.copy,{recursive:true,force:true});
  await assert.rejects(resume(service,p),new RegExp(change==='wiki'?'wiki_update_conflict':change==='copy'?'wiki_update_resume_changed':change==='missing'?'wiki_update_resume_missing':'wiki_update_sources_changed'));
  assert.equal(calls,1);
  if(change!=='missing')assert.equal(await readFile(path.join(failed.copy,'openwiki/saved.md'),'utf8'),'# Saved\n');
});

test('refresh reuses unchanged failed work, cancellation retains it, discard removes it',async t=>{
  const {service}=await fixture(t);service.store.set('setting:wiki-source',{mode:'local'});let calls=0;
  service.wikiUpdater=async({root:copy,signal})=>{calls++;await writeFile(path.join(copy,'openwiki/saved.md'),'# Saved\n');if(calls===1)throw Error('model_timeout');await new Promise((resolve,reject)=>{if(signal.aborted)return reject(Error('cancelled'));signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});};
  const p=await start(service),failed=await settle(service,p.id);
  const fresh=await service.wikiUpdate({method:'refresh'});assert.equal(fresh.update.id,p.id);assert.equal(fresh.resumed,true);
  await service.wikiUpdate({method:'cancel',id:p.id});const stopped=await settle(service,p.id);
  assert.equal(stopped.canResume,true);assert.equal(stopped.state,'cancelled');assert.equal(calls,2);
  await service.wikiUpdate({method:'status'});assert.equal(calls,2,'status never restarts cancellation');
  await service.wikiUpdate({method:'discard',id:p.id});assert.equal(await exists(failed.copy),false);
});

test('changed originals start a fresh refresh without deleting the older retained work',async t=>{
  const {service,root}=await fixture(t);service.store.set('setting:wiki-source',{mode:'local'});
  service.wikiUpdater=async()=>{throw Error('model_timeout');};const p=await start(service),failed=await settle(service,p.id);
  await writeFile(path.join(root,'app.txt'),'new source');
  service.wikiUpdater=async({root:copy})=>{assert.equal(await readFile(path.join(copy,'app.txt'),'utf8'),'new source');return {skipped:false};};
  const fresh=await service.wikiUpdate({method:'refresh'});assert.notEqual(fresh.update.id,p.id);
  assert.equal((await settle(service,fresh.update.id)).state,'ready');assert.equal(await exists(failed.copy),true);
});

test('simultaneous resume requests invoke one runner and retain human-edit conflicts',async t=>{
  const {service,root}=await fixture(t);service.wikiUpdater=async()=>{throw Error('model_timeout');};const p=await start(service);await settle(service,p.id);
  let calls=0;service.wikiUpdater=async({root:copy})=>{calls++;await writeFile(path.join(copy,'openwiki/home.md'),'# Updated\n');return {skipped:false};};
  const attempts=await Promise.allSettled([resume(service,p),resume(service,p)]);
  assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);const ready=await settle(service,p.id);assert.equal(calls,1);
  await writeFile(path.join(root,'openwiki/home.md'),'# Human\n');
  await assert.rejects(service.wikiUpdate({method:'apply',id:p.id,fingerprint:ready.fingerprint}),/wiki_update_conflict/);
  assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),'# Human\n');
});

test('a replaced retained directory cannot redirect resume into another folder',async t=>{
  const {service,root}=await fixture(t);service.wikiUpdater=async()=>{throw Error('model_timeout');};
  const p=await start(service),failed=await settle(service,p.id);
  await rm(failed.copy,{recursive:true,force:true});await symlink(root,failed.copy,'dir');
  await assert.rejects(resume(service,p),/path_scope/);
  assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),'first\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n');
});

test('publication preparation retries completed generation without another model call',async t=>{
  const {service}=await fixture(t);let calls=0;
  service.wikiUpdater=async({root:copy})=>{calls++;await writeFile(path.join(copy,'openwiki/home.md'),'# Finished\n');await writeFile(path.join(copy,'openwiki/.last-update.json'),'invalid json');return {skipped:false};};
  const p=await start(service),failed=await settle(service,p.id);assert.equal(failed.state,'failed');assert.equal(failed.canResume,true);
  await writeFile(path.join(failed.copy,'openwiki/.last-update.json'),JSON.stringify({status:'complete'}));
  await resume(service,p);const ready=await settle(service,p.id);assert.equal(ready.state,'ready');assert.equal(calls,1);
});

test('refresh retains an unapproved result instead of replaying an older failure',async t=>{
  const {service,root}=await fixture(t);service.store.set('setting:wiki-source',{mode:'local'});let calls=0;
  service.wikiUpdater=async()=>{throw Error('model_timeout');};const old=await start(service);await settle(service,old.id);
  await writeFile(path.join(root,'app.txt'),'a new source version');
  service.wikiUpdater=async({root:copy})=>{calls++;await writeFile(path.join(copy,'openwiki/home.md'),'# Refreshed\n');return {skipped:false};};
  const first=await service.wikiUpdate({method:'refresh'});const ready=await settle(service,first.update.id);
  const second=await service.wikiUpdate({method:'refresh'});
  assert.equal(second.update.id,ready.id);assert.equal(second.update.state,'ready');assert.equal(calls,1);
});
