// Morph the dialog surface, not its text. The live panel takes its natural size
// immediately; an inert surface behind it bridges the old/new bounds with FLIP.
// No per-frame React updates, layout animation or delayed focus/approval state.
import {frameCoalescer} from './frame-coalescer.mjs';
export function installModalResizeMotion(allowed){
 if(typeof ResizeObserver!=='function')return()=>{};
 const records=new Map(),viewport=()=>`${innerWidth}:${innerHeight}`;
 const bounds=panel=>{const r=panel.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};
 const layoutBounds=panel=>{
  const r=bounds(panel),transform=new DOMMatrixReadOnly(getComputedStyle(panel).transform),width=panel.offsetWidth,height=panel.offsetHeight;
  return {left:r.left+(r.width-width)/2-transform.m41,top:r.top+(r.height-height)/2-transform.m42,width,height};
 };
 const stop=record=>{record.animation?.cancel();record.reveal?.cancel();record.surface?.remove();record.panel.classList.remove('nubi-modal-morphing');record.animation=record.reveal=record.surface=record.appearance=null;};
 const appearance=panel=>{const style=getComputedStyle(panel);return {background:style.background,borderRadius:style.borderRadius,boxShadow:style.boxShadow,duration:parseFloat(style.getPropertyValue('--nubi-modal-resize'))||240,easing:style.getPropertyValue('--nubi-modal-resize-ease').trim()||'cubic-bezier(.2,.8,.2,1)'};};
 function morph(record,from,to){
  const panel=record.panel,backdrop=panel.parentElement;
  if(!allowed()||!panel.isConnected||!from?.width||!to.width||Math.abs(from.width-to.width)+Math.abs(from.height-to.height)<2)return;
  const {background,borderRadius,boxShadow,duration,easing}=record.appearance;
  record.animation?.cancel();record.reveal?.cancel();
  panel.dataset.modalSettled='true';
  const surface=record.surface||document.createElement('div');
  if(!record.surface){surface.className='nubi-modal-morph-surface';surface.setAttribute('aria-hidden','true');surface.inert=true;Object.assign(surface.style,{background,borderRadius,boxShadow});}
  Object.assign(surface.style,{left:`${to.left}px`,top:`${to.top}px`,width:`${to.width}px`,height:`${to.height}px`});
  if(!record.surface){backdrop.append(surface);record.surface=surface;panel.classList.add('nubi-modal-morphing');}
  record.animation=surface.animate([{transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width},${from.height/to.height})`},{transform:'none'}],{duration,easing});
  // Move the live text with the surface. Repeated progress/size updates must
  // not flash the entire form back to 35% opacity or scale its text.
  record.reveal=panel.animate([{transform:`translate(${from.left-to.left}px,${from.top-to.top}px)`},{transform:'none'}],{duration,easing});
  const animation=record.animation;
  animation.finished.then(()=>{if(record.animation===animation)stop(record);},()=>{});
 }
 const pending=new Set();
 const paint=frameCoalescer(()=>{
  const panels=[...pending];pending.clear();
  if(!allowed())return;
  const screen=viewport();
  // All reads precede any style writes, including when several panels resize.
  const jobs=panels.flatMap(panel=>{const record=records.get(panel);if(!record||!panel.isConnected)return [];const next=layoutBounds(panel),from=record.surface?bounds(record.surface):record.from||record.rect;if(from&&!record.appearance)record.appearance=appearance(panel);return [{record,next,from}];});
  for(const {record,next,from} of jobs){
   if(from&&record.viewport===screen)morph(record,from,next);else stop(record);
   record.from=null;record.rect=next;record.viewport=screen;
  }
 });
 const observer=new ResizeObserver(entries=>{for(const {target} of entries)if(records.has(target))pending.add(target);if(pending.size)paint.schedule();});
 function attach(backdrop,from){
  if(!backdrop.matches?.('.cx-panel-backdrop:is(.is-modal,.is-confirmation):not([data-modal-motion="leaving"])'))return;
  const panel=backdrop.querySelector(':scope > .cx-detail-panel');if(!panel||records.has(panel))return;
  const record={panel,rect:null,from,viewport:viewport()};records.set(panel,record);observer.observe(panel);
 }
 const mutations=new MutationObserver(changes=>{
  let previous;
  for(const change of changes)for(const node of change.removedNodes){
   for(const [panel,record] of records)if(node===panel.parentElement||node.contains?.(panel)){
    previous=record.surface?.isConnected?bounds(record.surface):record.rect;stop(record);observer.unobserve(panel);records.delete(panel);pending.delete(panel);
   }
  }
  for(const change of changes)for(const node of change.addedNodes)if(node instanceof Element)attach(node,previous);
 });
 mutations.observe(document.body,{childList:true});
 for(const node of document.querySelectorAll('.cx-panel-backdrop'))attach(node);
 const quiet=()=>{if(!allowed()){paint.cancel();pending.clear();for(const record of records.values()){stop(record);record.rect=null;record.from=null;}}};
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');reduced.addEventListener('change',quiet);document.addEventListener('visibilitychange',quiet);
 return()=>{paint.cancel();pending.clear();mutations.disconnect();observer.disconnect();reduced.removeEventListener('change',quiet);document.removeEventListener('visibilitychange',quiet);for(const record of records.values())stop(record);records.clear();};
}
