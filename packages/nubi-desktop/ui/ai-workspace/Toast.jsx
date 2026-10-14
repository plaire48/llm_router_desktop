import { ActionButton } from './ActionButton';
import React, {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {createToastStore} from './toastStore';
import {modalFeedbackTarget, subscribeModalFeedback} from './modalFocus';
import './toast.css';

const store = createToastStore();
let host;
function clearActionFeedback(source) {
  const item = store.getSnapshot();
  if (item?.source === source && (item.error || item.actions.length)) store.dismiss(item.id);
}
export function notifyToast(message, {source = 'app', error = false, actions = []} = {}) {
  if (typeof document !== 'undefined' && !host?.isConnected) {
    host = document.createElement('div');
    host.dataset.cxToastHost = '';
    document.body.append(host);
    createRoot(host).render(<ToastViewport/>);
  }
  store.show({message: message instanceof Error ? message.message : message, source, error, actions,
    diagnosticText: message instanceof Error ? message.diagnosticText || message.cause?.diagnosticText : undefined});
}

// Retain local validation state while sending all operation feedback to one surface.
export function useFeedback(errorActions = []) {
  const source = useId();
  const latestActions = useRef(errorActions);
  latestActions.current = errorActions;
  const [state, setState] = useState({message: '', error: false});
  useEffect(() => () => clearActionFeedback(source), [source]);
  const notify = useCallback((message, error = false, actions) => {
    setState({message: message instanceof Error ? message.message : message, error});
    notifyToast(message, {source, error, actions: actions || (error ? latestActions.current.map((action,index)=>({...action,onClick:()=>latestActions.current[index]?.onClick()})) : [])});
  }, [source]);
  return [state.message, notify, state.error];
}

export function ToastNotice({message, error = false, actions = []}) {
  const source = useId(), latest = useRef(actions);
  latest.current = actions;
  const labels = actions.map(action => action.label).join('|');
  useEffect(() => {
    notifyToast(message, {source, error, actions: latest.current.map((action, index) => ({...action, onClick: () => latest.current[index]?.onClick()}))});
    return () => clearActionFeedback(source);
  }, [source, message, error, labels]);
  return null;
}

function ToastViewport() {
  const item = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const target = useSyncExternalStore(subscribeModalFeedback, modalFeedbackTarget);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [copyState, setCopyState] = useState(null);
  const previousFocus = useRef(null), region = useRef(null), progress = useRef(null), progressTip = useRef(null);
  const countdown = useRef({id: null, elapsed: 0});
  const duration = 3000, completionHold = 150;
  const fillDuration = duration - completionHold;
  const paused = focused || hidden;
  const dismiss = useCallback(() => {
    if (!item) return;
    const restore = region.current?.contains(document.activeElement);
    store.dismiss(item.id);
    if (restore) requestAnimationFrame(() => {
      const candidate = previousFocus.current;
      if (candidate?.isConnected && !candidate.closest('[inert]')) candidate.focus({preventScroll:true});
      else (modalFeedbackTarget().querySelector('h2, h1[tabindex]') || modalFeedbackTarget()).focus({preventScroll:true});
    });
    setFocused(false);
  }, [item?.id]);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useLayoutEffect(() => {
    // Replacing an alert can remove the focused control without firing blur.
    setFocused(Boolean(region.current?.contains(document.activeElement) && document.activeElement.matches(':focus-visible')));
  }, [item?.id, target]);
  useLayoutEffect(() => {
    if (!item) return;
    if (countdown.current.id !== item.id) countdown.current = {id: item.id, elapsed: 0};
    const clock = countdown.current, started = performance.now();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const paint = elapsed => {
      const fraction = Math.min(fillDuration, elapsed) / fillDuration;
      // Keep the remaining-time indicator visible with reduced motion, using
      // three quiet steps instead of hiding the countdown entirely.
      const visibleFraction = reducedMotion.matches ? Math.floor(fraction * 3) / 3 : fraction;
      progress.current?.setAttribute('stroke-dashoffset', String(100 * (1 - visibleFraction)));
      progressTip.current?.setAttribute('transform', `rotate(${360 * fraction} 16 16)`);
      progressTip.current?.setAttribute('opacity', fraction < 1 ? '1' : '0');
    };
    paint(clock.elapsed);
    if (paused) return;
    let frame, completedSince = null;
    // The ring, moving tip and dismissal share one clock. The final 150 ms of
    // the three-second notice hold the completed ring before it disappears.
    const tick = () => {
      const now = performance.now(), elapsed = Math.min(duration, clock.elapsed + now - started);
      paint(elapsed);
      if (elapsed >= fillDuration) {
        completedSince ??= now;
        if (now - completedSince >= completionHold) { dismiss(); return; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clock.elapsed = Math.min(duration, clock.elapsed + performance.now() - started);
    };
  }, [item?.id, duration, fillDuration, completionHold, paused, target, dismiss]);
  const copyError = async () => {
    try {
      await navigator.clipboard.writeText(item.diagnosticText);
      setCopyState({id: item.id, copied: true});
    } catch {
      setCopyState({id: item.id, copied: false});
    }
  };
  // Inside the active dialog so its focus trap and screen-reader scope include feedback.
  return createPortal(<div ref={region} className="cx-toast-region" aria-label="알림"
    onPointerDownCapture={() => setFocused(false)}
    onFocusCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) previousFocus.current = event.relatedTarget; setFocused(event.target.matches(':focus-visible')); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDownCapture={() => setFocused(true)}
    onKeyDown={event => { if (event.key === 'Escape' && item) { event.preventDefault();event.stopPropagation();dismiss(); } }}>
    {item && <div key={item.id} className={`toast toast--light cx-toast ${item.error ? 'is-error' : ''}`} data-toast-id={item.id}>
      <div className="toast__message" role={item.error ? 'alert' : 'status'} aria-atomic="true">
        <span className="cx-toast-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle className="cx-toast-countdown-track" cx="16" cy="16" r="13"/>
          <circle ref={progress} className="cx-toast-countdown" cx="16" cy="16" r="13" pathLength="100" strokeDasharray="100" strokeDashoffset="100" transform="rotate(-90 16 16)"/>
          <circle ref={progressTip} className="cx-toast-countdown-tip" cx="16" cy="3" r="2.5"/>
          {item.error ? <><path d="M16 10v8"/><circle cx="16" cy="22" r="1" fill="currentColor" stroke="none"/></> : item.success ? <path d="m10 16 4 4 8-9"/> : <><path d="M16 16v6"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/></>}
        </svg></span>
        <span className="toast__text">{item.message}</span>
      </div>
      {(item.actions.length > 0 || item.diagnosticText) && <div className="cx-toast-actions">
        {item.actions.map(action => <button type="button" key={action.label} onClick={action.onClick}>{action.label}</button>)}
        {item.diagnosticText && <button type="button" onClick={copyError}>{copyState?.id === item.id && copyState.copied ? '복사 완료' : '오류 정보 복사'}</button>}
        {copyState?.id === item.id && !copyState.copied && <span role="status">복사하지 못했습니다. 오류 내용을 직접 복사하세요.</span>}
      </div>}
      <ActionButton action="close" className="cx-toast-close" aria-label="알림 닫기" title="알림 닫기" onClick={dismiss}/>
    </div>}
  </div>, target);
}
