import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {git,hash} from '../runtime/files.mjs';
import {RepositoryEvidenceResolver} from '../generated/openwiki.mjs';
import {wikiUpdateStatus} from '../runtime/wiki-update.mjs';
import {wikiInitializationError} from '../runtime/wiki-initialization-error.mjs';
import {listWikiSourceFiles,readWikiSource} from '../runtime/wiki-snapshot.mjs';
import {stat} from 'node:fs/promises';
import {WIKI_GIT_PREPARATION_TIMEOUT} from '../runtime/wiki-git-preparation.mjs';

// A Windows checkout may carry CRLF (core.autocrlf): compare source text by its lines.
const lf=text=>String(text).replace(/\r\n/g,'\n');
async function setup(t,{gitProject=false}={}){
  const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-flow-')),root=path.join(temp,'source');await mkdir(root);await writeFile(path.join(root,'app.txt'),'initial source\n');
  if(gitProject){await git(root,['init','-q']);await git(root,['add','-A']);await git(root,['-c','user.name=Fixture','-c','user.email=fixture@localhost','-c','commit.gpgSign=false','commit','-qm','Source']);}
  const service=new ProjectService({storageRoot:path.join(temp,'state')});
  // Every service opened in the test closes before the temp folder goes; a file Windows still holds (EBUSY, EPERM) is
  // left to the runner's temp cleanup rather than retried or failed on.
  const opened=[service];t.openedServices=opened;
  t.after(async()=>{for(const item of opened.reverse()){try{item.dispose();item.store?.close();}catch{}}await rm(temp,{recursive:true,force:true}).catch(error=>{if(!['EBUSY','EPERM','ENOTEMPTY'].includes(error.code))throw error;});});
  await service.open(root);service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};
  service.wikiInitializer=async({root:copy})=>{
    assert.match((await git(copy,['rev-parse','HEAD'])).trim(),/^[a-f0-9]{40}$/,'OpenWiki receives its required Git snapshot');
    await publish(copy,'# App\n\ninitial source\n');
    const commit=(await git(copy,['rev-parse','HEAD'])).trim();
    await writeFile(path.join(copy,'openwiki/.last-update.json'),JSON.stringify({status:'complete',command:'init',language:'ko',gitHead:commit}));
    await writeFile(path.join(copy,'openwiki/.page-manifest.json'),JSON.stringify({schemaVersion:1,pages:{'openwiki/home.md':{gitHead:commit}}}));
  };
  await service.initializeWiki();await service.wikiInitPromise;
  assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));return {root:service.root,service};
}
async function publish(root,text){
  await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),text);
  const resource='repo://app.txt',resolved=await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource);
  await writeFile(path.join(root,'openwiki/.claims/home.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(text),claims:[{id:'app',statement:'App source',evidence:[{resource,version:resolved.evidence.version}]}]}));
}
async function settle(service,id){for(let i=0;i<200;i++){const value=(await service.wikiUpdate({method:'status'})).updates.find(item=>item.id===id);if(value.state!=='running')return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Wiki update did not settle');}

for(const gitProject of [false,true])test(`Git preparation timeout retains partial work across reopening (${gitProject?'Git':'folder'})`,async t=>{
 const {root,service}=await setup(t,{gitProject});await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);
 await writeFile(path.join(root,'app.txt'),'new uncommitted source\n');
 const sourceStatus=gitProject?await git(root,['status','--porcelain']):null;
 let interrupted=false;
 service.wikiPreparationGit=async(cwd,args,options)=>{
   assert.equal(options.timeout,WIKI_GIT_PREPARATION_TIMEOUT);assert(options.signal);
   const result=await git(cwd,args,options);
   if(!interrupted&&args.includes(gitProject?'read-tree':'add')){interrupted=true;throw Object.assign(Error('fixture preparation timeout'),{killed:true});}
   return result;
 };
 let modelCalls=0;service.wikiInitializer=async()=>{modelCalls++;};
 await service.initializeWiki();await service.wikiInitPromise;
 const failed=service.wikiInitialization();assert.equal(failed.error,'wiki_git_timeout',JSON.stringify(failed));assert.equal(failed.gitStep,'index');assert.equal(failed.canResume,true);assert.equal(modelCalls,0);
 const record=service.store.get('wiki-init-checkpoint'),copy=path.join(service.store.directory,'wiki-preparation',record.name);assert.equal(record.ready,false);await access(copy);
 const historyFile=path.join(service.store.directory,'wiki-folder-history/app.txt'),mtime=gitProject?null:(await stat(historyFile)).mtimeMs;
 const storageRoot=service.storageRoot;service.dispose();service.store.close();
 const reopened=new ProjectService({storageRoot});t.openedServices.push(reopened);await reopened.open(root,{initializeWiki:false});
 reopened.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};
 reopened.wikiPreparationGit=async(cwd,args,options)=>{assert.equal(args.includes('worktree'),false,'an attached worktree is reused');return git(cwd,args,options);};
 reopened.wikiInitializer=async({root:current})=>{assert.equal(current,copy);assert.equal(await readFile(path.join(current,'app.txt'),'utf8'),'new uncommitted source\n');await publish(current,'# Resumed Wiki\n');};
 reopened.wikiInitialization({action:'retry'});await reopened.wikiInitPromise;
 assert.equal(reopened.wikiInitialization().state,'completed',JSON.stringify(reopened.wikiInitialization()));assert.equal(reopened.wikiInitialization().resumed,true);
 if(gitProject)assert.equal(await git(root,['status','--porcelain']),sourceStatus+'?? openwiki/\n');
 else {assert.equal((await stat(historyFile)).mtimeMs,mtime,'unchanged sources are not rewritten on retry');await assert.rejects(access(path.join(root,'.git')));}
});

test('initialization retains native metadata and Claims without initializing the user folder',async t=>{
  const {root}=await setup(t);
  await assert.rejects(access(path.join(root,'.git')));
  const record=JSON.parse(await readFile(path.join(root,'openwiki/.last-update.json'),'utf8'));
  assert.equal(record.status,'complete');assert.equal(record.gitHead,undefined,'temporary Git commit is not advertised as a source commit');
  assert((await readFile(path.join(root,'openwiki/.claims/home.json'),'utf8')).includes('repo://app.txt'));
  assert.equal((await wikiUpdateStatus(root)).state,'current');
  await writeFile(path.join(root,'app.txt'),'changed source\n');
  assert.deepEqual((await wikiUpdateStatus(root)).changedFiles,['app.txt']);
});
test('plain-folder update reads the current Wiki, proposes a result and preserves concurrent human edits',async t=>{
  const {root,service}=await setup(t);await writeFile(path.join(root,'app.txt'),'changed source\n');
  service.wikiUpdater=async({root:copy})=>{assert.match(await readFile(path.join(copy,'openwiki/home.md'),'utf8'),/initial source/);await publish(copy,'# App\n\nchanged source\n');return {};};
  const proposal=await service.wikiUpdate({method:'propose'});await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  const ready=await settle(service,proposal.id);assert.equal(ready.state,'ready',JSON.stringify(ready));
  assert.match(await readFile(path.join(root,'openwiki/home.md'),'utf8'),/initial source/);
  await service.wikiUpdate({method:'apply',id:ready.id,fingerprint:ready.fingerprint});assert.equal((await wikiUpdateStatus(root)).state,'current');
  await writeFile(path.join(root,'app.txt'),'third source\n');
  service.wikiUpdater=async({root:copy})=>{await writeFile(path.join(root,'openwiki/home.md'),'human edits while generating');await publish(copy,'# App\n\nthird source\n');return {};};
  const next=await service.wikiUpdate({method:'propose'});await service.wikiUpdate({method:'run',id:next.id,fingerprint:next.fingerprint});
  const conflict=await settle(service,next.id);await assert.rejects(service.wikiUpdate({method:'apply',id:conflict.id,fingerprint:conflict.fingerprint}),/wiki_update_conflict/);
  assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),'human edits while generating');
});
// User decision 2026-10-12: the update reads the sources as the working tree holds them, as the status that proposed it did.
test('Git updates include the current uncommitted Wiki and the working tree sources, and the result is current afterwards',async t=>{
  const {root,service}=await setup(t,{gitProject:true});await writeFile(path.join(root,'app.txt'),'committed change\n');
  await git(root,['add','app.txt']);await git(root,['-c','user.name=Fixture','-c','user.email=fixture@localhost','-c','commit.gpgSign=false','commit','-qm','Changed source']);
  await writeFile(path.join(root,'app.txt'),'uncommitted change\n');await writeFile(path.join(root,'new.txt'),'new source\n');
  service.wikiUpdater=async({root:copy})=>{assert.match(await readFile(path.join(copy,'openwiki/home.md'),'utf8'),/initial source/);assert.equal((await readFile(path.join(copy,'app.txt'),'utf8')).replace(/\r\n/g,'\n'),'uncommitted change\n');assert.equal(await readFile(path.join(copy,'new.txt'),'utf8'),'new source\n');await publish(copy,'# App\n\nuncommitted change\n');return {};};
  const proposal=await service.wikiUpdate({method:'propose'});await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  const ready=await settle(service,proposal.id);assert.equal(ready.state,'ready',JSON.stringify(ready));
  assert.deepEqual(ready.outside,[],'the working tree edits are not the runner\'s changes');
  await service.wikiUpdate({method:'apply',id:ready.id,fingerprint:ready.fingerprint});
  const status=await wikiUpdateStatus(root);assert.equal(status.state,'current',JSON.stringify(status));assert.deepEqual(status.uncommitted,['app.txt','new.txt']);
});

