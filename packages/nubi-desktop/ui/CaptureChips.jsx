import React,{useEffect,useRef,useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {createCaptureCache} from './capture-cache.mjs';
import './capture-thumbs.css';

// State snapshots contain references only; image bytes are fetched on visibility.
const cache=createCaptureCache();
export function configureCaptureReader(api){cache.configure(api);}
function Thumb({src,width,height,label,region,pending=false,onRemove,onRetry,onImageError}){
  const [open,setOpen]=useState(false);
  return <span className="nubi-capture-chip">
    <button type="button" className="nubi-capture-thumb" aria-label={`${label} ${src?'크게 보기':pending?'불러오는 중':'다시 불러오기'}`} title={src?label:'다시 불러오기'} aria-haspopup={src?'dialog':undefined} disabled={!src&&(pending||!onRetry)} onClick={()=>src?setOpen(true):onRetry?.()}>
      {src?<img src={src} alt={label} width={width} height={height} draggable="false" decoding="async" onError={()=>{setOpen(false);onImageError?.();}}/>:<span className="nubi-capture-missing">{pending?<span className="status-spinner" aria-label="캡처 불러오는 중"/>:<><Icon name="refresh" size={16}/>캡처 확인 불가</>}</span>}
    </button>
    <span className="nubi-capture-caption" title={label}><Icon name="image" size={16}/><span>{label}</span></span>
    {onRemove&&<WorkspaceAction action="close" label={`${label} 빼기`} title="첨부 빼기" className="nubi-capture-remove" onClick={onRemove}/>}
    {open&&src&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide nubi-capture-preview" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon"><Icon name="image" size={18}/></span><span title={label}>{label}</span></span>} variant="modal" hideHelp onClose={()=>setOpen(false)}>
      <img src={src} alt={label} width={width} height={height}/><p className="nubi-muted">{width} × {height}{region?' 선택 영역':''}</p>
    </DetailPanel>}
  </span>;
}
export function CaptureChips({captures=[],onRemove}){
  if(!captures.length)return null;
  return <div className="nubi-capture-chips" aria-label="첨부한 화면 캡처">{captures.map((item,index)=><Thumb key={item.id} src={item.dataUrl} width={item.width} height={item.height} label={item.label||`화면 캡처 ${index+1}`} onRemove={onRemove?()=>onRemove(item.id):undefined}/>)}</div>;
}
function StoredThumb({item,label}){
  const root=useRef(null),[src,setSrc]=useState(null),[pending,setPending]=useState(true),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let live=true,started=false;setSrc(null);setPending(true);
    const load=()=>{if(started)return;started=true;void cache.load(item.id).then(value=>{if(live){setSrc(value);setPending(false);}});};
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){load();observer.disconnect();}},{rootMargin:'80px'});
    observer.observe(root.current);return()=>{live=false;observer.disconnect();};
  },[item.id,attempt]);
  return <span ref={root} className="nubi-stored-capture"><Thumb src={src} pending={pending} width={item.width} height={item.height} label={label} region={item.region} onImageError={()=>{cache.invalidate(item.id);setSrc(null);setPending(false);}} onRetry={()=>{cache.invalidate(item.id);setSrc(null);setPending(true);setAttempt(value=>value+1);}}/></span>;
}
export function CaptureThumbs({captures=[],label='첨부한 화면 캡처'}){
  const [limit,setLimit]=useState(4),[expanded,setExpanded]=useState(false);
  if(!captures?.length)return null;
  return <details className="nubi-process-fold nubi-command-record nubi-capture-record" onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary><Icon name="image" size={16}/><strong title={label}>{label}</strong><Icon name="chevronDown" size={14}/></summary>
    {expanded&&<div className="nubi-capture-chips" aria-label={label}>{captures.slice(0,limit).map((item,index)=><StoredThumb key={item.id} item={item} label={item.label||`화면 캡처 ${index+1}`}/>)}{captures.length>limit&&<CxButton onClick={()=>setLimit(value=>value+4)}><Icon name="plus" size={16}/>더 보기</CxButton>}</div>}
  </details>;
}
