import React,{useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {UserIdentity} from './UserIdentity';

export function MentionMenu({items,activeIndex=0,onSelect,anchorRect,anchorElement,id,loading=false}) {
 const menu=useRef(null),[position,setPosition]=useState(null);
 useLayoutEffect(()=>{
  const place=()=>{
   const rect=anchorRect?.()||anchorElement?.getBoundingClientRect();if(!rect)return;
   const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,w=viewport?.width||innerWidth,h=viewport?.height||innerHeight;
   const width=Math.min(320,w-16),below=top+h-rect.bottom-8,above=rect.top-top-8,needed=Math.min(240,menu.current.scrollHeight+2),aboveComposer=anchorElement?.closest('.talk-comment-form')&&above>=needed,down=!aboveComposer&&(below>=needed||below>=above);
   const height=Math.max(32,Math.min(240,down?below:above)),x=Math.max(left+8,Math.min(rect.left,left+w-width-8));
   setPosition({left:x,width,maxHeight:height,...(down?{top:Math.max(top+8,rect.bottom+4)}:{top:Math.max(top+8,rect.top-Math.min(needed,height)-4)})});
  };
  place();const observer=new ResizeObserver(place);observer.observe(menu.current);window.addEventListener('resize',place);document.addEventListener('scroll',place,true);window.visualViewport?.addEventListener('resize',place);
  return()=>{observer.disconnect();window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);window.visualViewport?.removeEventListener('resize',place);};
 },[anchorRect,anchorElement,items,loading]);
 useLayoutEffect(()=>{menu.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});},[activeIndex]);
 return createPortal(<div ref={menu} id={id} className="cx-mention-menu talk-mention-menu" role="listbox" aria-label="언급할 사용자" style={position||{visibility:'hidden'}}>{loading?<p role="status">사용자를 찾는 중…</p>:items.length?items.map((user,index)=><button id={`${id}-${index}`} type="button" tabIndex={-1} key={user.login} role="option" aria-selected={activeIndex===index} onMouseDown={e=>e.preventDefault()} onClick={()=>onSelect(user)}><UserIdentity user={user}/></button>):<p>일치하는 사용자가 없습니다.</p>}</div>,anchorElement?.closest('[aria-modal=true]')||document.body);
}
