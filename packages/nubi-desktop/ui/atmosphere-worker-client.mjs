import {ATMOSPHERE_LIMITS} from './atmosphere-model.mjs';

// One frame in flight and one replaceable latest frame. A slow GPU may finish
// later, but cannot accumulate messages or block input/layout on the renderer.
export function createAtmosphereWorkerRenderer(canvas,url,{kind='atmosphere',colors,WorkerClass=globalThis.Worker,timeoutMs=10000}={}){
 let worker;
 try{worker=new WorkerClass(url,{type:'module',name:kind==='glass'?'nubi-glass-lens':kind==='ring'?'nubi-glass-ring':'nubi-colour-field'});}catch{return null;}
 let ready=false,disposed=false,inFlight=null,pending=null,sequence=0,resolve;
 const listeners=new Set(),result=new Promise(done=>resolve=done),metrics={frames:0,rect:null,buffer:[0,0]};
 const publish=state=>{for(const listener of listeners)listener(state);};
 const fail=event=>{event?.preventDefault?.();if(disposed)return;ready=false;pending=null;resolve(false);publish('failed');dispose();};
 const timer=setTimeout(fail,timeoutMs);
 const send=value=>{try{worker.postMessage(value);return true;}catch{fail();return false;}};
 const flush=()=>{if(!disposed&&ready&&inFlight===null&&pending){const value=pending;pending=null;inFlight=++sequence;send({type:'draw',id:inFlight,...value});}};
 const receive=event=>{
  if(disposed)return;const value=event.data;
  if(value?.type==='ready'){clearTimeout(timer);ready=true;adapter.budget=value.budget;adapter.material=value.material;resolve(true);publish('ready');flush();}
  else if(value?.type==='size'){metrics.buffer=[value.width,value.height];canvas.dataset.renderWidth=String(value.width);canvas.dataset.renderHeight=String(value.height);}
  else if(value?.type==='frame'&&value.id===inFlight){metrics.frames++;if(value.rect!==undefined)metrics.rect=value.rect;inFlight=null;flush();}
  else if(value?.type==='lost'){ready=false;inFlight=null;pending=null;publish('lost');}
  else if(value?.type==='failed')fail();
 };
 function dispose(){if(disposed)return;disposed=true;clearTimeout(timer);resolve(false);pending=null;worker.removeEventListener('message',receive);worker.removeEventListener('error',fail);worker.terminate();listeners.clear();}
 const adapter={ready:result,budget:kind==='glass'?180000:kind==='ring'?ATMOSPHERE_LIMITS.ringPixels:ATMOSPHERE_LIMITS.pixels,material:kind==='glass'?'glass-lens':kind==='ring'?'liquid-glass-ring':'organic-field',thread:'worker',metrics,
  resize(width,height,dpr,palette){if(!disposed)send({type:'resize',width,height,dpr,palette});},
  draw(state,colors){if(disposed)return;pending={state:structuredClone(state),colors};flush();},
  pause(){pending=null;},onState(listener){listeners.add(listener);return()=>listeners.delete(listener);},dispose
 };
 worker.addEventListener('message',receive);worker.addEventListener('error',fail);
 try{const surface=canvas.transferControlToOffscreen();worker.postMessage({type:'init',kind,colors,canvas:surface},[surface]);}
 catch{dispose();return null;}
 return adapter;
}
