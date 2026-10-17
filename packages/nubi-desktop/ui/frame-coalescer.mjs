// Keep the latest visual update for the next paint; state/approval commits do
// not use this queue. Cancellation drops work after unmount or an aborted drag.
export function frameCoalescer(callback,{request=requestAnimationFrame,cancel=cancelAnimationFrame}={}){
 let frame=null,value;
 const clear=()=>{if(frame!==null)cancel(frame);frame=null;value=undefined;};
 return {
  schedule(next){value=next;if(frame!==null)return;frame=request(()=>{frame=null;const latest=value;value=undefined;callback(latest);});},
  cancel:clear
 };
}
