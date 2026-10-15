import {open,lstat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './files.mjs';
import {documentWindow,DOCUMENT_MAX_BYTES} from './document-window.mjs';

export const CHAT_DOCUMENT_LIMIT=10;
export const CHAT_DOCUMENT_EXTENSIONS=['pdf','doc','docx','docm','dotx','dotm','xls','xlsx','xlsm','xltx','xltm','ppt','pptx','pptm','ppsx','ppsm','potx','potm','txt','md','csv','json','xml','html','htm','ics'];
const reference=({id,hash:sourceHash,filename,bytes,coverage})=>({id,sourceHash,filename,coverage,bytes});
export function validateDocuments(service,items=[]){
 if(!Array.isArray(items)||items.length>CHAT_DOCUMENT_LIMIT)throw Error('chat_document_limit');
 return items.map(item=>{
  const record=typeof item?.id==='string'&&service.store.get('chat-document:'+item.id);
  if(!record||record.projectId!==service.projectId||record.hash!==item.sourceHash)throw Error('chat_document_missing');
  return reference(record);
 });
}
export function mergeDocuments(current=[],added=[]){return [...new Map([...current,...added].map(item=>[item.id,item])).values()];}
// Only the native picker may call this host method. No arbitrary AI or renderer path reads.
export async function importDocumentSelection({paths,projectId}={}){
 this.ready();if(projectId!==this.projectId)throw Error('project_changed');
 if(!Array.isArray(paths)||!paths.length||paths.length>CHAT_DOCUMENT_LIMIT)throw Error('chat_document_limit');
 if(this.chatDocumentReading)throw Error('document_reader_busy');
 const owner=this.store,controller=new AbortController();this.chatDocumentReading=controller;
 const records=[],errors=[];
 try{
  await this.mail({action:'status'});
  for(const target of paths){
   const filename=typeof target==='string'?path.basename(target):'문서';
   try{
    if(!path.isAbsolute(target)||!CHAT_DOCUMENT_EXTENSIONS.includes(path.extname(target).slice(1).toLowerCase()))throw Error('document_format');
    const before=await lstat(target);if(!before.isFile()||before.isSymbolicLink())throw Error('document_scope');
    if(before.size>DOCUMENT_MAX_BYTES)throw Error('document_limit');
    const file=await open(target,'r');let bytes;
    try{const actual=await file.stat();if(!actual.isFile()||actual.size>DOCUMENT_MAX_BYTES||actual.ino!==before.ino||actual.dev!==before.dev)throw Error('source_stale');bytes=Buffer.alloc(actual.size);let offset=0;while(offset<bytes.length){const {bytesRead}=await file.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw Error('source_stale');offset+=bytesRead;}const after=await file.stat();if(after.size!==actual.size||after.mtimeMs!==actual.mtimeMs)throw Error('source_stale');}finally{await file.close();}
    const directory=path.join(this.storageRoot,'document-read');await mkdir(directory,{recursive:true,mode:0o700});
    const document=await this.personalMail.extractAttachment(bytes,{filename},controller.signal,directory,{useActiveModel:true});
    if(!document.text?.trim())throw Error('document_empty');
    if(this.store!==owner||this.projectId!==projectId||controller.signal.aborted)throw Error('project_changed');
    // Keep an immutable extracted snapshot, not the arbitrary external path or original document bytes.
    records.push({id:randomUUID(),projectId,hash:hash(bytes),filename,bytes:bytes.length,text:document.text,segments:document.segments||[],coverage:document.coverage,createdAt:new Date().toISOString()});
   }catch(error){if(error.message==='project_changed')throw error;errors.push({filename,error:/^(document_[a-z_]+|office_[a-z_]+|source_stale)$/.test(error.message)?error.message:'document_read_failed'});}
  }
  if(this.store!==owner||this.projectId!==projectId)throw Error('project_changed');
  for(const record of records)owner.set('chat-document:'+record.id,record);
  return {documents:records.map(reference),errors};
 }finally{if(this.chatDocumentReading===controller)this.chatDocumentReading=null;}
}
export function readChatDocument(service,{id,sourceHash,offset=0,limit=12000}={},task){
 const [ref]=validateDocuments(service,[{id,sourceHash}]);
 if(task&&!task.documentReferences?.some(item=>item.id===id&&item.sourceHash===sourceHash))throw Error('document_scope');
 const record=service.store.get('chat-document:'+id),window=documentWindow(record,{offset,limit});
 return {...ref,text:window.text,segments:window.segments,coverage:window.coverage,offset:window.offset,nextOffset:window.nextOffset,totalCharacters:window.totalCharacters,partial:window.partial,snapshot:true};
}
