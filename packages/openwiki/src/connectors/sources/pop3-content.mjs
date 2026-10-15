import {simpleParser} from 'mailparser';
import {htmlToText} from 'html-to-text';

const MAX_MAIL=10*1024*1024;
export const MAIL_CONTENT_VERSION=5;
const meaningful=value=>typeof value==='string'&&value.replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'').length>0;

// MIME alternatives can contain an empty text/plain part. MailParser then
// suppresses HTML-to-text conversion even though the HTML contains the body.
// Convert only the parsed HTML body, never an HTML file attached to the mail.
export async function parsePop3Content(raw){
  const parsed=await simpleParser(raw,{skipTextToHtml:true,skipHtmlToText:false,keepCidLinks:true,maxHtmlLengthToParse:MAX_MAIL});
  // Named inline HTML is still a body even when a plain fallback exists.
  // Explicit HTML files remain attachments unless a known body filename and
  // an empty/fallback/identical plain part provide evidence of an exported body.
  if(!meaningful(parsed.html)){
    const plain=String(parsed.text||'').trim();
    const fallback=!meaningful(plain)||/^(?:this (?:is a )?message (?:is |contains ).*html.*|please (?:view|open|read).*html.*|HTML (?:메일|본문).*)$/i.test(plain);
    const candidates=[];
    for(const part of parsed.attachments){
      const bodyName=/^(?:body|message|mail|본문|첨부파일)(?:\.html?)?$/i.test(part.filename||'');
      const htmlType=/^text\/html(?:;|$)/i.test(part.contentType||'');
      if(!htmlType&&!(bodyName&&/^(?:application\/octet-stream|text\/plain)$/i.test(part.contentType||'')&&/^\s*(?:<!doctype html|<html|<body|<div|<p[ >]|<table)/i.test(part.content.toString('utf8'))))continue;
      const declared=part.headers?.get('content-type')?.params?.charset||'utf-8';
      const charset=({'cp949':'euc-kr','ms949':'euc-kr','windows-949':'euc-kr','ks_c_5601-1987':'euc-kr'})[declared.toLowerCase()]||declared;
      let html;try{html=new TextDecoder(charset).decode(part.content);}catch{html=part.content.toString('utf8');}
      const sameText=bodyName&&meaningful(plain)&&plain.replace(/\s/g,'')===htmlToText(html,{wordwrap:false,limits:{maxInputLength:MAX_MAIL},selectors:[{selector:'img',format:'skip'},{selector:'script',format:'skip'},{selector:'style',format:'skip'}]}).replace(/\s/g,'');
      // Filter by body evidence before counting. A real report.html attachment
      // must not prevent the unique exported body.html from becoming the body.
      if(part.contentDisposition!=='attachment'||bodyName&&(fallback||sameText))candidates.push({part,html});
    }
    if(candidates.length===1){
      const {part,html}=candidates[0];parsed.html=html;part.bodyPart=true;
      if(fallback)parsed.text='';
    }
    // Ambiguous HTML files remain files. Never substitute an arbitrary attached
    // report for an empty message body merely because it is the only HTML file.
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
