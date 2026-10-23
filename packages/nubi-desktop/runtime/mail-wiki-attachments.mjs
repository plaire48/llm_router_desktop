import {createHash} from 'node:crypto';
import {officeCacheUsable} from './mail-document-routing.mjs';
import {mailParts,unreadBodyImageReferences} from './mail-body-images.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
// Both automatic and explicit topic Wiki generation use the same original,
// hash and extraction cache. Read files and body images one at a time.
export async function prepareMailWikiAttachments(mail,source,signal){
 const updates=new Map();
 for(const part of mailParts(source.mail)){
  if(signal?.aborted||mail.disposed)throw Error('mail_cancelled');
  if(part.contentState==='not_stored'||(['document_read','text_read'].includes(part.contentState)&&part.text?.trim()&&officeCacheUsable(part)))continue;
  try{
   const bytes=await mail.readAttachmentBytes(source,part);
   if(hash(bytes)!==part.sha256)throw Error('mail_source_changed');
   const document=await mail.extractAttachment(bytes,part,signal,source.attachmentDirectory);
   if(signal?.aborted||mail.disposed)throw Error('mail_cancelled');
   await mail.rememberAttachmentDocument(source,part.id,document);
   updates.set(part.id,{...part,...document,contentState:'document_read',error:null});
  }catch(error){
   if(signal?.aborted||['mail_source_changed','mail_cancelled'].includes(error.message))throw error;
   updates.set(part.id,{...part,text:'',segments:[],contentState:'document_attention',error:/^(document|mail)_[a-z_]+$/.test(error.message)?error.message:'document_read_failed'});
  }
 }
 const current=await mail.read(source.id);if(current.sourceHash!==source.sourceHash)throw Error('mail_source_changed');
 const updated=part=>updates.get(part.id)||part;
 return {...source,mail:{...source.mail,attachments:(source.mail.attachments||[]).map(updated),inlineImages:(source.mail.inlineImages||[]).map(updated)}};
}
// Flatten for generation evidence only; body images stay separate in the mail
// reader, attachment counts and original storage receipts.
export function mailWikiEvidence(mail){
 const unread=unreadBodyImageReferences(mail)+(mail.inlineImages||[]).filter(part=>!['document_read','text_read'].includes(part.contentState)||!part.text?.trim()||part.partial===true).length;
 const {inlineImages,...body}=mail;
 return {...body,attachments:mailParts(mail),...(unread?{coverage:{...mail.coverage,complete:false,bodyImagesRead:false,unreadBodyImages:unread}}:{})};
}
export function mailBodyImageWikiReceipt(mail){
 const images=mail.inlineImages||[],unavailable=unreadBodyImageReferences(mail);
 if(!images.length&&!unavailable)return '';
 return '\n## 본문 이미지 확인\n\n'+[
  ...images.map((part,index)=>`- 본문 이미지 ${index+1} / SHA-256: ${part.sha256} / ${['document_read','text_read'].includes(part.contentState)&&part.text?.trim()?'판독: '+String(part.coverage||part.reader||'document_parser').replace(/[\r\n]/g,' '):'읽지 못함'}`),
  ...(unavailable?[`- 본문 이미지 ${unavailable}개는 원문 바이트 미확인`]:[])
 ].join('\n')+'\n';
}
