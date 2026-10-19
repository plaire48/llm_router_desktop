// Analytic under-damped step response. Time is normalized to the enter token,
// not a JS animation timer. No spring/animation dependency is shipped.
import {pathToFileURL} from 'node:url';
export function springSamples(){
 const physics={stiffness:300,damping:26,mass:1},w=Math.sqrt(physics.stiffness/physics.mass),z=physics.damping/(2*Math.sqrt(physics.stiffness*physics.mass)),wd=w*Math.sqrt(1-z*z);
 const values=Array.from({length:61},(_,i)=>{const t=i/60*.7;return i===0?0:i===60?1:Number((1-Math.exp(-z*w*t)*(Math.cos(wd*t)+z*w/wd*Math.sin(wd*t))).toFixed(5));});
 return {physics,values,css:`linear(${values.map((value,i)=>`${value} ${(i/60*100).toFixed(3)}%`).join(', ')})`};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(springSamples().css);
