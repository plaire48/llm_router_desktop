import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtmosphereWorkerRenderer} from '../ui/atmosphere-worker-client.mjs';
import {installAtmosphereWorker} from '../ui/atmosphere-worker.mjs';

class Port{
 listeners=new Map();sent=[];terminated=false;
 addEventListener(name,fn){this.listeners.set(name,fn);}
 removeEventListener(name){this.listeners.delete(name);}
 postMessage(value){this.sent.push(value);}
 emit(value){this.listeners.get('message')?.({data:value});}
 terminate(){this.terminated=true;}
}
function fixture(){let port;const canvas={dataset:{},transferControlToOffscreen:()=>({})};const renderer=createAtmosphereWorkerRenderer(canvas,'fixture-worker.mjs',{WorkerClass:class extends Port{constructor(){super();port=this;}}});return {renderer,canvas,get port(){return port;}};}
test('a slow background GPU has one in-flight frame and only the newest pending state',async()=>{
 const f=fixture();try{f.port.emit({type:'ready',budget:24000,material:'organic-field'});assert.equal(await f.renderer.ready,true);
  for(let phase=0;phase<100;phase++)f.renderer.draw({phase,values:{x:0,y:0}},[[1,0,0]]);
  const first=f.port.sent.filter(x=>x.type==='draw');assert.equal(first.length,1);assert.equal(first[0].state.phase,0);
  f.port.emit({type:'frame',id:first[0].id});const next=f.port.sent.filter(x=>x.type==='draw');assert.equal(next.length,2);assert.equal(next[1].state.phase,99);
  f.renderer.pause();f.port.emit({type:'frame',id:next[1].id});assert.equal(f.port.sent.filter(x=>x.type==='draw').length,2);
  assert.equal(f.renderer.budget,24000);
 }finally{f.renderer.dispose();}assert(f.port.terminated);
});
test('worker startup failure/disposal settles readiness and ignores late ready/frame replies',async()=>{
 for(const failed of [true,false]){const f=fixture();if(failed)f.port.emit({type:'failed'});else f.renderer.dispose();assert.equal(await f.renderer.ready,false);assert(f.port.terminated);f.port.emit({type:'ready'});f.renderer.draw({phase:1},[]);assert.equal(f.port.sent.filter(x=>x.type==='draw').length,0);}
});
test('the worker owns GPU creation, exact motion/palette, dimensions and context restoration',async()=>{
 const port=new Port(),canvas=new Port(),draws=[],sizes=[];let creations=0,disposals=0;
 const stop=installAtmosphereWorker(port,()=>{creations++;return {ready:Promise.resolve(true),budget:64000,material:'organic-field',resize:(width,height)=>{sizes.push([width,height]);canvas.width=width;canvas.height=height;},draw:(...args)=>draws.push(args),dispose:()=>disposals++};});
 port.emit({type:'init',canvas});port.emit({type:'resize',width:200,height:100,dpr:1});await Promise.resolve();
 assert.equal(creations,1);assert.deepEqual(sizes,[[200,100]]);const state={phase:.2,values:{x:.1,y:.2}},colors=[[1,.5,.2]];
 port.emit({type:'draw',id:7,state,colors});assert.deepEqual(draws,[[state,colors]]);assert(port.sent.some(x=>x.type==='frame'&&x.id===7));
 canvas.listeners.get('webglcontextlost')({preventDefault(){}});assert(port.sent.some(x=>x.type==='lost'));
 canvas.listeners.get('webglcontextrestored')();await Promise.resolve();assert.equal(creations,2);assert.deepEqual(sizes,[[200,100],[200,100]]);stop();assert.equal(disposals,2);
});
test('late loading of the 3D renderer cannot revive a disposed worker',async()=>{
 const port=new Port(),canvas=new Port();let resolve,disposals=0;
 const stop=installAtmosphereWorker(port,()=>new Promise(done=>resolve=done));port.emit({type:'init',canvas,kind:'ring'});stop();
 resolve({dispose:()=>disposals++});await Promise.resolve();assert.equal(disposals,1);assert.deepEqual(port.sent,[]);
});
test('a resize allocation failure reports failure instead of leaving the surface waiting',async()=>{
 const port=new Port(),canvas=new Port();let disposals=0;
 const stop=installAtmosphereWorker(port,()=>({ready:Promise.resolve(true),resize(){throw Error('allocation');},dispose:()=>disposals++}));
 port.emit({type:'init',canvas});await Promise.resolve();port.emit({type:'resize',width:1,height:1,dpr:1});
 assert(port.sent.some(value=>value.type==='failed'));assert.equal(disposals,1);stop();
});
