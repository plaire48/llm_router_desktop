import {useCallback,useEffect,useRef,useState} from 'react';
import {useProgressiveList} from './useProgressiveList.js';
export const CONVERSATION_PAGE_SIZE=40;
const VISIBLE_ROWS=4;
export function useConversationWindow(id,messages,scroll,questionMessage){
 const initial=Math.max(0,messages.length-CONVERSATION_PAGE_SIZE);
 const questionIndex=questionMessage?messages.indexOf(questionMessage):-1;
 const first=Math.min(Math.max(initial,messages.length-VISIBLE_ROWS),questionIndex>=0?questionIndex:Infinity);
 const [window,setWindow]=useState(()=>({id,target:initial})),trigger=useRef(null);
 const target=Math.min(window.id===id?window.target:initial,initial,questionIndex>=0?questionIndex:Infinity);
 const {indices,loading}=useProgressiveList({id,start:target,end:messages.length,firstStart:first,firstEnd:messages.length,batchSize:4,direction:'backward',beforeBatch:()=>scroll.capturePrepend({preserveMode:true})});
 const start=indices.size?Math.min(...indices):messages.length;
 const older=useCallback(()=>{
  if(!start||loading)return;
  scroll.onUserScroll();setWindow({id,target:Math.max(0,start-CONVERSATION_PAGE_SIZE)});
 },[id,start,loading,scroll.onUserScroll]);
 useEffect(()=>{
  const node=trigger.current,root=scroll.viewport.current;if(loading||!start||!node||!root)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))older();},{root,rootMargin:'100px 0px 0px'});
  observer.observe(node);return()=>observer.disconnect();
 },[id,start,loading,older,scroll.viewport]);
 return {start,older,trigger,loading};
}
