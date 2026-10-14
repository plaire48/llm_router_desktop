import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

// Drag a rectangle over the Workspace window to capture that part of it (user request 2026-10-14: capture something
// in Nubi itself and talk about it). A click without a drag takes the whole window; Escape or a right click cancels.
// Coordinates are CSS pixels of the viewport; the caller scales them to the window capture.
const MIN=8;
export function CaptureOverlay({onSelect,onCancel,preview=null}){
  const [rect,setRect]=useState(null),start=useRef(null);
  useEffect(()=>{
    const key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel();}};
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[onCancel]);
  const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight});
  useEffect(()=>{const resized=()=>{start.current=null;setRect(null);setViewport({width:window.innerWidth,height:window.innerHeight});};window.addEventListener('resize',resized);return()=>window.removeEventListener('resize',resized);},[]);
  const scale=preview?Math.min((viewport.width-48)/preview.width,(viewport.height-104)/preview.height,1):1;
  const bounds=preview?{x:(viewport.width-preview.width*scale)/2,y:64,width:preview.width*scale,height:preview.height*scale}:{x:0,y:0,width:viewport.width,height:viewport.height};
  const point=event=>({x:Math.max(bounds.x,Math.min(bounds.x+bounds.width,event.clientX)),y:Math.max(bounds.y,Math.min(bounds.y+bounds.height,event.clientY))});
  const box=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});
  return createPortal(<div className="nubi-capture-overlay" role="dialog" aria-label="캡처할 영역 선택" data-dragging={!!rect||undefined}
    onContextMenu={event=>{event.preventDefault();onCancel();}}
    onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);start.current=point(event);setRect(box(start.current,start.current));}}
    onPointerMove={event=>{if(start.current)setRect(box(start.current,point(event)));}}
    onPointerUp={event=>{
      if(!start.current)return;const area=box(start.current,point(event));start.current=null;setRect(null);
      const chosen=area.width>=MIN&&area.height>=MIN?area:bounds;
      onSelect(preview?{x:(chosen.x-bounds.x)/scale,y:(chosen.y-bounds.y)/scale,width:chosen.width/scale,height:chosen.height/scale,imagePixels:true}:chosen);
    }}>
    {preview&&<img src={'data:image/png;base64,'+preview.image} alt="캡처할 웹페이지" draggable={false} style={{position:'absolute',left:bounds.x,top:bounds.y,width:bounds.width,height:bounds.height,pointerEvents:'none',borderRadius:8}}/>}
    <p className="nubi-capture-hint">{rect?`${Math.round(rect.width/scale)} × ${Math.round(rect.height/scale)}`:(preview?'끌어서 영역 선택. 클릭하면 웹페이지 전체, Esc는 취소':'끌어서 영역 선택. 클릭하면 창 전체, Esc는 취소')}</p>
    {rect&&<div className="nubi-capture-rect" style={{left:rect.x,top:rect.y,width:rect.width,height:rect.height}}/>}
  </div>,document.body);
}
