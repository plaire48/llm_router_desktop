// Shadow Git snapshots adopted from opencode (MIT License, Copyright (c) 2025 opencode), packages/core/src/snapshot.ts and
// the tree capture, diff and restore parts of packages/core/src/git.ts at commit d93568f3. A separate Git directory in
// the app data folder records the project's files as content-addressed trees; the project's own repository, index and
// history are never written. Changed tracked files and untracked files are listed against a temporary index, paths the
// project repository ignores and untracked files over 2 MiB are left out, and the index is replaced only by rename.
// Line endings and filters are disabled in the store so a restore writes back the exact bytes. See THIRD-PARTY-NOTICES.md.
import {execFile} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {copyFile,mkdir,readdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {gitCandidates} from './git-runtime.mjs';
export const SNAPSHOT_MAX_UNTRACKED_BYTES=2*1024*1024;
const CONFIG=`[core]
\tautocrlf = false
\tsafecrlf = false
\tlongpaths = true
\tsymlinks = true
\tfsmonitor = false
\tuntrackedCache = true
\tsplitIndex = false
\tquotepath = false
[gc]
\tauto = 0
[feature]
\tmanyFiles = true
[index]
\tversion = 4
`;
// info/attributes outranks every .gitattributes file: bytes go in and come back unchanged.
const ATTRIBUTES='* -text -filter -ident\n';
const TEMPORARY_INDEX='index.nubi-';
export const snapshotDirectory=(dataDirectory,worktree)=>path.join(dataDirectory,'snapshot',createHash('sha256').update(path.resolve(worktree)).digest('hex').slice(0,16));
const literal=file=>':(literal)'+file;
const nuls=text=>String(text).split('\0').filter(Boolean);
function cleanEnv(extra){
 const env={};for(const [key,value] of Object.entries(process.env))if(!/^GIT_/i.test(key))env[key]=value;
 return {...env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',...extra};
}
function git(args,{cwd,env,input,candidates=gitCandidates()}={}){
 const attempt=index=>new Promise((resolve,reject)=>{
  const child=execFile(candidates[index],args,{cwd,env:cleanEnv(env),windowsHide:true,timeout:120000,maxBuffer:64*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{
   if(error?.code==='ENOENT'&&index+1<candidates.length)return resolve(attempt(index+1));
   if(error)return reject(Object.assign(error,{stderr}));
   resolve(stdout);
  });
  child.stdin?.on('error',()=>{});child.stdin?.end(input??'');
 });
 return attempt(0);
}
export function createSnapshotStore({worktree,directory,maximumUntrackedFileBytes=SNAPSHOT_MAX_UNTRACKED_BYTES}){
 const root=path.resolve(worktree),gitDirectory=path.resolve(directory);
 let queue=Promise.resolve(),prepared=false;
 // One store, one writer: captures and restores never interleave on the same index.
 const locked=work=>{const run=queue.then(work,work);queue=run.catch(()=>{});return run;};
 const shadow=(index)=>({GIT_DIR:gitDirectory,GIT_WORK_TREE:root,...(index?{GIT_INDEX_FILE:index}:{})});
 const run=(args,{index,input}={})=>git(args,{cwd:root,env:shadow(index),input});
 async function isRepository(){
  try{return (await git(['rev-parse','--is-inside-work-tree'],{cwd:root})).trim()==='true';}catch{return false;}
 }
 async function prepare(){
  if(!existsSync(path.join(gitDirectory,'HEAD'))){
   await mkdir(gitDirectory,{recursive:true});
   await git(['init','-q'],{cwd:root,env:{GIT_DIR:gitDirectory}});
  }
  if(prepared)return;
  await mkdir(path.join(gitDirectory,'info'),{recursive:true});
  for(const [file,text] of [['nubi.gitconfig',CONFIG],[path.join('info','attributes'),ATTRIBUTES]]){
   const target=path.join(gitDirectory,file),temporary=target+'.'+randomBytes(4).toString('hex');
   await writeFile(temporary,text);await rename(temporary,target);
  }
  await git(['config','--file',path.join(gitDirectory,'config'),'--replace-all','include.path','nubi.gitconfig'],{cwd:root});
  // Temporary indexes left by a killed process are removed after an hour.
  const cutoff=Date.now()-60*60*1000;
  for(const entry of await readdir(gitDirectory).catch(()=>[]))if(entry.startsWith(TEMPORARY_INDEX)&&Number(entry.slice(TEMPORARY_INDEX.length).split('-')[0])<cutoff)await rm(path.join(gitDirectory,entry),{force:true});
  prepared=true;
 }
 async function withTemporaryIndex(use,{seed=true}={}){
  const index=path.join(gitDirectory,`${TEMPORARY_INDEX}${Date.now()}-${randomBytes(4).toString('hex')}`),current=path.join(gitDirectory,'index');
  try{
   if(seed&&existsSync(current))await copyFile(current,index);
   const value=await use(index);
   if(seed)await rename(index,current).catch(()=>{});
   return value;
  }finally{await rm(index,{force:true});}
 }
 async function ignoredByProject(paths){
  if(!paths.length)return new Set();
  // check-ignore exits 1 when nothing is ignored.
  const out=await git(['check-ignore','--no-index','--stdin','-z'],{cwd:root,input:paths.join('\0')+'\0'}).catch(error=>error.code===1?'':Promise.reject(error));
  return new Set(nuls(out));
 }
 async function capture(){
  if(!await isRepository())return undefined;
  return locked(async()=>{
   await prepare();
   return withTemporaryIndex(async index=>{
    const tracked=nuls(await run(['diff-files','--name-only','-z'],{index})).map(file=>file.replace(/\/$/,''));
    const untracked=nuls(await run(['ls-files','--others','--exclude-standard','-z'],{index})).map(file=>file.replace(/\/$/,''));
    const excluded=await ignoredByProject([...tracked,...untracked]);
    const large=new Set();
    for(const file of untracked){
     if(excluded.has(file))continue;
     const info=await stat(path.join(root,file)).catch(()=>null);
     if(info?.isFile()&&info.size>maximumUntrackedFileBytes)large.add(file);
    }
    const removed=tracked.filter(file=>excluded.has(file));
    if(removed.length)await run(['update-index','--force-remove','-z','--stdin'],{index,input:removed.join('\0')+'\0'});
    const added=[...tracked,...untracked].filter(file=>!excluded.has(file)&&!large.has(file));
    if(added.length)await run(['update-index','--add','--remove','--replace','-z','--stdin'],{index,input:added.join('\0')+'\0'});
    return (await run(['write-tree'],{index})).trim();
   });
  });
 }
 async function files({from,to}){
  return nuls(await run(['diff-tree','-r','-z','--name-only','--no-renames',from,to]));
 }
 async function diff({from,to,paths,context=3}){
  if(paths&&!paths.length)return '';
  return run(['diff','--no-color','--no-ext-diff','--no-renames',`-U${context}`,from,to,'--',...(paths||[]).map(literal)]);
 }
 function plan(entries){
  const groups=new Map();
  for(const [file,tree] of entries){
   const absolute=path.resolve(root,file);
   if(absolute===root||!absolute.startsWith(root+path.sep))throw Error('snapshot_path_escape');
   const relative=path.relative(root,absolute).split(path.sep).join('/');
   groups.set(tree,[...(groups.get(tree)||[]),relative]);
  }
  return groups;
 }
 async function restore({files:entries}){
  const groups=plan(entries);
  if(!groups.size)return;
  return locked(async()=>{
   await prepare();
   for(const [tree,list] of groups){
    const present=new Set(nuls(await run(['ls-tree','-r','-z','--name-only',tree,'--',...list.map(literal)])));
    const checkout=list.filter(file=>present.has(file)),absent=list.filter(file=>!present.has(file));
    // Checkouts first, so one failing removal cannot stop the other files from being restored.
    if(checkout.length)await withTemporaryIndex(index=>run(['checkout',tree,'--pathspec-from-file=-','--pathspec-file-nul'],{index,input:checkout.map(literal).join('\0')+'\0'}),{seed:false});
    for(const file of absent)await rm(path.join(root,file),{recursive:true,force:true});
   }
  });
 }
 return {worktree:root,gitDirectory,capture,files,diff,restore};
}
