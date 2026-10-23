import test from 'node:test';
import assert from 'node:assert/strict';
import {ATMOSPHERE_LIMITS,atmosphereSize,atmosphereBlobs,createAtmosphereMotion,stepAtmosphereMotion,atmosphereAllowed} from '../ui/atmosphere-model.mjs';
test('large and high-DPI backgrounds stay inside the fixed drawing budget',()=>{
 for(const [width,height,dpr] of [[3840,2160,2],[1280,900,1.5],[440,900,3],[300,150,1]]){const size=atmosphereSize(width,height,dpr);assert(size.width*size.height<=ATMOSPHERE_LIMITS.pixels);assert(size.width<=width&&size.height<=height);assert(Math.abs(size.width/size.height-width/height)<.02);}
 assert.deepEqual(atmosphereSize(Infinity,0),{width:1,height:1});
 const software=atmosphereSize(1920,1080,2,ATMOSPHERE_LIMITS.softwarePixels);assert(software.width*software.height<=24000);
 const excessive=atmosphereSize(1920,1080,2,1e9);assert(excessive.width*excessive.height<=ATMOSPHERE_LIMITS.pixels);
});
test('all six colour centres travel across both axes and change their overlap',()=>{
 const state=createAtmosphereMotion(),positions=Array.from({length:6},()=>({x:[],y:[]}));let overlap=false,separated=false;
 for(let second=0;second<150;second++){
  state.phase=second*Math.PI*2/48;const blobs=atmosphereBlobs(state);
  for(let i=0;i<6;i++){const [x,y,r]=blobs.slice(i*3,i*3+3);assert(x>=0&&x<=1&&y>=0&&y<=1);assert(r>.3&&r<.5);positions[i].x.push(x);positions[i].y.push(y);}
  const distance=Math.hypot(blobs[0]-blobs[3],blobs[1]-blobs[4]);overlap||=distance<blobs[2]+blobs[5];separated||=distance>blobs[2]+blobs[5];
 }
 for(const range of positions)for(const values of [range.x,range.y])assert(Math.max(...values)-Math.min(...values)>.6,'each form crosses the screen instead of staying at an edge');
 assert(overlap&&separated,'forms merge and separate');
});
test('the damped pointer response stays bounded at 60/120 Hz and after a long gap',()=>{
 const states=[60,120].map(hz=>{const state=createAtmosphereMotion();for(let i=0;i<hz*6;i++)stepAtmosphereMotion(state,1/hz,{x:.8,y:-.5});return state;});
 for(const key of Object.keys(states[0].values))assert(Math.abs(states[0].values[key]-states[1].values[key])<.003,key);
 const before=states[0].phase;stepAtmosphereMotion(states[0],3600,{x:Infinity,y:NaN});assert(states[0].phase-before<.02);assert(Object.values(states[0].values).every(Number.isFinite));
});
test('only the requested foreground screens animate; ordinary forms and preparation are excluded',()=>{
 assert(atmosphereAllowed({scene:'intro',opening:true}));assert(atmosphereAllowed({scene:'workspace'}));assert(!atmosphereAllowed({scene:'workspace',opening:true}));assert(atmosphereAllowed({scene:'project',switching:true}));assert(!atmosphereAllowed({scene:'project'}));assert(!atmosphereAllowed({scene:'workspace',switching:true}));
 for(const scene of ['form','preparing','mail','wiki','skills'])assert(!atmosphereAllowed({scene}));
 for(const change of [{hidden:true},{windowHidden:true},{reduced:true},{forcedColors:true},{transition:true},{modal:true},{active:false},{visible:false}])assert(!atmosphereAllowed({scene:'workspace',...change}));
});
