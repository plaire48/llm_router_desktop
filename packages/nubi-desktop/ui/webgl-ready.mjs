// KHR completion polling does not force the GPU driver to finish compilation.
// Never ask for shader status or uniforms until linking has completed. Without
// the extension, yield the current input/paint task before the one status read.
export function waitForWebGLProgram(gl,program){
 const parallel=gl.getExtension('KHR_parallel_shader_compile');
 let timer,settled=false,resolve;const started=performance.now();
 const ready=new Promise(done=>resolve=done);
 const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
 const poll=()=>{
  if(settled)return;
  try{
   if(gl.isContextLost?.()||performance.now()-started>10000){finish(false);return;}
   if(parallel&&!gl.getProgramParameter(program,parallel.COMPLETION_STATUS_KHR)){timer=setTimeout(poll,16);return;}
   finish(!!gl.getProgramParameter(program,gl.LINK_STATUS));
  }catch{finish(false);}
 };
 timer=setTimeout(poll,0);
 return {ready,cancel:()=>finish(false)};
}
