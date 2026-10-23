import path from 'node:path';
import {mkdir,lstat,realpath,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {MAIL_INTAKE_VERSION,normalizeMailIntake} from './mail-intake-policy.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(child,parent)=>{const relative=path.relative(parent,child);return !relative.startsWith('..')&&!path.isAbsolute(relative);};
export async function relocateMailWiki(owner,directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||directory.includes('\0'))throw Error('mail_intake_invalid');
 await owner.ensureWiki();const vault=owner.wikiVault;if(!vault.active)throw Error('mail_encryption_unavailable');
 owner.relocating=true;const copied=[];let committed=false;
 const progress=owner.storageProgress={id:randomUUID(),state:'running',stage:'scanning',startedAt:new Date().toISOString(),completed:0,total:null,bytes:0,totalBytes:null};
 try{
  await vault.syncAll();await mkdir(directory,{recursive:true});
  const from=await realpath(vault.storeRoot),selected=await realpath(directory),to=path.basename(selected)==='nubi-mail-wiki'?selected:path.join(selected,'nubi-mail-wiki');
  if(from===to){Object.assign(progress,{state:'completed',stage:'complete'});return;}
  const rawRoot=await realpath(owner.rawRoot),sessionRoot=await realpath(vault.sessionRoot);
  if(inside(to,from)||inside(from,to)||inside(to,rawRoot)||inside(rawRoot,to)||inside(to,sessionRoot)||inside(sessionRoot,to))throw Error('mail_storage_nested');
  await vault.privateDir(to);if((await readdir(to)).length)throw Error('mail_storage_not_empty');
  // Only encrypted page files belong here. Keep the live session directory stable
  // so source receipts, open Wiki pages and user edits retain their existing paths.
  const files=[];for(const name of await readdir(from)){const file=path.join(from,name),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||!name.endsWith('.md.enc'))throw Error('mail_file_conflict');files.push({name,hash:hash(await readFile(file)),size:info.size});}
  Object.assign(progress,{stage:'copying',total:files.length,totalBytes:files.reduce((sum,file)=>sum+file.size,0)});
  await vault.syncing;
  for(const file of files){const bytes=await readFile(path.join(from,file.name));if(hash(bytes)!==file.hash)throw Error('mail_source_changed');const target=path.join(to,file.name);await writeFile(target,bytes,{flag:'wx',mode:0o600});copied.push(target);if(hash(await readFile(target))!==file.hash)throw Error('mail_source_changed');progress.completed++;progress.bytes+=bytes.length;}
  if(JSON.stringify((await readdir(from)).sort())!==JSON.stringify(files.map(file=>file.name).sort()))throw Error('mail_source_changed');
  for(const file of files)if(hash(await readFile(path.join(from,file.name)))!==file.hash)throw Error('mail_source_changed');
  progress.stage='committing';owner.store.set('setting:wiki-root',{path:to});vault.storeRoot=to;owner.wikiStoreRoot=to;committed=true;
  await vault.syncAll();const leftover=[];
  for(const file of files){try{const source=path.join(from,file.name);if(hash(await readFile(source))===file.hash)await rm(source);else leftover.push(file.name);}catch{leftover.push(file.name);}}
  Object.assign(progress,{state:'completed',stage:'complete',finishedAt:new Date().toISOString(),...(leftover.length?{leftover:leftover.length,previousRoot:from}:{})});
 }catch(error){if(!committed)for(const file of copied)await rm(file,{force:true}).catch(()=>{});Object.assign(progress,{state:'failed',stage:'failed',error:error.message});throw error;}
 finally{owner.relocating=false;}
}
export async function configureMailIntake(owner,args){
 const policy=normalizeMailIntake(args.policy),warnings=[];
 if(args.includeAttachments!==undefined&&typeof args.includeAttachments!=='boolean')throw Error('mail_intake_invalid');
 for(const key of ['rawDirectory','wikiDirectory'])if(args[key]!==undefined&&(typeof args[key]!=='string'||!path.isAbsolute(args[key])||args[key].includes('\0')))throw Error('mail_intake_invalid');
 if(owner.configuringIntake||owner.relocating||owner.checking||owner.connecting||owner.importController||owner.synthesis||owner.attachmentRead||owner.desktopSource.running||owner.desktopSource.connecting)throw Error('mail_busy');
 owner.configuringIntake=true;
 try{
 if(args.rawDirectory){
  await owner.ensureWiki();await mkdir(args.rawDirectory,{recursive:true});
  const selected=await realpath(args.rawDirectory),target=path.basename(selected)==='nubi-mail-raw'?selected:path.join(selected,'nubi-mail-raw');
  for(const directory of [owner.wikiStoreRoot,owner.wikiRoot]){const root=await realpath(directory);if(inside(target,root)||inside(root,target))throw Error('mail_storage_nested');}
 }
 if(args.rawDirectory){await owner.relocateRaw(args.rawDirectory,{includeAttachments:args.includeAttachments??owner.includeAttachments});if(owner.storageProgress?.leftover)warnings.push({kind:'raw',count:owner.storageProgress.leftover});}
 if(args.wikiDirectory){await relocateMailWiki(owner,args.wikiDirectory);if(owner.storageProgress?.leftover)warnings.push({kind:'wiki',count:owner.storageProgress.leftover});}
 await owner.ensureRaw();
 owner.store.set('setting:raw-root',{...owner.store.get('setting:raw-root'),path:owner.rawRoot,includeAttachments:args.includeAttachments??owner.includeAttachments});
 owner.store.set('setting:raw-root-confirmed',true);
 owner.store.set('setting:mail-intake',{version:MAIL_INTAKE_VERSION,confirmedAt:new Date().toISOString(),policy});
 }finally{owner.configuringIntake=false;}
 owner.resumeCollection();owner.resumeProcessing();return {...owner.status(),storageWarnings:warnings};
}
