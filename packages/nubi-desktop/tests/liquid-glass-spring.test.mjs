import test from 'node:test';
import assert from 'node:assert/strict';
import {createGlassSpring,targetGlassSpring,stepGlassSpring} from '../ui/liquid-glass/spring.mjs';
const rect=(x=0,y=0,width=104,height=40)=>({x,y,width,height});
test('the same elapsed movement stays consistent across 30Hz, 60Hz and 120Hz',()=>{
 const positions=[30,60,120].map(hz=>{const state=createGlassSpring(rect());targetGlassSpring(state,rect(600));for(let frame=0;frame<hz/5;frame++)stepGlassSpring(state,1/hz);return state.values.x;});
 assert(Math.max(...positions)-Math.min(...positions)<1,JSON.stringify(positions));
});
test('selection travels, stretches in its travel direction and settles on the real target',()=>{
 const state=createGlassSpring(rect());targetGlassSpring(state,rect(210,0,140));
 const first=stepGlassSpring(state,1/60);
 assert(first.rect.x>0&&first.rect.x<210);assert(first.stretch>0);assert.equal(first.rect.x,state.values.x);
 let result=first;for(let i=0;i<180&&result.moving;i++)result=stepGlassSpring(state,1/60);
 assert.equal(result.moving,false);assert.deepEqual(result.rect,rect(210,0,140));
});
test('rapid reversal retains position and velocity instead of jumping',()=>{
 const state=createGlassSpring(rect(0,0));targetGlassSpring(state,rect(0,240));
 for(let i=0;i<8;i++)stepGlassSpring(state,1/60,{axis:'y'});
 const before={position:state.values.y,velocity:state.velocity.y};targetGlassSpring(state,rect(0,20));
 assert.equal(state.values.y,before.position);assert.equal(state.velocity.y,before.velocity);
 let result;for(let i=0;i<180;i++)result=stepGlassSpring(state,1/60,{axis:'y'});
 assert.deepEqual(result.rect,rect(0,20));assert.equal(result.stretch,0);
});
test('reduced motion snaps immediately and clears residual momentum',()=>{
 const state=createGlassSpring(rect());targetGlassSpring(state,rect(300));stepGlassSpring(state,1/60);
 const result=stepGlassSpring(state,1/60,{reduced:true});assert.deepEqual(result,{rect:rect(300),moving:false,stretch:0});assert.equal(state.velocity.x,0);
});
test('background-tab frame gaps cannot explode the spring',()=>{
 const state=createGlassSpring(rect());targetGlassSpring(state,rect(600,0,80));
 for(let i=0;i<80;i++){const result=stepGlassSpring(state,5);assert(Object.values(result.rect).every(Number.isFinite));assert(result.rect.width>0&&result.rect.height>0);}
 assert.deepEqual(state.values,rect(600,0,80));
});
