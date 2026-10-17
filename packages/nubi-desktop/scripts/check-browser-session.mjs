import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url),profile=await mkdtemp(path.join(os.tmpdir(),'nubi-browser-session-check-'));
try{for(const stage of ['write','read']){
 const child=spawn(require('electron'),['scripts/browser-session-check-host.cjs',profile,stage],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:['ignore','inherit','inherit']});
 const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
 try{const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});if(code!==0)throw Error('browser_session_check_failed:'+stage);}finally{clearTimeout(timer);}
}}finally{await rm(profile,{recursive:true,force:true});}
