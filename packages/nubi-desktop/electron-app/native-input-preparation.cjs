// Startup-only preparation. Never click, focus a control, type, or replay an event.
const preparations=new WeakMap();
const paint="new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))";
function prepareNativeInput(window,{timeoutMs=1500}={}){
 const startedAt=performance.now();let contents,pid;
 const failed=error=>({status:'failed',sent:false,error,durationMs:performance.now()-startedAt});
 try{if(window?.isDestroyed()||(contents=window?.webContents)?.isDestroyed())return Promise.resolve(failed('native_input_host_closed'));pid=contents?.getOSProcessId?.();if(!Number.isInteger(pid)||pid<=0||typeof contents.sendInputEvent!=='function'||typeof contents.executeJavaScript!=='function')return Promise.resolve(failed('native_input_unsupported'));}catch{return Promise.resolve(failed('native_input_host_closed'));}
 const cached=preparations.get(contents);if(cached?.pid===pid)return cached.promise;
 let cancelled=false,sent=false,timer;const phases={};
 const work=(async()=>{
  try{
   await contents.executeJavaScript(paint);phases.firstPaintMs=performance.now()-startedAt;
   if(cancelled)return;
   if(window.isDestroyed()||contents.isDestroyed()||contents.getOSProcessId()!==pid)throw Error();
   contents.sendInputEvent({type:'mouseMove',x:-1,y:-1});sent=true;phases.dispatchMs=performance.now()-startedAt;
   await contents.executeJavaScript(paint);
   if(cancelled)return;
   if(window.isDestroyed()||contents.isDestroyed()||contents.getOSProcessId()!==pid)throw Error();
   return {status:'ready',sent,pid,...phases,durationMs:performance.now()-startedAt};
  }catch{return {...failed('native_input_failed'),sent,pid,...phases};}
 })();
 const timeout=new Promise(resolve=>{timer=setTimeout(()=>{cancelled=true;resolve({...failed('native_input_timeout'),sent,pid,...phases});},timeoutMs);});
 const promise=Promise.race([work,timeout]).finally(()=>clearTimeout(timer));preparations.set(contents,{pid,promise});return promise;
}
module.exports={prepareNativeInput};
