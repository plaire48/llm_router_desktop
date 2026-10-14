import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

// Drag a rectangle over the Workspace window to capture that part of it (user request 2026-10-14: capture something
// in Nubi itself and talk about it). A click without a drag takes the whole window; Escape or a right click cancels.
// Coordinates are CSS pixels of the viewport; the caller scales them to the window capture.
const MIN=8;
export function CaptureOverlay({onSelect,onCancel}){
  const [rect,setRect]=useState(null),start=useRef(null);
  useEffect(()=>{
    const key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel();}};
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[onCancel]);
  const box=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});
  return createPortal(<div className="nubi-capture-overlay" role="dialog" aria-label="캡처할 영역 선택" data-dragging={!!rect||undefined}
    onContextMenu={event=>{event.preventDefault();onCancel();}}
    onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);start.current={x:event.clientX,y:event.clientY};setRect(box(start.current,start.current));}}
    onPointerMove={event=>{if(start.current)setRect(box(start.current,{x:event.clientX,y:event.clientY}));}}
    onPointerUp={event=>{
      if(!start.current)return;const area=box(start.current,{x:event.clientX,y:event.clientY});start.current=null;setRect(null);
      onSelect(area.width>=MIN&&area.height>=MIN?area:{x:0,y:0,width:window.innerWidth,height:window.innerHeight});
    }}>
    <p className="nubi-capture-hint">{rect?`${Math.round(rect.width)} × ${Math.round(rect.height)}`:'끌어서 영역을 고르세요. 클릭하면 창 전체, Esc는 취소'}</p>
    {rect&&<div className="nubi-capture-rect" style={{left:rect.x,top:rect.y,width:rect.width,height:rect.height}}/>}
  </div>,document.body);
}
