import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
export const CONVERSATION_PAGE_SIZE=40;
// Render recent messages first. Stored history/search are unchanged, and older
// rows are prepended in bounded batches without removing already loaded rows.
export function useConversationWindow(id,messages,scroll,questionMessage){
 const initial=Math.max(0,messages.length-CONVERSATION_PAGE_SIZE);
 const [window,setWindow]=useState(()=>({id,start:initial})),pending=useRef(null),trigger=useRef(null);
 const questionIndex=questionMessage?messages.indexOf(questionMessage):-1;
 const start=Math.min(window.id===id?window.start:initial,initial,questionIndex>=0?questionIndex:Infinity);
 const older=useCallback(()=>{
  if(!start||pending.current)return;
  pending.current={id,restore:scroll.capturePrepend()};setWindow({id,start:Math.max(0,start-CONVERSATION_PAGE_SIZE)});
 },[id,start,scroll.capturePrepend]);
 useLayoutEffect(()=>{setWindow(current=>current.id!==id||current.start>start?{id,start}:current);const saved=pending.current;pending.current=null;if(saved&&saved.id===id)saved.restore();},[id,start]);
 useEffect(()=>{
  const node=trigger.current,root=scroll.viewport.current;if(!start||!node||!root)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))older();},{root,rootMargin:'100px 0px 0px'});
  observer.observe(node);return()=>observer.disconnect();
 },[id,start,older,scroll.viewport]);
 return {start,older,trigger};
}
