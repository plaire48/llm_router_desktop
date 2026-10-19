import {motionDuration} from './motion-policy.mjs';
export const listFrames=(height,enter,reduced)=>{
 const start={...(!reduced?{height:enter?'0px':height+'px'}:{}),opacity:enter?0:1};
 const end={...(!reduced?{height:enter?height+'px':'0px'}:{}),opacity:enter?1:0};return [start,end];
};
// Sidebar ownership only. No observer is added to the transcript. ResizeObserver
// provides natural heights after layout; no synchronous bounding-box reads.
export function installListMotion(root,selector='.nubi-session-row'){
 const heights=new Map(),pending=new Set(),running=new Map();let initial=true,closed=false;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const animate=(node,height,enter)=>{
  if(closed||!root.isConnected||running.size>=2||document.hidden)return false;
  const animation=node.animate(listFrames(height,enter,reduced.matches),{duration:motionDuration('list'),easing:getComputedStyle(root).getPropertyValue('--nubi-ease-out').trim()});animation.id=enter?'nubi-list-enter':'nubi-list-exit';
  const overflow=node.style.overflow;node.style.overflow='clip';running.set(node,animation);
  const done=()=>{if(running.get(node)!==animation)return;running.delete(node);node.style.overflow=overflow;if(!enter)node.remove();};
  animation.finished.then(done,done);return true;
 };
 const sizes=new ResizeObserver(entries=>{for(const {target,contentRect,borderBoxSize} of entries){if(running.has(target))continue;const height=borderBoxSize?.[0]?.blockSize||contentRect.height;heights.set(target,height);if(pending.delete(target))animate(target,height,true);}});
 const observe=node=>{if(heights.has(node))return;sizes.observe(node);if(!initial)pending.add(node);};
 for(const node of root.querySelectorAll(selector))observe(node);initial=false;
 const mutations=new MutationObserver(records=>{
  let budget=2;
  for(const record of records){
   for(const node of record.addedNodes){if(node.nodeType!==1)continue;for(const row of [...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]){if(row.dataset.motionLeaving)continue;observe(row);if(--budget<0)pending.delete(row);}}
   for(const node of record.removedNodes){
    const rows=[...(node.matches?.(selector)?[node]:[]),...(node.querySelectorAll?.(selector)||[])];
    for(const row of rows){if(row.isConnected||row.dataset?.motionLeaving)continue;pending.delete(row);sizes.unobserve(row);const height=heights.get(row);heights.delete(row);running.get(row)?.cancel();
     // Parent navigation/date groups disappear immediately. Never reinsert a
     // removed subtree merely to animate its former children.
     if(row!==node||!height||!record.target.isConnected||budget--<=0)continue;
     row.dataset.motionLeaving='true';row.inert=true;row.setAttribute('aria-hidden','true');record.target.insertBefore(row,record.nextSibling?.parentNode===record.target?record.nextSibling:null);
     if(!animate(row,height,false))row.remove();
    }
   }
  }
 });mutations.observe(root,{childList:true,subtree:true});
 return()=>{closed=true;mutations.disconnect();sizes.disconnect();for(const [node,animation] of running){animation.cancel();if(node.dataset.motionLeaving)node.remove();}running.clear();heights.clear();pending.clear();};
}
