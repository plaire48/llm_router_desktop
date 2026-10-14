import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git} from '../runtime/files.mjs';
import {pullSources} from '../runtime/wiki-refresh.mjs';

test('a folder that is not a git repository and one without a remote skip the pull and still report why',async t=>{
  const plain=await mkdtemp(path.join(os.tmpdir(),'nubi-refresh-plain-'));t.after(()=>rm(plain,{recursive:true,force:true}));
  assert.deepEqual(await pullSources(plain),{attempted:false,reason:'not_git_repository'});
  const repo=await mkdtemp(path.join(os.tmpdir(),'nubi-refresh-repo-'));t.after(()=>rm(repo,{recursive:true,force:true}));
  await git(repo,['init','-q']);
  assert.deepEqual(await pullSources(repo),{attempted:false,reason:'no_remote'});
});
test('a remote that cannot be reached is a reported failure, never a prompt or a throw',async t=>{
  const repo=await mkdtemp(path.join(os.tmpdir(),'nubi-refresh-remote-'));t.after(()=>rm(repo,{recursive:true,force:true}));
  await git(repo,['init','-q']);await git(repo,['remote','add','origin',path.join(repo,'missing-remote')]);
  const result=await pullSources(repo);
  assert.equal(result.attempted,true);assert.equal(result.ok,false);assert.ok(['git_pull_failed','git_auth','git_timeout','git_diverged','git_upstream_missing'].includes(result.reason),result.reason);
});

import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {snapshotFolderHistory} from '../runtime/wiki-folder-history.mjs';
import {wikiSources} from '../runtime/wiki-snapshot.mjs';
const commit=async(root,message)=>{await git(root,['add','-A']);await git(root,['-c','user.name=Fixture','-c','user.email=test@localhost','-c','commit.gpgSign=false','commit','-qm',message]);};
async function remoteFixture(t){
 const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-refresh-live-'));t.after(()=>rm(temp,{recursive:true,force:true}));
 const origin=path.join(temp,'origin'),local=path.join(temp,'local');await mkdir(origin);await git(origin,['init','-q']);await writeFile(path.join(origin,'app.txt'),'v1');await commit(origin,'Initial');await git(temp,['clone','-q',origin,local]);return {temp,origin,local};
}
test('refresh fast-forwards to the configured upstream and preserves local wiki pages',async t=>{
 const {origin,local}=await remoteFixture(t);await mkdir(path.join(local,'openwiki'));await writeFile(path.join(local,'openwiki/home.md'),'human wiki');
 await writeFile(path.join(origin,'app.txt'),'v2');await commit(origin,'Second');
 const result=await pullSources(local);assert.equal(result.ok,true);assert.equal(result.changed,true);assert.equal(await readFile(path.join(local,'app.txt'),'utf8'),'v2');assert.equal(await readFile(path.join(local,'openwiki/home.md'),'utf8'),'human wiki');assert.equal((await git(local,['rev-parse','HEAD'])).trim(),result.head);
 assert.equal((await pullSources(local)).changed,false);
});
test('dirty, local-ahead and divergent repositories never lose local work',async t=>{
 const {origin,local}=await remoteFixture(t);await writeFile(path.join(local,'app.txt'),'local');
 assert.equal((await pullSources(local)).reason,'git_local_changes');assert.equal(await readFile(path.join(local,'app.txt'),'utf8'),'local');
 await commit(local,'Local');const head=(await git(local,['rev-parse','HEAD'])).trim();assert.equal((await pullSources(local)).reason,'git_local_ahead');
 await writeFile(path.join(origin,'app.txt'),'remote');await commit(origin,'Remote');assert.equal((await pullSources(local)).reason,'git_diverged');assert.equal((await git(local,['rev-parse','HEAD'])).trim(),head);
});
test('missing upstream is actionable and never silently reads the old local copy',async t=>{
 const {local}=await remoteFixture(t);await git(local,['branch','--unset-upstream']);assert.equal((await pullSources(local)).reason,'git_upstream_missing');
});
test('plain folders keep private incremental commits including deletions without touching the source',async t=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-folder-history-'));t.after(()=>rm(temp,{recursive:true,force:true}));
 const root=path.join(temp,'source'),storage=path.join(temp,'state');await mkdir(root);await writeFile(path.join(root,'a.txt'),'one');await writeFile(path.join(root,'.env'),'PRIVATE');
 const first=await snapshotFolderHistory(storage,await wikiSources(root));assert.equal((await git(first.root,['rev-list','--count','HEAD'])).trim(),'1');assert.doesNotMatch(await git(first.root,['ls-files']),/\.env/);
 assert.equal((await snapshotFolderHistory(storage,await wikiSources(root))).head,first.head);
 await rm(path.join(root,'a.txt'));await writeFile(path.join(root,'b.txt'),'two');const copy=path.join(temp,'copy');const second=await snapshotFolderHistory(storage,await wikiSources(root),copy);
 assert.notEqual(second.head,first.head);assert.equal((await git(copy,['rev-list','--count','HEAD'])).trim(),'2');assert.equal((await git(copy,['show','HEAD~1:a.txt'])).trim(),'one');assert.equal(await readFile(path.join(copy,'b.txt'),'utf8'),'two');await assert.rejects(access(path.join(copy,'a.txt')));await assert.rejects(access(path.join(root,'.git')));
});
