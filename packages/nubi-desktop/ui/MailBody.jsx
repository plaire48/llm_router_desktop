import React,{useEffect,useMemo,useRef,useState,memo} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {MailMatchText} from './MailMatchText.jsx';
import {mailBodyParts} from '../runtime/mail-preview.mjs';
import {mailHtmlDocument} from './mail-html.mjs';
import './mail-body.css';

function HtmlMailBody({presentation,query,title='메일 본문'}){
 const frame=useRef(null),cleanup=useRef(()=>{}),[height,setHeight]=useState(240);
 const srcDoc=useMemo(()=>mailHtmlDocument(presentation,query),[presentation,query]);
 useEffect(()=>()=>cleanup.current(),[]);
 function loaded(){
  cleanup.current();const doc=frame.current?.contentDocument;if(!doc)return;
  const resize=()=>setHeight(Math.max(80,Math.min(16000,doc.documentElement.scrollHeight,doc.body.scrollHeight)));
  // Font-face registrations also belong to a document. Reuse the bundled
  // faces, so the isolated mail frame does not silently fall back to OS fonts.
  for(const face of document.fonts)if(/Noto Sans KR|Pretendard/.test(face.family))doc.fonts.add(face);
  void doc.fonts.ready.then(()=>{if(frame.current?.contentDocument===doc)resize();});
  // srcdoc is an isolated document: app variables and root text scaling do not
  // inherit across the frame boundary. Copy only our fixed presentation tokens.
  const theme=()=>{
   if(!frame.current||frame.current.contentDocument!==doc)return;
   const host=getComputedStyle(frame.current),root=doc.documentElement;
   for(const name of ['--nubi-font-family','--nubi-reading-size','--nubi-reading-leading','--nubi-text-primary','--nubi-text-secondary','--nubi-text-action','--nubi-text-meta','--nubi-weight-regular','--nubi-weight-emphasis','--deck-type-heading','--deck-type-caption','--deck-line-heading','--deck-control-radius','--deck-blue','--deck-blue-soft','--cx-space-2','--cx-space-3','--cx-space-4'])root.style.setProperty(name,host.getPropertyValue(name));
   root.style.fontSize=getComputedStyle(document.documentElement).fontSize;resize();
  };
  theme();
  const observer=new ResizeObserver(resize);observer.observe(doc.body);
  const tokens=new MutationObserver(theme);tokens.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});
  window.addEventListener('resize',theme);
  const activate=event=>{if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;const link=event.target.closest?.('a[data-mail-href]');if(!link)return;event.preventDefault();window.open(link.dataset.mailHref,'_blank','noopener,noreferrer');};
  const imageError=event=>{if(event.target.tagName!=='IMG')return;const note=doc.createElement('span');note.className='mail-image-missing';note.textContent=event.target.alt||'이미지를 불러오지 못했어요';event.target.replaceWith(note);resize();};
  doc.addEventListener('error',imageError,true);doc.addEventListener('click',activate);doc.addEventListener('keydown',activate);resize();
  cleanup.current=()=>{observer.disconnect();tokens.disconnect();window.removeEventListener('resize',theme);doc.removeEventListener('error',imageError,true);doc.removeEventListener('click',activate);doc.removeEventListener('keydown',activate);};
 }
 return <iframe ref={frame} title={title} className="nubi-mail-html-body" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={srcDoc} onLoad={loaded} style={{height}}/>;
}
export const MailBody=memo(function MailBody({text,query='',presentation,inlineImageCount=0,title='메일 본문'}) {
 if(presentation?.html?.trim())return <HtmlMailBody presentation={presentation} query={query} title={title}/>;
 if(!String(text||'').trim())return <p className="nubi-muted" role="status">{inlineImageCount?'이미지 본문은 원본 메일에서 확인해 주세요.':'텍스트 본문이 없는 메일이에요.'}</p>;
 return <div className="nubi-mail-reader-text">{mailBodyParts(text).map((part,index)=>part.href?
  <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" title={part.href}><MailMatchText text={part.label} query={query}/><Icon name="link" size={14}/></a>:
  <MailMatchText key={index} text={part.text} query={query}/>)}</div>;
});
