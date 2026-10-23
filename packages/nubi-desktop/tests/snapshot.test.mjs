import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';import {existsSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {removeLater} from './helpers-cleanup.mjs';
import {createSnapshotStore,snapshotDirectory} from '../runtime/snapshot.mjs';
const exec=promisify(execFile);
const git=(cwd,...args)=>exec('git',['-C',cwd,...args],{env:{...process.env,GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@example.com',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@example.com'}});

async function project(){
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-snapshot-'));removeLater(root);
 const worktree=path.join(root,'project'),data=path.join(root,'data');await mkdir(path.join(worktree,'src'),{recursive:true});
 await git(worktree,'init','-q');
 await writeFile(path.join(worktree,'.gitignore'),'secret.env\nbuild/\n');
 await writeFile(path.join(worktree,'src','a.js'),'export const a=1;\r\n');
 await writeFile(path.join(worktree,'src','b.js'),'export const b=2;\n');
 await git(worktree,'add','-A');await git(worktree,'commit','-qm','init');
 await writeFile(path.join(worktree,'notes.md'),'untracked but not ignored\n');
 await writeFile(path.join(worktree,'secret.env'),'TOKEN=x\n');
 return {worktree,store:createSnapshotStore({worktree,directory:snapshotDirectory(data,worktree)})};
}

test('capture never touches the project repository',async()=>{
 const {worktree,store}=await project();
 const before=(await git(worktree,'status','--porcelain')).stdout,index=(await stat(path.join(worktree,'.git','index'))).mtimeMs;
 const tree=await store.capture();
 assert.match(tree,/^[0-9a-f]{40,64}$/);
 // The index is compared before git status runs again: status itself may refresh the project index.
 assert.equal((await stat(path.join(worktree,'.git','index'))).mtimeMs,index);
 assert.equal((await git(worktree,'status','--porcelain')).stdout,before);
 assert.equal((await git(worktree,'rev-list','--count','HEAD')).stdout.trim(),'1');
});

test('files and diff list what changed between two captures, ignoring what the project ignores',async()=>{
 const {worktree,store}=await project();
 const start=await store.capture();
 await writeFile(path.join(worktree,'src','a.js'),'export const a=10;\r\n');
 await rm(path.join(worktree,'src','b.js'));
 await writeFile(path.join(worktree,'src','c.js'),'export const c=3;\n');
 await writeFile(path.join(worktree,'secret.env'),'TOKEN=y\n');
 await mkdir(path.join(worktree,'build'));await writeFile(path.join(worktree,'build','out.js'),'x');
 const end=await store.capture();
 assert.deepEqual(await store.files({from:start,to:end}),['src/a.js','src/b.js','src/c.js']);
 const patch=await store.diff({from:start,to:end,paths:['src/a.js']});
 assert.match(patch,/-export const a=1;/);assert.match(patch,/\+export const a=10;/);assert.doesNotMatch(patch,/c\.js/);
});

test('restore puts files back from their trees, removes files the tree did not have and keeps line endings',async()=>{
 const {worktree,store}=await project();
 const start=await store.capture();
 await writeFile(path.join(worktree,'src','a.js'),'broken');
 await rm(path.join(worktree,'src','b.js'));
 await writeFile(path.join(worktree,'src','c.js'),'new');
 await writeFile(path.join(worktree,'notes.md'),'kept as is');
 const end=await store.capture();
 const changed=await store.files({from:start,to:end});
 await store.restore({files:new Map(changed.filter(file=>file!=='notes.md').map(file=>[file,start]))});
 assert.equal(await readFile(path.join(worktree,'src','a.js'),'utf8'),'export const a=1;\r\n');
 assert.equal(await readFile(path.join(worktree,'src','b.js'),'utf8'),'export const b=2;\n');
 assert.equal(existsSync(path.join(worktree,'src','c.js')),false);
 assert.equal(await readFile(path.join(worktree,'notes.md'),'utf8'),'kept as is');
 assert.equal((await git(worktree,'status','--porcelain')).stdout,'?? notes.md\n');
});

test('untracked files over 2 MiB are left out of a capture',async()=>{
 const {worktree,store}=await project();
 const start=await store.capture();
 await writeFile(path.join(worktree,'big.bin'),Buffer.alloc(2*1024*1024+1));
 await writeFile(path.join(worktree,'small.txt'),'s');
 assert.deepEqual(await store.files({from:start,to:await store.capture()}),['small.txt']);
});

test('restore refuses a path outside the project',async()=>{
 const {store}=await project();
 const start=await store.capture();
 await assert.rejects(store.restore({files:new Map([['../escape.txt',start]])}),/snapshot_path_escape/);
});

test('a folder that is not a Git repository is not captured',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-snapshot-plain-'));removeLater(root);
 const worktree=path.join(root,'plain');await mkdir(worktree);await writeFile(path.join(worktree,'a.txt'),'a');
 const store=createSnapshotStore({worktree,directory:snapshotDirectory(path.join(root,'data'),worktree)});
 assert.equal(await store.capture(),undefined);
});

test('each project gets its own store under the data folder',()=>{
 const a=snapshotDirectory('/data','/work/a'),b=snapshotDirectory('/data','/work/b');
 assert.notEqual(a,b);assert.ok(a.startsWith(path.join('/data','snapshot')+path.sep));
});
