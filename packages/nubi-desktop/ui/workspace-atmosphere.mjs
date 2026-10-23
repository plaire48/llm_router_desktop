import {atmosphereAllowed,createAtmosphereMotion,stepAtmosphereMotion} from './atmosphere-model.mjs';
import {createAtmosphereRenderer} from './atmosphere-renderer.mjs';
const color=value=>{
 const hex=value.trim().match(/^#([\da-f]{6})$/i);if(hex)return [0,2,4].map(at=>parseInt(hex[1].slice(at,at+2),16)/255);
 const rgb=value.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);return rgb?rgb.slice(1,4).map(Number).map(v=>v/255):[.192,.51,.965];
};
// One bounded renderer on the visible loading or workspace surface. No React updates or
// layout reads on animation frames, and no catch-up jump after a hidden window.
export function startWorkspaceAtmosphere(node,canvas,{scene='intro',active=true}={}){
 const root=document.documentElement,reduced=matchMedia('(prefers-reduced-motion: reduce)'),forced=matchMedia('(forced-colors: active)');
 const state=createAtmosphereMotion(),pointer={x:0,y:0};let renderer=null,attempted=false,visible=false,frame=0,last=0,disposed=false,lost=false,rect=null,colors,cycle=48;
 const surface=node.parentElement;
 const stop=()=>{cancelAnimationFrame(frame);frame=0;last=0;node.dataset.running='false';};
 const allowed=()=>atmosphereAllowed({scene,active,visible,hidden:document.hidden,reduced:reduced.matches,forcedColors:forced.matches,windowHidden:root.hasAttribute('data-nubi-window-hidden')||root.getAttribute('data-motion-visibility')==='hidden'||root.getAttribute('data-motion')==='paused',transition:root.hasAttribute('data-nubi-transition'),opening:root.getAttribute('data-intro')==='true'||document.body.hasAttribute('data-nubi-opening')||scene==='workspace'&&root.getAttribute('data-preparing')==='true',switching:root.hasAttribute('data-project-switching'),modal:root.hasAttribute('data-motion-panel')});
 const resize=()=>{
  rect=surface.getBoundingClientRect();const style=getComputedStyle(node);colors=['--nuvi-mint','--nuvi-aqua','--nuvi-sky','--nuvi-periwinkle','--nuvi-iris','--nuvi-lavender'].map(name=>color(style.getPropertyValue(name)));
  cycle=parseFloat(style.getPropertyValue('--nubi-atmosphere-cycle'))||48;
  renderer?.resize(rect.width,rect.height,devicePixelRatio);if(renderer&&!frame)renderer.draw(state,colors);
 };
 const tick=now=>{
  frame=0;if(disposed||lost||!allowed()){stop();return;}
  const elapsed=last?Math.max(0,(now-last)/1000):0;last=now;
  stepAtmosphereMotion(state,elapsed,pointer,{cycle});renderer.draw(state,colors);frame=requestAnimationFrame(tick);
 };
 const sync=()=>{
  if(disposed||lost||!allowed()){stop();return;}
  if(!attempted){attempted=true;renderer=createAtmosphereRenderer(canvas);node.dataset.renderer=renderer?'webgl':'static';if(renderer){node.dataset.budget=String(renderer.budget);resize();}}
  if(renderer&&!frame){node.dataset.running='true';frame=requestAnimationFrame(tick);}
 };
 const enter=event=>{if(!rect||event.pointerType==='touch')return;pointer.x=Math.max(-1,Math.min(1,(event.clientX-rect.left)/rect.width*2-1));pointer.y=Math.max(-1,Math.min(1,1-(event.clientY-rect.top)/rect.height*2));};
 const leave=()=>{pointer.x=0;pointer.y=0;};
 const lostContext=event=>{event.preventDefault();lost=true;stop();node.dataset.renderer='static';};
 const restored=()=>{if(disposed)return;renderer?.dispose();renderer=null;lost=false;attempted=false;sync();};
 const sizes=new ResizeObserver(()=>{resize();sync();});sizes.observe(surface);
 const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting===true;sync();});intersection.observe(node);
 const attributes=new MutationObserver(sync);attributes.observe(root,{attributes:true,attributeFilter:['data-intro','data-preparing','data-project-switching','data-motion-panel','data-nubi-window-hidden','data-nubi-transition','data-motion','data-motion-visibility']});attributes.observe(document.body,{attributes:true,attributeFilter:['data-nubi-opening']});
 for(const media of [reduced,forced])media.addEventListener('change',sync);
 document.addEventListener('visibilitychange',sync);document.addEventListener('nubi-motion-change',sync);surface.addEventListener('pointermove',enter,{passive:true});surface.addEventListener('pointerleave',leave,{passive:true});canvas.addEventListener('webglcontextlost',lostContext);canvas.addEventListener('webglcontextrestored',restored);
 resize();sync();
 return()=>{disposed=true;stop();sizes.disconnect();intersection.disconnect();attributes.disconnect();for(const media of [reduced,forced])media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);document.removeEventListener('nubi-motion-change',sync);surface.removeEventListener('pointermove',enter);surface.removeEventListener('pointerleave',leave);canvas.removeEventListener('webglcontextlost',lostContext);canvas.removeEventListener('webglcontextrestored',restored);renderer?.dispose();};
}
