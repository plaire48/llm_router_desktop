// A bounded decorative colour field, not a computational fluid solver.
export const ATMOSPHERE_LIMITS=Object.freeze({pixels:64000,softwarePixels:24000,ringPixels:160000,ringSoftwarePixels:64000,maxStep:.05});
export function atmosphereSize(width,height,dpr=1,budget=ATMOSPHERE_LIMITS.pixels){
 if(![width,height,dpr].every(Number.isFinite)||width<=0||height<=0||dpr<=0)return {width:1,height:1};
 const ratio=Math.min(1,dpr,Math.sqrt(Math.min(ATMOSPHERE_LIMITS.pixels,Number.isFinite(budget)&&budget>0?budget:ATMOSPHERE_LIMITS.pixels)/(width*height)));
 return {width:Math.max(1,Math.floor(width*ratio)),height:Math.max(1,Math.floor(height*ratio))};
}
export function createAtmosphereMotion(){return {phase:0,elapsed:0,values:{x:0,y:0},velocity:{x:0,y:0}};}
export function stepAtmosphereMotion(state,seconds,pointer={x:0,y:0},{cycle=48}={}){
 const dt=Math.min(ATMOSPHERE_LIMITS.maxStep,Math.max(0,Number.isFinite(seconds)?seconds:0));state.phase+=dt*Math.PI*2/(cycle>0?cycle:48);state.elapsed+=dt;
 const clamp=value=>Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));
 const decay=Math.exp(-4*dt),cos=Math.cos(4*dt),sin=Math.sin(4*dt)/4;
 for(const key of ['x','y']){
  const target=clamp(pointer[key])*.025,distance=state.values[key]-target,velocity=state.velocity[key];
  state.values[key]=target+decay*(distance*cos+(velocity+4*distance)*sin);
  state.velocity[key]=decay*(velocity*cos-(4*velocity+32*distance)*sin);
 }
 return state;
}
export function atmosphereBlobs(state,out=new Float32Array(18)){
 const t=state.phase;
 for(let i=0;i<6;i++){
  const phase=i*Math.PI*2/6,angle=t*(.72+i*.065)+phase;
  out[i*3]=.5+.36*Math.sin(angle)+.065*Math.sin(t*1.31+phase*2)+state.values.x;
  out[i*3+1]=.5+.34*Math.cos(t*(.91+i*.045)+phase*1.7)+.065*Math.sin(angle*1.4)+state.values.y;
  out[i*3+2]=.38+.055*Math.sin(t*.67+phase);
 }
 return out;
}
export function atmosphereAllowed({active=true,visible=true,hidden=false,reduced=false,forcedColors=false,windowHidden=false,transition=false,opening=false,switching=false,modal=false,scene='intro'}){
 if(!['intro','project','workspace'].includes(scene))return false;
 if(!active||!visible||hidden||reduced||forcedColors||windowHidden||transition||modal)return false;
 if(scene==='intro')return true;
 if(opening)return false;
 return scene==='project'?switching:!switching;
}
