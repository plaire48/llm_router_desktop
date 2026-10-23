import {lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {readMailImportFile} from './mail-file-import.mjs';
import {mailFileKind,LOCAL_MAIL_KINDS,APPROVAL_KINDS} from './mail-file-kinds.mjs';

// This pointer is created by the discovered, selected Desktop Message profile,
// never by an agent/renderer path argument. It contains no body or attachment.
export function desktopMailReference(root,item){
 return {version:1,root,relative:item.relative,kind:item.kind};
}
export function desktopReferenceMetadata(reference){
 const file=reference.relative;
 return {sourceApp:'knox_desktop',sourceFolder:file.split(/[\\/]/).slice(0,-1).join('/'),documentKind:reference.kind,documentKindLabel:LOCAL_MAIL_KINDS[reference.kind].label,classificationSource:'folder_name',sourceType:APPROVAL_KINDS.includes(reference.kind)?'approval':'mail'};
}
export async function readDesktopMailReference(reference,signal){
 if(reference?.version!==1||typeof reference.root!=='string'||reference.root.includes('\0')||!path.isAbsolute(reference.root)||typeof reference.relative!=='string'||reference.relative.includes('\0')||path.isAbsolute(reference.relative)||reference.relative.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))throw Error('mail_source_changed');
 const file=path.join(reference.root,reference.relative);
 if(path.extname(file).toLowerCase()!=='.mysingle'||reference.kind!==mailFileKind(file))throw Error('mail_source_changed');
 try{
  const root=await lstat(reference.root);
  if(root.isSymbolicLink()||!root.isDirectory()||await realpath(reference.root)!==reference.root)throw Error('mail_source_changed');
  return await readMailImportFile(reference.root,{file},signal);
 }catch(error){
  if(['ENOENT','ENOTDIR'].includes(error.code))throw Error('mail_source_missing');
  if(['EACCES','EPERM'].includes(error.code))throw Error('mail_source_unavailable');
  throw error;
 }
}
