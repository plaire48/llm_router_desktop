// Mail threads and quoted text, done natively (user decision 2026-10-14: no Python sidecar). The ideas follow
// Talon (strip the quoted reply and the signature so the wiki page and the summary hold only new text) and the
// thread grouping a mail client does from Message-ID, In-Reply-To and References.
const QUOTE_SEPARATORS=[
  /^-{2,}\s*Original Message\s*-{2,}$/i,/^-{2,}\s*원본 메[시일]지\s*-{2,}$/,/^_{5,}$/,/^-{5,}$/,
  /^On .+ wrote:$/i,/^\d{4}[./년]\s*\d{1,2}[./월]\s*\d{1,2}.*(?:작성|wrote|씀):$/,
  /^(?:From|보낸 사람|보낸사람|발신)\s*:\s*.+$/,
  /^>+\s?/,
];
const HEADER_BLOCK=/^(?:From|Sent|To|Cc|Subject|보낸 사람|보낸사람|보낸 날짜|보낸날짜|받는 사람|받는사람|참조|제목|날짜|발신|수신)\s*:/;
const SIGNATURE_MARKERS=[/^--\s*$/,/^—\s*$/,/^Best regards,?$/i,/^Regards,?$/i,/^Thanks,?$/i,/^Sincerely,?$/i,/^감사합니다\.?$/,/^고맙습니다\.?$/,/^드림\.?$/,/^올림\.?$/];
const CONTACT_LINE=/(?:\+?\d[\d\s().-]{7,}\d)|@[\w.-]+\.[a-z]{2,}|(?:Tel|Mobile|Phone|전화|휴대폰|팩스|Fax)\s*[:.]/i;
export function stripQuotedReply(text){
  const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n');
  let cut=lines.length;
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();
    if(QUOTE_SEPARATORS.some(pattern=>pattern.test(line))){
      // A header block (From/Sent/To/Subject or the Korean equivalents) in the next lines confirms a forwarded or
      // quoted mail; a lone ">" line is quoted text as well.
      const window=lines.slice(i,i+6).map(entry=>entry.trim());
      if(/^>/.test(line)||window.filter(entry=>HEADER_BLOCK.test(entry)).length>=2||/Original Message|원본 메|wrote:|작성:/i.test(line)||/^[_-]{5,}$/.test(line)&&window.slice(1).some(entry=>HEADER_BLOCK.test(entry))){cut=i;break;}
    }
  }
  let kept=lines.slice(0,cut);
  while(kept.length&&!kept.at(-1).trim())kept.pop();
  // Signature: a marker line followed by at most eight short lines, or a trailing block of contact lines.
  for(let i=Math.max(0,kept.length-12);i<kept.length;i++){
    const line=kept[i].trim();
    if(SIGNATURE_MARKERS.some(pattern=>pattern.test(line))&&kept.length-i<=9){kept=kept.slice(0,i);break;}
  }
  let tail=kept.length;
  while(tail>0&&(!kept[tail-1].trim()||CONTACT_LINE.test(kept[tail-1])||kept[tail-1].trim().length<=40&&/^[\w가-힣.·, ()/]+$/.test(kept[tail-1].trim())&&tail>kept.length-5))tail--;
  if(kept.length-tail>=2&&kept.slice(tail).some(entry=>CONTACT_LINE.test(entry)))kept=kept.slice(0,tail);
  const result=kept.join('\n').replace(/\n{3,}/g,'\n\n').trim();
  return result||String(text||'').trim();
}
export function normalizeSubject(subject){
  return String(subject||'').replace(/\s+/g,' ').replace(/^(?:\s*(?:\[[^\]]{1,30}\]|\((?:외부|광고|EXTERNAL)\)|(?:re|fw|fwd|답장|전달|회신|답변)\s*:)\s*)+/i,'').trim().toLocaleLowerCase();
}
const id=value=>String(value||'').trim().replace(/^<|>$/g,'').slice(0,998);
// The thread key is the first Message-ID in References (the root), else In-Reply-To, else the mail's own id; a
// subject-only fallback keeps mails without ids together when the subject matches after Re/Fwd prefixes.
export function threadKey({messageId,inReplyTo,references,subject}={}){
  const refs=[].concat(references||[]).map(id).filter(Boolean);
  const root=refs[0]||id(inReplyTo)||id(messageId);
  if(root)return 'id:'+root;
  const plain=normalizeSubject(subject);
  return plain?'subject:'+plain:'';
}

// Front matter for a mail wiki page: the same keys the project wiki uses (type, title, description, tags) plus the
// headers that let the library group a thread and keep the sender, recipients and date with the page.
const yaml=value=>JSON.stringify(String(value??'').replace(/[\r\n]+/g,' ').slice(0,300));
export function mailFrontMatter({title,summary,thread,mail={},documentKind='메일'}){
  const description=String(summary||'').split(/(?<=[.!?。])\s+|\n/)[0].trim().slice(0,200);
  const lines=['---','type: Mail',`title: ${yaml(title)}`,`description: ${yaml(description)}`,`tags: [${['mail',documentKind==='메일'?null:documentKind].filter(Boolean).map(yaml).join(', ')}]`];
  if(thread)lines.push(`thread: ${yaml(thread)}`);
  if(mail.messageId)lines.push(`message_id: ${yaml(mail.messageId)}`);
  if(mail.inReplyTo)lines.push(`in_reply_to: ${yaml(mail.inReplyTo)}`);
  if(mail.from)lines.push(`from: ${yaml(mail.from)}`);
  if(mail.to)lines.push(`to: ${yaml(Array.isArray(mail.to)?mail.to.join(', '):mail.to)}`);
  if(mail.cc)lines.push(`cc: ${yaml(Array.isArray(mail.cc)?mail.cc.join(', '):mail.cc)}`);
  if(mail.date)lines.push(`date: ${yaml(mail.date)}`);
  lines.push('---','');
  return lines.join('\n');
}