test('an uncommitted edit counts as a change once it differs from the sources the last run read',async t=>{
  const {root}=await setup(t,{gitProject:true});
  assert.equal((await wikiUpdateStatus(root)).state,'current');
  await writeFile(path.join(root,'app.txt'),'edited, not committed\n');
  const status=await wikiUpdateStatus(root);assert.equal(status.state,'stale');assert.deepEqual(status.changedFiles,['app.txt']);assert.deepEqual(status.uncommitted,['app.txt']);
});

test('initialization returns its scanning job before a slow listing and cancellation remains responsive',async t=>{
  const {service}=await setup(t);await rm(path.join(service.root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);
  let release,entered;const started=new Promise(resolve=>entered=resolve);
  service.wikiSourceLister=()=>{entered();return new Promise(resolve=>release=resolve);};
  let modelCalled=false;service.wikiInitializer=async()=>{modelCalled=true;};
  const first=await service.initializeWiki();assert.equal(first.state,'running');assert.equal(first.stage,'scanning');assert(first.startedAt);
  await started;assert.equal(service.wikiInitialization().stage,'scanning');
  service.wikiInitialization({action:'cancel'});assert.equal(service.wikiInitialization().state,'cancelled');
  release({paths:['app.txt'],truncated:false});await service.wikiInitPromise;
  assert.equal(modelCalled,false);assert.equal(service.wikiInitialization().state,'cancelled');
  assert.equal((await service.initializeWiki()).state,'cancelled');
});

test('a listing failure remains a staged, sanitized retryable result',async t=>{
  const {service}=await setup(t);await rm(path.join(service.root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);
  service.wikiSourceLister=async()=>{throw Object.assign(Error('private path and private server reply'),{code:'EACCES'});};
  await service.initializeWiki();await service.wikiInitPromise;
  const failure=service.wikiInitialization();assert.equal(failure.state,'attention');assert.equal(failure.stage,'scanning');assert.equal(failure.error,'wiki_permission_denied');assert(!JSON.stringify(failure).includes('private'));
  service.wikiSourceLister=async()=>({paths:[],truncated:false});
  const retry=service.wikiInitialization({action:'retry'});assert.equal(retry.state,'running');assert.notEqual(retry.id,failure.id);await service.wikiInitPromise;assert.equal(service.wikiInitialization().error,'wiki_no_sources');
});

test('Wiki failure diagnostics preserve actionable codes without raw errors',()=>{
  assert.equal(wikiInitializationError({code:'ENOENT'},'snapshot_git'),'wiki_git_required');
  assert.equal(wikiInitializationError({code:128,stderr:'private'},'snapshot_git'),'wiki_snapshot_failed');
  assert.equal(wikiInitializationError({code:'ENOSPC'},'publishing'),'wiki_disk_full');
  assert.equal(wikiInitializationError({code:'EEXIST'},'publishing'),'wiki_output_conflict');
  assert.equal(wikiInitializationError(Error('response_invalid'),'planning'),'response_invalid');
  assert.equal(wikiInitializationError(Error('Repository planning worker exited without submit_plan.'),'planning'),'wiki_plan_missing');
  assert.equal(wikiInitializationError(Object.assign(Error('private graph state'),{name:'GraphRecursionError'}),'planning'),'wiki_analysis_limit');
  assert.equal(wikiInitializationError(Object.assign(Error('private plan'),{code:'invalid_input'}),'planning'),'wiki_plan_invalid');
  assert.equal(wikiInitializationError(Error('request_failed'),'planning'),'model_failed');
  assert.equal(wikiInitializationError(Error('unknown_private_reply'),'planning'),'wiki_failed');
});

test('deleted tracked files, sparse entries and uninitialized submodules do not abort source reading',async t=>{
  const {root,service}=await setup(t,{gitProject:true});await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);
  await writeFile(path.join(root,'deleted.txt'),'removed');await writeFile(path.join(root,'sparse.txt'),'sparse');
  await git(root,['add','deleted.txt','sparse.txt']);await git(root,['-c','user.name=Fixture','-c','user.email=fixture@localhost','-c','commit.gpgSign=false','commit','-qm','Tracked sources']);
  const head=(await git(root,['rev-parse','HEAD'])).trim();
  await rm(path.join(root,'deleted.txt'));await git(root,['update-index','--skip-worktree','sparse.txt']);await rm(path.join(root,'sparse.txt'));
  await git(root,['update-index','--add','--cacheinfo',`160000,${head},vendor/library`]);
  const listed=await listWikiSourceFiles(root);assert.deepEqual(listed.paths,['app.txt']);assert.equal(listed.unavailableFiles,3);
  await service.initializeWiki();await service.wikiInitPromise;
  assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));assert.equal(service.wikiInitialization().excludedFiles,3);
  await assert.rejects(access(path.join(root,'vendor/library')));await assert.rejects(readWikiSource(root,'missing.txt'),/source_stale/);
});

