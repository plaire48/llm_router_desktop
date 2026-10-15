import {simpleParser} from 'mailparser';
import {htmlToText} from 'html-to-text';

const MAX_MAIL=10*1024*1024;
export const MAIL_CONTENT_VERSION=3;
const meaningful=value=>typeof value==='string'&&value.replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'').length>0;

// MIME alternatives can contain an empty text/plain part. MailParser then
// suppresses HTML-to-text conversion even though the HTML contains the body.
// Convert only the parsed HTML body, never an HTML file attached to the mail.
export async function parsePop3Content(raw){
  const parsed=await simpleParser(raw,{skipTextToHtml:true,skipHtmlToText:false,keepCidLinks:true,maxHtmlLengthToParse:MAX_MAIL});
  // Some sent-message exporters wrap the only HTML body in a named MIME part.
  // Preserve explicit attachments, but still render that part when no body exists.
  if(!meaningful(parsed.text)&&!meaningful(parsed.html)){
    const candidates=parsed.attachments.filter(part=>/^text\/html(?:;|$)/i.test(part.contentType||''));
    if(candidates.length===1){
      const part=candidates[0];
      try{parsed.html=new TextDecoder(part.headers?.get('content-type')?.params?.charset||'utf-8').decode(part.content);}catch{parsed.html=part.content.toString('utf8');}
      if(part.contentDisposition!=='attachment'||/^(?:body|message|mail|본문|첨부파일)(?:\.html?)?$/i.test(part.filename||''))part.bodyPart=true;
    }
  }
  let text=parsed.text||'',bodySource='plain';
  if(!meaningful(text)&&typeof parsed.html==='string'){
    text=htmlToText(parsed.html,{wordwrap:false,limits:{maxInputLength:MAX_MAIL},selectors:[{selector:'img',format:'skip'},{selector:'script',format:'skip'},{selector:'style',format:'skip'}]});
    bodySource='html';
  }
  if(!meaningful(text)){text='';bodySource='empty';}
  return {...parsed,text,bodySource,contentVersion:MAIL_CONTENT_VERSION};
}

// A body image is a MIME part too, but should not become a user attachment.
// Explicit file attachments stay visible even if they also have a Content-ID.
export function mailPartPresentation(part,html){
  if(part.bodyPart)return 'body';
  if(part.contentDisposition==='attachment'||!/^image\//i.test(part.contentType||''))return 'attachment';
  const cid=String(part.cid||part.contentId||'').replace(/^<|>$/g,'');
  const linked=cid&&typeof html==='string'&&[...html.matchAll(/\bcid:([^\s"'<>]+)/g)].some(match=>match[1]===cid);
  return linked||part.related===true&&part.contentDisposition==='inline'?'inline':'attachment';
}
