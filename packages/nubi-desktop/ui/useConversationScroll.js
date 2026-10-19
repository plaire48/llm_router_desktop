import {frameCoalescer} from './frame-coalescer.mjs';
import {firstVisibleMessage} from './scroll-anchor.mjs';
import {useCallback,useLayoutEffect,useRef,useState} from 'react';

// A newly sent turn follows the bottom as progress and the answer grow beneath it (user decision 2026-10-14:
// the request must not jump to the top). `followNewTurn` keeps the pinned mode for callers that want it.
// Reading older content never resumes following just because a queue changes.
export function useConversationScroll(conversationId) {
  const viewport=useRef(null),content=useRef(null),mode=useRef('latest'),anchor=useRef(null),beforeSend=useRef(null),programmatic=useRef(null),prepend=useRef(null),dimensions=useRef(null),remeasure=useRef(null),scrollFrame=useRef(null),scrolled=useRef(null);
  const [away,setAway]=useState(false);
  const position=useCallback(()=>{
    const list=viewport.current,body=content.current;if(!list||!body||prepend.current||!dimensions.current)return;
    const {height,visible}=dimensions.current;
    if(mode.current==='turn'){
      const users=[...body.querySelectorAll('.message-user')];
      const key=anchor.current?.key;
      const current=key?users.find(node=>node.dataset.messageKey===key):users.at(-1);
      if(current&&(anchor.current||current!==beforeSend.current)){
        anchor.current={key:current.dataset.messageKey};
        const top=current.getBoundingClientRect().top-body.getBoundingClientRect().top;
        const padding=parseFloat(body.style.paddingBottom)||0,natural=height-padding;
        const tail=Math.max(0,visible-24-(natural-top));
        if(Math.abs(padding-tail)>1)body.style.paddingBottom=tail+'px';
        list.scrollTop=Math.max(0,top-24);programmatic.current=list.scrollTop;
      }
    }else if(mode.current==='latest'){
      if(body.style.paddingBottom!=='0px')body.style.paddingBottom='0px';list.scrollTop=height;programmatic.current=list.scrollTop;
    }
    setAway(height-list.scrollTop-visible>24);
  },[]);
  const capturePrepend=useCallback(({preserveMode=false}={})=>{
    const list=viewport.current,body=content.current;if(!list||!body)return()=>{};
    const following=preserveMode&&mode.current==='latest';
    const top=following?0:list.getBoundingClientRect().top;
    const node=following?null:firstVisibleMessage(body.querySelectorAll('.nubi-message'),top);
    const before=node?.getBoundingClientRect().top,height=dimensions.current?.height??list.scrollHeight;
    if(!preserveMode){mode.current='reading';anchor.current=null;}
    return()=>new Promise(finish=>{prepend.current={finish,apply:()=>{if(viewport.current!==list||following)return;list.scrollTop+=node?.isConnected?node.getBoundingClientRect().top-before:(dimensions.current?.height??height)-height;programmatic.current=list.scrollTop;setAway((dimensions.current?.height??height)-list.scrollTop-(dimensions.current?.visible??0)>24);}};remeasure.current?.();});
  },[]);
  const followLatest=useCallback(()=>{mode.current='latest';anchor.current=null;position();},[position]);
  const followNewTurn=useCallback(()=>{
    mode.current='turn';anchor.current=null;beforeSend.current=[...(content.current?.querySelectorAll('.message-user')||[])].at(-1);
    remeasure.current?.();
  },[position]);
  useLayoutEffect(()=>{
    const list=viewport.current,body=content.current;if(!list||!body)return;
    mode.current='latest';anchor.current=null;body.style.paddingBottom='0px';
    // Read the retained anchor after layout, before paint. Reading its rectangle
    // in React's layout effect forces layout of all newly prepended Markdown.
    const observer=new ResizeObserver(()=>{
      const previous=dimensions.current,size={height:list.scrollHeight,visible:list.clientHeight};dimensions.current=size;
      const fromScroll=scrolled.current===list;let top;
      if(fromScroll){scrolled.current=null;top=list.scrollTop;
        if(programmatic.current!==null&&Math.abs(top-programmatic.current)<2)programmatic.current=null;
        else if(mode.current!=='turn')mode.current=size.height-top-size.visible<=24?'latest':'reading';
      }
      const restore=prepend.current;prepend.current=null;restore?.apply();
      if(restore||!fromScroll||previous?.height!==size.height||previous?.visible!==size.visible)position();
      else setAway(size.height-top-size.visible>24);
      restore?.finish();
    });observer.observe(list);observer.observe(body);
    remeasure.current=()=>{observer.unobserve(body);observer.observe(body);};
    return()=>{scrollFrame.current?.cancel();scrolled.current=null;prepend.current?.finish();prepend.current=null;dimensions.current=null;remeasure.current=null;observer.disconnect();};
  },[conversationId,position]);
  const onUserScroll=useCallback(()=>{mode.current='reading';anchor.current=null;},[]);
  const onScroll=event=>{
    if(!scrollFrame.current)scrollFrame.current=frameCoalescer(list=>{
      if(viewport.current!==list)return;
      scrolled.current=list;remeasure.current?.();
    });
    scrollFrame.current.schedule(event.currentTarget);
  };
  const onFocusCapture=event=>{if(event.target.matches('input,textarea,[data-decision-id]')||event.target.closest('[data-decision-id]'))onUserScroll();};
  return {viewport,content,away,capturePrepend,followLatest,followNewTurn,onScroll,onFocusCapture,onUserScroll};
}
