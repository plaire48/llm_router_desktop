import {createHash} from 'node:crypto';
import {parsePop3Content,mailPartPresentation} from '../../openwiki/src/connectors/sources/pop3-content.mjs';
// The portal supplies EML bytes, not HTML previews. Reuse the MIME parser and
// original-byte hashes so search, source citations and downloads stay identical.
export async function normalizePortalMail(raw,{includePresentation=false}={}){
 if(!Buffer.isBuffer(raw)||!raw.length||raw.length>10*1024*1024)throw Error('mail_size_limit');
 const parsed=await parsePop3Content(raw),address=value=>value?.text?.slice(0,2000)||'';
 if(parsed.attachments.length>100)throw Error('mail_size_limit');
 const attachments=parsed.attachments.map((part,index)=>{const sha256=createHash('sha256').update(part.content).digest('hex');return {id:String(index).padStart(3,'0')+'-'+sha256.slice(0,16),filename:(part.filename||'').slice(0,500),contentType:part.contentType,size:part.size,sha256,content:part.content,text:'',contentState:'stored_bytes_only',presentation:mailPartPresentation(part,parsed.html)};});
 const text=(parsed.text||'').slice(0,32000);
 return {raw,attachments,...(includePresentation?{presentation:{html:typeof parsed.html==='string'?parsed.html.slice(0,500000):'',images:[]}}:{}),normalized:{subject:(parsed.subject||'(제목 없음)').slice(0,1000),from:address(parsed.from),to:address(parsed.to),cc:address(parsed.cc),bcc:address(parsed.bcc),sender:parsed.from?.value?.length===1?{name:parsed.from.value[0].name||'',address:parsed.from.value[0].address||''}:undefined,date:parsed.date?.toISOString()||null,messageId:(parsed.messageId||'').slice(0,1000)||null,inReplyTo:(parsed.inReplyTo||'').slice(0,1000)||null,references:[].concat(parsed.references||[]).slice(0,200).map(String),text,bodySource:parsed.bodySource,contentVersion:parsed.contentVersion,truncated:(parsed.text||'').length>text.length,attachments:attachments.map(({content,...metadata})=>metadata)}};
}
