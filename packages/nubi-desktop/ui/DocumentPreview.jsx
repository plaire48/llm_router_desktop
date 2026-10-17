import {CollectionTable} from './CollectionTable.jsx';
import React,{lazy,Suspense,useMemo,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {MailBody} from './MailBody.jsx';
import {MimeMailPreview} from './MimeMailPreview.jsx';
import {documentWindow} from '../runtime/document-window.mjs';
import {marked} from 'marked';
import './document-preview.css';
const PdfPreview=lazy(()=>import('./PdfPreview.jsx'));
export function RenderedFile({name='',text='',html}){
 const presentation=useMemo(()=>({html:html??(/\.md$/i.test(name)?marked.parse(text,{async:false}):text)}),[name,text,html]);
 return <div className="nubi-document-preview"><MailBody text={text} presentation={presentation} title={name||"문서 미리보기"}/></div>;
}
export function DocumentPreview({document,onRange,onDownloadAttachment,mailActions,onAsk,pdfDraft,onDirty,onSession}){
 const [source,setSource]=useState(false),[loading,setLoading]=useState(false);
 async function move(offset){if(loading)return;setLoading(true);try{await onRange(offset);}finally{setLoading(false);}}
 const rangeControl=document.partial&&(!document.pdf||source)&&<nav aria-label="문서 읽기 범위"><CxButton disabled={loading||!document.offset} aria-label="이전 범위" onClick={()=>move(Math.max(0,document.offset-60000))}><Icon name="chevronLeft" size={16}/></CxButton><span>{document.mailMessage?'본문 ':''}{Math.floor((document.offset||0)/60000)+1} / {Math.ceil(document.totalCharacters/60000)}</span><CxButton disabled={loading||document.nextOffset===null} aria-label="다음 범위" onClick={()=>move(document.nextOffset)}><Icon name="chevronRight" size={16}/></CxButton></nav>;
 if(document.mailMessage)return <section className="nubi-document-view" aria-label="문서 내용"><MimeMailPreview document={document} onDownloadAttachment={onDownloadAttachment} actions={mailActions} source={source} onToggleSource={()=>setSource(value=>!value)} rangeControl={rangeControl}/></section>;
 return <section className="nubi-document-view" aria-label="문서 내용">
  <div className="nubi-document-view-tools">
   <CxButton aria-label={source?'문서 보기':'추출 텍스트 보기'} title={source?'문서 보기':'추출 텍스트 보기'} aria-pressed={source} onClick={()=>setSource(v=>!v)}><Icon name={source?'eye':'code'} size={16}/></CxButton>
   {rangeControl}
  </div>
  {source&&<pre className="nubi-document-source">{document.text}</pre>}{document.pdf?<div hidden={source}><Suspense fallback={<span className="status-spinner" aria-label="PDF 여는 중"/>}><PdfPreview onSession={onSession} data={document.pdf} onAsk={onAsk} filename={document.filename||document.title} pdfDraft={pdfDraft} onDirty={onDirty} initialPage={document.citationLocation?.page||1}/></Suspense></div>:source?null:document.html?<RenderedFile text={document.text} html={document.html}/>:<article className="nubi-document-reading">{document.segments?.length?document.segments.map((segment,index)=><section key={index}>{(segment.page||segment.slide||segment.sheet)&&<h3>{segment.page?`${segment.page}쪽`:segment.slide?`슬라이드 ${segment.slide}`:segment.sheet}</h3>}{segment.sheet?<div className="nubi-document-table"><CollectionTable variant="reading"><tbody>{segment.text.split('\n').map((row,i)=>{try{const values=JSON.parse(row);return <tr key={i}>{values.slice(1).map((value,j)=><td key={j}>{typeof value==='object'?JSON.stringify(value):String(value??'')}</td>)}</tr>;}catch{return <tr key={i}><td>{row}</td></tr>;}})}</tbody></CollectionTable></div>:<div>{segment.text}</div>}</section>):document.text}</article>}
 </section>;
}

export function FileDocumentPreview({document,onAsk,onDirty,onSession}){
 const draft=useMemo(()=>document.pdfDraft||(document.pdfDraft={values:{},savedValues:{}}),[document]);
 const [offset,setOffset]=useState(0),range=useMemo(()=>documentWindow(document,{offset}),[document,offset]);
 return <DocumentPreview document={range} onRange={setOffset} onAsk={onAsk} pdfDraft={draft} onDirty={onDirty} onSession={onSession}/>;
}
