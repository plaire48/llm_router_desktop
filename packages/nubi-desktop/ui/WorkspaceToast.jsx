import React, {useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {recordNotice} from './notice-store.js';

// Adapt E2E Report's single-notice store and shared countdown clock. Desktop
// keeps a three-second duration (user decision 2026-10-14) and Nubi identity without a dependency.
let current = null, sequence = 0;
const listeners = new Set();
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => current;
const emit = () => listeners.forEach(listener => listener());
// A toast may carry several actions (the choices of a question) and a text input (its free-text answer), so a
// decision can be taken from the toast itself (user request 2026-10-14).
export function notifyWorkspaceToast(message, {error = false, success = false, action = null, actions = null, input = null} = {}) {
  const text = String(message || '').trim();
  if (!text) return;
  const valid = item => item && typeof item.onClick === 'function' && item.label;
  current = {id: ++sequence, message: text, error, success, action: valid(action) ? action : null, actions: Array.isArray(actions) ? actions.filter(valid).slice(0, 4) : [], input: input && typeof input.onSubmit === 'function' ? {placeholder: input.placeholder || '답변 입력', onSubmit: input.onSubmit} : null};
  recordNotice({text, error, success, action: current.action, kind: 'info', source: 'toast'});
  emit();
}

export function WorkspaceToast() {
  const item = useSyncExternalStore(subscribe, snapshot, () => null);
  const [portalTarget, setPortalTarget] = useState(document.body);
  const [focused, setFocused] = useState(false), [hidden, setHidden] = useState(document.hidden);
  const region = useRef(null), previousFocus = useRef(null), progress = useRef(null), tip = useRef(null);
  const clock = useRef({id: null, elapsed: 0});
  const paused = focused || hidden;
  useLayoutEffect(() => {
    // CX makes other body children inert while a modal is active. Keep feedback
    // inside the top modal so its live region remains available there.
    const update = () => {
      const dialogs = [...document.querySelectorAll('[aria-modal="true"]')];
      const target = dialogs.reverse().find(node => node.isConnected && !node.closest('[inert],[hidden],[aria-hidden="true"]')) || document.body;
      setPortalTarget(currentTarget => currentTarget === target ? currentTarget : target);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:['aria-modal','hidden','aria-hidden','inert']});
    update();
    return () => observer.disconnect();
  }, []);
  const dismiss = useCallback(() => {
    if (current?.id !== item?.id) return;
    const restore = region.current?.contains(document.activeElement);
    current = null; emit(); setFocused(false);
    if (restore) requestAnimationFrame(() => {
      if (previousFocus.current?.isConnected && !previousFocus.current.closest('[inert]')) previousFocus.current.focus({preventScroll: true});
    });
  }, [item?.id]);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useLayoutEffect(() => {
    setFocused(Boolean(region.current?.contains(document.activeElement) && document.activeElement.matches(':focus-visible')));
  }, [item?.id]);
  useLayoutEffect(() => {
    if (!item) return;
    if (clock.current.id !== item.id) clock.current = {id: item.id, elapsed: 0};
    const countdown = clock.current, started = performance.now(), duration = 3000, fillDuration = 2900;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const paint = elapsed => {
      const fraction = Math.min(fillDuration, elapsed) / fillDuration;
      progress.current?.setAttribute('stroke-dashoffset', String(100 * (1 - (reduced ? Math.floor(fraction * 3) / 3 : fraction))));
      tip.current?.setAttribute('transform', `rotate(${360 * fraction} 16 16)`);
      tip.current?.setAttribute('opacity', !reduced && fraction < 1 ? '1' : '0');
    };
    paint(countdown.elapsed);
    if (paused) return;
    let frame;
    const tick = () => {
      const elapsed = Math.min(duration, countdown.elapsed + performance.now() - started);
      paint(elapsed);
      if (elapsed >= duration) { dismiss(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); countdown.elapsed = Math.min(duration, countdown.elapsed + performance.now() - started); };
  }, [item?.id, paused, dismiss, portalTarget]);
  if (!item) return null;
  return createPortal(<div ref={region} className="nubi-feedback-region" aria-label="알림"
    onPointerDownCapture={() => setFocused(false)}
    onFocusCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) previousFocus.current = event.relatedTarget; setFocused(event.target.matches(':focus-visible')); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDownCapture={() => setFocused(true)}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
    <div className="nubi-feedback-toast" data-error={item.error} key={item.id}>
      <div className="nubi-feedback-message" role={item.error ? 'alert' : 'status'} aria-atomic="true">
        <svg className="nubi-feedback-icon" aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle className="nubi-feedback-track" cx="16" cy="16" r="13"/>
          <circle ref={progress} className="nubi-feedback-countdown" cx="16" cy="16" r="13" pathLength="100" strokeDasharray="100" strokeDashoffset="100" transform="rotate(-90 16 16)"/>
          <circle ref={tip} className="nubi-feedback-tip" cx="16" cy="3" r="2.5"/>
          {item.error ? <><path d="M16 10v8"/><circle cx="16" cy="22" r="1" fill="currentColor" stroke="none"/></> : item.success ? <path d="m10 16 4 4 8-9"/> : <><path d="M16 16v6"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/></>}
        </svg>
        <span title={item.message}>{item.message}</span>
        {item.action&&<button type="button" className="nubi-feedback-action" onClick={()=>{try{item.action.onClick();}finally{dismiss();}}}>{item.action.label}</button>}
        {item.actions.length>0&&<span className="nubi-feedback-actions">{item.actions.map(entry=><button key={entry.label} type="button" className="nubi-feedback-action" data-choice onClick={()=>{try{entry.onClick();}finally{dismiss();}}}>{entry.label}</button>)}</span>}
        {item.input&&<form className="nubi-feedback-input" onSubmit={event=>{event.preventDefault();const value=new FormData(event.currentTarget).get('answer');const text=typeof value==='string'?value.trim():'';if(!text)return;try{item.input.onSubmit(text);}finally{dismiss();}}}><input name="answer" aria-label={item.input.placeholder} placeholder={item.input.placeholder} autoComplete="off" maxLength={2000}/><button type="submit" className="nubi-feedback-action" aria-label="답변 보내기" title="답변 보내기"><svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8h11M9 4l4 4-4 4"/></svg></button></form>}
        <button type="button" className="nubi-feedback-close" aria-label="알림 닫기" title="알림 닫기" onClick={dismiss}><svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg></button>
      </div>
    </div>
  </div>, portalTarget);
}
