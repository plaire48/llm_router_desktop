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
  assert.equal(result.attempted,true);assert.equal(result.ok,false);assert.ok(['git_pull_failed','git_auth','git_timeout','git_diverged'].includes(result.reason),result.reason);
});
