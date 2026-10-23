// Damped spring and directional stretch from the supplied demo. Integrate its
// exact solution so display refresh rates do not change damping or velocity.
// Preserve momentum when targets change; never move the application controls.
export const REFERENCE_SPRING=Object.freeze({stiffness:220,damping:25,stretch:.061,maxStretch:55,maxStep:.1});
export function createGlassSpring(rect){
 return {target:{...rect},values:{...rect},velocity:{x:0,y:0,width:0,height:0}};
}
export function targetGlassSpring(state,rect,{snap=false}={}){
 state.target={...rect};
 if(snap){state.values={...rect};for(const key of Object.keys(state.velocity))state.velocity[key]=0;}
}
export function stepGlassSpring(state,seconds,{reduced=false,axis='x'}={}){
 const dt=Math.min(REFERENCE_SPRING.maxStep,Math.max(0,seconds));let moving=false;
 const decay=Math.exp(-12.5*dt),frequency=Math.sqrt(220-12.5**2),cos=Math.cos(frequency*dt),sin=Math.sin(frequency*dt)/frequency;
 for(const key of ['x','y','width','height']){
  if(reduced){state.values[key]=state.target[key];state.velocity[key]=0;continue;}
  const displacement=state.values[key]-state.target[key],velocity=state.velocity[key];
  state.values[key]=state.target[key]+decay*(displacement*cos+(velocity+12.5*displacement)*sin);
  state.velocity[key]=decay*(velocity*cos-(12.5*velocity+220*displacement)*sin);
  if(Math.abs(state.target[key]-state.values[key])<.02&&Math.abs(state.velocity[key])<.04){state.values[key]=state.target[key];state.velocity[key]=0;}
  else moving=true;
 }
 const speed=state.velocity[axis],stretch=reduced?0:Math.min(55,Math.abs(speed)*.061),rect={...state.values};
 rect[axis]+=speed<0?-stretch:0;rect[axis==='y'?'height':'width']+=stretch;
 return {rect,moving,stretch};
}
