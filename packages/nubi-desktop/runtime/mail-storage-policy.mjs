import {createHash} from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import {parsePop3Content,mailPartPresentation} from '../../openwiki/src/connectors/sources/pop3-content.mjs';

// A body-only copy is explicitly not the byte-identical original. Never mutate
// an existing receipt or delete previously stored attachments when settings change.
export async function mailForStorage(mail,includeAttachments,{retainOriginals=true}={}){
 if(retainOriginals&&(includeAttachments||!(mail.attachments||[]).some(part=>part.presentation!=='inline')))return mail;
 const original=Buffer.from(mail.raw),originalSha256=createHash('sha256').update(original).digest('hex');
 const parsed=await parsePop3Content(original);
 const kept=parsed.attachments.filter(part=>mailPartPresentation(part,parsed.html)==='inline');
 const composer=new MailComposer({
  from:parsed.from?.value,to:parsed.to?.value,cc:parsed.cc?.value,bcc:parsed.bcc?.value,replyTo:parsed.replyTo?.value,
  subject:parsed.subject||mail.normalized.subject,date:parsed.date||new Date(0),messageId:parsed.messageId||`<${originalSha256}@nubi.invalid>`,
  inReplyTo:parsed.inReplyTo,references:parsed.references,text:parsed.text||'',html:parsed.html||undefined,
  headers:{'X-Nubi-Storage':'body-only copy','X-Nubi-Original-SHA256':originalSha256},
  baseBoundary:originalSha256,disableFileAccess:true,disableUrlAccess:true,newline:'\r\n',
  attachments:kept.map(part=>({content:part.content,filename:part.filename,cid:part.cid||part.contentId?.replace(/^<|>$/g,''),contentType:part.contentType,contentDisposition:'inline',headers:part.headers?.get('content-location')?{'Content-Location':String(part.headers.get('content-location'))}:undefined}))
 });
 const message=composer.compile();message.keepBcc=true;
 const raw=await message.build();
 return {...mail,raw,attachments:mail.attachments.filter(part=>['inline','body'].includes(part.presentation)),normalized:{...mail.normalized,
  storage:{mode:'body_only',originalStored:false,originalSha256,originalBytes:original.length,storedBytes:raw.length},
  attachments:mail.normalized.attachments.map(part=>['inline','body'].includes(part.presentation)?part:{...part,contentState:'not_stored',text:''})}};
}

// Storage opt-out removes original payloads, not the evidence needed by Personal
// Wiki. Extract while bytes are in memory and retain the result in the encrypted,
// hash-bound manifest. Never acknowledge an unread/discarded attachment as done.
export async function extractUnstoredMailAttachments(mail,incoming,{extract,check=()=>{}}){
 if(mail.normalized.storage?.mode!=='body_only')return mail;
 const attachments=[];
 for(const part of mail.normalized.attachments){
  check();
  if(part.contentState!=='not_stored'){attachments.push(part);continue;}
  const original=incoming.attachments.find(item=>item.id===part.id);
  if(!original||createHash('sha256').update(Buffer.from(original.content)).digest('hex')!==part.sha256)throw Error('mail_source_changed');
  let document;
  try{document=await extract(Buffer.from(original.content),original);}
  catch(cause){check();if(cause.message==='mail_cancelled')throw cause;throw Object.assign(Error('mail_attachment_analysis_failed'),{cause});}
  check();
  if(!document?.text?.trim())throw Error('mail_attachment_analysis_failed');
  attachments.push({...part,originalStored:false,contentState:'document_read',text:document.text,
   segments:document.segments||[],coverage:document.coverage,reader:document.reader||'document_parser',readerVersion:5,
   officeVersion:document.officeVersion||null});
 }
 return {...mail,normalized:{...mail.normalized,attachments}};
}
