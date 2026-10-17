import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const app=spawn(require('electron'),['scripts/development-browser-host.cjs',process.execPath],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:['ignore','inherit','inherit']});
let timer;
try{const code=await Promise.race([new Promise((resolve,reject)=>{app.once('exit',resolve);app.once('error',reject);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('development_browser_timeout')),70000);})]);if(code!==0)throw Error('development_browser_failed:'+code);}
finally{clearTimeout(timer);if(app.exitCode===null)app.kill('SIGTERM');}
