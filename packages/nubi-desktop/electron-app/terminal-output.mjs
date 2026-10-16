// Preserve PTY order across frame batching, including an exit in the same frame.
export function terminalOutputBatch(write,{schedule=requestAnimationFrame,cancel=cancelAnimationFrame}={}){
 let pending='',frame=null;
 const flush=()=>{if(frame!==null)cancel(frame);frame=null;const data=pending;pending='';if(data)write(data);};
 return {
  push(data){pending+=data;if(frame===null)frame=schedule(flush);},
  flush,
  dispose(){if(frame!==null)cancel(frame);frame=null;pending='';}
 };
}
