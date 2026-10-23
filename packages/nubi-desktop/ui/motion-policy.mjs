import {frameCoalescer} from './frame-coalescer.mjs';
const metadata=new Set(['offset','computedOffset','easing','composite']);
const colors=new Set(['color','backgroundColor','borderColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','fill','stroke']);
export function parseAmbientRegistry(text){
 const entries=new Map();
 for(const row of text.replace(/^['"]|['"]$/g,'').split(';').map(row=>row.trim()).filter(Boolean)){
  const [name,raw,props]=row.split(':'),durations=raw?.split('/').map(Number)||[],duration=durations[0],properties=props?.split(',')||[];
  if(!name||!durations.length||durations.some(value=>!Number.isFinite(value)||value<=0))throw Error('ambient duration');
  if(!properties.length||properties.some(property=>!['transform','opacity'].includes(property)))throw Error('ambient property');
  if(entries.has(name))throw Error('ambient duplicate');entries.set(name,{duration,durations,properties});
 }return entries;
}
// Named CSS effects keep their property names for their lifetime in the static
// renderer stylesheet. Cache names, not values or durations. A new name/effect
// invalidates metadata; arbitrary WAAPI effects are always read again.
const properties=(animation,cache)=>{
 const previous=cache?.get(animation);
 if(previous?.effect===animation.effect&&previous?.name===animation.animationName)return previous.props;
 const props=[...new Set(animation.effect.getKeyframes().flatMap(frame=>Object.keys(frame).filter(key=>!metadata.has(key))))];
 cache?.set(animation,{effect:animation.effect,name:animation.animationName,props});return props;
};
const priority=animation=>/nubi-modal-|nubi-view-/.test(animation.animationName||animation.id||'')?0:/press/.test(animation.id||animation.animationName||'')||animation.transitionProperty?1:/nubi-list-/.test(animation.id||animation.animationName||'')?2:3;
// Decorative ambient loops held at their phase (design light-flow §6: 22 idle loops → at most 3). Status loops
// (spinners, live progress, wiki scan, working-bird moods) still run, because they say work is happening; the brand
// bird's float is the one decoration kept.
export const IDLE_AMBIENT_HELD=Object.freeze(new Set(['nubi-pastel-flow','deck-twinkle','nubi-water-aura','nubi-water-drift','nubi-ambient-blue','nubi-ambient-teal','nubi-ambient-violet','nubi-start-drift-a','nubi-start-drift-b','nubi-start-drift-c','nubi-emblem-drift','bird-idle-base','bird-idle-smile','bird-idle-wing','bird-blink','nubi-bird-flight','nubi-bird-curious','nubi-bird-swim']));
export function reconcileMotion(animations,{registry,paused,progressPaused=paused,projectSwitching=false,reduced=false,owned,limit=3,metadataCache,held=null}){
 const targets=new Set();let ambient=0,unknown=0;
 for(const animation of [...animations].sort((a,b)=>priority(a)-priority(b))){
  if(!animation.effect||animation.playState==='idle'||animation.playState==='finished')continue;
  const name=animation.animationName||animation.id||'',timing=animation.effect.getTiming(),target=animation.effect.target;
  const progressFill=target?.matches?.('.nubi-progress>span')&&(name==='nubi-progress-pending'||animation.transitionProperty==='transform');
  const entry=registry.get(name)||(progressFill&&animation.transitionProperty==='transform'?registry.get('nubi-progress-fill'):undefined),props=properties(animation,entry&&animation.animationName?metadataCache:undefined);
  if(entry){
   ambient++;
   if(!entry.durations.includes(timing.duration)||props.some(property=>!entry.properties.includes(property))){animation.cancel();unknown++;continue;}
   // Essential fill in the top modal continues while covered decoration pauses.
   const hold=(progressFill&&target.closest?.('.cx-panel-backdrop[data-modal-top=true]')?progressPaused:paused)||!!held?.has(name)||projectSwitching&&!target?.closest?.('.nubi-project-switch-cover');
   if(hold&&animation.playState==='running'){owned.add(animation);animation.pause();}
   else if(!hold&&owned.delete(animation)&&animation.playState==='paused')animation.play();
   continue;
  }
  if(timing.iterations>1){animation.cancel();unknown++;continue;}
  const list=/^nubi-list-/.test(name);
  if(timing.duration>(reduced?120:300)||props.some(property=>!['opacity',...(!reduced?['transform']:[]),...(list&&!reduced?['height']:[])].includes(property)&&!colors.has(property))){animation.cancel();continue;}
  const key=animation.effect.target, pseudo=animation.effect.pseudoElement;
  // All color channels on one control are one animated element. Snapshot
  // pseudo-elements are separate pictures, even though their target is html.
  const motionTarget=pseudo||key;
  if(!targets.has(motionTarget)&&targets.size>=limit){animation.cancel();continue;}
  targets.add(motionTarget);
 }
 for(const animation of owned)if(!animations.includes(animation))owned.delete(animation);
 return {ambient,unknown,interactionTargets:targets.size};
}
export function motionDuration(name,element=globalThis.document?.documentElement){
 if(!element||typeof getComputedStyle!=='function')return 0;
 const value=getComputedStyle(element).getPropertyValue('--nubi-motion-'+name).trim();
 return Number.parseFloat(value)*(value.endsWith('ms')?1:1000)||0;
}
const transitions=new WeakMap();
export function beginMotion(doc=globalThis.document){
 if(!doc?.documentElement)return()=>{};
 const count=(transitions.get(doc)||0)+1;transitions.set(doc,count);doc.documentElement.setAttribute?.('data-nubi-transition','');
 doc.dispatchEvent?.(new Event('nubi-motion-change'));let active=true;
 return()=>{if(!active)return;active=false;const next=(transitions.get(doc)||1)-1;transitions.set(doc,next);if(!next)doc.documentElement.removeAttribute?.('data-nubi-transition');doc.dispatchEvent?.(new Event('nubi-motion-change'));};
}
const owners=new WeakMap();
export function installMotionPolicy(doc=document){
 let owner=owners.get(doc),active=true;
 if(owner){owner.count++;return()=>release();}
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),owned=new Set(),root=doc.documentElement;
 let metadataCache=new WeakMap(),registry;
 const paused=()=>doc.hidden||root.hasAttribute('data-nubi-window-hidden')||reduced.matches||root.hasAttribute('data-nubi-transition')||root.hasAttribute('data-motion-panel');
 const sync=()=>{
  registry??=parseAmbientRegistry(getComputedStyle(root).getPropertyValue('--nubi-ambient-registry'));
  const animations=doc.getAnimations().filter(animation=>!animation.effect?.target?.closest?.('.nubi-intro,.nubi-connecting'));
  return reconcileMotion(animations,{registry,paused:paused(),progressPaused:doc.hidden||root.hasAttribute('data-nubi-window-hidden')||root.hasAttribute('data-nubi-transition')||reduced.matches,projectSwitching:root.hasAttribute('data-project-switching'),reduced:reduced.matches,owned,metadataCache,held:IDLE_AMBIENT_HELD});
 };
 const frame=frameCoalescer(sync),schedule=event=>{
  if(event?.target?.closest?.('.nubi-intro,.nubi-connecting'))return;
  frame.schedule();
 };
 // Event boundaries, not transcript subtree observation or a per-frame loop.
 for(const name of ['animationstart','transitionrun'])doc.addEventListener(name,schedule,true);
 // CSS pauses registered ambient motion as soon as a phase attribute changes.
 // Discover/reconcile once after the same-turn React commit, rather than
 // flushing the whole document for each nested view/modal notification.
 doc.addEventListener('visibilitychange',sync);doc.addEventListener('nubi-motion-change',schedule);
 reduced.addEventListener('change',sync);
 const observer=new MutationObserver(schedule);observer.observe(root,{attributes:true,attributeFilter:['data-motion-panel','data-project-switching']});
 const invalidateStyles=()=>{metadataCache=new WeakMap();registry=undefined;frame.schedule();};
 const styleHead=doc.head,styles=styleHead?new MutationObserver(invalidateStyles):null;
 styles?.observe(styleHead,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['href','rel','media','disabled']});styleHead?.addEventListener?.('load',invalidateStyles,true);
 const stopHost=globalThis.window?.nubi?.onHostEvent?.(event=>{if(event?.type!=='window_visibility'||typeof event.visible!=='boolean')return;root.toggleAttribute('data-nubi-window-hidden',!event.visible);sync();});
 owner={count:1,stop(){stopHost?.();frame.cancel();observer.disconnect();styles?.disconnect();styleHead?.removeEventListener?.('load',invalidateStyles,true);for(const name of ['animationstart','transitionrun'])doc.removeEventListener(name,schedule,true);doc.removeEventListener('visibilitychange',sync);doc.removeEventListener('nubi-motion-change',schedule);reduced.removeEventListener('change',sync);for(const animation of owned)if(animation.playState==='paused')animation.play();owned.clear();root.removeAttribute?.('data-nubi-window-hidden');}};
 owners.set(doc,owner);frame.schedule();
 return()=>release();
 function release(){if(!active)return;active=false;if(!--owner.count){owner.stop();owners.delete(doc);}}
}
