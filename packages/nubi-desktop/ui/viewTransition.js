import {flushSync} from 'react-dom';
import {beginMotion,motionDuration} from './motion-policy.mjs';

// Sidebar, side pane and screen changes morph instead of jumping (user request 2026-10-14: "liquid", iOS-like). The
// browser's View Transitions capture the old and new layout and animate between them on the compositor, so the work
// per frame stays small. Same-tick updates share one transition. New input skips
// stale snapshots immediately; it never waits for an animation to accept input.
// Reduced motion uses a 120ms crossfade; hidden windows and automated checks can opt out.
let queue=null,running=null;
const canAnimate=()=>typeof document!=='undefined'&&typeof document.startViewTransition==='function'&&!document.hidden
  &&!(typeof navigator!=='undefined'&&navigator.webdriver)
  // An open or leaving dialog covers the layout with its scrim and has its own motion (modalMotion.js); morphing the
  // page underneath would animate the dialog a second time inside the root snapshot.
  &&!document.documentElement?.hasAttribute('data-project-switching')&&!document.body?.hasAttribute('data-nubi-opening')&&!document.querySelector('.nubi-intro,.cx-panel-backdrop');
const quiet=promise=>{promise?.catch?.(()=>{});};
export function cancelViewTransition(){
 if(running){running.flush();running.transition.skipTransition();}
}
export function transitioned(update){
  if(running){running.flush();running.transition.skipTransition();update();return;}
  if(!canAnimate()){update();return;}
  if(queue){queue.push(update);return;}
  queue=[update];
  queueMicrotask(()=>{
    const updates=queue;queue=null;
    let transition,applied=false;
    const flush=()=>{if(applied)return;applied=true;flushSync(()=>{for(const run of updates)run();});};
    // Recheck at the microtask boundary: a modal or visibility state
    // may have changed since the action was queued.
    if(!canAnimate()){flush();return;}
    // Read the token before phase attributes invalidate inherited ambient
    // styles. Reading it during capture forces the whole screen to restyle.
    const captureDuration=motionDuration('capture')||120;
    const endMotion=beginMotion();
    try{transition=document.startViewTransition(flush);}
    catch{endMotion();flush();return;}
    const record={transition,flush};running=record;quiet(transition.ready);quiet(transition.updateCallbackDone);
    // Snapshot capture is optional decoration. A slow compositor must not hold
    // the requested screen update; continue live if capture misses the budget.
    const captureTimer=setTimeout(()=>{flush();transition.skipTransition();},captureDuration);
    transition.ready.then(()=>clearTimeout(captureTimer),()=>clearTimeout(captureTimer));
    const interrupt=()=>{flush();transition.skipTransition();};
    const events=['pointerdown','keydown','wheel','visibilitychange'];
    for(const event of events)document.addEventListener(event,interrupt,{capture:true,passive:true});
    const done=()=>{clearTimeout(captureTimer);endMotion();for(const event of events)document.removeEventListener(event,interrupt,{capture:true});if(running===record)running=null;};
    transition.finished.then(done,done);
  });
}
// A state setter whose changes animate.
export const animatedSetter=setter=>value=>transitioned(()=>setter(value));
