import React,{useLayoutEffect,useRef} from 'react';
import {createGlassRenderer} from './renderer.mjs';
import {glassPalette,paintGlassBackdrop} from './backdrop.mjs';
import {createGlassSpring,targetGlassSpring,stepGlassSpring} from './spring.mjs';
import './liquid-glass.css';

// An inert decorative child of an existing navigation/tab container. The host
// retains selection, keyboard focus, routing and all input event ownership.
export function GlassSurface({axis='x',selector='[role="tab"][aria-selected="true"]',targetWrapper}){
 const layer=useRef(null);
 useLayoutEffect(()=>installGlassSurface(layer.current,{axis,selector,targetWrapper}),[axis,selector,targetWrapper]);
 return <span ref={layer} className="nubi-liquid-glass" aria-hidden="true" inert="">
  <canvas className="nubi-liquid-glass__backdrop"/><span className="nubi-liquid-glass__selection"/><canvas className="nubi-liquid-glass__lens"/>
 </span>;
}

export function installGlassSurface(layer,{axis='x',selector,targetWrapper}={}){
 if(!layer)return()=>{};
 const host=layer.parentElement,doc=host.ownerDocument,root=doc.documentElement;
 const [backdrop,canvas]=layer.querySelectorAll('canvas');
 const selection=layer.querySelector('.nubi-liquid-glass__selection');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),opaque=matchMedia('(prefers-reduced-transparency: reduce)'),forced=matchMedia('(forced-colors: active)');
 let renderer=null,spring=null,frame=0,measureFrame=0,previous=0,disposed=false,visible=true,lost=false;
 let width=0,height=0,dpr=1,radius=14,pointer=[-1000,-1000],pressed=false,hover=false,interaction=1,target=null;
 let textureWidth=0,textureHeight=0,textureDpr=0;
 const metrics={frames:0,textureUploads:0,pixels:0};layer.glassMetrics=metrics;
 host.classList.add('nubi-liquid-glass-host');
 const quiet=()=>doc.hidden||!visible||root.hasAttribute('data-nubi-window-hidden')||root.hasAttribute('data-motion-panel')||root.hasAttribute('data-project-switching')||!!doc.querySelector('.nubi-intro,.cx-panel-backdrop');
 const supported=()=>!opaque.matches&&!forced.matches&&!lost;
 const mark=(state,moving=false)=>{host.dataset.liquidGlass=state;layer.dataset.glassMoving=String(moving);};
 const cancel=()=>{cancelAnimationFrame(frame);frame=0;previous=0;mark(renderer&&supported()?'webgl':'fallback');};
 function draw(rect,now){
  if(!renderer||quiet()||!supported())return;
  const scale=reduced.matches?1:interaction;
  const shaped=rect?{x:rect.x+rect.width*(1-scale)/2,y:rect.y+rect.height*(1-scale)/2,width:rect.width*scale,height:rect.height*scale}:null;
  selection.hidden=!shaped;
  if(shaped)Object.assign(selection.style,{transform:`translate3d(${shaped.x}px,${shaped.y}px,0)`,width:shaped.width+'px',height:shaped.height+'px',borderRadius:radius+'px'});
  renderer.draw(shaped,{pointer,strength:.78,time:reduced.matches?0:now/1000,radius});metrics.frames++;
 }
 function tick(now){
  frame=0;if(disposed||quiet()||!supported()||!renderer)return cancel();
  const dt=Math.min(.1,(now-(previous||now-16.67))/1000);previous=now;
  const result=spring?stepGlassSpring(spring,dt,{axis,reduced:reduced.matches}):{rect:null,moving:false};
  const desired=pressed?.96:hover?1.025:1;
  interaction=reduced.matches?1:interaction+(desired-interaction)*(1-Math.exp(-dt*20));
  const moving=result.moving||Math.abs(desired-interaction)>.0002;
  // Present each display frame. A 25ms gate on a 60Hz display discards every
  // other frame and makes the spring visibly step at 30fps. Pixel bounds and
  // stopping the idle loop bound GPU work without dropping moving frames.
  draw(result.rect,now);
  mark('webgl',moving);
  if(moving)frame=requestAnimationFrame(tick);else previous=0;
 }
 const wake=()=>{if(!frame&&!quiet()&&supported()&&renderer)frame=requestAnimationFrame(tick);};
 function measure(){
  measureFrame=0;if(disposed)return;
  if(!supported()){cancel();mark('fallback');return;}
  const bounds=host.getBoundingClientRect();width=host.clientWidth;height=host.clientHeight;
  if(!width||!height||quiet()){cancel();return;}
  if(!renderer)renderer=createGlassRenderer(canvas);
  if(!renderer){mark('fallback');return;}
  // At most 180k backing pixels per surface, even on Retina/4K displays.
  dpr=Math.min(devicePixelRatio||1,1.5,Math.sqrt(180000/(width*height)));
  Object.assign(layer.style,{left:host.scrollLeft+'px',top:host.scrollTop+'px',width:width+'px',height:height+'px'});
  if(width!==textureWidth||height!==textureHeight||dpr!==textureDpr){
   if(!paintGlassBackdrop(backdrop,width,height,dpr,glassPalette(host))){mark('fallback');return;}
   renderer.resize(width,height,dpr,backdrop);textureWidth=width;textureHeight=height;textureDpr=dpr;metrics.textureUploads++;metrics.pixels=canvas.width*canvas.height;
  }
  const selected=host.querySelector(selector),node=targetWrapper?selected?.closest(targetWrapper)||selected:selected;
  if(node?.checkVisibility()){
   const box=node.getBoundingClientRect();target={x:box.left-bounds.left-host.clientLeft,y:box.top-bounds.top-host.clientTop,width:box.width,height:box.height};
   radius=parseFloat(getComputedStyle(node).borderTopLeftRadius)||14;
   if(!spring)spring=createGlassSpring(target);else targetGlassSpring(spring,target,{snap:reduced.matches});
  }else{target=null;spring=null;}
  mark('webgl');wake();
 }
 const queue=()=>{if(!disposed&&!measureFrame)measureFrame=requestAnimationFrame(measure);};
 const media=()=>{if(!supported()){cancel();mark('fallback');}else{textureWidth=0;queue();}};
 const resize=new ResizeObserver(queue);resize.observe(host);
 const mutations=new MutationObserver(records=>{if(records.some(record=>!layer.contains(record.target)))queue();});
 mutations.observe(host,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-selected','aria-pressed','aria-current','hidden']});
 const rootChanges=new MutationObserver(()=>{if(quiet())cancel();else queue();});
 rootChanges.observe(root,{attributes:true,attributeFilter:['data-motion-panel','data-nubi-window-hidden','data-project-switching']});
 const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;if(visible)queue();else cancel();});intersection.observe(host);
 const move=event=>{if(reduced.matches||quiet())return;const box=layer.getBoundingClientRect();pointer=[event.clientX-box.left,event.clientY-box.top];const hit=target&&pointer[0]>=target.x&&pointer[0]<=target.x+target.width&&pointer[1]>=target.y&&pointer[1]<=target.y+target.height;hover=!!hit;wake();};
 const leave=()=>{pointer=[-1000,-1000];hover=false;pressed=false;wake();};
 const down=event=>{if(event.target.closest('button,[role=tab]')){pressed=true;move(event);wake();}};
 const up=()=>{pressed=false;wake();};
 const contextLost=event=>{event.preventDefault();lost=true;renderer=null;cancel();mark('fallback');};
 const contextRestored=()=>{lost=false;textureWidth=0;renderer=null;queue();};
 canvas.addEventListener('webglcontextlost',contextLost);canvas.addEventListener('webglcontextrestored',contextRestored);
 const events=[['scroll',queue],['pointermove',move],['pointerleave',leave],['pointerdown',down],['pointerup',up],['pointercancel',leave]];
 for(const [name,handler]of events)host.addEventListener(name,handler,{passive:true});
 doc.addEventListener('pointerup',up,{passive:true});doc.addEventListener('visibilitychange',media);doc.addEventListener('nubi-motion-change',queue);
 window.addEventListener('resize',queue,{passive:true});doc.fonts?.addEventListener('loadingdone',queue);doc.fonts?.ready.then(()=>{if(!disposed)queue();});
 for(const query of [reduced,opaque,forced])query.addEventListener('change',media);
 queue();
 return()=>{
  disposed=true;cancelAnimationFrame(frame);cancelAnimationFrame(measureFrame);resize.disconnect();mutations.disconnect();rootChanges.disconnect();intersection.disconnect();
  for(const [name,handler]of events)host.removeEventListener(name,handler);
  doc.removeEventListener('pointerup',up);doc.removeEventListener('visibilitychange',media);doc.removeEventListener('nubi-motion-change',queue);window.removeEventListener('resize',queue);doc.fonts?.removeEventListener('loadingdone',queue);
  for(const query of [reduced,opaque,forced])query.removeEventListener('change',media);
  canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);renderer?.dispose();
  delete host.dataset.liquidGlass;host.classList.remove('nubi-liquid-glass-host');delete layer.glassMetrics;
 };
}
