// Routines are off in this release (design light-flow §5.1); someone who saved routines is told once. The notice waits
// for the opening intro to finish (it covers the screen on the first launch after an update) and is acknowledged only
// after it has been on screen for its whole toast time, so it is never consumed unseen.
export function scheduleRoutineNotice({api,show,isReady,whenReady,setTimer=setTimeout,clearTimer=clearTimeout,visibleMs=3000}){
 let live=true,timer=null,unsubscribe=null;
 const start=async()=>{
  const notice=await Promise.resolve(api('routineNotice',{})).catch(()=>null);
  if(!live||!notice?.show)return;
  show(notice.text);
  timer=setTimer(()=>{timer=null;if(live)Promise.resolve(api('acknowledgeRoutineNotice',{})).catch(()=>{});},visibleMs);
 };
 if(isReady())start();else unsubscribe=whenReady(()=>{if(!live||!isReady())return;unsubscribe?.();unsubscribe=null;start();});
 return ()=>{live=false;unsubscribe?.();if(timer!==null)clearTimer(timer);};
}
// The DOM signals the intro leaves behind while it plays (CinematicIntro, opening-scene).
export const openingDone=(doc=globalThis.document)=>!doc.body.hasAttribute('data-nubi-opening')&&!doc.querySelector('.nubi-intro');
export function whenOpeningDone(doc=globalThis.document){
 return callback=>{const observer=new MutationObserver(callback);observer.observe(doc.body,{attributes:true,attributeFilter:['data-nubi-opening'],childList:true,subtree:true});return ()=>observer.disconnect();};
}
