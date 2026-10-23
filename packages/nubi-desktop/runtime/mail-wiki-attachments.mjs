import {createHash} from 'node:crypto';
import {officeCacheUsable} from './mail-document-routing.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
// Explicit topic generation does not wait for the background mailbox queue.
// Read one file at a time through the same original/hash/cache contract.
export async function prepareMailWikiAttachments(mail,source,signal){
 const attachments=[];
 for(const part of source.mail.attachments||[]){
  if(signal?.aborted||mail.disposed)throw Error('mail_cancelled');
  if(part.contentState==='not_stored'||(['document_read','text_read'].includes(part.contentState)&&part.text?.trim()&&officeCacheUsable(part))){attachments.push(part);continue;}
  try{
   const bytes=await mail.readAttachmentBytes(source,part);
   if(hash(bytes)!==part.sha256)throw Error('mail_source_changed');
   const document=await mail.extractAttachment(bytes,part,signal,source.attachmentDirectory);
   await mail.rememberAttachmentDocument(source,part.id,document);
   attachments.push({...part,...document,contentState:'document_read',error:null});
  }catch(error){
   if(signal?.aborted||['mail_source_changed','mail_cancelled'].includes(error.message))throw error;
   attachments.push({...part,text:'',segments:[],contentState:'document_attention',error:/^(document|mail)_[a-z_]+$/.test(error.message)?error.message:'document_read_failed'});
  }
 }
 const current=await mail.read(source.id);if(current.sourceHash!==source.sourceHash)throw Error('mail_source_changed');
 return {...source,mail:{...source.mail,attachments}};
}
