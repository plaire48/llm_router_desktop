// Morph the dialog surface, not its text. The live panel takes its natural size
// immediately; an inert surface behind it bridges the old/new bounds with FLIP.
// No per-frame React updates, layout animation or delayed focus/approval state.
export function installModalResizeMotion(allowed){
 if(typeof ResizeObserver!=='function')return()=>{};
 const records=new Map(),viewport=()=>`${innerWidth}:${innerHeight}`;
 const bounds=panel=>{const r=panel.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};
 const layoutBounds=panel=>{
  const r=bounds(panel),transform=new DOMMatrixReadOnly(getComputedStyle(panel).transform),width=panel.offsetWidth,height=panel.offsetHeight;
  return {left:r.left+(r.width-width)/2-transform.m41,top:r.top+(r.height-height)/2-transform.m42,width,height};
 };
 const stop=record=>{record.animation?.cancel();record.reveal?.cancel();record.surface?.remove();record.panel.classList.remove('nubi-modal-morphing');record.animation=record.reveal=record.surface=null;};
 function morph(record,from,to){
  stop(record);
  const panel=record.panel,backdrop=panel.parentElement;
  if(!allowed()||!panel.isConnected||!from?.width||!to.width||Math.abs(from.width-to.width)+Math.abs(from.height-to.height)<2)return;
  panel.dataset.modalSettled='true';
  const style=getComputedStyle(panel),surface=document.createElement('div');
  surface.className='nubi-modal-morph-surface';surface.setAttribute('aria-hidden','true');surface.inert=true;
  Object.assign(surface.style,{left:`${to.left}px`,top:`${to.top}px`,width:`${to.width}px`,height:`${to.height}px`,background:style.background,borderRadius:style.borderRadius,boxShadow:style.boxShadow});
  backdrop.append(surface);record.surface=surface;panel.classList.add('nubi-modal-morphing');
  const duration=parseFloat(style.getPropertyValue('--nubi-modal-resize'))||360,easing=style.getPropertyValue('--nubi-modal-resize-ease').trim()||'cubic-bezier(.22,1,.36,1)';
  record.animation=surface.animate([{transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width},${from.height/to.height})`},{transform:'none'}],{duration,easing});
  record.reveal=panel.animate([{opacity:.35},{opacity:1}],{duration:160,easing:'ease-out'});
  const animation=record.animation;
  animation.finished.then(()=>{if(record.animation===animation)stop(record);},()=>{});
 }
 const observer=new ResizeObserver(entries=>{
  for(const {target:panel} of entries){
   const record=records.get(panel);if(!record||!panel.isConnected)continue;
   const next=layoutBounds(panel),screen=viewport();
   if(record.rect&&record.viewport===screen){const from=record.surface?bounds(record.surface):record.rect;morph(record,from,next);}
   else stop(record);
   record.rect=next;record.viewport=screen;
  }
 });
 function attach(backdrop,from){
  if(!backdrop.matches?.('.cx-panel-backdrop:is(.is-modal,.is-confirmation):not([data-modal-motion="leaving"])'))return;
  const panel=backdrop.querySelector(':scope > .cx-detail-panel');if(!panel||records.has(panel))return;
  const record={panel,rect:null,viewport:viewport()};records.set(panel,record);observer.observe(panel);
  if(from){record.rect=layoutBounds(panel);morph(record,from,record.rect);}
 }
 const mutations=new MutationObserver(changes=>{
  let previous;
  for(const change of changes)for(const node of change.removedNodes){
   for(const [panel,record] of records)if(node===panel.parentElement||node.contains?.(panel)){
    previous=record.surface?.isConnected?bounds(record.surface):record.rect;stop(record);observer.unobserve(panel);records.delete(panel);
   }
  }
  for(const change of changes)for(const node of change.addedNodes)if(node instanceof Element)attach(node,previous);
 });
 mutations.observe(document.body,{childList:true});
 for(const node of document.querySelectorAll('.cx-panel-backdrop'))attach(node);
 const quiet=()=>{if(!allowed())for(const record of records.values())stop(record);};
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');reduced.addEventListener('change',quiet);document.addEventListener('visibilitychange',quiet);
 return()=>{mutations.disconnect();observer.disconnect();reduced.removeEventListener('change',quiet);document.removeEventListener('visibilitychange',quiet);for(const record of records.values())stop(record);records.clear();};
}
