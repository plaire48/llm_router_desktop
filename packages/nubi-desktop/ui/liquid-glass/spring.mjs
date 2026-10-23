// Semi-implicit damped spring and directional stretch from the supplied demo.
// Preserve momentum when targets change; never move the application controls.
export const REFERENCE_SPRING=Object.freeze({stiffness:220,damping:25,stretch:.061,maxStretch:55,maxStep:.04});
export function createGlassSpring(rect){
 return {target:{...rect},values:{...rect},velocity:{x:0,y:0,width:0,height:0}};
}
export function targetGlassSpring(state,rect,{snap=false}={}){
 state.target={...rect};
 if(snap){state.values={...rect};for(const key of Object.keys(state.velocity))state.velocity[key]=0;}
}
export function stepGlassSpring(state,seconds,{reduced=false,axis='x'}={}){
 const dt=Math.min(REFERENCE_SPRING.maxStep,Math.max(0,seconds));let moving=false;
 for(const key of ['x','y','width','height']){
  if(reduced){state.values[key]=state.target[key];state.velocity[key]=0;continue;}
  const a=220*(state.target[key]-state.values[key])-25*state.velocity[key];
  state.velocity[key]+=a*dt;state.values[key]+=state.velocity[key]*dt;
  if(Math.abs(state.target[key]-state.values[key])<.02&&Math.abs(state.velocity[key])<.04){state.values[key]=state.target[key];state.velocity[key]=0;}
  else moving=true;
 }
 const speed=state.velocity[axis],stretch=reduced?0:Math.min(55,Math.abs(speed)*.061),rect={...state.values};
 rect[axis]+=speed<0?-stretch:0;rect[axis==='y'?'height':'width']+=stretch;
 return {rect,moving,stretch};
}
