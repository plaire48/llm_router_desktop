import {startTransition,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {frameCoalescer} from './frame-coalescer.mjs';
export const CONVERSATION_PAGE_SIZE=40;
const VISIBLE_ROWS=4,ADMISSION_BATCH=4;
// The visible tail paints first. The rest of recent40 is prepended in small
// commits, retaining keys and the reading anchor. Older pages remain40 each.
export function useConversationWindow(id,messages,scroll,questionMessage){
 const initial=Math.max(0,messages.length-CONVERSATION_PAGE_SIZE);
 const questionIndex=questionMessage?messages.indexOf(questionMessage):-1;
 const first=Math.min(Math.max(initial,messages.length-VISIBLE_ROWS),questionIndex>=0?questionIndex:Infinity);
 const [window,setWindow]=useState(()=>({id,start:first,target:initial})),pending=useRef(null),trigger=useRef(null),restored=useRef(Promise.resolve()),painted=useRef(null);
 const current=window.id===id?window:{id,start:first,target:initial};
 const target=Math.min(current.target,initial,questionIndex>=0?questionIndex:Infinity);
 const start=Math.min(current.start,Math.max(initial,messages.length-VISIBLE_ROWS),questionIndex>=0?questionIndex:Infinity);
 const loading=start>target;
 const older=useCallback(()=>{
  if(!start||pending.current||loading)return;
  scroll.onUserScroll();pending.current={id,restore:()=>{}};const next=Math.max(0,start-CONVERSATION_PAGE_SIZE);setWindow({id,start,target:next});
 },[id,start,loading,scroll.onUserScroll]);
 useLayoutEffect(()=>{
  setWindow(current=>current.id!==id||current.start!==start||current.target!==target?{id,start,target}:current);
  const saved=pending.current;pending.current=null;if(saved&&saved.id===id)restored.current=Promise.resolve(saved.restore());
 },[id,start,target]);
 useEffect(()=>{
  if(!loading)return;
  let cancelled=false;
  const admit=()=>{
   pending.current={id,restore:scroll.capturePrepend({preserveMode:true})};
   startTransition(()=>setWindow({id,start:Math.max(target,start-ADMISSION_BATCH),target}));
  };
  // Wait for the previous layout and anchor restoration, not a guessed frame count.
  const nextPaint=frameCoalescer(admit),firstPaint=frameCoalescer(()=>nextPaint.schedule());
  restored.current.then(()=>{if(cancelled)return;if(painted.current!==id){painted.current=id;firstPaint.schedule();}else admit();});
  return()=>{cancelled=true;nextPaint.cancel();firstPaint.cancel();};
 },[id,start,target,loading,scroll.capturePrepend]);
 useEffect(()=>{
  const node=trigger.current,root=scroll.viewport.current;if(loading||!start||!node||!root)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))older();},{root,rootMargin:'100px 0px 0px'});
  observer.observe(node);return()=>observer.disconnect();
 },[id,start,loading,older,scroll.viewport]);
 return {start,older,trigger,loading};
}
