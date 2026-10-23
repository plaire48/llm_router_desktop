import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtmosphereRenderer} from '../ui/atmosphere-renderer.mjs';
import {createGlassRenderer} from '../ui/liquid-glass/renderer.mjs';

function graphics({parallel=true,linked=true}={}){
 const blocking=[],deleted=[];let completed=false,draws=0;
 const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,
  getExtension:name=>name==='KHR_parallel_shader_compile'&&parallel?{COMPLETION_STATUS_KHR:5}:null,
  createShader:()=>({}),createProgram:()=>({}),createBuffer:()=>({}),createTexture:()=>({}),
  getShaderParameter(){blocking.push('compile');return true;},
  getProgramParameter(_program,name){if(name===5)return completed;blocking.push('link');return linked;},
  getAttribLocation:()=>0,getUniformLocation:()=>({}),drawArrays(){draws++;}
 };
 for(const name of ['shaderSource','compileShader','attachShader','linkProgram','useProgram','bindBuffer','bufferData','enableVertexAttribArray','vertexAttribPointer','clearColor','viewport','activeTexture','bindTexture','texParameteri','pixelStorei','uniform1i','uniform1f','uniform2f','uniform2fv','uniform3fv','uniform4fv','uniform1fv','texImage2D','clear','enable','scissor','disable'])gl[name]=()=>{};
 for(const name of ['deleteShader','deleteProgram','deleteBuffer','deleteTexture'])gl[name]=value=>deleted.push(value);
 return {canvas:{getContext:()=>gl},blocking,deleted,complete:()=>completed=true,get draws(){return draws;}};
}
for(const [name,create] of [['colour field',createAtmosphereRenderer],['glass lens',createGlassRenderer]]){
 test(`${name} never waits for incomplete GPU compilation on the input thread`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const gpu=graphics(),renderer=create(gpu.canvas);assert(renderer);
  assert.deepEqual(gpu.blocking,[],'compile/link status queries can synchronously stall the renderer');
  renderer.resize(240,100,1,{});renderer.draw({x:1,y:1,width:80,height:40,phase:0,values:{x:0,y:0}},Array(6).fill([1,1,1]));assert.equal(gpu.draws,0,'CSS remains visible while shaders are pending');
  t.mock.timers.tick(16);await Promise.resolve();assert.deepEqual(gpu.blocking,[]);
  gpu.complete();t.mock.timers.tick(16);assert.equal(await renderer.ready,true);assert.deepEqual(gpu.blocking,['link']);
  renderer.draw({x:1,y:1,width:80,height:40,phase:0,values:{x:0,y:0}},Array(6).fill([1,1,1]));assert.equal(gpu.draws,1);renderer.dispose();
 });
 test(`${name} disposal settles pending work without reviving a removed surface`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const gpu=graphics(),renderer=create(gpu.canvas);renderer.dispose();gpu.complete();t.mock.timers.tick(64);
  assert.equal(await renderer.ready,false);assert.deepEqual(gpu.blocking,[]);assert.equal(gpu.draws,0);assert(gpu.deleted.length>=3);
 });
 test(`${name} without parallel compilation yields the current task before checking the link`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const gpu=graphics({parallel:false}),renderer=create(gpu.canvas);assert.deepEqual(gpu.blocking,[]);
  t.mock.timers.tick(1);assert.equal(await renderer.ready,true);assert.deepEqual(gpu.blocking,['link']);renderer.dispose();
 });
 test(`${name} failed linking releases graphics resources and keeps the CSS surface`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const gpu=graphics({linked:false}),renderer=create(gpu.canvas);gpu.complete();t.mock.timers.tick(16);
  assert.equal(await renderer.ready,false);assert.equal(gpu.draws,0);assert(gpu.deleted.length>=3);renderer.dispose();
 });
}
