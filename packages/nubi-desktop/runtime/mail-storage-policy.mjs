import {createHash} from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import {parsePop3Content,mailPartPresentation} from '../../openwiki/src/connectors/sources/pop3-content.mjs';

// A body-only copy is explicitly not the byte-identical original. Never mutate
// an existing receipt or delete previously stored attachments when settings change.
export async function mailForStorage(mail,includeAttachments){
 if(includeAttachments||!(mail.attachments||[]).some(part=>part.presentation!=='inline'))return mail;
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
 return {...mail,raw,attachments:mail.attachments.filter(part=>part.presentation==='inline'),normalized:{...mail.normalized,
  storage:{mode:'body_only',originalSha256,originalBytes:original.length,storedBytes:raw.length},
  attachments:mail.normalized.attachments.map(part=>part.presentation==='inline'?part:{...part,contentState:'not_stored',text:''})}};
}
