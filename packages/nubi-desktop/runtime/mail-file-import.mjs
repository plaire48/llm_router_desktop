import {mailFileKind} from './mail-file-kinds.mjs';
import {opendir,lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
export const MAIL_FILE_EXTENSIONS=new Set(['.eml','.mysingle','.mhtml','.mht']);
// Folder totals do not limit imports. Payloads are read one at a time.
const HARD_LIMIT=256*1024*1024;
const check=signal=>{if(signal?.aborted)throw Error('mail_cancelled');};
// Only the native folder picker supplies this root. Never follow links out of it.
export async function scanMailFolder(directory,{signal,onScan=()=>{},extensions=MAIL_FILE_EXTENSIONS,excludeDirectories=[]}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('mail_input_invalid');
 const root=await realpath(directory),info=await lstat(directory);
 if(info.isSymbolicLink()||!info.isDirectory())throw Error('mail_import_folder');
 const files=[],failures=[],pending=[root];
 while(pending.length){
  check(signal);const folder=pending.pop();
  if(await realpath(folder)!==folder||(await lstat(folder)).isSymbolicLink())throw Error('mail_source_changed');
  let entries;try{entries=await opendir(folder);}catch(error){if(folder===root)throw error;failures.push({file:path.relative(root,folder),error:'mail_import_read'});continue;}
  for await(const entry of entries){
   check(signal);
   const file=path.join(folder,entry.name),relative=path.relative(root,file);
   if(entry.isSymbolicLink()){failures.push({file:relative,error:'mail_import_link'});continue;}
   if(entry.isDirectory()){if(!excludeDirectories.includes(entry.name.toUpperCase()))pending.push(file);continue;}
   if(!entry.isFile()||!extensions.has(path.extname(entry.name).toLowerCase()))continue;
   let stat;try{stat=await lstat(file);}catch{failures.push({file:relative,error:'mail_import_read'});continue;}
   if(!stat.isFile()||stat.isSymbolicLink()){failures.push({file:relative,error:'mail_import_link'});continue;}
   if(stat.size>HARD_LIMIT){failures.push({file:relative,error:'mail_size_limit'});continue;}
   files.push({file,relative,size:stat.size,signature:mailImportSignature(stat),kind:mailFileKind(file)});onScan(files.length);
  }
 }
 return {root,files,failures};
}
export const mailImportSignature=stat=>[stat.size,stat.mtimeMs,stat.ctimeMs,stat.dev,stat.ino].join(':');

export async function readMailImportFile(root,item,signal){
 check(signal);const resolved=await realpath(item.file);
 if(resolved!==item.file||path.relative(root,resolved).split(path.sep).includes('..'))throw Error('mail_source_changed');
 const handle=await open(item.file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const before=await handle.stat();if(item.signature&&item.signature!==mailImportSignature(before))throw Error('mail_source_changed');if(!before.isFile()||before.size>HARD_LIMIT)throw Error('mail_size_limit');
  const limit=HARD_LIMIT;const chunks=[];let length=0;
  while(length<limit){check(signal);const buffer=Buffer.alloc(Math.min(65536,limit-length)),{bytesRead}=await handle.read(buffer);if(!bytesRead)break;length+=bytesRead;chunks.push(buffer.subarray(0,bytesRead));}
  const after=await handle.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||await realpath(item.file)!==resolved)throw Error('mail_source_changed');
  const current=await lstat(item.file);if(current.isSymbolicLink()||mailImportSignature(current)!==mailImportSignature(after))throw Error('mail_source_changed');
  const raw=Buffer.concat(chunks);if(raw.length!==before.size)throw Error('mail_source_changed');if(raw.subarray(0,32).toString('ascii').startsWith('<## NASCA DRM'))throw Error('mail_import_protected');
  if(!raw.length||!/(?:^|\r?\n)(?:Subject|From|To|MIME-Version|Content-Type|X-DESTTOP-MSG-UNIQUEID):/i.test(raw.subarray(0,65536).toString('latin1')))throw Error('mail_parse_failed');
  return raw;
 }finally{await handle.close();}
}
