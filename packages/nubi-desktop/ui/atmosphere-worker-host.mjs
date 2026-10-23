import {createAtmosphereRenderer} from './atmosphere-renderer.mjs';
import {createGlassRenderer} from './liquid-glass/renderer.mjs';
import {paintGlassBackdrop} from './liquid-glass/backdrop.mjs';

const createWorkerRenderer=(canvas,kind,options)=>{
 if(kind==='ring')return import('./glass-ring-renderer.mjs').then(({createGlassRingRenderer})=>createGlassRingRenderer(canvas,options));
 const renderer=kind==='glass'?createGlassRenderer(canvas):createAtmosphereRenderer(canvas);return renderer&&Object.assign(renderer,kind==='glass'?{budget:180000,material:'glass-lens'}:{});
};
export function installAtmosphereWorker(port,create=createWorkerRenderer){
 let renderer=null,canvas=null,backdrop=null,kind='atmosphere',options,disposed=false,generation=0,size=null;
 const send=value=>{if(!disposed)port.postMessage(value);};
 const resize=()=>{if(!renderer||!size)return;if(kind==='glass'){backdrop||=new OffscreenCanvas(1,1);paintGlassBackdrop(backdrop,size.width,size.height,size.dpr,size.palette);}renderer.resize(size.width,size.height,size.dpr,backdrop);send({type:'size',width:canvas.width,height:canvas.height});};
 const initialize=async()=>{
  const epoch=++generation;renderer?.dispose();renderer=null;let candidate;
  try{const created=create(canvas,kind,options);candidate=created?.then?await created:created;}catch{}
  if(disposed||generation!==epoch){candidate?.dispose();return;}
  renderer=candidate;if(!renderer){send({type:'failed'});return;}
  let ready=false;try{resize();ready=candidate.ready?await candidate.ready:true;}catch{}
  if(disposed||generation!==epoch||renderer!==candidate)return;
  if(!ready){candidate.dispose();renderer=null;send({type:'failed'});return;}
  send({type:'ready',budget:candidate.budget,material:candidate.material});
 };
 const lost=event=>{event.preventDefault();++generation;renderer?.dispose();renderer=null;send({type:'lost'});};
 const restored=()=>{if(!disposed)void initialize();};
 const receive=event=>{
  const value=event.data;if(disposed||!value)return;
  if(value.type==='init'&&!canvas){canvas=value.canvas;kind=value.kind||'atmosphere';options={colors:value.colors};canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);void initialize();}
  else if(value.type==='resize'){size=value;try{resize();}catch{renderer?.dispose();renderer=null;send({type:'failed'});}}
  else if(value.type==='draw'){
   try{renderer?.draw(value.state,value.colors);send({type:'frame',id:value.id,...(kind==='glass'?{rect:value.state}:{} )});}
   catch{renderer?.dispose();renderer=null;send({type:'failed'});}
  }
 };
 port.addEventListener('message',receive);
 return()=>{disposed=true;++generation;port.removeEventListener('message',receive);canvas?.removeEventListener('webglcontextlost',lost);canvas?.removeEventListener('webglcontextrestored',restored);renderer?.dispose();};
}
