import {useCallback,useLayoutEffect,useRef,useState} from 'react';

// A newly sent turn follows the bottom as progress and the answer grow beneath it (user decision 2026-10-14:
// the request must not jump to the top). `followNewTurn` keeps the pinned mode for callers that want it.
// Reading older content never resumes following just because a queue changes.
export function useConversationScroll(conversationId) {
  const viewport=useRef(null),content=useRef(null),mode=useRef('latest'),anchor=useRef(null),beforeSend=useRef(null),programmatic=useRef(null),frame=useRef(null);
  const [away,setAway]=useState(false);
  const position=useCallback(()=>{
    const list=viewport.current,body=content.current;if(!list||!body)return;
    const users=[...body.querySelectorAll('.message-user')];
    if(mode.current==='turn'){
      const key=anchor.current?.key;
      const current=key?users.find(node=>node.dataset.messageKey===key):users.at(-1);
      if(current&&(anchor.current||current!==beforeSend.current)){
        anchor.current={key:current.dataset.messageKey};
        const top=current.getBoundingClientRect().top-body.getBoundingClientRect().top;
        const padding=parseFloat(body.style.paddingBottom)||0,natural=body.scrollHeight-padding;
        const tail=Math.max(0,list.clientHeight-24-(natural-top));
        if(Math.abs(padding-tail)>1)body.style.paddingBottom=tail+'px';
        list.scrollTop=Math.max(0,top-24);programmatic.current=list.scrollTop;
      }
    }else if(mode.current==='latest'){
      body.style.paddingBottom='0px';list.scrollTop=list.scrollHeight;programmatic.current=list.scrollTop;
    }
    setAway(list.scrollHeight-list.scrollTop-list.clientHeight>24);
  },[]);
  const followLatest=useCallback(()=>{mode.current='latest';anchor.current=null;position();},[position]);
  const followNewTurn=useCallback(()=>{
    mode.current='turn';anchor.current=null;beforeSend.current=[...(content.current?.querySelectorAll('.message-user')||[])].at(-1);
    cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(position);
  },[position]);
  useLayoutEffect(()=>{
    const list=viewport.current,body=content.current;if(!list||!body)return;
    mode.current='latest';anchor.current=null;position();
    const observer=new ResizeObserver(position);observer.observe(list);observer.observe(body);
    const changes=new MutationObserver(()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(position);});
    changes.observe(body,{childList:true,subtree:true});
    return()=>{observer.disconnect();changes.disconnect();cancelAnimationFrame(frame.current);};
  },[conversationId,position]);
  const onUserScroll=()=>{mode.current='reading';anchor.current=null;};
  const onScroll=event=>{
    const list=event.currentTarget;
    if(programmatic.current!==null&&Math.abs(list.scrollTop-programmatic.current)<2){programmatic.current=null;return;}
    if(mode.current!=='turn')mode.current=list.scrollHeight-list.scrollTop-list.clientHeight<=24?'latest':'reading';
    setAway(list.scrollHeight-list.scrollTop-list.clientHeight>24);
  };
  const onFocusCapture=event=>{if(event.target.matches('input,textarea,[data-decision-id]')||event.target.closest('[data-decision-id]'))onUserScroll();};
  return {viewport,content,away,followLatest,followNewTurn,onScroll,onFocusCapture,onUserScroll};
}
