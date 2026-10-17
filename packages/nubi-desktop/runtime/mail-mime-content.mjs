// Content evidence, not a filename, selects the existing MIME parser. Keep
// simple text notes and real HTML/Office files on their original readers.
export function isMimeMailContent(bytes){
  if(!bytes?.length)return false;
  const prefix=bytes.subarray(0,65536).toString('latin1'),end=/\r?\n\r?\n/.exec(prefix);
  if(!end)return false;
  const header=prefix.slice(0,end.index).replace(/\r?\n[ \t]+/g,' ');
  if(!header.split(/\r?\n/).every(line=>/^[a-z][a-z0-9-]*:/i.test(line)))return false;
  return /^Content-Type:\s*(?:multipart\/|text\/(?:plain|html)\b|message\/rfc822\b)/im.test(header)&&
    /^(?:MIME-Version:\s*1\.0|X-DESTTOP-MSG-UNIQUEID:)/im.test(header)&&
    /^(?:Subject|From|To|X-DESTTOP-MSG-UNIQUEID):/im.test(header);
}

export function mimeMailDocument(parsed){
  const mail=parsed.normalized;
  if(mail.truncated)throw Error('document_limit');
  return {text:mail.text||'',segments:[],reader:'mime_mail',
    coverage:'첨부 메일 본문. 내부 첨부 내용은 별도이며 아직 읽지 않았어요.',
    mailHeaders:{subject:mail.subject,from:mail.from,to:mail.to,cc:mail.cc,date:mail.date}};
}

export function mimeMailPresentation(parsed){
  const mail=parsed.normalized;
  return {subject:mail.subject,from:mail.from,to:mail.to,cc:mail.cc,date:mail.date,
    presentation:parsed.presentation,
    attachments:mail.attachments.filter(part=>part.presentation==='attachment')};
}
