import {mkdir,readdir,rm,cp,lstat,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fail,privatePath,relativeFile} from './files.mjs';
import {writeWikiSnapshot} from './wiki-snapshot.mjs';
import {wikiPreparationGit} from './wiki-git-preparation.mjs';

// Owned source-only history. The selected folder never acquires .git, and an
// existing developer repository never receives automatic commits.
export async function snapshotFolderHistory(storage,sources,copy,options={}){
  for(const file of sources)if(privatePath(file.path)||file.path.startsWith('openwiki/'))fail('path_scope');else relativeFile(file.path);
  const root=path.join(storage,'wiki-folder-history');
  await mkdir(root,{recursive:true});
  if((await lstat(root)).isSymbolicLink())fail('path_scope');
  const config=['-c','core.hooksPath='+path.join(root,'.nubi-no-hooks'),'-c','commit.gpgSign=false','-c','user.name=Nubi Wiki','-c','user.email=wiki@localhost'];
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  const gitOptions={...options,env:{...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}};
  const run=(args,step)=>wikiPreparationGit(root,[...config,...args],gitOptions,step);
  try{if((await lstat(path.join(root,'.git'))).isSymbolicLink())fail('path_scope');}catch(error){if(error.code!=='ENOENT')throw error;}
  await run(['init','-q'],'repository');
  await run(['config','core.hooksPath',path.join(root,'.nubi-no-hooks')],'repository');
  await run(['config','core.autocrlf','false'],'repository');
  // Keep unchanged files and their mtimes so Git can reuse the index's stat cache.
  const paths=new Set(sources.map(file=>file.path)),parents=new Set();
  for(const rel of paths){const parts=rel.split('/');while(parts.length>1){parts.pop();parents.add(parts.join('/'));}}
  async function prune(dir,base=''){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      options.signal?.throwIfAborted();if(!base&&entry.name==='.git')continue;
      const rel=base+entry.name,target=path.join(dir,entry.name);
      if(entry.isDirectory()&&parents.has(rel))await prune(target,rel+'/');
      else if(!entry.isFile()||!paths.has(rel))await rm(target,{recursive:true,force:true});
    }
  }
  options.onGitStep?.('sources');await prune(root);
  await writeWikiSnapshot(root,sources,{...options,incremental:true});
  await run(['add','--all','--force'],'index');
  let head;
  try{head=(await run(['rev-parse','--verify','--quiet','HEAD'],'commit')).trim();}
  catch(error){if(error.code!==1||error.killed)throw error;head='';}
  if(!head||(await run(['diff','--cached','--name-only'])).trim()){
    await run(['commit','--allow-empty','-qm','Snapshot sources for OpenWiki'],'commit');
    head=(await run(['rev-parse','HEAD'],'commit')).trim();
  }
  if(copy){
    await mkdir(copy,{recursive:true});
    if((await lstat(copy)).isSymbolicLink())fail('path_scope');
    const copyGit=path.join(copy,'.git'),receipt=path.join(copyGit,'nubi-snapshot-head');let copied=false;
    try{if((await lstat(copyGit)).isSymbolicLink())fail('path_scope');copied=(await readFile(receipt,'utf8'))===head;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    options.onGitStep?.('history');
    if(!copied){
      await rm(copyGit,{recursive:true,force:true});
      await cp(path.join(root,'.git'),copyGit,{recursive:true,errorOnExist:true,force:false,filter:()=>{options.signal?.throwIfAborted();return true;}});
      await writeFile(receipt,head);
    }
    options.onGitStep?.('sources');
    await writeWikiSnapshot(copy,sources,{...options,incremental:true});
  }
  return {head,root};
}
