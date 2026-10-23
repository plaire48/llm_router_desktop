import {useEffect} from 'react';
import {frameCoalescer} from './frame-coalescer.mjs';
import {motionDuration} from './motion-policy.mjs';

// Decoration never owns application state, focus, scrolling, approval or writes.
// Geometry is committed first. Only inert surfaces scale; text is never scaled
// during reflow. Every effect is bounded and can be interrupted by new input.
export function installWorkspaceInteractions(root){
 if(!root)return()=>{};
 const doc=root.ownerDocument,media=matchMedia('(prefers-reduced-motion: reduce)'),effects=new Set(),surfaces=new Set(),timers=new Set();
 let disposed=false,selection=null,drag=null,rubber=null,rubberTimer=null,layoutFrame=0,layoutUntil=0;
 const pendingLayout=new Map();
 const allowed=()=>!disposed&&!doc.hidden&&!media.matches&&!['data-nubi-window-hidden','data-project-switching','data-motion-panel'].some(name=>doc.documentElement.hasAttribute(name))&&!doc.querySelector('.cx-panel-backdrop,.nubi-intro');
 const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);return timer;};
 const stopEffects=()=>{for(const effect of effects)effect.cancel();effects.clear();for(const surface of surfaces)surface.remove();surfaces.clear();selection=null;};
 function animate(node,frames,id='nubi-atlas-enter',duration=motionDuration('enter'),delay=0){
  if(!allowed()||!node?.isConnected||effects.size>=3)return null;
  const effect=node.animate(frames,{duration:Math.min(280,duration),delay,easing:getComputedStyle(root).getPropertyValue('--nubi-ease-spring').trim()||'ease-out'});
  effect.id=id;effects.add(effect);const done=()=>effects.delete(effect);effect.finished.then(done,done);return effect;
 }
 function surface(from,to,kind='layout'){
  if(!allowed()||!from?.width||!to?.width||Math.abs(from.width-to.width)+Math.abs(from.x-to.x)+Math.abs(from.height-to.height)<2)return;
  const node=doc.createElement('div');node.className='nubi-interaction-surface';node.dataset.nubiMorphSurface=kind;node.inert=true;node.setAttribute('aria-hidden','true');
  Object.assign(node.style,{left:to.x+'px',top:to.y+'px',width:to.width+'px',height:to.height+'px'});root.append(node);surfaces.add(node);
  const effect=animate(node,[{transform:`translate(${from.x-to.x}px,${from.y-to.y}px) scale(${from.width/to.width},${from.height/to.height})`,opacity:.65},{transform:'none',opacity:0}],'nubi-atlas-'+kind);
  const done=()=>{node.remove();surfaces.delete(node);};if(effect)effect.finished.then(done,done);else done();
 }
 const rect=node=>{const r=node?.getBoundingClientRect();return r?.width&&r?.height?{x:r.x,y:r.y,width:r.width,height:r.height}:null;};
 const boxes=new Map(),sizes=new ResizeObserver(entries=>{
  if(performance.now()>layoutUntil)pendingLayout.clear();
  if(root.hasAttribute('data-pane-resizing')||root.querySelector('[data-sidebar-resizing]')){pendingLayout.clear();for(const {target} of entries)boxes.set(target,rect(target));return;}
  for(const {target} of entries){const before=pendingLayout.get(target),after=rect(target);boxes.set(target,after);pendingLayout.delete(target);if(before&&after&&allowed()&&!selection)surface(before,after);}
 });
 function observeLayout(){
  for(const node of root.querySelectorAll('.desktop-pane,.nubi-sidebar,.nubi-activity-record,.nubi-project-wiki-progress'))if(!boxes.has(node)){boxes.set(node,rect(node));sizes.observe(node);}
  for(const node of boxes.keys())if(!node.isConnected){sizes.unobserve(node);boxes.delete(node);}
 }
 function revealSelection(){
  if(!selection||!allowed())return;
  const target=root.querySelector('.desktop-selection-detail:not([hidden]) h2');
  if(!target||!target.textContent.includes(selection.title))return;
  const after=rect(target.closest('article'));if(!after)return;
  surface(selection.rect,after,'shared');selection=null;
  animate(target,[{opacity:.55,transform:'translateX(8px)'},{opacity:1,transform:'none'}],'nubi-atlas-reader',motionDuration('state'));
 }
 const inspect=()=>{layoutFrame=0;if(disposed)return;observeLayout();revealSelection();};
 const queueLayout=()=>{if(!layoutFrame)layoutFrame=requestAnimationFrame(inspect);};
 const mutations=new MutationObserver(records=>{
  if(records.every(record=>record.target.closest?.('.nubi-interaction-surface')))return;
  // Only structural/screen changes. Streaming text and polling do not start effects.
  if(records.some(record=>record.type==='attributes'&&record.attributeName==='data-workspace-screen')){
   const main=root.querySelector('.nubi-main');if(!doc.documentElement.hasAttribute('data-nubi-transition'))animate(main,[{opacity:.6,transform:'translateX(10px)'},{opacity:1,transform:'none'}],'nubi-atlas-page');
  }
  queueLayout();
 });
 mutations.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['data-workspace-screen','hidden']});observeLayout();
 const click=event=>{
  if(!allowed())return;stopEffects();pendingLayout.clear();layoutUntil=performance.now()+motionDuration('enter')+motionDuration('capture');for(const [node,box] of boxes)if(box)pendingLayout.set(node,box);
  const button=event.target.closest('button,a,summary');
  if(button){const back=/돌아|이전|목록으로|탐색으로/.test(button.getAttribute('aria-label')||button.textContent);doc.documentElement.style.setProperty('--nubi-navigation-offset',back?'-12px':'12px');}
  const source=event.target.closest('.nubi-mail-result,.nubi-wiki-result,.nubi-file-card')||event.target.closest('.nubi-mail-table tr,.nubi-wiki-table tbody tr')?.querySelector('.nubi-mail-result,.nubi-wiki-result');
  if(source&&!source.disabled){const title=(source.querySelector('strong')?.textContent||source.getAttribute('title')||source.textContent).trim();selection={rect:rect(source),title};const pending=selection;later(()=>{if(selection===pending)selection=null;},1000);queueLayout();}
 };
 function menu(event){
  if(event.newState!=='open'||!event.target.matches?.('.nubi-actions-disclosure-body'))return;
  queueMicrotask(()=>animate(event.target,[{transform:'scale(.92)',opacity:.55},{transform:'none',opacity:1}],'nubi-atlas-menu'));
 }
 // Horizontal intent reveals the existing management menu. No operation is
 // executed by swiping; its original confirmation and disabled state remain.
 function down(event){
  if(!allowed()||event.button!==0||event.pointerType==='mouse')return;
  const row=event.target.closest('.nubi-session-row');if(!row||event.target.closest('.nubi-session-actions'))return;
  drag={row,node:row.querySelector('.nubi-session-select'),x:event.clientX,y:event.clientY,id:event.pointerId,moved:false};
 }
 const pointer=frameCoalescer(event=>{
  if(!allowed())return;
  if(drag)return;
  const rail=event.target.closest('.nubi-workspace-rail');
  if(rail){
   const buttons=[...rail.querySelectorAll('button')].filter(button=>button.getClientRects().length),near=buttons.map(button=>({button,weight:Math.max(0,1-Math.abs(event.y-(button.getBoundingClientRect().top+button.offsetHeight/2))/70)})).sort((a,b)=>b.weight-a.weight).slice(0,3);
   resetDock();for(const {button,weight} of near){const glyph=button.querySelector('svg,img'),lucide=glyph?.dataset.iconSet==='lucide',icon=lucide?glyph.querySelector('.nubi-icon-drawing'):glyph;if(icon){icon.dataset.nubiDockIcon='';icon.style.transform=lucide?`translateY(${-weight*.5}px) scale(${1+weight*.04})`:`translateX(${weight*2}px) scale(${1+weight*.2})`;}}
  }else resetDock();
  const welcome=event.target.closest('.welcome');if(welcome){welcome.dataset.nubiDepth='';const r=welcome.getBoundingClientRect(),x=Math.max(-1,Math.min(1,(event.x-r.left)/r.width*2-1)),y=Math.max(-1,Math.min(1,(event.y-r.top)/r.height*2-1));welcome.style.setProperty('--nubi-depth-x',`${x*8}px`);welcome.style.setProperty('--nubi-depth-y',`${y*6}px`);welcome.style.setProperty('--nubi-depth-rotate',`${x*4}deg`);welcome.style.setProperty('--nubi-depth-tilt',`${y*-3}deg`);}else for(const node of root.querySelectorAll('[data-nubi-depth]'))resetDepth(node);
 });
 const resetDock=()=>{for(const icon of root.querySelectorAll('[data-nubi-dock-icon]'))icon.style.transform='';};
 function move(event){
  if(drag&&event.pointerId===drag.id){
   const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
   if(!drag.moved&&Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){drag=null;return;}
   if(!drag.moved&&dx< -12&&Math.abs(dx)>Math.abs(dy)*1.5){drag.moved=true;drag.row.setPointerCapture(event.pointerId);drag.row.dataset.nubiSwiping='';}
   if(drag.moved){event.preventDefault();drag.row.style.setProperty('--nubi-swipe-x',Math.max(-72,Math.min(0,dx))+'px');}return;
  }
  if(event.pointerType!=='touch')pointer.schedule({target:event.target,x:event.clientX,y:event.clientY});
 }
 function up(event){
  if(!drag||drag.id!==event.pointerId)return;const current=drag;drag=null;delete current.row.dataset.nubiSwiping;current.row.style.removeProperty('--nubi-swipe-x');
  if(current.row.hasPointerCapture(event.pointerId))current.row.releasePointerCapture(event.pointerId);
  if(current.moved){
   // Open first: the compatibility-click guard must not swallow this explicit
   // programmatic activation of the existing summary.
   if(event.type==='pointerup'&&event.clientX-current.x< -38)current.row.querySelector('.nubi-actions-disclosure>summary')?.click();
   const suppress=event=>{event.preventDefault();event.stopPropagation();};current.row.addEventListener('click',suppress,{capture:true,once:true});later(()=>current.row.removeEventListener('click',suppress,true),300);
  }
 }
 function restoreRubber(){if(!rubber)return;const node=rubber;rubber=null;node.style.removeProperty('transform');delete node.dataset.nubiElastic;animate(node,[{transform:node.dataset.nubiElasticOffset||'none'},{transform:'none'}],'nubi-atlas-elastic');delete node.dataset.nubiElasticOffset;}
 function wheel(event){
  if(!allowed()||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||Math.abs(event.deltaY)<1)return;
  const viewport=event.target.closest('.nubi-mail-results,.nubi-wiki-explorer,.nubi-sidebar-body');if(!viewport||viewport.scrollHeight<=viewport.clientHeight+1)return;
  if(!((viewport.scrollTop<=0&&event.deltaY<0)||(viewport.scrollTop+viewport.clientHeight>=viewport.scrollHeight-1&&event.deltaY>0)))return;
  const node=viewport.querySelector('.nubi-mail-table,.nubi-wiki-results,.nubi-sidebar-history');if(!node||node.contains(doc.activeElement)&&doc.activeElement.matches('input,textarea,[contenteditable]'))return;
  if(rubber&&rubber!==node)restoreRubber();rubber=node;const offset=`translateY(${Math.max(-12,Math.min(12,-event.deltaY*.12))}px)`;node.dataset.nubiElastic='';node.dataset.nubiElasticOffset=offset;node.style.transform=offset;
  if(rubberTimer){clearTimeout(rubberTimer);timers.delete(rubberTimer);}rubberTimer=later(restoreRubber,70);
 }
 function resetDepth(node){for(const name of ['x','y','rotate','tilt'])node.style.removeProperty('--nubi-depth-'+name);}
 function clear(){stopEffects();pendingLayout.clear();pointer.cancel();resetDock();if(drag){delete drag.row.dataset.nubiSwiping;drag.row.style.removeProperty('--nubi-swipe-x');drag=null;}if(rubber){rubber.style.removeProperty('transform');delete rubber.dataset.nubiElastic;delete rubber.dataset.nubiElasticOffset;rubber=null;}for(const node of root.querySelectorAll('[data-nubi-depth]'))resetDepth(node);}
 // A covered workspace must release its old decorations immediately. Merely
 // declining new effects leaves a dock/lens or morph frozen behind the dialog.
 const contextChange=()=>{if(!allowed())clear();};
 const contextObserver=new MutationObserver(contextChange);
 contextObserver.observe(doc.documentElement,{attributes:true,attributeFilter:['data-nubi-window-hidden','data-project-switching','data-motion-panel']});
 const leave=()=>{pointer.cancel();resetDock();for(const node of root.querySelectorAll('[data-nubi-depth]'))resetDepth(node);};
 root.dataset.interactions='on';
 root.addEventListener('click',click,true);root.addEventListener('pointerdown',down);root.addEventListener('pointermove',move);root.addEventListener('pointerup',up);root.addEventListener('pointercancel',up);root.addEventListener('pointerleave',leave);root.addEventListener('wheel',wheel,{passive:true});doc.addEventListener('beforetoggle',menu,true);
 media.addEventListener('change',clear);doc.addEventListener('visibilitychange',clear);doc.addEventListener('nubi-motion-change',contextChange);
 return()=>{disposed=true;clear();sizes.disconnect();mutations.disconnect();contextObserver.disconnect();cancelAnimationFrame(layoutFrame);for(const timer of timers)clearTimeout(timer);delete root.dataset.interactions;root.removeEventListener('click',click,true);root.removeEventListener('pointerdown',down);root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',up);root.removeEventListener('pointerleave',leave);root.removeEventListener('wheel',wheel);doc.removeEventListener('beforetoggle',menu,true);media.removeEventListener('change',clear);doc.removeEventListener('visibilitychange',clear);doc.removeEventListener('nubi-motion-change',contextChange);};
}
export function useWorkspaceInteractions(ref){useEffect(()=>installWorkspaceInteractions(ref.current),[ref]);}
