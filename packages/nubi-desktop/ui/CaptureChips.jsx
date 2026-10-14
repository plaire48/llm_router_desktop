import React,{useEffect,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';

// Screenshots attached to a message (user request 2026-10-14). A draft chip holds its own image; a sent message keeps
// only the id, and the thumbnail comes from the host record through the reader the Workbench configures once.
let reader=null;const cache=new Map();
export function configureCaptureReader(api){reader=api;}
async function loadCapture(id){
  if(!cache.has(id))cache.set(id,(reader?reader('capture',{id}):Promise.reject(Error('capture_missing'))).then(record=>'data:image/png;base64,'+record.image).catch(()=>null));
  return cache.get(id);
}
function Thumb({src,width,height,label,onRemove,children}){
  const [open,setOpen]=useState(false);
  return <span className="nubi-capture-chip" data-open={open||undefined}>
    <button type="button" className="nubi-capture-thumb" aria-label={open?`${label} 접기`:`${label} 크게 보기`} aria-expanded={open} onClick={()=>setOpen(!open)}>
      {src?<img src={src} alt={label} width={width} height={height} draggable="false"/>:<span className="nubi-capture-missing"><Icon name="image" size={16}/>읽지 못한 캡처</span>}
    </button>
    {children}
    {onRemove&&<CxButton type="button" className="nubi-icon-button nubi-capture-remove" data-icon-only aria-label={`${label} 빼기`} title="첨부 빼기" onClick={onRemove}><Icon name="xClose" size={14}/></CxButton>}
  </span>;
}
// Drafts and pending echoes: the image is local.
export function CaptureChips({captures=[],onRemove}){
  if(!captures.length)return null;
  return <div className="nubi-capture-chips" aria-label="첨부한 화면 캡처">{captures.map((item,index)=><Thumb key={item.id} src={item.dataUrl} width={item.width} height={item.height} label={`화면 캡처 ${index+1}`} onRemove={onRemove?()=>onRemove(item.id):undefined}/>)}</div>;
}
function StoredThumb({item,label}){
  const [src,setSrc]=useState(null);
  useEffect(()=>{let live=true;loadCapture(item.id).then(value=>{if(live)setSrc(value);});return()=>{live=false;};},[item.id]);
  return <Thumb src={src} width={item.width} height={item.height} label={label}/>;
}
// Sent messages: ids only, read from the host.
export function CaptureThumbs({captures=[]}){
  if(!captures?.length)return null;
  return <div className="nubi-capture-chips" aria-label="첨부한 화면 캡처">{captures.map((item,index)=><StoredThumb key={item.id} item={item} label={`화면 캡처 ${index+1}`}/>)}</div>;
}