// User decision 2026-10-12: a source that moves while the model works no longer discards its work.
test('a source added or removed while generating is published for its snapshot and reported for an update',async t=>{
  const {root,service}=await setup(t,{gitProject:true});await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);
  service.wikiInitializer=async({root:copy})=>{await publish(copy,'# Outdated');await writeFile(path.join(root,'new.txt'),'new source');};
  await service.initializeWiki();await service.wikiInitPromise;
  let job=service.wikiInitialization();assert.equal(job.state,'completed',JSON.stringify(job));assert.equal(job.changedDuringRun,1);await access(path.join(root,'openwiki/home.md'));
  assert.deepEqual((await wikiUpdateStatus(root)).uncommitted,['new.txt'],'the untracked file is named apart until it is committed');
  await rm(path.join(root,'openwiki'),{recursive:true});await rm(path.join(root,'new.txt'));service.store.set('wiki-init',null);
  service.wikiInitializer=async({root:copy})=>{await publish(copy,'# Outdated');await rm(path.join(root,'app.txt'));};
  await service.initializeWiki();await service.wikiInitPromise;
  job=service.wikiInitialization();assert.equal(job.state,'completed',JSON.stringify(job));assert.equal(job.changedDuringRun,1);
  const status=await wikiUpdateStatus(root);assert.equal(status.state,'stale');assert.deepEqual(status.stalePages,[{path:'openwiki/home.md',freshness:'unavailable'}]);
});


