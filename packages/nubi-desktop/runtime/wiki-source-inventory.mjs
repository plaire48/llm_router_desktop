import {spawn} from 'node:child_process';
import {opendir} from 'node:fs/promises';
import path from 'node:path';
import {gitCandidates,gitFailure} from './git-runtime.mjs';
import {privatePath} from './files.mjs';
import {OpenWikiIgnore} from '../generated/openwiki.mjs';
import {WIKI_GIT_PREPARATION_TIMEOUT} from './wiki-git-preparation.mjs';

const excluded = rel => privatePath(rel) || /(^|\/)(?:dist|build|coverage|verification|\.next)(\/|$)/.test(rel);

// Stream NUL records rather than buffering Git's complete stdout. A large
// repository must not inherit the interactive search's 20,000-file cap.
export async function wikiGitRecords(root,args,onRecord,{signal,timeout=WIKI_GIT_PREPARATION_TIMEOUT}={}) {
  for (const executable of gitCandidates()) {
    signal?.throwIfAborted();
    const child=spawn(executable,['-C',root,...args],{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});
    let stderr='',timedOut=false;
    const result=new Promise(resolve=>{
      child.once('error',error=>resolve({error}));
      child.once('close',(code)=>resolve({code}));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192);});
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);timer.unref();
    let pending='';
    try {
      child.stdout.setEncoding('utf8');
      for await (const chunk of child.stdout) {
        signal?.throwIfAborted();
        pending+=chunk;let boundary;
        while((boundary=pending.indexOf('\0'))!==-1){const record=pending.slice(0,boundary);pending=pending.slice(boundary+1);if(record)onRecord(record);}
        if(pending.length>16384)throw Error('path_scope');
      }
      const status=await result;
      signal?.throwIfAborted();
      if(timedOut)throw Object.assign(Error('git_timeout'),{code:'ETIMEDOUT',killed:true});
      if(status.error){if(status.error.code==='ENOENT')continue;throw status.error;}
      if(status.code!==0)throw Object.assign(Error('git_history_failed'),{stderr});
      if(pending)throw Error('git_history_failed');
      return;
    } catch(error) { child.kill();await result;throw error; }
    finally { clearTimeout(timer); }
  }
  throw Object.assign(Error('git_unavailable'),{code:'ENOENT'});
}

export async function wikiSourceInventory(root,{signal,onProgress,maxFiles=200000}={}) {
  if(!Number.isSafeInteger(maxFiles)||maxFiles<1||maxFiles>200000)throw Error('wiki_source_limit');
  const ignore=await OpenWikiIgnore.load(root),ignored=new Set(),paths=new Set();let visited=0,unavailableFiles=0,truncated=false;
  const omit=rel=>{if(ignore.ignores(rel)){ignored.add(rel);return true;}return excluded(rel)||rel.startsWith('openwiki/');};
  const remember=rel=>{
    signal?.throwIfAborted();
    if(!omit(rel)&&!paths.has(rel)){if(paths.size>=maxFiles)truncated=true;else paths.add(rel);}
    if(++visited%256===0)onProgress?.(visited);
  };
  try {
    await wikiGitRecords(root,['ls-files','-z','--cached','--others','--exclude-standard'],remember,{signal});
    await wikiGitRecords(root,['ls-files','--deleted','-z'],rel=>{if(paths.delete(rel))unavailableFiles++;},{signal});
    await wikiGitRecords(root,['ls-files','--stage','-v','-z'],row=>{
      const match=/^([A-Za-z]) (\d{6}) [a-f0-9]+ \d\t([\s\S]+)$/.exec(row);
      if(match&&(match[2]==='160000'||match[1].toUpperCase()==='S')&&paths.delete(match[3]))unavailableFiles++;
    },{signal});
  } catch(error) {
    signal?.throwIfAborted();
    if(!['not_git_repository','git_unavailable'].includes(gitFailure(error)))throw error;
    paths.clear();ignored.clear();visited=0;unavailableFiles=0;truncated=false;
    async function walk(directory,base='') {
      signal?.throwIfAborted();
      for await(const entry of await opendir(directory)) {
        signal?.throwIfAborted();
        const rel=base+entry.name;
        if(excluded(rel))continue;
        // Traverse ignored directories to retain exact excluded-file counts and negations.
        if(entry.isDirectory())await walk(path.join(directory,entry.name),rel+'/');
        else if(entry.isFile())remember(rel);
      }
    }
    await walk(root);
  }
  onProgress?.(visited);
  return {paths:[...paths].sort(),truncated,unavailableFiles,excluded:{ignored:ignored.size,binary:0,large:0}};
}
