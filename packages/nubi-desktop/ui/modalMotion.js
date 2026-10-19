import {useEffect} from 'react';
import {installMotionPresence} from '../../../extensions/aipro-chat/src/motion-presence.mjs';
import {installModalResizeMotion} from './modalResizeMotion.js';
import {installMotionPolicy,motionDuration} from './motion-policy.mjs';

// iOS-like dialog motion (user request 2026-10-14): dialogs rise in like a sheet and drop away on close instead of
// popping in and vanishing. The enter motion is pure CSS (electron-app/modal-motion.css), keyed on
// :root[data-modal-motion] so it only runs when this module allowed it.
//
// The exit needs the pixels to outlive React. CX DetailPanel portals its backdrop into <body>, and React removes it
// the moment the caller's state closes it (dozens of `open && <DetailPanel/>` sites plus the vendored CX package).
// Instead of delaying every close, this puts the exact node React just removed back in place as an inert,
// aria-hidden "leaving" layer, plays the exit animation and then removes it. React state, Escape, focus return and the
// CX inert layer therefore finish immediately, exactly as before; only the picture lingers for the exit (~180ms) and
// it never takes focus or pointer input. Automated checks can opt out. Reduced motion retains
// a 120ms opacity-only transition; hidden windows skip resize geometry animation.

const BACKDROP='cx-panel-backdrop';
const isBackdrop=node=>node instanceof HTMLElement&&node.classList.contains(BACKDROP);
const isLeaving=node=>node.dataset.modalMotion==='leaving';

export function installModalMotion(){
  if(typeof document==='undefined'||typeof MutationObserver!=='function'||!document.body)return()=>{};
  const stopPresence=installMotionPresence();
  const stopPolicy=installMotionPolicy();
  const html=document.documentElement;
  const reduced=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
  const allowed=()=>!(typeof navigator!=='undefined'&&navigator.webdriver);
  const sync=()=>{if(allowed())html.dataset.modalMotion='on';else delete html.dataset.modalMotion;};
  sync();reduced?.addEventListener?.('change',sync);
  const stopResize=installModalResizeMotion(()=>!!html.dataset.modalMotion&&!document.hidden&&!reduced?.matches);

  // A node taken out of the document loses its scroll offset; remember offsets inside dialogs so the leaving copy
  // keeps showing what the person was looking at.
  const offsets=new Map();
  const remember=event=>{
    const target=event.target;
    if(target instanceof Element&&target.closest('.'+BACKDROP))offsets.set(target,[target.scrollTop,target.scrollLeft]);
  };
  document.addEventListener('scroll',remember,{capture:true,passive:true});

  const leaving=new Set(),timers=new Set();
  const finish=node=>{if(leaving.delete(node)){node.remove();for(const element of offsets.keys())if(node.contains(element))offsets.delete(element);}};
  const leave=(node,record)=>{
    node.dataset.modalMotion='leaving';
    node.inert=true;node.setAttribute('aria-hidden','true');
    for(const dialog of node.querySelectorAll('[aria-modal]'))dialog.removeAttribute('aria-modal');
    const parent=record.target,next=record.nextSibling;
    if(next&&next.parentNode===parent)parent.insertBefore(node,next);else parent.appendChild(node);
    leaving.add(node);
    for(const [element,[top,left]] of offsets)if(node.contains(element)){element.scrollTop=top;element.scrollLeft=left;}
    // CX restores the inert state it recorded when its (possibly deferred) effect cleanup runs; keep the copy inert.
    requestAnimationFrame(()=>{if(leaving.has(node))node.inert=true;});
    // Only the exit keyframes count; a spinner inside the dialog never finishes.
    const panel=node.querySelector(':scope > .cx-detail-panel');
    const exits=[...(node.getAnimations?.()||[]),...(panel?.getAnimations?.()||[])].filter(animation=>String(animation.animationName||'').startsWith('nubi-modal-'));
    if(!exits.length){finish(node);return;}
    Promise.allSettled(exits.map(animation=>animation.finished)).then(()=>finish(node));
    const timer=setTimeout(()=>{timers.delete(timer);finish(node);},motionDuration('exit')+motionDuration('capture'));
    timers.add(timer);
  };

  const observer=new MutationObserver(records=>{
    if(!html.dataset.modalMotion)return;
    const removed=[],added=[];
    for(const record of records){
      for(const node of record.removedNodes)if(isBackdrop(node)&&!isLeaving(node))removed.push([node,record]);
      for(const node of record.addedNodes)if(isBackdrop(node)&&!isLeaving(node))added.push(node);
    }
    const gone=removed.filter(([node])=>!node.isConnected),fresh=added.filter(node=>node.isConnected&&!removed.some(([old])=>old===node));
    // One dialog replacing another in the same update (settings -> memories) is navigation inside the sheet: the
    // new panel fades in over a steady scrim and the old one leaves no copy behind.
    if(fresh.length)for(const node of leaving)finish(node);
    if(gone.length&&fresh.length)for(const node of fresh)node.dataset.modalMotion='swap';
    else if(!document.hidden)for(const [node,record] of gone)leave(node,record);
    // Leaving copies have restored their offsets by now; forget dialogs that are gone for good.
    if(removed.length)for(const element of offsets.keys())if(!element.isConnected)offsets.delete(element);
  });
  observer.observe(document.body,{childList:true});

  return()=>{
    stopPresence();
    stopPolicy();
    stopResize();
    observer.disconnect();
    document.removeEventListener('scroll',remember,{capture:true});
    reduced?.removeEventListener?.('change',sync);
    for(const timer of timers)clearTimeout(timer);
    for(const node of leaving)node.remove();
    leaving.clear();offsets.clear();
    delete html.dataset.modalMotion;
  };
}

export function useModalMotion(){
  useEffect(()=>installModalMotion(),[]);
}