test('remote clone nested in another repository retains history and its own root during Wiki initialization',async t=>{
  const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-remote-wiki-'))),remote=path.join(temp,'remote'),parent=path.join(temp,'parent'),clone=path.join(parent,'cloned');
  await mkdir(remote);await mkdir(parent);
  for(const root of [remote,parent]){await git(root,['init','-q']);await git(root,['config','user.name','Fixture']);await git(root,['config','user.email','fixture@localhost']);}
  for(let index=1;index<=3;index++){await writeFile(path.join(remote,'app.txt'),`source ${index}\n`);await git(remote,['add','app.txt']);await git(remote,['-c','commit.gpgSign=false','commit','-qm',`History ${index}`]);}
  await git(remote,['branch','design-history','HEAD~1']);await git(remote,['tag','v1','HEAD~2']);
  await writeFile(path.join(parent,'parent.txt'),'Parent project');await git(parent,['add','.']);await git(parent,['-c','commit.gpgSign=false','commit','-qm','Parent']);
  await git(parent,['clone','--',remote,clone]);
  const service=new ProjectService({storageRoot:path.join(temp,'state')});t.after(async()=>{service.dispose();service.store?.close();await rm(temp,{recursive:true,force:true});});
  const opened=await service.invoke('open',{root:clone,exactRoot:true,initializeWiki:false});assert.equal(opened.root,clone);assert(!opened.files.includes('parent.txt'));assert.equal(service.wikiInitEnabled,false);
  const child=path.join(parent,'not-a-clone');await mkdir(child);await assert.rejects(service.invoke('open',{root:child,exactRoot:true}),/clone_root_mismatch/);assert.equal(service.root,clone);
  const head=(await git(clone,['rev-parse','HEAD'])).trim(),index=await readFile(path.join(clone,'.git/index'));
  service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};let analysisRoot;
  service.wikiInitializer=async({root})=>{analysisRoot=root;assert.equal((await git(root,['rev-list','--count','HEAD'])).trim(),'3');assert.equal((await git(root,['rev-parse','HEAD'])).trim(),head);assert.match(await git(root,['log','--format=%s']),/History 1/);assert.match(await git(root,['branch','-r']),/origin\/design-history/);assert.match(await git(root,['tag']),/v1/);assert.equal((await readFile(path.join(root,'app.txt'),'utf8')).replace(/\r\n/g,'\n'),'source 3\n');await publish(root,'# Real history');await writeFile(path.join(root,'openwiki/.last-update.json'),JSON.stringify({status:'complete',gitHead:head}));};
  await service.invoke('open',{root:clone,exactRoot:true,initializeWiki:true});await service.wikiInitPromise;assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));
  assert.equal((await git(clone,['rev-parse','HEAD'])).trim(),head);assert.deepEqual(await readFile(path.join(clone,'.git/index')),index);
  assert.equal(JSON.parse(await readFile(path.join(clone,'openwiki/.last-update.json'),'utf8')).gitHead,head);
  assert(!await git(clone,['worktree','list','--porcelain']).then(text=>text.includes(analysisRoot)));await assert.rejects(access(analysisRoot));
});

