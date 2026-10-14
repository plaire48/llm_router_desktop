import {mkdir,readdir,rm,cp,lstat} from 'node:fs/promises';
import path from 'node:path';
import {git,fail,privatePath,relativeFile} from './files.mjs';
import {writeWikiSnapshot} from './wiki-snapshot.mjs';

// Owned source-only history. The selected folder never acquires .git, and an
// existing developer repository never receives automatic commits.
export async function snapshotFolderHistory(storage,sources,copy){
  for(const file of sources)if(privatePath(file.path)||file.path.startsWith('openwiki/'))fail('path_scope');else relativeFile(file.path);
  const root=path.join(storage,'wiki-folder-history');
  await mkdir(root,{recursive:true});
  if((await lstat(root)).isSymbolicLink())fail('path_scope');
  const config=['-c','core.hooksPath='+path.join(root,'.nubi-no-hooks'),'-c','commit.gpgSign=false','-c','user.name=Nubi Wiki','-c','user.email=wiki@localhost'];
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  const options={env:{...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}};
  const run=args=>git(root,[...config,...args],options);
  await run(['init','-q']);
  await run(['config','core.hooksPath',path.join(root,'.nubi-no-hooks')]);
  await run(['config','core.autocrlf','false']);
  for(const entry of await readdir(root))if(entry!=='.git')await rm(path.join(root,entry),{recursive:true,force:true});
  await writeWikiSnapshot(root,sources);
  await run(['add','--all','--force']);
  let head=(await run(['rev-parse','--verify','HEAD']).catch(()=>'' )).trim();
  if(!head||(await run(['diff','--cached','--name-only'])).trim()){
    await run(['commit','--allow-empty','-qm','Snapshot sources for OpenWiki']);
    head=(await run(['rev-parse','HEAD'])).trim();
  }
  if(copy){
    await mkdir(copy,{recursive:true});
    await cp(path.join(root,'.git'),path.join(copy,'.git'),{recursive:true,errorOnExist:true,force:false});
    await writeWikiSnapshot(copy,sources);
  }
  return {head,root};
}
