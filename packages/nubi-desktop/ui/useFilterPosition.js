import {useLayoutEffect,useState} from 'react';

// Scroll events inside a list must not rerender the entire filter. Batch geometry
// reads once per frame and keep the same state object when the anchor is stable.
export function useFilterPosition(open,trigger,popup,{width=300,align='end',focusPopup=false,onOutside}={}){
 const [position,setPosition]=useState({top:0,left:0});
 useLayoutEffect(()=>{
  if(!open)return;
  let frame=0;
  const place=()=>{
   frame=0;if(!trigger.current||!popup.current)return;
   const box=trigger.current.getBoundingClientRect(),height=popup.current.offsetHeight,measuredWidth=align==='start'?popup.current.offsetWidth:width,edge=align==='start'?8:12;
   const top=box.bottom+height+8<=innerHeight?box.bottom+8:box.top-height-8;
   const next={left:Math.max(edge,Math.min(align==='start'?box.left:box.right-measuredWidth,innerWidth-measuredWidth-edge)),top:Math.max(12,Math.min(top,innerHeight-height-12))};
   setPosition(current=>current.left===next.left&&current.top===next.top?current:next);
  };
  const schedule=event=>{if(event?.type==='scroll'&&popup.current?.contains(event.target))return;if(!frame)frame=requestAnimationFrame(place);};
  const outside=event=>{if(!popup.current?.contains(event.target)&&!trigger.current?.contains(event.target))onOutside?.();};
  const observer=new ResizeObserver(schedule);if(popup.current)observer.observe(popup.current);
  place();(focusPopup?popup.current:popup.current?.querySelector('input')||popup.current?.querySelector('button'))?.focus({preventScroll:true});
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);};
 },[open,width,align,focusPopup,trigger,popup]);
 return position;
}
