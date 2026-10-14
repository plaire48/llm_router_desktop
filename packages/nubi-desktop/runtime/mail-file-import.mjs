import {mailFileKind} from './mail-file-kinds.mjs';
import {opendir,lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
export const MAIL_FILE_EXTENSIONS=new Set(['.eml','.mysingle','.mhtml','.mht']);
// Folder imports are usually bulk exports; the caps keep one import bounded, not small (user decision 2026-10-14: 50 MB per file, 20,000 files or 4 GB per folder). Files are read one at a time.
const MAX_FILE=50*1024*1024,MAX_TOTAL=4*1024*1024*1024,MAX_FILES=20000,MAX_VISITED=200000;
// Files above MAX_FILE are still imported: only their first HEAD_LIMIT bytes (headers and the text parts, which MIME puts
// before attachments) are read. Only files above HARD_LIMIT are refused.
const HEAD_LIMIT=24*1024*1024,HARD_LIMIT=2*1024*1024*1024;
const check=signal=>{if(signal?.aborted)throw Error('mail_cancelled');};
// Only the native folder picker supplies this root. Never follow links out of it.
export async function scanMailFolder(directory,{signal,onScan=()=>{}}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('mail_input_invalid');
 const root=await realpath(directory),info=await lstat(directory);
 if(info.isSymbolicLink()||!info.isDirectory())throw Error('mail_import_folder');
 const files=[],failures=[];let visited=0,total=0;
 async function walk(folder,depth){
  check(signal);if(depth>20)throw Error('mail_import_limit');
  const entries=await opendir(folder);
  for await(const entry of entries){
   check(signal);if(++visited>MAX_VISITED)throw Error('mail_import_limit');
   const file=path.join(folder,entry.name),relative=path.relative(root,file);
   if(entry.isSymbolicLink()){failures.push({file:relative,error:'mail_import_link'});continue;}
   if(entry.isDirectory()){await walk(file,depth+1);continue;}
   if(!entry.isFile()||!MAIL_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))continue;
   const stat=await lstat(file);
   if(stat.size>HARD_LIMIT){failures.push({file:relative,error:'mail_size_limit'});continue;}
   total+=Math.min(stat.size,HEAD_LIMIT);if(files.length>=MAX_FILES||total>MAX_TOTAL)throw Error('mail_import_limit');
   files.push({file,relative,size:stat.size,kind:mailFileKind(file)});onScan(files.length);
  }
 }
 await walk(root,0);return {root,files,failures};
}
export async function readMailImportFile(root,item,signal){
 check(signal);const resolved=await realpath(item.file);
 if(resolved!==item.file||path.relative(root,resolved).split(path.sep).includes('..'))throw Error('mail_source_changed');
 const handle=await open(item.file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const before=await handle.stat();if(!before.isFile()||before.size>HARD_LIMIT)throw Error('mail_size_limit');
  const limit=before.size>MAX_FILE?HEAD_LIMIT:MAX_FILE;const chunks=[];let length=0;
  while(length<limit){check(signal);const buffer=Buffer.alloc(Math.min(65536,limit-length)),{bytesRead}=await handle.read(buffer);if(!bytesRead)break;length+=bytesRead;chunks.push(buffer.subarray(0,bytesRead));}
  const after=await handle.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||await realpath(item.file)!==resolved)throw Error('mail_source_changed');
  const raw=Buffer.concat(chunks);if(raw.subarray(0,32).toString('ascii').startsWith('<## NASCA DRM'))throw Error('mail_import_protected');
  if(!raw.length||!/(?:^|\r?\n)(?:Subject|From|To|MIME-Version|Content-Type|X-DESTTOP-MSG-UNIQUEID):/i.test(raw.subarray(0,65536).toString('latin1')))throw Error('mail_parse_failed');
  return raw;
 }finally{await handle.close();}
}
