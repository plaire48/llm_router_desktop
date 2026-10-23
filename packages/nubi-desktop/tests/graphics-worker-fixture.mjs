// Test-only GPU observation and context loss live outside the product protocol.
import {installAtmosphereWorker} from '../ui/atmosphere-worker-host.mjs';
import {createAtmosphereRenderer} from '../ui/atmosphere-renderer.mjs';
import {createGlassRenderer} from '../ui/liquid-glass/renderer.mjs';
export const graphicsProbeURL=import.meta.url;
if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope){
 let gl,extension;
 installAtmosphereWorker(globalThis,async(canvas,kind,options)=>{
  const renderer=kind==='ring'?(await import('../ui/glass-ring-renderer.mjs')).createGlassRingRenderer(canvas,options):kind==='glass'?createGlassRenderer(canvas):createAtmosphereRenderer(canvas);if(!renderer)return null;
  gl=canvas.getContext(kind==='ring'?'webgl2':'webgl');extension=gl.getExtension('WEBGL_lose_context');const draw=renderer.draw;
  return {...renderer,draw(...args){draw(...args);const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)visible++;postMessage({type:'probe-pixels',visible,error:gl.getError(),extension:!!extension});}};
 });
 addEventListener('message',event=>{if(event.data?.type==='probe-lose')extension?.loseContext();if(event.data?.type==='probe-restore')extension?.restoreContext();});
}
