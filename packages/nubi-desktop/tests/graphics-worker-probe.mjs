import {createAtmosphereWorkerRenderer} from '../ui/atmosphere-worker-client.mjs';
import {createAtmosphereMotion} from '../ui/atmosphere-model.mjs';
window.probeGraphicsWorkers=async()=>{
 const {graphicsProbeURL}=await import('./graphics-worker-fixture.mjs'),results=[];
 const wait=async predicate=>{const deadline=performance.now()+6000;while(!predicate()){if(performance.now()>deadline)throw Error('graphics worker timeout');await new Promise(resolve=>setTimeout(resolve,16));}};
 for(const kind of ['atmosphere','glass','ring']){
  const canvas=document.createElement('canvas');canvas.style.cssText='width:260px;height:120px';document.body.append(canvas);let worker;const pixels=[],states=[];
  const renderer=createAtmosphereWorkerRenderer(canvas,graphicsProbeURL,{kind,colors:[[.2,.5,.96],[.4,.8,.9],[.7,.6,.9]],WorkerClass:class extends Worker{constructor(...args){super(...args);worker=this;this.addEventListener('message',event=>{if(event.data?.type==='probe-pixels')pixels.push(event.data);});}}});
  try{
   renderer.onState(state=>states.push(state));renderer.resize(260,120,1,{base:'#f1f7fe'});if(!await renderer.ready)throw Error('graphics worker unavailable');
   const rect={x:20,y:30,width:120,height:36,radius:18},options={width:260,height:120,opacity:1,phase:1};
   const draw=()=>kind==='glass'?renderer.draw(rect,options):renderer.draw(createAtmosphereMotion(),Array(6).fill([.2,.5,.96]));
   draw();await wait(()=>renderer.metrics.frames>0&&pixels.length>0);const first={...pixels.at(-1)},buffer=[...renderer.metrics.buffer];
   worker.postMessage({type:'probe-lose'});await wait(()=>states.includes('lost'));const frames=renderer.metrics.frames;
   worker.postMessage({type:'probe-restore'});await wait(()=>states.filter(x=>x==='ready').length===2);draw();await wait(()=>renderer.metrics.frames>frames&&pixels.length>1);
   results.push({kind,first,restored:pixels.at(-1),buffer,states,frames:renderer.metrics.frames});
  }finally{renderer?.dispose();canvas.remove();}
 }
 return results;
};
