import React,{useCallback,useLayoutEffect,useRef} from 'react';
import {DetailPanel} from '@e2e/cx-design-system';

// Positioned picker content uses the very same CX focus/inert stack as full
// dialogs. Never acquire a second background lock in an anchored menu.
export function AnchoredDialog({dialogRef,id,title,className='',style,initialFocus,onClose,busy=false,provider,children}){
 const waitingForPosition=useRef(false);
 const attach=useCallback(node=>{dialogRef.current=node?.closest('[aria-modal="true"]')||null;},[dialogRef]);
 useLayoutEffect(()=>{
  const panel=dialogRef.current;if(!panel)return;
  panel.style.position='fixed';panel.style.margin='0';
  if(id)panel.id=id;
  if(provider)panel.dataset.provider=provider;
  for(const [key,value] of Object.entries(style||{}))panel.style[key]=typeof value==='number'&&key!=='zIndex'?`${value}px`:value;
  if(style?.visibility==='hidden')waitingForPosition.current=true;
  else if(waitingForPosition.current&&!panel.closest('[inert]')){
   // CX's initial focus may run during the first hidden measurement. Complete
   // that one initial focus when positioning reveals the picker.
   waitingForPosition.current=false;
   if(!panel.contains(document.activeElement))panel.querySelector(initialFocus)?.focus({preventScroll:true});
  }
 },[dialogRef,id,style,provider,initialFocus]);
 return <DetailPanel title={title} variant="modal" className={`deck-dialog nubi-anchored-dialog ${className}`} initialFocus={initialFocus} onClose={onClose} busy={busy} hideHelp>
  <div ref={attach} className="nubi-anchored-content">{children}</div>
 </DetailPanel>;
}
