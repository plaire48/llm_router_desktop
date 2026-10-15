import {mailPresentation} from './mail-body-images.mjs';
import {createHash} from 'node:crypto';
import {parsePop3Content,mailPartPresentation} from '../../openwiki/src/connectors/sources/pop3-content.mjs';
// The portal supplies EML bytes, not HTML previews. Reuse the MIME parser and
// original-byte hashes so search, source citations and downloads stay identical.
export async function normalizePortalMail(raw,{includePresentation=false,filename=''}={}){
 if(!Buffer.isBuffer(raw)||!raw.length||raw.length>96*1024*1024)throw Error('mail_size_limit');
 const parsed=await parsePop3Content(filename?decodeLocalHeaders(raw):raw),address=value=>value?.text?.slice(0,2000)||'';
 if(parsed.attachments.length>100)throw Error('mail_size_limit');
 const attachments=parsed.attachments.map((part,index)=>{const sha256=createHash('sha256').update(part.content).digest('hex');return {id:String(index).padStart(3,'0')+'-'+sha256.slice(0,16),filename:(part.filename||'').slice(0,500),contentType:part.contentType,size:part.size,sha256,content:part.content,text:'',contentState:'stored_bytes_only',presentation:mailPartPresentation(part,parsed.html)};});
 const text=(parsed.text||'').slice(0,32000);
 return {raw,attachments,...(includePresentation?{presentation:mailPresentation(parsed)}:{}),normalized:{...(filename?{sourceFilename:filename,sourceFormat:filename.split('.').at(-1).toLowerCase(),desktopMessage:{uniqueId:String(parsed.headers.get('x-desttop-msg-uniqueid')||'').slice(0,1000),flags:String(parsed.headers.get('x-msgflags')||'').slice(0,200)}}:{}),subject:(parsed.subject||filename||'(제목 없음)').slice(0,1000),from:address(parsed.from),to:address(parsed.to),cc:address(parsed.cc),bcc:address(parsed.bcc),sender:parsed.from?.value?.length===1?{name:parsed.from.value[0].name||'',address:parsed.from.value[0].address||''}:undefined,date:parsed.date?.toISOString()||null,messageId:(parsed.messageId||'').slice(0,1000)||null,inReplyTo:(parsed.inReplyTo||'').slice(0,1000)||null,references:[].concat(parsed.references||[]).slice(0,200).map(String),text,bodySource:parsed.bodySource,contentVersion:parsed.contentVersion,truncated:(parsed.text||'').length>text.length,attachments:attachments.map(({content,...metadata})=>metadata)}};
}

// Some Desktop Message files have raw CP949 header bytes. Decode only display
// headers for parsing; the original bytes and their receipt remain unchanged.
function decodeLocalHeaders(raw){
 const marker=/\r?\n\r?\n/.exec(raw.toString('latin1',0,65536));if(!marker)return raw;
 const header=raw.subarray(0,marker.index).toString('latin1').replace(/\r?\n[ \t]+/g,' ');
 const fixed=header.split(/\r?\n/).map(line=>{
  if(!/^(subject|from|to|cc|bcc):/i.test(line)||!/[\x80-\xff]/.test(line))return line;
  const colon=line.indexOf(':'),bytes=Buffer.from(line.slice(colon+1),'latin1');let value;
  try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{value=new TextDecoder('euc-kr').decode(bytes);}
  // Encoded words preserve decoded Korean without reinterpreting raw bytes.
  return line.slice(0,colon+1)+value.replace(/[^\x00-\x7f]+/g,text=>'=?UTF-8?B?'+Buffer.from(text).toString('base64')+'?=');
 }).join('\r\n');
 return Buffer.concat([Buffer.from(fixed+'\r\n\r\n','latin1'),raw.subarray(marker.index+marker[0].length)]);
}
