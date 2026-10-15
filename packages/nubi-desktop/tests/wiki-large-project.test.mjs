import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git,listFiles} from '../runtime/files.mjs';
import {listWikiSourceFiles,wikiSources,writeWikiSnapshot} from '../runtime/wiki-snapshot.mjs';
import {wikiSourceInventory,wikiGitRecords} from '../runtime/wiki-source-inventory.mjs';
import {wikiUpdateStatus} from '../runtime/wiki-update.mjs';
import {ProjectService} from '../runtime/project-service.mjs';

test('more than 20,000 sources survive folder/Git enumeration, Wiki generation and checkpoint reload',async t=>{
  const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-large-wiki-'))),root=path.join(temp,'source');
  let service;
  t.after(async()=>{service?.dispose();service?.store?.close();await rm(temp,{recursive:true,force:true});});
  await mkdir(path.join(root,'src'),{recursive:true});
  const count=20025;
  for(let offset=0;offset<count;offset+=256)await Promise.all(Array.from({length:Math.min(256,count-offset)},(_,i)=>writeFile(path.join(root,'src',String(offset+i).padStart(5,'0')+'.txt'),'source '+(offset+i)+'\n')));
  await writeFile(path.join(root,'src','마지막 파일.txt'),'last source\n');
  await writeFile(path.join(root,'.openwikiignore'),'ignored.txt\n');await writeFile(path.join(root,'ignored.txt'),'excluded\n');
  await writeFile(path.join(root,'.env'),'PRIVATE_FIXTURE\n');
  const folder=await listWikiSourceFiles(root);
  assert.equal(folder.truncated,false);assert.equal(folder.paths.length,count+3);assert(folder.paths.includes('src/마지막 파일.txt'));assert(!folder.paths.includes('.env'));
  // Fixture setup must not inherit Windows CRLF conversion or the interactive Git timeout.
  await git(root,['init','-q']);await git(root,['config','core.autocrlf','false']);
  await git(root,['add','-A'],{timeout:300000});await git(root,['-c','user.name=Fixture','-c','user.email=fixture@localhost','-c','commit.gpgSign=false','commit','-qm','Many sources'],{timeout:300000});
  assert.equal((await listFiles(root)).truncated,true,'interactive search retains its bounded contract');
  assert.deepEqual((await listWikiSourceFiles(root)).paths,folder.paths);
  const sources=await wikiSources(root);
  assert.equal(sources.length,count+2);assert(sources.every(file=>file.content===undefined&&file.hash&&file.sourceRoot),'keep hashes, not all source bodies in memory');
  assert(!sources.some(file=>file.path==='ignored.txt'));
  service=new ProjectService({storageRoot:path.join(temp,'state')});await service.open(root,{initializeWiki:false});
  service.wikiInitEnabled=true;service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};
  service.wikiInitializer=async({root:copy})=>{
    assert.equal(await readFile(path.join(copy,'src','마지막 파일.txt'),'utf8'),'last source\n');
    assert.equal(await readFile(path.join(copy,'src','20024.txt'),'utf8'),'source 20024\n');
    await assert.rejects(readFile(path.join(copy,'.env')),{code:'ENOENT'});
    await assert.rejects(readFile(path.join(copy,'ignored.txt')),{code:'ENOENT'});
    await mkdir(path.join(copy,'openwiki'));await writeFile(path.join(copy,'openwiki','home.md'),'# Large project\n');
    await writeFile(path.join(copy,'openwiki','.last-update.json'),JSON.stringify({status:'complete'}));
  };
  service.store.set('wiki-init',null);await service.initializeWiki();await service.wikiInitPromise;
  assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));
  assert.equal(service.wikiInitialization().sourceFiles,count+2);
  assert((await stat(path.join(root,'openwiki','.nubi-sources.json'))).size>1024*1024,'large checkpoint exceeds ordinary source-file allowance');
  assert.equal((await wikiUpdateStatus(root)).state,'current');
  await writeFile(path.join(root,'src','마지막 파일.txt'),'changed\n');
  const status=await wikiUpdateStatus(root);assert.equal(status.state,'stale');assert(status.changedFiles.includes('src/마지막 파일.txt'));
  service.wikiUpdater=async({root:copy})=>{
    assert.equal(await readFile(path.join(copy,'src','마지막 파일.txt'),'utf8'),'changed\n');
    await writeFile(path.join(copy,'openwiki','home.md'),'# Updated large project\n');
    return {updated:true};
  };
  const proposed=await service.wikiUpdate({method:'propose'});
  await service.wikiUpdate({method:'run',id:proposed.id,fingerprint:proposed.fingerprint});
  const deadline=Date.now()+60000;let updated;
  do {updated=service.store.get('wiki-update:'+proposed.id);if(updated.state!=='running')break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
  assert.equal(updated.state,'ready',JSON.stringify({state:updated.state,error:updated.error}));
  await service.wikiUpdate({method:'apply',id:updated.id,fingerprint:updated.fingerprint});
  assert.equal(await readFile(path.join(root,'openwiki','home.md'),'utf8'),'# Updated large project\n');
  assert.equal((await wikiUpdateStatus(root)).state,'current');
});

test('large inventory cancellation stops the scan and lazy snapshot refuses a changed source',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-scan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'source.txt'),'original');
  const sources=await wikiSources(root);await writeFile(path.join(root,'source.txt'),'changed');
  const copy=path.join(root,'copy');await mkdir(copy);await assert.rejects(writeWikiSnapshot(copy,sources),/source_stale/);
  const controller=new AbortController();controller.abort();await assert.rejects(wikiSourceInventory(root,{signal:controller.signal}),{name:'AbortError'});
  await git(root,['init','-q']);await git(root,['add','source.txt']);
  const active=new AbortController();await assert.rejects(wikiGitRecords(root,['ls-files','-z'],()=>active.abort(),{signal:active.signal}),{name:'AbortError'});
});