test('a commit made during initialization is published for the snapshot commit and its worktree is removed',async t=>{
  const {root,service}=await setup(t,{gitProject:true});await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);let copy;
  service.wikiInitializer=async({root:analysis})=>{copy=analysis;await git(root,['-c','user.name=Fixture','-c','user.email=fixture@localhost','-c','commit.gpgSign=false','commit','--allow-empty','-qm','Concurrent commit']);await publish(analysis,'# Outdated');};
  await service.initializeWiki();await service.wikiInitPromise;
  const job=service.wikiInitialization();assert.equal(job.state,'completed',JSON.stringify(job));assert.equal(job.changedDuringRun,0);await access(path.join(root,'openwiki/home.md'));await assert.rejects(access(copy));
  assert.equal((await wikiUpdateStatus(root)).state,'current','an empty commit changed no source');
});

test('refresh uses folder history, applies only Wiki and skips an unchanged second run',async t=>{
 const {root,service}=await setup(t);const history=path.join(service.store.directory,'wiki-folder-history');const first=(await git(history,['rev-parse','HEAD'])).trim();
 await writeFile(path.join(root,'app.txt'),'new source\n');let calls=0;
 service.wikiUpdater=async({root:copy})=>{calls++;assert.equal(await readFile(path.join(copy,'app.txt'),'utf8'),'new source\n');assert.equal((await git(copy,['rev-list','--count','HEAD'])).trim(),'2');await publish(copy,'# App\n\nnew source\n');return {};};
 const result=await service.wikiUpdate({method:'refresh'});assert(result.update);const ready=await settle(service,result.update.id);assert.equal(ready.state,'ready');await service.wikiUpdate({method:'apply',id:ready.id,fingerprint:ready.fingerprint});
 assert.notEqual((await git(history,['rev-parse','HEAD'])).trim(),first);await assert.rejects(access(path.join(root,'.git')));
 assert.equal((await service.wikiUpdate({method:'refresh'})).update,null);assert.equal(calls,1);
});
test('refresh aborts on a failed upstream and never starts a model with stale sources',async t=>{
 const {root,service}=await setup(t,{gitProject:true});await git(root,['remote','add','origin',path.join(root,'missing')]);let calls=0;service.wikiUpdater=async()=>{calls++;};
 await assert.rejects(service.wikiUpdate({method:'refresh'}),/git_upstream_missing/);assert.equal(calls,0);assert.equal(service.wikiRefreshOwner,null);
});
test('refresh initializes absent Wiki instead of claiming it is already current',async t=>{
 const {root,service}=await setup(t);await rm(path.join(root,'openwiki'),{recursive:true});
 const result=await service.wikiUpdate({method:'refresh'});assert.equal(result.initialization.state,'running');await service.wikiInitPromise;assert.equal(service.wikiInitialization().state,'completed');
});
test('remote refresh updates code first and the model reads that remote revision',async t=>{
 const {root,service}=await setup(t,{gitProject:true});const remote=path.join(path.dirname(root),'remote');await git(path.dirname(root),['clone','-q',root,remote]);const branch=(await git(root,['branch','--show-current'])).trim();await git(root,['remote','add','origin',remote]);await git(root,['config',`branch.${branch}.remote`,'origin']);await git(root,['config',`branch.${branch}.merge`,'refs/heads/'+branch]);
 await writeFile(path.join(remote,'app.txt'),'remote source\n');await git(remote,['add','app.txt']);await git(remote,['-c','user.name=Fixture','-c','user.email=fixture@localhost','-c','commit.gpgSign=false','commit','-qm','Remote update']);const remoteHead=(await git(remote,['rev-parse','HEAD'])).trim();
 service.wikiUpdater=async({root:copy})=>{assert.equal((await git(copy,['rev-parse','HEAD'])).trim(),remoteHead);assert.equal(lf(await readFile(path.join(copy,'app.txt'),'utf8')),'remote source\n');await publish(copy,'# App\nremote source\n');return {};};
 const result=await service.wikiUpdate({method:'refresh'});assert.equal(result.pulled.ok,true);assert.equal(lf(await readFile(path.join(root,'app.txt'),'utf8')),'remote source\n');const ready=await settle(service,result.update.id);assert.equal(ready.state,'ready');await service.wikiUpdate({method:'apply',id:ready.id,fingerprint:ready.fingerprint});assert.equal((await wikiUpdateStatus(root)).state,'current');
});
test('folder-open with existing Git follows local history even when a remote exists',async t=>{
 const {root,service}=await setup(t,{gitProject:true});const head=(await git(root,['rev-parse','HEAD'])).trim();await git(root,['remote','add','origin','/not-contacted']);await service.open(root,{initializeWiki:false,sourceKind:'local'});await service.open(root,{initializeWiki:false});assert.equal(service.store.get('setting:wiki-source').mode,'local');
 await writeFile(path.join(root,'app.txt'),'local edit\n');service.wikiUpdater=async({root:copy})=>{assert.equal((await git(copy,['rev-parse','HEAD'])).trim(),head);assert.equal(await readFile(path.join(copy,'app.txt'),'utf8'),'local edit\n');await publish(copy,'# Local');return {};};
 const result=await service.wikiUpdate({method:'refresh'});assert.equal(result.pulled.reason,'local_project');assert.equal((await settle(service,result.update.id)).state,'ready');assert.equal((await git(root,['rev-parse','HEAD'])).trim(),head);assert.match(await git(root,['status','--short']),/app.txt/);
});

