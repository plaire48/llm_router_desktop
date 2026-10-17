import {execFile} from 'node:child_process';
import path from 'node:path';

// Recheck the owned ChildProcess after taskkill: a launch/exit race must not
// leave cancellation waiting forever. Never kill by image name or retry a PID
// after this child has exited, when Windows may already have reused that PID.
export function stopWindowsProcess(child,{isActive,onAttempt=()=>{},onResult=()=>{},onUnconfirmed=()=>{},execute=execFile,systemRoot=process.env.SystemRoot||'C:\\Windows',retryMs=250,timeoutMs=3500}={}){
 let attempts=0,timer,closed=false;
 const cleanup=()=>{closed=true;clearTimeout(timer);child.removeListener('close',cleanup);};
 child.once('close',cleanup);
 const attempt=()=>{
  if(closed||!isActive()||!Number.isInteger(child.pid)||child.pid<=0){cleanup();return;}
  if(child.exitCode!==null&&child.exitCode!==undefined){onUnconfirmed();cleanup();return;}
  attempts++;onAttempt(attempts);
  execute(path.win32.join(systemRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,timeout:timeoutMs},error=>{
   if(closed||!isActive()){cleanup();return;}
   onResult(error?(typeof error.code==='number'?error.code:error.killed?'timeout':'failed'):0);
   timer=setTimeout(()=>{
    if(closed||!isActive()){cleanup();return;}
    if(attempts<3)attempt();else{onUnconfirmed();cleanup();}
   },retryMs);timer.unref?.();
  });
 };
 attempt();return cleanup;
}
