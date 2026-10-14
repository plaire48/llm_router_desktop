import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ActionButton} from './ActionButton';
import {Icon} from './Icon';
import './upload-button.css';

// Browsers expose separate native file and directory pickers behind one entry point.
export function UploadButton({disabled,onSelect,folderLabel='폴더 선택',fileLabel='파일 선택',describedBy}){
  const id=useId(),trigger=useRef(null),menu=useRef(null),folder=useRef(null),files=useRef(null),focusPending=useRef(false);
  const [open,setOpen]=useState(false),[position,setPosition]=useState(null);
  const close=(restore=true)=>{setOpen(false);if(restore)trigger.current?.focus({preventScroll:true});};
  useEffect(()=>{if(disabled)close(false);},[disabled]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const box=trigger.current.getBoundingClientRect(),viewport=window.visualViewport;
      const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
      const w=Math.min(200,width-16),h=menu.current?.offsetHeight||100;
      setPosition({width:w,left:Math.max(left+8,Math.min(box.left,left+width-w-8)),top:Math.max(top+8,Math.min(box.bottom+4,top+height-h-8))});
    };
    const outside=event=>{if(!menu.current?.contains(event.target)&&!trigger.current?.contains(event.target))close(false);};
    focusPending.current=true;place();
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);window.addEventListener('resize',place);document.addEventListener('scroll',place,true);window.visualViewport?.addEventListener('resize',place);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);window.visualViewport?.removeEventListener('resize',place);};
  },[open]);
  useLayoutEffect(()=>{if(open&&position&&focusPending.current){menu.current?.querySelector('[role=menuitem]')?.focus({preventScroll:true});focusPending.current=false;}},[open,position]);
  const choose=input=>{if(disabled)return;close();input.current.click();};
  const selected=event=>{const selection=Array.from(event.target.files||[]);event.target.value='';if(!disabled&&selection.length)onSelect(selection);};
  const keys=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key==='Tab'){close();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();const choices=[...menu.current.querySelectorAll('[role=menuitem]')],index=choices.indexOf(document.activeElement);
    choices[event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length]?.focus();
  };
  return <>
    <ActionButton ref={trigger} action="upload" label="업로드" iconOnly={false} disabled={disabled} aria-describedby={describedBy} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>open?close():setOpen(true)} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setOpen(true);}}}/>
    <input ref={folder} hidden type="file" webkitdirectory="" multiple aria-label={folderLabel} disabled={disabled} onChange={selected}/>
    <input ref={files} hidden type="file" multiple aria-label={fileLabel} disabled={disabled} onChange={selected}/>
    {open&&createPortal(<div ref={menu} id={id} role="menu" aria-label="업로드 선택" className="cx-upload-menu" style={position||{visibility:'hidden'}} onKeyDown={keys}>
      <button type="button" role="menuitem" disabled={disabled} onClick={()=>choose(folder)}><Icon name="folder" size={18}/>폴더</button>
      <button type="button" role="menuitem" disabled={disabled} onClick={()=>choose(files)}><Icon name="file" size={18}/>ZIP 또는 파일</button>
    </div>,trigger.current?.closest('[role=dialog]')||document.body)}
  </>;
}