for(const gitProject of [false,true])test(`interrupted Wiki keeps its snapshot and resumes after reopening (${gitProject?'Git':'folder'})`,async t=>{
 const {root,service}=await setup(t,{gitProject});await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);
 let firstCopy;
 service.wikiInitializer=async({root:copy})=>{firstCopy=copy;await publish(copy,'# Completed first page\n');await writeFile(path.join(copy,'openwiki/.run.json'),'checkpoint fixture');throw Error('model_timeout');};
 await service.initializeWiki();await service.wikiInitPromise;
 assert.equal(service.wikiInitialization().error,'timeout');assert.equal(service.wikiInitialization().canResume,true);await access(firstCopy);
 await assert.rejects(access(path.join(root,'openwiki/home.md')),'a partial Wiki is never published');
 const storageRoot=service.storageRoot;service.dispose();service.store.close();
 const reopened=new ProjectService({storageRoot});t.openedServices.push(reopened);
 await reopened.open(root,{initializeWiki:false});reopened.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};
 reopened.wikiInitializer=async({root:copy})=>{assert.equal(copy,firstCopy);assert.match(await readFile(path.join(copy,'openwiki/home.md'),'utf8'),/Completed first page/);assert.equal(await readFile(path.join(copy,'openwiki/.run.json'),'utf8'),'checkpoint fixture');await rm(path.join(copy,'openwiki/.run.json'));};
 reopened.wikiInitialization({action:'retry'});await reopened.wikiInitPromise;
 assert.equal(reopened.wikiInitialization().state,'completed',JSON.stringify(reopened.wikiInitialization()));assert.equal(reopened.wikiInitialization().resumed,true);
 assert.match(await readFile(path.join(root,'openwiki/home.md'),'utf8'),/Completed first page/);await assert.rejects(access(firstCopy));
});

