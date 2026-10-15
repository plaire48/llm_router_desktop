import React,{useEffect,useRef,useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import './mail-image-thumbs.css';

function ImageThumb({source,api,onOpen}){
  const root=useRef(null),[src,setSrc]=useState(null),[failed,setFailed]=useState(false),[expanded,setExpanded]=useState(false);
  const label=source.filename||'첨부 이미지';
  useEffect(()=>{
    let live=true,started=false;
    const load=()=>{if(started)return;started=true;void api('mailDocument',{action:'previewImage',id:source.id,attachmentId:source.attachmentId,expectedSourceHash:source.sourceHash,expectedAttachmentHash:source.attachmentHash}).then(value=>{if(live){if(/^data:image\/(png|jpeg|gif|webp);base64,/.test(value.image||''))setSrc(value.image);else setFailed(true);}}).catch(()=>{if(live)setFailed(true);});};
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){load();observer.disconnect();}},{rootMargin:'80px'});
    observer.observe(root.current);return()=>{live=false;observer.disconnect();};
  },[api,source.id,source.attachmentId,source.sourceHash,source.attachmentHash]);
  return <figure ref={root} className="nubi-mail-image-thumb" data-expanded={expanded||undefined}>
    <button type="button" onClick={()=>failed?onOpen?.(source):setExpanded(value=>!value)} aria-label={failed?`${label} 원문 확인`:`${label} ${expanded?'접기':'크게 보기'}`} aria-expanded={expanded} disabled={!src&&!failed} title={label}>
      {src?<img src={src} alt={label} loading="lazy" decoding="async"/>:failed?<span><Icon name="image" size={20}/>원문 확인</span>:<span className="status-spinner" aria-label="이미지 불러오는 중"/>}
    </button>
    <figcaption title={label}>{label}</figcaption>
  </figure>;
}
export function MailImageThumbs({message,api,onOpen}){
  const [limit,setLimit]=useState(4),seen=new Set();
  const sources=[...(message.sourceReferences||[]),...(message.consultedSources||[])].filter(source=>{
    if(source.kind!=='mail'||!source.attachmentId||!source.attachmentHash||source.preview!=='image'&&!/\.(png|jpe?g|gif|webp)$/i.test(source.filename||''))return false;
    const key=source.id+':'+source.attachmentId+':'+source.attachmentHash;if(seen.has(key))return false;seen.add(key);return true;
  });
  if(!sources.length)return null;
  return <div className="nubi-mail-image-thumbs" aria-label="확인한 첨부 이미지">{sources.slice(0,limit).map(source=><ImageThumb key={`${source.id}:${source.attachmentId}:${source.sourceHash}:${source.attachmentHash}`} source={source} api={api} onOpen={onOpen}/>)}{sources.length>limit&&<button type="button" className="nubi-mail-image-more" onClick={()=>setLimit(value=>value+4)}><Icon name="plus" size={16}/>이미지 더 보기</button>}</div>;
}