test('changed sources discard the saved Wiki snapshot before retry',async t=>{
 const {root,service}=await setup(t);await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);let firstCopy;
 service.wikiInitializer=async({root:copy})=>{firstCopy=copy;await publish(copy,'# Stale draft\n');throw Error('network_error');};
 await service.initializeWiki();await service.wikiInitPromise;
 await writeFile(path.join(root,'app.txt'),'new source\n');
 service.wikiInitializer=async({root:copy})=>{assert.notEqual(copy,firstCopy);await assert.rejects(access(firstCopy));await assert.rejects(access(path.join(copy,'openwiki/home.md')));assert.equal(await readFile(path.join(copy,'app.txt'),'utf8'),'new source\n');await publish(copy,'# Fresh Wiki\n');};
 service.wikiInitialization({action:'retry'});await service.wikiInitPromise;
 assert.equal(service.wikiInitialization().state,'completed');assert.equal(service.wikiInitialization().resumed,false);
});

test('publication retry uses the generated Wiki without calling the model again',async t=>{
 const {root,service}=await setup(t);await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);let calls=0;
 service.wikiInitializer=async({root:copy})=>{calls++;await publish(copy,'# Generated Wiki\n');await mkdir(path.join(root,'openwiki'));await mkdir(path.join(root,'openwiki/home.md'));};
 await service.initializeWiki();await service.wikiInitPromise;assert.equal(service.wikiInitialization().state,'attention');
 await rm(path.join(root,'openwiki'),{recursive:true});
 service.wikiInitialization({action:'retry'});await service.wikiInitPromise;
 assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));assert.equal(calls,1);
});

test('retry after Git verification timeout reuses copied history and sources',async t=>{
 const {root,service}=await setup(t);await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);
 service.wikiPreparationGit=async(cwd,args,options)=>{
   if(cwd.includes('wiki-preparation')&&args.includes('rev-parse'))throw Object.assign(Error('slow verification'),{killed:true});
   return git(cwd,args,options);
 };
 await service.initializeWiki();await service.wikiInitPromise;
 assert.equal(service.wikiInitialization().error,'wiki_git_timeout');assert.equal(service.wikiInitialization().gitStep,'verify');
 const copy=path.join(service.store.directory,'wiki-preparation',service.store.get('wiki-init-checkpoint').name);
 const receipt=path.join(copy,'.git/nubi-snapshot-head'),source=path.join(copy,'app.txt');
 const receiptTime=(await stat(receipt)).mtimeMs,sourceTime=(await stat(source)).mtimeMs;
 service.wikiPreparationGit=git;
 service.wikiInitializer=async({root:current})=>{assert.equal(current,copy);assert.equal((await stat(receipt)).mtimeMs,receiptTime);assert.equal((await stat(source)).mtimeMs,sourceTime);await publish(copy,'# Wiki\n');};
 service.wikiInitialization({action:'retry'});await service.wikiInitPromise;
 assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));
});
